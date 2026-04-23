import type { VerificationToken } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../../../config/app-config.service';
import { VerificationTokenRepository } from '../../../../infrastructure/persistence/iam/verification-token.repository';
import { OTP_MAX_ATTEMPTS, OTP_MAX_RESENDS, OtpService } from './otp.service';

// Service-level invariants for OTP issuance, verification, resend, and
// lock-out. A fake repository backs every test — we're not testing Prisma,
// we're pinning the domain rules:
//   - codes are sha256'd at rest
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
  const incrementAttempt = jest.fn(async (challengeId: string) => {
    const row = rows.find((r) => r.challengeId === challengeId);
    if (!row) throw new Error('not found');
    row.attemptCount += 1;
    return row;
  });
  const incrementResend = jest.fn(async (challengeId: string) => {
    const row = rows.find((r) => r.challengeId === challengeId);
    if (!row) throw new Error('not found');
    row.resendCount += 1;
    return row;
  });
  const rotateChallenge = jest.fn(
    async (challengeId: string, data: { tokenHash: string; expiresAt: Date }) => {
      const row = rows.find((r) => r.challengeId === challengeId);
      if (!row) throw new Error('not found');
      row.tokenHash = data.tokenHash;
      row.expiresAt = data.expiresAt;
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

  const api: Partial<VerificationTokenRepository> = {
    findByChallengeId,
    findByHash,
    create,
    consumeByChallenge,
    incrementAttempt,
    incrementResend,
    rotateChallenge,
    invalidateOutstanding,
  };
  return { repo: api as VerificationTokenRepository, rows: () => rows, reset: () => (rows = []) };
}

const cfg = { get: () => undefined } as unknown as AppConfigService;

describe('OtpService', () => {
  describe('issue', () => {
    it('creates a challenge with a 6-digit code stored only as sha256', async () => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);

      const out = await svc.issue('u-1', 'LOGIN_OTP');

      expect(out.rawCode).toMatch(/^[0-9]{6}$/);
      expect(out.challengeId).toMatch(/^[A-Za-z0-9_-]{16,}$/);
      expect(out.expiresInSeconds).toBe(300);
      // Plaintext code must not be stored.
      const stored = rows()[0]!;
      expect(stored.tokenHash).not.toBe(out.rawCode);
      expect(stored.tokenHash).toBe(OtpService.hashForTest(out.rawCode));
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

      await expect(svc.verify(issued.challengeId, '000000')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_INVALID' }),
      });
      expect(rows()[0]!.attemptCount).toBe(1);
      expect(rows()[0]!.usedAt).toBeNull();
    });

    it('bumps the attempt counter EVEN WHEN the caller wraps verify in a tx that rolls back', async () => {
      // Regression test: AuthenticationService.verifyOtp runs verify inside
      // its own $transaction. If incrementAttempt were tx-scoped to that
      // outer tx, the throw would roll the counter back and the 5-strike
      // lockout would never fire — unthrottled brute-force of the 6-digit
      // space. The fix does the increment outside the caller's tx.
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const issued = await svc.issue('u-1', 'LOGIN_OTP');

      // Pass an opaque "outer tx" handle. Our fake repo ignores it, but
      // the contract under test is that verify MUST NOT thread it into
      // incrementAttempt / rotateChallenge on the miss path. We prove it
      // by spying on the repo mocks and asserting they were called with
      // no tx argument.
      const fakeTx = { $marker: 'outer' } as unknown as Parameters<typeof svc.verify>[2];
      await expect(svc.verify(issued.challengeId, '000000', fakeTx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_INVALID' }),
      });

      expect(rows()[0]!.attemptCount).toBe(1);
      // The read path (findByChallengeId) legitimately uses the outer tx so
      // reads see concurrent writes within the same transaction. The write
      // path (incrementAttempt) must NOT — that's the regression surface.
      const incrementCall = (repo.incrementAttempt as jest.Mock).mock.calls[0];
      expect(incrementCall?.[1]).toBeUndefined();
    });

    it('locks the challenge after OTP_MAX_ATTEMPTS consecutive misses (AUTH_OTP_LOCKED)', async () => {
      const { repo, rows } = makeRepo();
      const svc = new OtpService(repo, cfg);
      const issued = await svc.issue('u-1', 'LOGIN_OTP');

      for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) {
        await svc.verify(issued.challengeId, '000000').catch(() => undefined);
      }
      // Final attempt: must surface LOCKED, not INVALID.
      await expect(svc.verify(issued.challengeId, '000000')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_LOCKED' }),
      });
      // A locked-out challenge MUST NOT accept any code afterwards, even the
      // originally correct one — the row is rotated to a dead hash.
      await expect(svc.verify(issued.challengeId, issued.rawCode)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'AUTH_OTP_LOCKED' }),
      });
      // Used/expired state is consistent with "no longer verifiable".
      expect(rows()[0]!.tokenHash.startsWith('locked:')).toBe(true);
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
