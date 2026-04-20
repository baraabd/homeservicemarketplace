import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { PrismaTx, TokenPurpose, VerificationToken } from '@homeservicemarketplace/database';

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
    await this.repo.invalidateOutstanding(userId, purpose, tx);

    const rawCode = generateNumericCode(OTP_CODE_LENGTH);
    const tokenHash = hashCode(rawCode);
    const challengeId = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.repo.create({ userId, tokenHash, purpose, expiresAt, challengeId }, tx);

    return {
      challengeId,
      rawCode,
      expiresAt,
      expiresInSeconds: OTP_TTL_MINUTES * 60,
    };
  }

  // --- Verify ------------------------------------------------------------
  // Returns { userId, purpose } when the code matches and the challenge is
  // still live. Throws a normalized AUTH_OTP_* error otherwise. The purpose
  // returned is the one stored in the DB — the caller (AuthenticationService)
  // is the only place that maps purpose → behavior (issue session, etc.).
  async verify(challengeId: string, rawCode: string, tx?: PrismaTx): Promise<ConsumedOtp> {
    const row = await this.repo.findByChallengeId(challengeId, tx);
    assertLiveOtp(row);

    // Atomic consumption: the updateMany in consumeByChallenge will only
    // flip usedAt if tokenHash matches AND the row is still unused. Prevents
    // TOCTOU races with a concurrent verify() call. Always increment the
    // attempt counter so lock-out works even for misses.
    const supplied = hashCode(rawCode);
    const consumed = await this.repo.consumeByChallenge(challengeId, supplied, tx);

    if (!consumed) {
      const after = await this.repo.incrementAttempt(challengeId, tx);
      if (after.attemptCount >= OTP_MAX_ATTEMPTS) {
        // Out of attempts: burn the challenge so a passer-by can't keep
        // grinding the remaining window. The user must request a fresh one
        // via /resend-otp (which itself is rate-limited) or re-login.
        await this.repo.rotateChallenge(
          challengeId,
          { tokenHash: 'locked:' + randomBytes(8).toString('hex'), expiresAt: new Date(0) },
          tx,
        );
        throw new ForbiddenException({ code: 'AUTH_OTP_LOCKED' });
      }
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
    const row = await this.repo.findByChallengeId(challengeId, tx);
    assertLiveOtp(row);
    if (row!.resendCount >= OTP_MAX_RESENDS) {
      throw new ForbiddenException({ code: 'AUTH_OTP_RESEND_EXCEEDED' });
    }

    const rawCode = generateNumericCode(OTP_CODE_LENGTH);
    const tokenHash = hashCode(rawCode);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    await this.repo.rotateChallenge(challengeId, { tokenHash, expiresAt }, tx);
    await this.repo.incrementResend(challengeId, tx);

    return {
      rawCode,
      userId: row!.userId,
      purpose: row!.purpose as OtpPurpose,
      expiresInSeconds: OTP_TTL_MINUTES * 60,
    };
  }

  // --- Helpers exposed for tests ----------------------------------------
  static hashForTest(raw: string): string {
    return hashCode(raw);
  }
}

function hashCode(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateNumericCode(length: number): string {
  // crypto.randomInt is unbiased across the range. We generate one digit
  // at a time to avoid leading-zero bias when formatting a single integer.
  let out = '';
  for (let i = 0; i < length; i++) out += randomInt(0, 10).toString();
  return out;
}

function assertLiveOtp(row: VerificationToken | null): asserts row is VerificationToken {
  if (!row) throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
  if (row.usedAt !== null) throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
  // Lock takes precedence over expiry: once a challenge is burned via
  // attempt lock-out, the expiresAt is also rewound to epoch, so without
  // this ordering a stale locked row would surface as AUTH_OTP_EXPIRED and
  // mask the true reason. The user-visible remedy is the same (request a
  // new OTP), but the audit + metrics pipeline cares about the distinction.
  if (row.attemptCount >= OTP_MAX_ATTEMPTS) {
    throw new ForbiddenException({ code: 'AUTH_OTP_LOCKED' });
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new BadRequestException({ code: 'AUTH_OTP_EXPIRED' });
  }
}
