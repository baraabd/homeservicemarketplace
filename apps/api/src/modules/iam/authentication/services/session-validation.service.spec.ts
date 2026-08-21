import type { AccountStatus } from '@homeservicemarketplace/database';

import type {
  SessionRepository,
  SessionWithUserStanding,
} from '../../../../infrastructure/persistence/iam/session.repository';
import { SessionValidationService } from './session-validation.service';

// D-2 — the authoritative per-request session check.
//
// This suite replaces the previous account-only "in good standing" cache
// tests. That design could not see logout, logout-all, password reset, or
// refresh rotation at all — it only asked whether the USER was allowed to hold
// a session — so those revocations left an already-issued access token working
// until it expired. Every account-standing case the old suite covered is still
// covered here (suspended / locked / deleted-status / soft-deleted / inactive /
// missing user), plus the session-level cases that were previously untestable
// because they were not checked.

const NOW = Date.UTC(2026, 7, 21, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

const USER_ID = 'u-1';
const SESSION_ID = 'sess-1';
const JTI = 'jti-1';

function makeSession(over: Partial<SessionWithUserStanding> = {}): SessionWithUserStanding {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    currentJti: JTI,
    revokedAt: null,
    expiresAt: new Date(NOW + 30 * 24 * HOUR),
    user: {
      id: USER_ID,
      status: 'ACTIVE' as AccountStatus,
      isActive: true,
      deletedAt: null,
    },
    ...over,
  };
}

function build(result: SessionWithUserStanding | null | Error) {
  const findByIdWithUserStanding = jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const sessions = { findByIdWithUserStanding } as unknown as SessionRepository;
  return { sessions, findByIdWithUserStanding, service: new SessionValidationService(sessions) };
}

const claims = { userId: USER_ID, sessionId: SESSION_ID, jti: JTI };

// Every rejection must present the SAME opaque code — being able to tell
// "revoked" from "never existed" from "suspended" is an oracle.
const OPAQUE_401 = {
  response: expect.objectContaining({ code: 'AUTH_INVALID_CREDENTIALS' }),
};

describe('SessionValidationService.assertSessionActive', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('admits a live session held by a user in good standing', async () => {
    const { service } = build(makeSession());
    await expect(service.assertSessionActive(claims)).resolves.toBeUndefined();
  });

  it('reads the session by id in a single indexed lookup (no N+1)', async () => {
    const { service, findByIdWithUserStanding } = build(makeSession());
    await service.assertSessionActive(claims);
    expect(findByIdWithUserStanding).toHaveBeenCalledTimes(1);
    expect(findByIdWithUserStanding).toHaveBeenCalledWith(SESSION_ID);
  });

  it('re-reads on EVERY request — a prior success is never cached', async () => {
    // This is what makes revocation immediate on every instance: there is no
    // positive cache entry that could outlive the revocation.
    const { service, findByIdWithUserStanding } = build(makeSession());
    await service.assertSessionActive(claims);
    await service.assertSessionActive(claims);
    await service.assertSessionActive(claims);
    expect(findByIdWithUserStanding).toHaveBeenCalledTimes(3);
  });

  describe('session-level rejections', () => {
    it('rejects when the session row does not exist', async () => {
      const { service } = build(null);
      await expect(service.assertSessionActive(claims)).rejects.toMatchObject(OPAQUE_401);
    });

    it('rejects a REVOKED session (logout / logout-all / reset / suspend)', async () => {
      const { service } = build(makeSession({ revokedAt: new Date(NOW - 1000) }));
      await expect(service.assertSessionActive(claims)).rejects.toMatchObject(OPAQUE_401);
    });

    it('rejects an EXPIRED session', async () => {
      const { service } = build(makeSession({ expiresAt: new Date(NOW - 1) }));
      await expect(service.assertSessionActive(claims)).rejects.toMatchObject(OPAQUE_401);
    });

    it('rejects a session expiring exactly now (boundary is exclusive)', async () => {
      const { service } = build(makeSession({ expiresAt: new Date(NOW) }));
      await expect(service.assertSessionActive(claims)).rejects.toMatchObject(OPAQUE_401);
    });

    it('rejects when the session belongs to a DIFFERENT user than the token claims', async () => {
      // Token replay against someone else's session id.
      const { service } = build(makeSession({ userId: 'someone-else' }));
      await expect(service.assertSessionActive(claims)).rejects.toMatchObject(OPAQUE_401);
    });

    it('rejects when the row returned does not match the requested session id', async () => {
      const { service } = build(makeSession({ id: 'other-session' }));
      await expect(service.assertSessionActive(claims)).rejects.toMatchObject(OPAQUE_401);
    });

    it('rejects a token whose jti is no longer the session current jti (refresh rotation)', async () => {
      // After refresh rotates the family, the OLD access token must die even
      // though a session row for that id may still exist.
      const { service } = build(makeSession({ currentJti: 'jti-2-after-rotation' }));
      await expect(
        service.assertSessionActive({ ...claims, jti: 'jti-1-before-rotation' }),
      ).rejects.toMatchObject(OPAQUE_401);
    });
  });

  describe('account-standing rejections', () => {
    it.each([
      ['SUSPENDED', { status: 'SUSPENDED' as AccountStatus }],
      ['LOCKED', { status: 'LOCKED' as AccountStatus }],
      ['DELETED status', { status: 'DELETED' as AccountStatus }],
      ['PENDING_VERIFICATION', { status: 'PENDING_VERIFICATION' as AccountStatus }],
      ['soft-deleted', { deletedAt: new Date(NOW - 1000) }],
      ['deactivated', { isActive: false }],
    ])('rejects a session whose owner is %s', async (_label, userOver) => {
      const { service } = build(makeSession({ user: { ...makeSession().user!, ...userOver } }));
      await expect(service.assertSessionActive(claims)).rejects.toMatchObject(OPAQUE_401);
    });

    it('rejects when the owning user row is missing entirely', async () => {
      const { service } = build(makeSession({ user: null }));
      await expect(service.assertSessionActive(claims)).rejects.toMatchObject(OPAQUE_401);
    });
  });

  describe('claim-shape rejections', () => {
    it.each([
      ['missing userId', { ...claims, userId: '' }],
      ['missing sessionId', { ...claims, sessionId: '' }],
      ['missing jti', { ...claims, jti: '' }],
    ])('rejects a token with %s without touching the database', async (_label, bad) => {
      const { service, findByIdWithUserStanding } = build(makeSession());
      await expect(service.assertSessionActive(bad)).rejects.toMatchObject(OPAQUE_401);
      expect(findByIdWithUserStanding).not.toHaveBeenCalled();
    });
  });

  describe('failure policy', () => {
    it('FAILS CLOSED when the database lookup throws', async () => {
      // A token must never be admitted because the check that would have
      // refused it was unavailable — that turns a DB blip into an authz bypass.
      const { service } = build(new Error('connection terminated'));
      await expect(service.assertSessionActive(claims)).rejects.toMatchObject(OPAQUE_401);
    });

    it('does not leak the infrastructure failure reason to the caller', async () => {
      const { service } = build(new Error('P1001: cannot reach database at db.internal:5432'));
      await expect(service.assertSessionActive(claims)).rejects.not.toMatchObject({
        message: expect.stringContaining('db.internal'),
      });
    });
  });

  describe('multi-session isolation', () => {
    it('leaves a second session usable after the first is revoked', async () => {
      // Two sessions for one user: revoking one must not affect the other.
      const revoked = makeSession({ id: 'sess-a', revokedAt: new Date(NOW - 1) });
      const live = makeSession({ id: 'sess-b', currentJti: 'jti-b' });

      const sessions = {
        findByIdWithUserStanding: jest.fn(async (id: string) => (id === 'sess-a' ? revoked : live)),
      } as unknown as SessionRepository;
      const service = new SessionValidationService(sessions);

      await expect(
        service.assertSessionActive({ userId: USER_ID, sessionId: 'sess-a', jti: JTI }),
      ).rejects.toMatchObject(OPAQUE_401);
      await expect(
        service.assertSessionActive({ userId: USER_ID, sessionId: 'sess-b', jti: 'jti-b' }),
      ).resolves.toBeUndefined();
    });
  });
});
