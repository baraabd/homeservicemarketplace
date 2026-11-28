import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import type { PrismaTx, TokenPurpose, VerificationToken } from '@homeservicemarketplace/database';

import { lockAuthAccount } from '../../../../infrastructure/persistence/iam/auth-account-lock';
import { AppConfigService } from '../../../../config/app-config.service';
import { VerificationTokenRepository } from '../../../../infrastructure/persistence/iam/verification-token.repository';
import {
  assertOtpChallengeId,
  assertOtpCode,
  hashOtpCode,
  isWhatsAppLoginChallenge,
  OTP_HASH_PREFIX,
  WHATSAPP_LOGIN_CHALLENGE_PREFIX,
} from '../helpers/otp-codec';

// Limits. The numbers are conservative: short-lived, few attempts, fewer
// resends. Increasing them should be a deliberate security decision.
export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_RESENDS = 3;

export type OtpPurpose = Extract<
  TokenPurpose,
  | 'REGISTRATION_OTP'
  | 'LOGIN_OTP'
  | 'PASSWORD_RESET_OTP'
  | 'PHONE_VERIFICATION_OTP'
  | 'EMAIL_CONTACT_OTP'
>;

export interface IssuedOtpChallenge {
  challengeId: string;
  rawCode: string; // sent to the user by email; never persisted
  expiresAt: Date;
  expiresInSeconds: number;
}

/** Internal prepared material; never serialize the digest into an API response. */
export interface PreparedOtpChallenge {
  readonly challengeId: string;
  readonly rawCode: string;
  readonly tokenHash: string;
}

export interface OtpDeliveryBinding {
  channel: 'email' | 'whatsapp';
  destination: string;
}

export interface ConsumedOtp {
  userId: string;
  purpose: OtpPurpose;
  channel?: 'email' | 'whatsapp';
  destination?: string;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly repo: VerificationTokenRepository,
    private readonly config: AppConfigService,
  ) {}

  /** Anonymous account lookup paths prepare once even for neutral responses. */
  async prepare(
    purpose?: OtpPurpose,
    delivery?: OtpDeliveryBinding,
  ): Promise<PreparedOtpChallenge> {
    const rawCode = generateNumericCode(OTP_CODE_LENGTH);
    const prefix =
      purpose === 'LOGIN_OTP' && delivery?.channel === 'whatsapp'
        ? WHATSAPP_LOGIN_CHALLENGE_PREFIX
        : '';
    const challengeId = prefix + randomBytes(24).toString('base64url');
    const tokenHash = await this.hashChallenge(rawCode, challengeId);
    return { rawCode, challengeId, tokenHash };
  }

  // --- Issue -------------------------------------------------------------
  // Creates a fresh challenge for the user, invalidating any outstanding
  // OTP of the same purpose in the same transaction. Returns the raw code
  // so the caller can send it by email (never store, never log).
  async issue(
    userId: string,
    purpose: OtpPurpose,
    tx?: PrismaTx,
    delivery?: OtpDeliveryBinding,
    prepared?: PreparedOtpChallenge,
  ): Promise<IssuedOtpChallenge> {
    if (tx) await lockAuthAccount(tx, userId);
    await this.repo.invalidateOutstanding(userId, purpose, tx);

    const { rawCode, challengeId, tokenHash } = prepared ?? (await this.prepare(purpose, delivery));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.repo.create(
      {
        userId,
        tokenHash,
        purpose,
        expiresAt,
        challengeId,
        ...(delivery
          ? { deliveryChannel: delivery.channel, deliveryTarget: delivery.destination }
          : {}),
      },
      tx,
    );

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
  async verifyForLogin(
    challengeId: string,
    rawCode: string,
    tx: PrismaTx,
  ): Promise<{ consumed: ConsumedOtp } | { rejection: BadRequestException | ForbiddenException }> {
    return this.verifyForPurposes(challengeId, rawCode, tx, ['REGISTRATION_OTP', 'LOGIN_OTP']);
  }

  async verifyForPasswordReset(challengeId: string, rawCode: string, tx: PrismaTx) {
    return this.verifyForPurposes(challengeId, rawCode, tx, ['PASSWORD_RESET_OTP']);
  }

  async verifyForPhoneEnrollment(challengeId: string, rawCode: string, tx: PrismaTx) {
    return this.verifyForPurposes(challengeId, rawCode, tx, ['PHONE_VERIFICATION_OTP']);
  }

  async verifyForEmailEnrollment(challengeId: string, rawCode: string, tx: PrismaTx) {
    return this.verifyForPurposes(challengeId, rawCode, tx, ['EMAIL_CONTACT_OTP']);
  }

  private async verifyForPurposes(
    challengeId: string,
    rawCode: string,
    tx: PrismaTx,
    purposes: OtpPurpose[],
  ): Promise<{ consumed: ConsumedOtp } | { rejection: BadRequestException | ForbiddenException }> {
    try {
      return { consumed: await this.verify(challengeId, rawCode, tx, purposes) };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException)
        return { rejection: error };
      throw error;
    }
  }

  // --- Verify ------------------------------------------------------------
  // Returns { userId, purpose } when the code matches and the challenge is
  // still live. Throws a normalized AUTH_OTP_* error otherwise. The purpose
  // returned is the one stored in the DB — the caller (AuthenticationService)
  // is the only place that maps purpose → behavior (issue session, etc.).
  // Transactional login callers MUST use verifyForLogin and commit its verdict.
  async verify(
    challengeId: string,
    rawCode: string,
    tx?: PrismaTx,
    allowedPurposes: OtpPurpose[] = ['REGISTRATION_OTP', 'LOGIN_OTP'],
  ): Promise<ConsumedOtp> {
    assertOtpChallengeId(challengeId);
    assertOtpCode(rawCode);
    // Anonymous WhatsApp login must pay the same one bounded KDF for unknown,
    // expired, used, locked and live challenges before inspecting stored state.
    const preparedHash = isWhatsAppLoginChallenge(challengeId)
      ? await this.hashChallenge(rawCode, challengeId)
      : undefined;
    let row = await this.repo.findByChallengeId(challengeId, tx);
    if (row && tx) {
      await lockAuthAccount(tx, row.userId);
      row = await this.repo.findByChallengeId(challengeId, tx);
    }
    if (!row) {
      // Neutral envelopes must not be distinguishable by skipping verification
      // work. Syntax was bounded above, so this always has the fixed KDF cost.
      if (preparedHash === undefined) await this.hashChallenge(rawCode, challengeId);
      throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
    }
    assertChallengeScope(challengeId, row);
    assertLiveOtp(row);
    if (!allowedPurposes.includes(row.purpose as OtpPurpose))
      throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });

    // Re-check after the account lock. Reset revokes outstanding challenges
    // before releasing that same lock; no pre-reset OTP can create a new session.
    // Pre-v4 codes require a resend; identity, destination and attempt counters
    // remain intact. Never compute a deprecated fast digest for verification.
    if (!row.tokenHash.startsWith(OTP_HASH_PREFIX))
      throw new BadRequestException({ code: 'AUTH_OTP_EXPIRED' });
    const supplied = preparedHash ?? (await this.hashChallenge(rawCode, challengeId));
    const consumed = await this.repo.consumeByChallenge(
      challengeId,
      supplied,
      tx,
      OTP_MAX_ATTEMPTS,
    );

    if (!consumed) {
      // A correct-but-expired/raced code is not a wrong-code attempt. Wrong
      // attempts belong to the same transaction. verifyForLogin returns their
      // rejection as a verdict so AuthenticationService commits before throwing.
      if (supplied !== row.tokenHash) {
        const after = await this.repo.recordFailedAttempt(
          challengeId,
          row.tokenHash,
          OTP_MAX_ATTEMPTS,
          tx,
        );
        if (after && after.attemptCount >= OTP_MAX_ATTEMPTS) {
          throw new ForbiddenException({ code: 'AUTH_OTP_LOCKED' });
        }
      }
      assertLiveOtp(await this.repo.findByChallengeId(challengeId, tx));
      throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
    }

    return {
      userId: consumed.userId,
      purpose: consumed.purpose as OtpPurpose,
      ...deliveryBinding(consumed),
    };
  }

  // --- Resend ------------------------------------------------------------
  // Replaces the code behind an existing challengeId so the client can
  // stay on the same verification screen. Returns the new raw code for
  // sending. Throttled by resendCount; the underlying row is only rotated
  // if it's still live (not consumed, not expired).
  async resend(
    challengeId: string,
    tx?: PrismaTx,
  ): Promise<{
    rawCode: string;
    userId: string;
    purpose: OtpPurpose;
    expiresInSeconds: number;
    channel?: 'email' | 'whatsapp';
    destination?: string;
  }> {
    assertOtpChallengeId(challengeId);
    const preparedCode = isWhatsAppLoginChallenge(challengeId)
      ? generateNumericCode(OTP_CODE_LENGTH)
      : undefined;
    const preparedHash =
      preparedCode === undefined ? undefined : await this.hashChallenge(preparedCode, challengeId);
    let row = await this.repo.findByChallengeId(challengeId, tx);
    if (row && tx) {
      await lockAuthAccount(tx, row.userId);
      row = await this.repo.findByChallengeId(challengeId, tx);
    }
    if (!row) {
      // Neutral registration/recovery envelopes contain well-formed random
      // IDs too. A missing challenge performs the same one KDF as a live resend.
      if (preparedHash === undefined)
        await this.hashChallenge(generateNumericCode(OTP_CODE_LENGTH), challengeId);
      throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
    }
    assertChallengeScope(challengeId, row);
    assertLiveOtp(row);
    if (row!.resendCount >= OTP_MAX_RESENDS) {
      throw new ForbiddenException({ code: 'AUTH_OTP_RESEND_EXCEEDED' });
    }

    let rawCode: string;
    let tokenHash: string;
    if (preparedCode !== undefined && preparedHash !== undefined) {
      // A one-in-a-million repeated code leaves the current challenge intact.
      // Do not add account-dependent KDF work or send the same code as a rotation.
      if (preparedHash === row.tokenHash)
        throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
      rawCode = preparedCode;
      tokenHash = preparedHash;
    } else {
      do {
        rawCode = generateNumericCode(OTP_CODE_LENGTH);
        tokenHash = await this.hashChallenge(rawCode, challengeId);
      } while (tokenHash === row.tokenHash);
    }
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    const rotated = await this.repo.rotateLiveChallenge(
      challengeId,
      row.tokenHash,
      { tokenHash, expiresAt },
      { attempts: OTP_MAX_ATTEMPTS, resends: OTP_MAX_RESENDS },
      tx,
    );
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
      ...deliveryBinding(row),
    };
  }

  // A server pepper protects database-only exposure; Argon2id adds bounded
  // memory-hard work. Rotating the secret requires a resend for pending codes.
  private hashChallenge(raw: string, challengeId: string): Promise<string> {
    const secret = this.config.get('JWT_ACCESS_SECRET');
    if (typeof secret !== 'string' || secret.length < 32)
      throw new Error('OTP hashing requires the validated authentication secret');
    return hashOtpCode(raw, challengeId, secret);
  }

  // --- Helpers exposed for tests ----------------------------------------
  static hashForTest(raw: string, challengeId: string, secret: string): Promise<string> {
    return hashOtpCode(raw, challengeId, secret);
  }
}

function generateNumericCode(length: number): string {
  // crypto.randomInt is unbiased across the range. We generate one digit
  // at a time to avoid leading-zero bias when formatting a single integer.
  let out = '';
  for (let i = 0; i < length; i++) out += randomInt(0, 10).toString();
  return out;
}

function assertLiveOtp(row: VerificationToken | null): asserts row is VerificationToken {
  if (
    !row ||
    ![
      'REGISTRATION_OTP',
      'LOGIN_OTP',
      'PASSWORD_RESET_OTP',
      'PHONE_VERIFICATION_OTP',
      'EMAIL_CONTACT_OTP',
    ].includes(row.purpose)
  ) {
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

function deliveryBinding(row: VerificationToken): Partial<OtpDeliveryBinding> {
  if (
    (row.deliveryChannel === 'email' || row.deliveryChannel === 'whatsapp') &&
    row.deliveryTarget
  ) {
    return { channel: row.deliveryChannel, destination: row.deliveryTarget };
  }
  return {};
}

function assertChallengeScope(challengeId: string, row: VerificationToken): void {
  if (
    isWhatsAppLoginChallenge(challengeId) &&
    (row.purpose !== 'LOGIN_OTP' || row.deliveryChannel !== 'whatsapp')
  )
    throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
}
