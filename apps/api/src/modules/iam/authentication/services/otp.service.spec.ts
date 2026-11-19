import { randomBytes } from 'node:crypto';
import type { VerificationToken } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../../../config/app-config.service';
import { VerificationTokenRepository } from '../../../../infrastructure/persistence/iam/verification-token.repository';
import { OTP_MAX_ATTEMPTS, OTP_MAX_RESENDS, OtpService } from './otp.service';
import * as otpCodec from '../helpers/otp-codec';

// Service-level invariants for OTP issuance, verification, resend, and
// lock-out. A fake repository backs every test — we're not testing Prisma,
// we're pinning the domain rules:
//   - codes have domain-separated keyed hashes at rest
//   - consumption is atomic (wrong code never flips usedAt)
//   - attempts lock the challenge out at OTP_MAX_ATTEMPTS
//   - resends are rate-limited at OTP_MAX_RESENDS
//   - expired rows are rejected even if usedAt is still null

function makeRow(overrides: Partial<VerificationToken> = {}): VerificationToken {
  const now = new Date();
  return {
    id: 't-1',
    userId: 'u-1',
    tokenHash: 'hash-placeholder',
    purpose: 'LOGIN_OTP',
    expiresAt: new Date(now.getTime() + 5 * 60_000),
    usedAt: null,
    createdAt: now,
    challengeId: 'chal-1',
    attemptCount: 0,
    resendCount: 0,
    deliveryChannel: null,
    deliveryTarget: null,
    ...overrides,
  };
}

function makeRepo() {
  let rows: VerificationToken[] = [];

  const findByChallengeId = jest.fn(
    async (challengeId: string) => rows.find((r) => r.challengeId === challengeId) ?? null,
  );
  const findByHash = jest.fn(async (h: string) => rows.find((r) => r.tokenHash === h) ?? null);
  const create = jest.fn(
    async (input: {
      userId: string;
      tokenHash: string;
      purpose: VerificationToken['purpose'];
      expiresAt: Date;
      challengeId?: string | null;
      deliveryChannel?: string | null;
      deliveryTarget?: string | null;
    }) => {
      const row = makeRow({ ...input, challengeId: input.challengeId ?? null });
      rows.push(row);
      return row;
    },
  );
  const consumeByChallenge = jest.fn(async (challengeId: string, tokenHash: string) => {
    const row = rows.find(
      (r) => r.challengeId === challengeId && r.tokenHash === tokenHash && r.usedAt === null,
    );
    if (!row) return null;
    row.usedAt = new Date();
    return row;
  });
  const recordFailedAttempt = jest.fn(
    async (challengeId: string, expectedHash: string, max: number) => {
      const row = rows.find(
        (r) =>
          r.challengeId === challengeId &&
          r.tokenHash === expectedHash &&
          r.usedAt === null &&
          r.expiresAt.getTime() > Date.now() &&
          r.attemptCount < max,
      );
      if (!row) return null;
      row.attemptCount += 1;
      return row;
    },
  );
  const invalidateOutstanding = jest.fn(
    async (userId: string, purpose: VerificationToken['purpose']) => {
      let count = 0;
      for (const r of rows) {
        if (r.userId === userId && r.purpose === purpose && r.usedAt === null) {
          r.usedAt = new Date();
          count++;
        }
      }
      return { count };
    },
  );

  const rotateLiveChallenge = jest.fn(
    async (
      challengeId: string,
      expectedHash: string,
      data: { tokenHash: string; expiresAt: Date },
      limits: { attempts: number; resends: number },
    ) => {
      const row = rows.find(
        (r) =>
          r.challengeId === challengeId &&
          r.tokenHash === expectedHash &&
          r.usedAt === null &&
          r.expiresAt.getTime() > Date.now() &&
          r.attemptCount < limits.attempts &&
          r.resendCount < limits.resends,
      );
      if (!row) return false;
      row.tokenHash = data.tokenHash;
      row.expiresAt = data.expiresAt;
      row.resendCount += 1;
      return true;
    },
  );

  const api: Partial<VerificationTokenRepository> = {
    findByChallengeId,
    findByHash,
    create,
    consumeByChallenge,
    recordFailedAttempt,
    rotateLiveChallenge,
    invalidateOutstanding,
  };
  return { repo: api as VerificationTokenRepository, rows: () => rows, reset: () => (rows = []) };
}

const secret = randomBytes(48).toString('hex');
const cfg = {
  get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? secret : undefined),
} as unknown as AppConfigService;

describe('OtpService', () => {
  describe('issue', () => {
    it('creates a challenge with a 6-digit code stored only as a keyed hash', async () => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);

      const out = await svc.issue('u-1', 'LOGIN_OTP');

      expect(out.rawCode).toMatch(/^[0-9]{6}$/);
      expect(out.challengeId).toMatch(/^[A-Za-z0-9_-]{16,}$/);
      expect(out.expiresInSeconds).toBe(300);
      // Plaintext code must not be stored.
      const stored = rows()[0]!;
      expect(stored.tokenHash).not.toBe(out.rawCode);
      expect(stored.tokenHash).toBe(
        await OtpService.hashForTest(out.rawCode, out.challengeId, secret),
      );
    });

    it('invalidates any outstanding OTP of the same purpose for the user', async () => {
      const { repo } = makeRepo();
      const svc = new OtpService(repo, cfg);
      await svc.issue('u-1', 'LOGIN_OTP');
      await svc.issue('u-1', 'LOGIN_OTP');
      expect(repo.invalidateOutstanding).toHaveBeenCalledTimes(2);
    });
  });

  describe('verify', () => {
    it('returns { userId, purpose } for the correct code and atomically marks it used', async () => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const issued = await svc.issue('u-1', 'LOGIN_OTP');

      const result = await svc.verify(issued.challengeId, issued.rawCode);

      expect(result).toEqual({ userId: 'u-1', purpose: 'LOGIN_OTP' });
      expect(rows()[0]!.usedAt).toBeInstanceOf(Date);
    });

    it('rejects a wrong code with AUTH_OTP_INVALID and bumps the attempt counter', async () => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const issued = await svc.issue('u-1', 'LOGIN_OTP');

      await expect(
        svc.verify(issued.challengeId, issued.rawCode === '000000' ? '111111' : '000000'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_INVALID' }),
      });
      expect(rows()[0]!.attemptCount).toBe(1);
      expect(rows()[0]!.usedAt).toBeNull();
    });

    it('returns a transactional rejection using the SAME connection, without pool starvation', async () => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const issued = await svc.issue('u-1', 'LOGIN_OTP');
      const fakeTx = { $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as NonNullable<
        Parameters<typeof svc.verify>[2]
      >;
      const wrong = issued.rawCode === '000000' ? '111111' : '000000';
      await expect(svc.verifyForLogin(issued.challengeId, wrong, fakeTx)).resolves.toMatchObject({
        rejection: { response: { code: 'AUTH_OTP_INVALID' } },
      });
      expect(rows()[0]!.attemptCount).toBe(1);
      expect(repo.recordFailedAttempt).toHaveBeenCalledWith(
        issued.challengeId,
        rows()[0]!.tokenHash,
        OTP_MAX_ATTEMPTS,
        fakeTx,
      );
    });

    it('locks the challenge after OTP_MAX_ATTEMPTS consecutive misses (AUTH_OTP_LOCKED)', async () => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const issued = await svc.issue('u-1', 'LOGIN_OTP');

      for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) {
        await svc
          .verify(issued.challengeId, issued.rawCode === '000000' ? '111111' : '000000')
          .catch(() => undefined);
      }
      // Final attempt: must surface LOCKED, not INVALID.
      await expect(
        svc.verify(issued.challengeId, issued.rawCode === '000000' ? '111111' : '000000'),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_LOCKED' }),
      });
      // A locked-out challenge MUST NOT accept any code afterwards, even the
      // originally correct one — the persisted attempt ceiling is enforced.
      await expect(svc.verify(issued.challengeId, issued.rawCode)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_LOCKED' }),
      });
      // The attempt ceiling is durable, with no second unguarded write.
      expect(rows()[0]!.attemptCount).toBe(OTP_MAX_ATTEMPTS);
    });

    it('rejects a consumed code with AUTH_OTP_INVALID (no replay)', async () => {
      const { repo } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const issued = await svc.issue('u-1', 'REGISTRATION_OTP');
      await svc.verify(issued.challengeId, issued.rawCode);
      await expect(svc.verify(issued.challengeId, issued.rawCode)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_INVALID' }),
      });
    });

    it('rejects an expired row with AUTH_OTP_EXPIRED even when usedAt is still null', async () => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const issued = await svc.issue('u-1', 'LOGIN_OTP');
      // Rewind the stored row's expiresAt into the past.
      rows()[0]!.expiresAt = new Date(Date.now() - 1_000);
      await expect(svc.verify(issued.challengeId, issued.rawCode)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_EXPIRED' }),
      });
    });
  });

  describe('resend', () => {
    it('rotates the code and bumps resendCount', async () => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const first = await svc.issue('u-1', 'LOGIN_OTP');
      const firstHash = rows()[0]!.tokenHash;

      const out = await svc.resend(first.challengeId);

      expect(out.rawCode).toMatch(/^[0-9]{6}$/);
      expect(out.purpose).toBe('LOGIN_OTP');
      expect(rows()[0]!.tokenHash).not.toBe(firstHash);
      expect(rows()[0]!.resendCount).toBe(1);
      // Old code no longer verifies.
      await expect(svc.verify(first.challengeId, first.rawCode)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_INVALID' }),
      });
      // New code verifies.
      await expect(svc.verify(first.challengeId, out.rawCode)).resolves.toEqual({
        userId: 'u-1',
        purpose: 'LOGIN_OTP',
      });
    });

    it('refuses once resendCount reaches OTP_MAX_RESENDS (AUTH_OTP_RESEND_EXCEEDED)', async () => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const first = await svc.issue('u-1', 'LOGIN_OTP');
      for (let i = 0; i < OTP_MAX_RESENDS; i++) await svc.resend(first.challengeId);
      expect(rows()[0]!.resendCount).toBe(OTP_MAX_RESENDS);
      await expect(svc.resend(first.challengeId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_RESEND_EXCEEDED' }),
      });
    });

    it('refuses resend for unknown challenge (AUTH_OTP_INVALID)', async () => {
      const { repo } = makeRepo();
      const svc = new OtpService(repo, cfg);
      await expect(svc.resend('not-a-real-challenge')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_INVALID' }),
      });
    });
  });
});

describe('R04 OTP hash scope and purpose boundaries', () => {
  it('identical numeric codes in different challenges do not collide at rest', async () => {
    const one = await OtpService.hashForTest('123456', 'challenge-one-123456', secret);
    const two = await OtpService.hashForTest('123456', 'challenge-two-123456', secret);
    expect(one).toMatch(/^otp-v4:\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(one).not.toBe(two);
  });

  it.each(['a'.repeat(64), `otp-v2:${'b'.repeat(64)}`, `otp-v3:${'c'.repeat(64)}`])(
    'requires a resend for pre-v4 digest %s and preserves the existing challenge limits',
    async (legacyHash) => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const issued = await svc.issue('u-1', 'LOGIN_OTP');
      rows()[0]!.tokenHash = legacyHash;
      rows()[0]!.attemptCount = 2;
      rows()[0]!.resendCount = 1;
      await expect(svc.verify(issued.challengeId, issued.rawCode)).rejects.toMatchObject({
        response: { code: 'AUTH_OTP_EXPIRED' },
      });
      expect(rows()[0]).toMatchObject({
        tokenHash: legacyHash,
        attemptCount: 2,
        resendCount: 1,
        usedAt: null,
      });
      expect(repo.consumeByChallenge).not.toHaveBeenCalled();
      const rotated = await svc.resend(issued.challengeId);
      expect(rows()[0]).toMatchObject({ attemptCount: 2, resendCount: 2, usedAt: null });
      expect(rows()[0]!.tokenHash).toMatch(/^otp-v4:/);
      await expect(svc.verify(issued.challengeId, rotated.rawCode)).resolves.toEqual({
        userId: 'u-1',
        purpose: 'LOGIN_OTP',
      });
    },
  );

  it('does not accept a link-purpose token through the challenge path', async () => {
    const { repo, rows } = makeRepo();
    const svc = new OtpService(repo, cfg);
    const issued = await svc.issue('u-1', 'LOGIN_OTP');
    rows()[0]!.purpose = 'PASSWORD_RESET';
    await expect(svc.verify(issued.challengeId, issued.rawCode)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTH_OTP_INVALID' }),
    });
    expect(repo.consumeByChallenge).not.toHaveBeenCalled();
  });
});

it('R04 OTP hashing is deterministic for CAS and separates server peppers', async () => {
  const challengeId = 'challenge-123456789';
  const keyed = await OtpService.hashForTest('123456', challengeId, secret);
  expect(keyed).toBe(await OtpService.hashForTest('123456', challengeId, secret));
  expect(keyed).not.toBe(
    await OtpService.hashForTest('123456', challengeId, randomBytes(48).toString('hex')),
  );
  expect(keyed).not.toContain(secret);
});

describe('bounded OTP hashing work', () => {
  afterEach(() => jest.restoreAllMocks());

  it('persists prepared material without running a second KDF', async () => {
    const { repo, rows } = makeRepo();
    const svc = new OtpService(repo, cfg);
    const hash = jest.spyOn(otpCodec, 'hashOtpCode');
    const prepared = await svc.prepare();
    expect(hash).toHaveBeenCalledTimes(1);
    const issued = await svc.issue('u-1', 'LOGIN_OTP', undefined, undefined, prepared);
    expect(hash).toHaveBeenCalledTimes(1);
    expect(rows()[0]!.tokenHash).toBe(prepared.tokenHash);
    expect(issued).toMatchObject({ challengeId: prepared.challengeId, rawCode: prepared.rawCode });
    expect(issued).not.toHaveProperty('tokenHash');
  });

  it.each([
    ['short', '123456'],
    ['invalid challenge id', '123456'],
    ['challenge-123456789', '12345'],
    ['challenge-123456789', 'abc123'],
  ])('rejects malformed challenge/code before lookup or KDF', async (id, code) => {
    const { repo } = makeRepo();
    const svc = new OtpService(repo, cfg);
    const hash = jest.spyOn(otpCodec, 'hashOtpCode');
    await expect(svc.verify(id, code)).rejects.toMatchObject({
      response: { code: 'AUTH_OTP_INVALID' },
    });
    expect(hash).not.toHaveBeenCalled();
    expect(repo.findByChallengeId).not.toHaveBeenCalled();
  });

  it.each(['short', 'invalid challenge id'])(
    'rejects malformed resend IDs before lookup or KDF',
    async (id) => {
      const { repo } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const hash = jest.spyOn(otpCodec, 'hashOtpCode');
      await expect(svc.resend(id)).rejects.toMatchObject({
        response: { code: 'AUTH_OTP_INVALID' },
      });
      expect(hash).not.toHaveBeenCalled();
      expect(repo.findByChallengeId).not.toHaveBeenCalled();
    },
  );

  it.each([
    { purpose: 'PASSWORD_RESET' as const },
    { usedAt: new Date() },
    { expiresAt: new Date(0) },
    { attemptCount: OTP_MAX_ATTEMPTS },
  ])('rejects unusable rows before KDF', async (patch) => {
    const { repo, rows } = makeRepo();
    const svc = new OtpService(repo, cfg);
    const issued = await svc.issue('u-1', 'LOGIN_OTP');
    Object.assign(rows()[0]!, patch);
    const hash = jest.spyOn(otpCodec, 'hashOtpCode');
    await expect(svc.verify(issued.challengeId, issued.rawCode)).rejects.toBeDefined();
    await expect(svc.resend(issued.challengeId)).rejects.toBeDefined();
    expect(hash).not.toHaveBeenCalled();
  });

  it('rejects an exhausted resend budget before KDF', async () => {
    const { repo, rows } = makeRepo();
    const svc = new OtpService(repo, cfg);
    const issued = await svc.issue('u-1', 'LOGIN_OTP');
    rows()[0]!.resendCount = OTP_MAX_RESENDS;
    const hash = jest.spyOn(otpCodec, 'hashOtpCode');
    await expect(svc.resend(issued.challengeId)).rejects.toMatchObject({
      response: { code: 'AUTH_OTP_RESEND_EXCEEDED' },
    });
    expect(hash).not.toHaveBeenCalled();
  });

  it.each(['verify', 'resend'] as const)(
    'performs one KDF for real and unknown well-formed %s challenges',
    async (method) => {
      const { repo } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const issued = await svc.issue('u-1', 'LOGIN_OTP');
      const hash = jest.spyOn(otpCodec, 'hashOtpCode');
      if (method === 'verify') await svc.verify(issued.challengeId, issued.rawCode);
      else await svc.resend(issued.challengeId);
      expect(hash).toHaveBeenCalledTimes(1);
      hash.mockClear();
      const unknownId = randomBytes(24).toString('base64url');
      await expect(
        method === 'verify' ? svc.verify(unknownId, '123456') : svc.resend(unknownId),
      ).rejects.toMatchObject({ response: { code: 'AUTH_OTP_INVALID' } });
      expect(hash).toHaveBeenCalledTimes(1);
    },
  );
});

it('R04 infrastructure failures are not converted to committed bad-code verdicts', async () => {
  const { repo } = makeRepo();
  const svc = new OtpService(repo, cfg);
  jest.spyOn(repo, 'findByChallengeId').mockRejectedValue(new Error('Synthetic database outage'));
  const fakeTx = { $queryRaw: jest.fn() } as unknown as NonNullable<
    Parameters<typeof svc.verify>[2]
  >;
  await expect(svc.verifyForLogin('challenge-123456789', '123456', fakeTx)).rejects.toThrow(
    'Synthetic database outage',
  );
});

describe('OTP delivery binding and purpose separation', () => {
  it('persists the WhatsApp destination and returns it unchanged after resend', async () => {
    const { repo, rows } = makeRepo();
    const svc = new OtpService(repo, cfg);
    const delivery = { channel: 'whatsapp' as const, destination: '+966501234567' };
    const first = await svc.issue('u-phone', 'REGISTRATION_OTP', undefined, delivery);

    expect(rows()[0]).toMatchObject({
      deliveryChannel: delivery.channel,
      deliveryTarget: delivery.destination,
    });
    const resent = await svc.resend(first.challengeId);
    expect(resent).toMatchObject(delivery);
    expect(rows()[0]).toMatchObject({
      deliveryChannel: delivery.channel,
      deliveryTarget: delivery.destination,
    });
    await expect(svc.verify(first.challengeId, resent.rawCode)).resolves.toMatchObject({
      userId: 'u-phone',
      purpose: 'REGISTRATION_OTP',
      ...delivery,
    });
  });

  it.each(['PASSWORD_RESET_OTP', 'PHONE_VERIFICATION_OTP', 'EMAIL_CONTACT_OTP'] as const)(
    'does not consume a %s challenge through the login verifier',
    async (purpose) => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const challenge = await svc.issue('u-phone', purpose, undefined, {
        channel: 'whatsapp',
        destination: '+966501234567',
      });
      const tx = { $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as NonNullable<
        Parameters<typeof svc.verify>[2]
      >;
      await expect(
        svc.verifyForLogin(challenge.challengeId, challenge.rawCode, tx),
      ).resolves.toMatchObject({
        rejection: { response: { code: 'AUTH_OTP_INVALID' } },
      });
      expect(rows()[0]!.usedAt).toBeNull();
      expect(repo.consumeByChallenge).not.toHaveBeenCalled();
    },
  );

  it('a login OTP cannot authorize password recovery', async () => {
    const { repo, rows } = makeRepo();
    const svc = new OtpService(repo, cfg);
    const challenge = await svc.issue('u-1', 'LOGIN_OTP');
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as NonNullable<
      Parameters<typeof svc.verify>[2]
    >;
    await expect(
      svc.verifyForPasswordReset(challenge.challengeId, challenge.rawCode, tx),
    ).resolves.toMatchObject({
      rejection: { response: { code: 'AUTH_OTP_INVALID' } },
    });
    expect(rows()[0]!.usedAt).toBeNull();
  });

  it('password recovery preserves the attempt ceiling and consumes a correct code once', async () => {
    const { repo, rows } = makeRepo();
    const svc = new OtpService(repo, cfg);
    const challenge = await svc.issue('u-phone', 'PASSWORD_RESET_OTP', undefined, {
      channel: 'whatsapp',
      destination: '+966501234567',
    });
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as NonNullable<
      Parameters<typeof svc.verify>[2]
    >;
    const wrong = challenge.rawCode === '000000' ? '111111' : '000000';
    await expect(
      svc.verifyForPasswordReset(challenge.challengeId, wrong, tx),
    ).resolves.toMatchObject({
      rejection: { response: { code: 'AUTH_OTP_INVALID' } },
    });
    expect(rows()[0]!.attemptCount).toBe(1);
    await expect(
      svc.verifyForPasswordReset(challenge.challengeId, challenge.rawCode, tx),
    ).resolves.toMatchObject({
      consumed: {
        userId: 'u-phone',
        purpose: 'PASSWORD_RESET_OTP',
        channel: 'whatsapp',
        destination: '+966501234567',
      },
    });
    await expect(
      svc.verifyForPasswordReset(challenge.challengeId, challenge.rawCode, tx),
    ).resolves.toMatchObject({
      rejection: { response: { code: 'AUTH_OTP_INVALID' } },
    });
  });
});
