import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import type { PrismaTx, TokenPurpose, VerificationToken } from '@homeservicemarketplace/database';

import { lockAuthAccount } from '../../../../infrastructure/persistence/iam/auth-account-lock';
import { AppConfigService } from '../../../../config/app-config.service';
import { VerificationTokenRepository } from '../../../../infrastructure/persistence/iam/verification-token.repository';

// Limits. The numbers are conservative: short-lived, few attempts, fewer
// resends. Increasing them should be a deliberate security decision.
export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_RESENDS = 3;

export type OtpPurpose = Extract<TokenPurpose, 'REGISTRATION_OTP' | 'LOGIN_OTP'>;

export interface IssuedOtpChallenge {
  challengeId: string;
  rawCode: string; // sent to the user by email; never persisted
  expiresAt: Date;
  expiresInSeconds: number;
}

export interface ConsumedOtp {
  userId: string;
  purpose: OtpPurpose;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly repo: VerificationTokenRepository,
    private readonly config: AppConfigService,
  ) {}

  // --- Issue -------------------------------------------------------------
  // Creates a fresh challenge for the user, invalidating any outstanding
  // OTP of the same purpose in the same transaction. Returns the raw code
  // so the caller can send it by email (never store, never log).
  async issue(userId: string, purpose: OtpPurpose, tx?: PrismaTx): Promise<IssuedOtpChallenge> {
    if (tx) await lockAuthAccount(tx, userId);
    await this.repo.invalidateOutstanding(userId, purpose, tx);

    const rawCode = generateNumericCode(OTP_CODE_LENGTH);
    const challengeId = randomBytes(24).toString('base64url');
    const tokenHash = this.hashChallenge(rawCode, challengeId);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.repo.create({ userId, tokenHash, purpose, expiresAt, challengeId }, tx);

    return {
      challengeId,
      rawCode,
      expiresAt,
      expiresInSeconds: OTP_TTL_MINUTES * 60,
    };
  }

  /** Wrong-code bookkeeping must commit on the caller's SAME connection.
   * Returning a domain rejection avoids rolling it back, without an independent
   * connection that could deadlock a saturated interactive-transaction pool.
   * Infrastructure errors still throw and roll back; they are not bad codes.
   */
  async verifyForLogin(challengeId: string, rawCode: string, tx: PrismaTx): Promise<
    { consumed: ConsumedOtp } | { rejection: BadRequestException | ForbiddenException }
  > {
    try { return { consumed: await this.verify(challengeId, rawCode, tx) }; }
    catch (error) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException) return { rejection: error };
      throw error;
    }
  }

  // --- Verify ------------------------------------------------------------
  // Returns { userId, purpose } when the code matches and the challenge is
  // still live. Throws a normalized AUTH_OTP_* error otherwise. The purpose
  // returned is the one stored in the DB — the caller (AuthenticationService)
  // is the only place that maps purpose → behavior (issue session, etc.).
  // Transactional login callers MUST use verifyForLogin and commit its verdict.
  async verify(challengeId: string, rawCode: string, tx?: PrismaTx): Promise<ConsumedOtp> {
    let row = await this.repo.findByChallengeId(challengeId, tx);
    if (row && tx) {
      await lockAuthAccount(tx, row.userId);
      row = await this.repo.findByChallengeId(challengeId, tx);
    }
    assertLiveOtp(row);

    // Re-check after the account lock. Reset revokes outstanding challenges
    // before releasing that same lock; no pre-reset OTP can create a new session.
    // Legacy unexpired hashes remain valid; all new codes are challenge-scoped.
    const supplied = this.hashChallenge(rawCode, challengeId, row.tokenHash);
    const consumed = await this.repo.consumeByChallenge(challengeId, supplied, tx, OTP_MAX_ATTEMPTS);

    if (!consumed) {
      // A correct-but-expired/raced code is not a wrong-code attempt. Wrong
      // attempts belong to the same transaction. verifyForLogin returns their
      // rejection as a verdict so AuthenticationService commits before throwing.
      if (supplied !== row.tokenHash) {
        const after = await this.repo.recordFailedAttempt(challengeId, row.tokenHash, OTP_MAX_ATTEMPTS, tx);
        if (after && after.attemptCount >= OTP_MAX_ATTEMPTS) {
          throw new ForbiddenException({ code: 'AUTH_OTP_LOCKED' });
        }
      }
      assertLiveOtp(await this.repo.findByChallengeId(challengeId, tx));
      throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
    }

    return { userId: consumed.userId, purpose: consumed.purpose as OtpPurpose };
  }

  // --- Resend ------------------------------------------------------------
  // Replaces the code behind an existing challengeId so the client can
  // stay on the same verification screen. Returns the new raw code for
  // sending. Throttled by resendCount; the underlying row is only rotated
  // if it's still live (not consumed, not expired).
  async resend(
    challengeId: string,
    tx?: PrismaTx,
  ): Promise<{ rawCode: string; userId: string; purpose: OtpPurpose; expiresInSeconds: number }> {
    let row = await this.repo.findByChallengeId(challengeId, tx);
    if (row && tx) {
      await lockAuthAccount(tx, row.userId);
      row = await this.repo.findByChallengeId(challengeId, tx);
    }
    assertLiveOtp(row);
    if (row!.resendCount >= OTP_MAX_RESENDS) {
      throw new ForbiddenException({ code: 'AUTH_OTP_RESEND_EXCEEDED' });
    }

    let rawCode: string;
    do { rawCode = generateNumericCode(OTP_CODE_LENGTH); }
    while (this.hashChallenge(rawCode, challengeId, row.tokenHash) === row.tokenHash);
    const tokenHash = this.hashChallenge(rawCode, challengeId);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    const rotated = await this.repo.rotateLiveChallenge(challengeId, row.tokenHash,
      { tokenHash, expiresAt }, { attempts: OTP_MAX_ATTEMPTS, resends: OTP_MAX_RESENDS }, tx);
    if (!rotated) {
      const latest = await this.repo.findByChallengeId(challengeId, tx);
      assertLiveOtp(latest);
      if (latest.resendCount >= OTP_MAX_RESENDS) {
        throw new ForbiddenException({ code: 'AUTH_OTP_RESEND_EXCEEDED' });
      }
      throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
    }

    return {
      rawCode,
      userId: row!.userId,
      purpose: row!.purpose as OtpPurpose,
      expiresInSeconds: OTP_TTL_MINUTES * 60,
    };
  }

  // Domain-separated keyed hashing protects short numeric codes against an
  // offline database-only guess. Rotating the signing secret expires pending
  // keyed challenges; request a new code. Legacy live challenges drain naturally.
  private hashChallenge(raw: string, challengeId: string, stored?: string): string {
    if (stored && !stored.startsWith('otp-v3:')) {
      return hashCode(raw, stored.startsWith('otp-v2:') ? challengeId : undefined);
    }
    const secret = this.config.get('JWT_ACCESS_SECRET');
    if (typeof secret !== 'string' || secret.length < 32) throw new Error('OTP hashing requires the validated authentication secret');
    return hashCode(raw, challengeId, secret);
  }

  // --- Helpers exposed for tests ----------------------------------------
  static hashForTest(raw: string, challengeId?: string, secret?: string): string {
    return hashCode(raw, challengeId, secret);
  }
}

function hashCode(raw: string, challengeId?: string, secret?: string): string {
  if (secret && challengeId) return 'otp-v3:' + createHmac('sha256', secret)
    .update(`hsm:email-otp:v3\0${challengeId}\0${raw}`).digest('hex');
  if (!challengeId) return createHash('sha256').update(raw).digest('hex');
  return 'otp-v2:' + createHash('sha256').update(`${challengeId}\0${raw}`).digest('hex');
}

function generateNumericCode(length: number): string {
  // crypto.randomInt is unbiased across the range. We generate one digit
  // at a time to avoid leading-zero bias when formatting a single integer.
  let out = '';
  for (let i = 0; i < length; i++) out += randomInt(0, 10).toString();
  return out;
}

function assertLiveOtp(row: VerificationToken | null): asserts row is VerificationToken {
  if (!row || !['REGISTRATION_OTP', 'LOGIN_OTP'].includes(row.purpose)) {
    throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
  }
  if (row.usedAt !== null) throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
  // Lockout remains authoritative even after expiry. The conditional update
  // stops at the ceiling; rejection must never reset a persisted attempt.
  if (row.attemptCount >= OTP_MAX_ATTEMPTS) {
    throw new ForbiddenException({ code: 'AUTH_OTP_LOCKED' });
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new BadRequestException({ code: 'AUTH_OTP_EXPIRED' });
  }
}
