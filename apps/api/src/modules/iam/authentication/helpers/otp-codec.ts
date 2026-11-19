import { BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';

export const OTP_HASH_PREFIX = 'otp-v4:';

export function assertOtpChallengeId(challengeId: string): void {
  if (typeof challengeId !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/u.test(challengeId))
    throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
}

export function assertOtpCode(rawCode: string): void {
  if (typeof rawCode !== 'string' || !/^[0-9]{6}$/u.test(rawCode))
    throw new BadRequestException({ code: 'AUTH_OTP_INVALID' });
}

/**
 * The random, public challenge identifier supplies a unique salt; the server
 * secret is an additional pepper and is never encoded in the stored digest.
 * Fixed Argon2id parameters bound each operation to the same 19 MiB / two
 * passes as account passwords. The deterministic digest preserves the token
 * repository's compare-and-swap and single-use transaction semantics.
 */
export async function hashOtpCode(
  rawCode: string,
  challengeId: string,
  secret: string,
): Promise<string> {
  assertOtpChallengeId(challengeId);
  assertOtpCode(rawCode);
  if (typeof secret !== 'string' || secret.length < 32)
    throw new Error('OTP hashing requires the validated authentication secret');
  return (
    OTP_HASH_PREFIX +
    (await argon2.hash(`hsm:otp:v4\0${rawCode}`, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
      salt: Buffer.from(challengeId, 'utf8'),
      secret: Buffer.from(secret, 'utf8'),
    }))
  );
}
