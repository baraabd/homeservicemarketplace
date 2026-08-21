// Unit tests for SessionService — the load-bearing security component of IAM.
// Covers: rotation happy path, replay detection (revoked token), concurrent
// refresh race (two callers of the same refresh token), unknown refresh,
// expired refresh, family-wide revoke on replay, revokeById / revokeAll.
//
// Prisma is mocked at the repository boundary. The transaction runner is
// faked to invoke its callback with a stub tx that only supports the calls
// SessionService actually makes (session.update).

import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import type { Session } from '@homeservicemarketplace/database';

import type { AppConfigService } from '../../../../config/app-config.service';
import type { SessionRepository } from '../../../../infrastructure/persistence/iam/session.repository';
import type { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import type { AuditService } from '../../audit/audit.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

const SECRET = 'test_secret_at_least_32_characters_long_1234';

function makeConfig(): AppConfigService {
  const values: Record<string, unknown> = {
    JWT_ACCESS_SECRET: SECRET,
    JWT_ISSUER: 'hsm-api',
    JWT_AUDIENCE: 'hsm-clients',
    JWT_ACCESS_TTL_SECONDS: 600,
    JWT_REFRESH_TTL_DAYS: 30,
  };
  return { get: (k: string) => values[k] } as unknown as AppConfigService;
}

function makeSessionRow(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    userId: 'user-1',
    familyId: 'fam-1',
    parentJti: null,
    currentJti: 'jti-old',
    tokenHash: 'hash-old',
    ipAddress: '1.2.3.4',
    userAgent: 'test-agent',
    clientKind: 'WEB',
    createdAt: new Date(),
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    revokedAt: null,
    ...overrides,
  };
}

function makeHarness() {
  const sessions = {
    create: jest.fn(),
    findByTokenHash: jest.fn(),
    findById: jest.fn(),
    listActiveByUser: jest.fn(),
    markRevokedIfActive: jest.fn(),
    revokeFamily: jest.fn().mockResolvedValue({ count: 1 }),
    revokeAllForUser: jest.fn().mockResolvedValue({ count: 0 }),
    revokeById: jest.fn().mockResolvedValue({ count: 1 }),
    touchLastUsed: jest.fn(),
  } as unknown as jest.Mocked<SessionRepository>;

  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { algorithm: 'HS256', issuer: 'hsm-api', audience: 'hsm-clients' },
    verifyOptions: { algorithms: ['HS256'], issuer: 'hsm-api', audience: 'hsm-clients' },
  });
  const tokens = new TokenService(jwt, makeConfig());

  // The tx param is used by the service to call session.update inline.
  const fakeTx = { session: { update: jest.fn().mockResolvedValue(undefined) } };
  const tx = {
    run: jest.fn(async <T>(fn: (t: unknown) => Promise<T>) => fn(fakeTx)),
  } as unknown as TransactionRunner;

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;

  const svc = new SessionService(sessions, tokens, tx, audit);
  return { svc, sessions, tokens, tx, audit, fakeTx };
}

describe('SessionService', () => {
  describe('createForLogin', () => {
    it('creates a new family and persists a session row with null parentJti', async () => {
      const h = makeHarness();
      h.sessions.create.mockImplementation(async (input) =>
        makeSessionRow({ ...input, id: 'new-sess' }),
      );
      const result = await h.svc.createForLogin({
        userId: 'user-1',
        roles: ['customer'],
        device: { ipAddress: '1.1.1.1', userAgent: 'ua', clientKind: 'WEB' },
        requestId: 'req-1',
      });

      expect(h.sessions.create).toHaveBeenCalledTimes(1);
      const createCall = h.sessions.create.mock.calls[0]![0];
      expect(createCall.parentJti).toBeNull();
      expect(createCall.userId).toBe('user-1');
      expect(createCall.clientKind).toBe('WEB');
      expect(result.session.id).toBe('new-sess');
      expect(result.refresh.raw).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result.refresh.hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('rotate — happy path', () => {
    it('atomically revokes the old row, creates a new row in the same family, and audits ROTATED', async () => {
      const h = makeHarness();
      const refresh = h.tokens.mintRefreshToken();
      const existing = makeSessionRow({ tokenHash: refresh.hash });

      h.sessions.findByTokenHash.mockResolvedValueOnce(existing);
      h.sessions.markRevokedIfActive.mockResolvedValueOnce(1);
      h.sessions.create.mockImplementationOnce(async (input) =>
        makeSessionRow({ ...input, id: 'new-sess' }),
      );

      const issued = await h.svc.rotate({
        presentedRefreshRaw: refresh.raw,
        roles: ['customer'],
        device: { ipAddress: '1.1.1.1', userAgent: 'ua', clientKind: 'WEB' },
        requestId: 'req-rot',
      });

      expect(h.sessions.markRevokedIfActive).toHaveBeenCalledWith(existing.id, expect.anything());
      expect(h.sessions.create).toHaveBeenCalledTimes(1);
      const createArgs = h.sessions.create.mock.calls[0]![0];
      expect(createArgs.familyId).toBe(existing.familyId);
      expect(createArgs.parentJti).toBe(existing.currentJti);
      expect(issued.session.familyId).toBe(existing.familyId);
      expect(issued.session.id).toBe('new-sess');
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'REFRESH_ROTATED' }),
        expect.anything(),
      );
      expect(h.sessions.revokeFamily).not.toHaveBeenCalled();
    });
  });

  describe('rotate — replay', () => {
    it('presenting an already-revoked refresh token revokes the whole family and audits REFRESH_REPLAY', async () => {
      const h = makeHarness();
      const refresh = h.tokens.mintRefreshToken();
      const revoked = makeSessionRow({ tokenHash: refresh.hash, revokedAt: new Date() });
      h.sessions.findByTokenHash.mockResolvedValueOnce(revoked);

      await expect(
        h.svc.rotate({
          presentedRefreshRaw: refresh.raw,
          roles: [],
          device: { ipAddress: '1.1.1.1', userAgent: 'ua', clientKind: 'WEB' },
          requestId: 'req-replay',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(h.sessions.revokeFamily).toHaveBeenCalledWith(revoked.familyId, expect.anything());
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'REFRESH_REPLAY' }),
        expect.anything(),
      );
      expect(h.sessions.create).not.toHaveBeenCalled();
    });
  });

  describe('rotate — concurrent race', () => {
    it('when markRevokedIfActive returns 0 rows affected, treats as replay and revokes the family', async () => {
      const h = makeHarness();
      const refresh = h.tokens.mintRefreshToken();
      const existing = makeSessionRow({ tokenHash: refresh.hash });
      h.sessions.findByTokenHash.mockResolvedValueOnce(existing);
      h.sessions.markRevokedIfActive.mockResolvedValueOnce(0); // lost the race

      await expect(
        h.svc.rotate({
          presentedRefreshRaw: refresh.raw,
          roles: [],
          device: { ipAddress: '1.1.1.1', userAgent: 'ua', clientKind: 'WEB' },
          requestId: 'req-race',
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(h.sessions.revokeFamily).toHaveBeenCalledWith(existing.familyId, expect.anything());
      expect(h.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REFRESH_REPLAY',
          metadata: expect.objectContaining({ reason: 'race' }),
        }),
        expect.anything(),
      );
      expect(h.sessions.create).not.toHaveBeenCalled();
    });
  });

  describe('rotate — unknown / expired', () => {
    it('unknown refresh token → 401 and no audit entry for replay', async () => {
      const h = makeHarness();
      h.sessions.findByTokenHash.mockResolvedValueOnce(null);
      await expect(
        h.svc.rotate({
          presentedRefreshRaw: 'x'.repeat(32),
          roles: [],
          device: { ipAddress: '1.1.1.1', userAgent: 'ua', clientKind: 'WEB' },
          requestId: 'req-unknown',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(h.audit.record).not.toHaveBeenCalled();
    });

    it('expired refresh row → 401 without revoking the family (expiry is not a compromise signal)', async () => {
      const h = makeHarness();
      const refresh = h.tokens.mintRefreshToken();
      const expired = makeSessionRow({
        tokenHash: refresh.hash,
        expiresAt: new Date(Date.now() - 1000),
      });
      h.sessions.findByTokenHash.mockResolvedValueOnce(expired);
      await expect(
        h.svc.rotate({
          presentedRefreshRaw: refresh.raw,
          roles: [],
          device: { ipAddress: '1.1.1.1', userAgent: 'ua', clientKind: 'WEB' },
          requestId: 'req-exp',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(h.sessions.revokeFamily).not.toHaveBeenCalled();
    });
  });

  describe('revokeById / revokeAllForUser / peekByRefreshRaw', () => {
    it('revokeAllForUser forwards to the repository and returns the count', async () => {
      const h = makeHarness();
      h.sessions.revokeAllForUser.mockResolvedValueOnce({ count: 3 });
      await expect(h.svc.revokeAllForUser('user-1')).resolves.toBe(3);
      // The optional tx is forwarded to the repo (undefined for standalone
      // revocation, a Prisma tx client when called inside a transaction).
      expect(h.sessions.revokeAllForUser).toHaveBeenCalledWith('user-1', undefined);
    });

    it('revokeAllForUser forwards the transaction client when given one (atomic reset path)', async () => {
      const h = makeHarness();
      h.sessions.revokeAllForUser.mockResolvedValueOnce({ count: 2 });
      const fakeTx = { marker: 'tx' } as never;
      await expect(h.svc.revokeAllForUser('user-1', fakeTx)).resolves.toBe(2);
      expect(h.sessions.revokeAllForUser).toHaveBeenCalledWith('user-1', fakeTx);
    });

    it('peekByRefreshRaw hashes the raw token before looking up — plaintext never hits the DB', async () => {
      const h = makeHarness();
      const refresh = h.tokens.mintRefreshToken();
      h.sessions.findByTokenHash.mockResolvedValueOnce(makeSessionRow({ tokenHash: refresh.hash }));
      await h.svc.peekByRefreshRaw(refresh.raw);
      expect(h.sessions.findByTokenHash).toHaveBeenCalledWith(refresh.hash);
    });
  });
});
