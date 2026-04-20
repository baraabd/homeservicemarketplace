// Unit tests for VerificationService. The table is shared between
// EMAIL_VERIFICATION and PASSWORD_RESET; these tests pin single-use,
// expiry, purpose discrimination, and hash-at-rest.

import { JwtService } from '@nestjs/jwt';
import type { VerificationToken } from '@homeservicemarketplace/database';

import type { AppConfigService } from '../../../../config/app-config.service';
import type { VerificationTokenRepository } from '../../../../infrastructure/persistence/iam/verification-token.repository';
import { TokenService } from './token.service';
import { VerificationService } from './verification.service';

const SECRET = 'test_secret_at_least_32_characters_long_1234';

function makeConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const values: Record<string, unknown> = {
    JWT_ACCESS_SECRET: SECRET,
    JWT_ISSUER: 'hsm-api',
    JWT_AUDIENCE: 'hsm-clients',
    JWT_ACCESS_TTL_SECONDS: 600,
    JWT_REFRESH_TTL_DAYS: 30,
    EMAIL_VERIFICATION_TTL_HOURS: 24,
    PASSWORD_RESET_TTL_MINUTES: 15,
    ...overrides,
  };
  return { get: (k: string) => values[k] } as unknown as AppConfigService;
}

function makeRow(overrides: Partial<VerificationToken> = {}): VerificationToken {
  return {
    id: 't-1',
    userId: 'u-1',
    tokenHash: 'hash',
    purpose: 'EMAIL_VERIFICATION',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    usedAt: null,
    createdAt: new Date(),
    // OTP-specific columns added in the email-otp phase. Default to
    // null / 0 to keep existing link-token tests semantically unchanged.
    challengeId: null,
    attemptCount: 0,
    resendCount: 0,
    ...overrides,
  };
}

function makeHarness() {
  const repo = {
    create: jest.fn(),
    findByHash: jest.fn(),
    consume: jest.fn(),
    invalidateOutstanding: jest.fn().mockResolvedValue({ count: 0 }),
  } as unknown as jest.Mocked<VerificationTokenRepository>;
  const tokens = new TokenService(new JwtService({ secret: SECRET }), makeConfig());
  const svc = new VerificationService(repo, tokens, makeConfig());
  return { svc, repo, tokens };
}

describe('VerificationService', () => {
  describe('issue', () => {
    it('returns a raw token and persists only its sha256 hash (plaintext never stored)', async () => {
      const h = makeHarness();
      h.repo.create.mockImplementationOnce(async (input) => makeRow({ ...input, id: 'new' }));

      const { raw } = await h.svc.issue('u-1', 'EMAIL_VERIFICATION');

      expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
      const createCall = h.repo.create.mock.calls[0]![0];
      expect(createCall.tokenHash).toBe(h.tokens.hashOpaqueToken(raw));
      expect(createCall.tokenHash).not.toBe(raw);
      expect(createCall.purpose).toBe('EMAIL_VERIFICATION');
    });

    it('invalidates any outstanding token of the same purpose before issuing', async () => {
      const h = makeHarness();
      h.repo.create.mockImplementationOnce(async (input) => makeRow({ ...input }));
      await h.svc.issue('u-1', 'PASSWORD_RESET');
      expect(h.repo.invalidateOutstanding).toHaveBeenCalledWith('u-1', 'PASSWORD_RESET', undefined);
    });

    it('computes expiry from config (password reset uses minutes, verification uses hours)', async () => {
      const h = makeHarness();
      h.repo.create.mockImplementation(async (input) => makeRow(input));
      const before = Date.now();
      const { expiresAt } = await h.svc.issue('u-1', 'PASSWORD_RESET');
      const elapsed = expiresAt.getTime() - before;
      // 15 minutes, ±2s tolerance
      expect(elapsed).toBeGreaterThan(15 * 60 * 1000 - 2_000);
      expect(elapsed).toBeLessThan(15 * 60 * 1000 + 2_000);
    });
  });

  describe('consume', () => {
    it('returns userId when the token is valid and atomically consumed', async () => {
      const h = makeHarness();
      const raw = 'x'.repeat(32);
      const hash = h.tokens.hashOpaqueToken(raw);
      h.repo.findByHash.mockResolvedValueOnce(makeRow({ tokenHash: hash, userId: 'u-1' }));
      h.repo.consume.mockResolvedValueOnce(
        makeRow({ tokenHash: hash, userId: 'u-1', usedAt: new Date() }),
      );
      await expect(h.svc.consume(raw, 'EMAIL_VERIFICATION')).resolves.toBe('u-1');
    });

    it('returns null when the token has already been used (single-use)', async () => {
      const h = makeHarness();
      const raw = 'x'.repeat(32);
      const hash = h.tokens.hashOpaqueToken(raw);
      h.repo.findByHash.mockResolvedValueOnce(makeRow({ tokenHash: hash, usedAt: new Date() }));
      await expect(h.svc.consume(raw, 'EMAIL_VERIFICATION')).resolves.toBeNull();
      expect(h.repo.consume).not.toHaveBeenCalled();
    });

    it('returns null on purpose mismatch — a reset token is never accepted as a verification', async () => {
      const h = makeHarness();
      const raw = 'x'.repeat(32);
      const hash = h.tokens.hashOpaqueToken(raw);
      h.repo.findByHash.mockResolvedValueOnce(
        makeRow({ tokenHash: hash, purpose: 'PASSWORD_RESET' }),
      );
      await expect(h.svc.consume(raw, 'EMAIL_VERIFICATION')).resolves.toBeNull();
    });

    it('returns null when the token has expired', async () => {
      const h = makeHarness();
      const raw = 'x'.repeat(32);
      const hash = h.tokens.hashOpaqueToken(raw);
      h.repo.findByHash.mockResolvedValueOnce(
        makeRow({ tokenHash: hash, expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(h.svc.consume(raw, 'EMAIL_VERIFICATION')).resolves.toBeNull();
    });

    it('returns null for missing / too-short input without doing any DB work', async () => {
      const h = makeHarness();
      await expect(h.svc.consume('', 'EMAIL_VERIFICATION')).resolves.toBeNull();
      await expect(h.svc.consume('short', 'EMAIL_VERIFICATION')).resolves.toBeNull();
      expect(h.repo.findByHash).not.toHaveBeenCalled();
    });

    it('returns null when the atomic consume loses the race (consume returns null)', async () => {
      const h = makeHarness();
      const raw = 'x'.repeat(32);
      const hash = h.tokens.hashOpaqueToken(raw);
      h.repo.findByHash.mockResolvedValueOnce(makeRow({ tokenHash: hash }));
      h.repo.consume.mockResolvedValueOnce(null);
      await expect(h.svc.consume(raw, 'EMAIL_VERIFICATION')).resolves.toBeNull();
    });
  });
});
