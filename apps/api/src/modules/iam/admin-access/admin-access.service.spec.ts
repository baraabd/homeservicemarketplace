import type { AdminAccessRequestRepository } from '../../../infrastructure/persistence/iam/admin-access-request.repository';
import type { RoleRepository } from '../../../infrastructure/persistence/iam/role.repository';
import type { SessionRepository } from '../../../infrastructure/persistence/iam/session.repository';
import type { UserRepository } from '../../../infrastructure/persistence/iam/user.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { SecurityEventsBus } from '../../../shared/security-events/security-events.bus';
import type { AuditService } from '../audit/audit.service';
import { AdminAccessService } from './admin-access.service';

// Phase 4 — the admin ACCESS-REQUEST lifecycle.
//
// The rule under test: a public signup must NEVER grant the admin role.
// Wanting admin access produces a request; a DIFFERENT, currently authorized
// administrator grants it; approval grants ONLY the admin role and revokes the
// applicant's sessions so the new role is authoritative rather than eventual.

const tx: TransactionRunner = {
  run: <T>(fn: (t: undefined) => Promise<T>) => fn(undefined),
} as unknown as TransactionRunner;

const APPLICANT = {
  id: 'u-applicant',
  email: 'hopeful@example.com',
  firstName: 'Hope',
  lastName: 'Ful',
  status: 'ACTIVE' as const,
  isActive: true,
  emailVerifiedAt: new Date('2026-08-01T00:00:00Z'),
  userRoles: [{ role: { name: 'customer' } }],
};

function makeRequest(over: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    userId: APPLICANT.id,
    status: 'PENDING',
    justification: 'I run operations.',
    decidedByUserId: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: new Date('2026-08-10T00:00:00Z'),
    updatedAt: new Date('2026-08-10T00:00:00Z'),
    user: { ...APPLICANT },
    ...over,
  };
}

function build(
  over: {
    request?: ReturnType<typeof makeRequest> | null;
    pending?: unknown;
    latest?: unknown;
    userRoles?: Array<{ role: { name: string } }>;
    user?: Record<string, unknown> | null;
    decideCount?: number;
    adminRole?: { id: string; name: string } | null;
  } = {},
) {
  const request = over.request === undefined ? makeRequest() : over.request;

  const requests = {
    create: jest.fn().mockResolvedValue(makeRequest()),
    findById: jest.fn().mockResolvedValue(request),
    findPendingByUserId: jest.fn().mockResolvedValue(over.pending ?? null),
    findLatestByUserId: jest.fn().mockResolvedValue(over.latest ?? null),
    decideIfPending: jest.fn().mockResolvedValue(over.decideCount ?? 1),
    listForReview: jest.fn().mockResolvedValue([]),
  } as unknown as AdminAccessRequestRepository;

  const users = {
    findById: jest.fn().mockResolvedValue(over.user === undefined ? { ...APPLICANT } : over.user),
    listRoles: jest.fn().mockResolvedValue(over.userRoles ?? [{ role: { name: 'customer' } }]),
    assignRole: jest.fn().mockResolvedValue(undefined),
  } as unknown as UserRepository;

  const roles = {
    findByName: jest
      .fn()
      .mockResolvedValue(
        over.adminRole === undefined ? { id: 'role-admin', name: 'admin' } : over.adminRole,
      ),
  } as unknown as RoleRepository;

  const sessions = {
    revokeAllForUser: jest.fn().mockResolvedValue({ count: 2 }),
  } as unknown as SessionRepository;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const securityEvents = new SecurityEventsBus();

  return {
    requests,
    users,
    roles,
    sessions,
    audit,
    securityEvents,
    service: new AdminAccessService(requests, users, roles, sessions, audit, tx, securityEvents),
  };
}

describe('AdminAccessService', () => {
  describe('getMine — the three axes, answered separately', () => {
    it('reports hasAdminRole from the ROLE, never from the account status', async () => {
      // The screens that called a user "Admin active" were reading
      // User.status === ACTIVE. This is the field they should read instead.
      const { service } = build({ userRoles: [{ role: { name: 'customer' } }] });
      const mine = await service.getMine('u-applicant');
      expect(mine.hasAdminRole).toBe(false);
    });

    it('reports hasAdminRole true when the admin role is actually held', async () => {
      const { service } = build({
        userRoles: [{ role: { name: 'customer' } }, { role: { name: 'admin' } }],
      });
      expect((await service.getMine('u-applicant')).hasAdminRole).toBe(true);
    });

    it('marks an outstanding request as pending and blocks a second submission', async () => {
      const { service } = build({ latest: makeRequest({ status: 'PENDING' }) });
      const mine = await service.getMine('u-applicant');
      expect(mine.isPending).toBe(true);
      expect(mine.canSubmit).toBe(false);
    });

    it('allows a new submission after a REJECTED decision', async () => {
      const { service } = build({ latest: makeRequest({ status: 'REJECTED' }) });
      const mine = await service.getMine('u-applicant');
      expect(mine.isPending).toBe(false);
      expect(mine.canSubmit).toBe(true);
    });

    it('does not offer submission to someone who already holds the role', async () => {
      const { service } = build({ userRoles: [{ role: { name: 'admin' } }] });
      expect((await service.getMine('u-applicant')).canSubmit).toBe(false);
    });

    it('never exposes which administrator reviewed the request', async () => {
      // Leaking the reviewer would hand the operator roster to anyone who can
      // submit a request.
      const { service } = build({
        latest: makeRequest({ status: 'APPROVED', decidedByUserId: 'admin-secret' }),
      });
      const mine = await service.getMine('u-applicant');
      expect(JSON.stringify(mine.latestRequest)).not.toContain('admin-secret');
      expect(mine.latestRequest).not.toHaveProperty('decidedByUserId');
    });
  });

  describe('submit — grants nothing', () => {
    it('creates a PENDING request and audits it', async () => {
      const { service, requests, audit, users } = build();
      const summary = await service.submit('u-applicant', { justification: 'I run operations.' });

      expect(summary.status).toBe('PENDING');
      expect(requests.create).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ADMIN_ACCESS_REQUESTED', userId: 'u-applicant' }),
        undefined,
      );
      // The critical negative: submitting must not attach any role.
      expect(users.assignRole).not.toHaveBeenCalled();
    });

    it('refuses a second request while one is still pending', async () => {
      const { service, requests } = build({ pending: makeRequest() });
      await expect(service.submit('u-applicant', {})).rejects.toMatchObject({ status: 409 });
      expect(requests.create).not.toHaveBeenCalled();
    });

    it('refuses when the applicant already has admin access', async () => {
      const { service } = build({ userRoles: [{ role: { name: 'admin' } }] });
      await expect(service.submit('u-applicant', {})).rejects.toMatchObject({ status: 409 });
    });

    it('refuses an unverified identity — the queue must not fill with unowned addresses', async () => {
      const { service } = build({ user: { ...APPLICANT, emailVerifiedAt: null } });
      await expect(service.submit('u-applicant', {})).rejects.toMatchObject({ status: 400 });
    });

    it('normalises a blank justification to null rather than storing whitespace', async () => {
      const { service, requests } = build();
      await service.submit('u-applicant', { justification: '   ' });
      expect(requests.create).toHaveBeenCalledWith(
        expect.objectContaining({ justification: null }),
        undefined,
      );
    });
  });

  describe('approve — the grant', () => {
    it('grants ONLY the admin role', async () => {
      const { service, users } = build();
      await service.approve('admin-reviewer', 'req-1', {});

      expect(users.assignRole).toHaveBeenCalledTimes(1);
      expect(users.assignRole).toHaveBeenCalledWith('u-applicant', 'role-admin', undefined);
    });

    it('does NOT create or activate a ProviderProfile', async () => {
      // The provider axis has its own review. An admin grant that silently
      // minted an approved marketplace seller is exactly what Phase 4 removes.
      const { service, roles } = build();
      await service.approve('admin-reviewer', 'req-1', {});
      // The only role ever looked up is `admin`.
      expect((roles.findByName as jest.Mock).mock.calls.map((c) => c[0])).toEqual(['admin']);
    });

    it('revokes the applicant sessions so the new role is authoritative, not eventual', async () => {
      // RolesGuard reads the token's role claim, so without this the grant
      // would not take effect until the old access token expired.
      const { service, sessions } = build();
      await service.approve('admin-reviewer', 'req-1', {});
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('u-applicant', undefined);
    });

    it('publishes a post-commit teardown so live sockets re-handshake', async () => {
      const { service, securityEvents } = build();
      const revoked = jest.fn();
      const rolesChanged = jest.fn();
      securityEvents.onAllSessionsRevoked(revoked);
      securityEvents.onRolesChanged(rolesChanged);

      await service.approve('admin-reviewer', 'req-1', {});

      expect(revoked).toHaveBeenCalledWith({ userId: 'u-applicant', reason: 'roles-changed' });
      expect(rolesChanged).toHaveBeenCalledWith({ userId: 'u-applicant' });
    });

    it('audits the approval with the reviewer recorded', async () => {
      const { service, audit } = build();
      await service.approve('admin-reviewer', 'req-1', { decisionNote: 'vouched for' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ADMIN_ACCESS_APPROVED',
          userId: 'u-applicant',
          metadata: expect.objectContaining({ reviewerUserId: 'admin-reviewer' }),
        }),
        undefined,
      );
    });

    describe('self-review is forbidden', () => {
      it('refuses when the reviewer IS the applicant', async () => {
        // Holding the permission is not the same as being allowed to grant
        // yourself the role it protects.
        const { service, users, sessions } = build();
        await expect(service.approve(APPLICANT.id, 'req-1', {})).rejects.toMatchObject({
          status: 403,
        });
        expect(users.assignRole).not.toHaveBeenCalled();
        expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
      });

      it('refuses self-REJECTION too, so the check cannot be probed', async () => {
        const { service } = build();
        await expect(service.reject(APPLICANT.id, 'req-1', {})).rejects.toMatchObject({
          status: 403,
        });
      });
    });

    it.each(['APPROVED', 'REJECTED', 'CANCELLED'])(
      'refuses to decide an already-%s request',
      async (status) => {
        const { service, users } = build({ request: makeRequest({ status }) });
        await expect(service.approve('admin-reviewer', 'req-1', {})).rejects.toMatchObject({
          status: 409,
        });
        expect(users.assignRole).not.toHaveBeenCalled();
      },
    );

    it('409s when a concurrent reviewer decided first (0 rows moved)', async () => {
      const { service, users } = build({ decideCount: 0 });
      await expect(service.approve('admin-reviewer', 'req-1', {})).rejects.toMatchObject({
        status: 409,
      });
      expect(users.assignRole).not.toHaveBeenCalled();
    });

    it.each([
      ['suspended', { status: 'SUSPENDED', isActive: false }],
      ['deactivated', { isActive: false }],
      ['unverified', { emailVerifiedAt: null }],
    ])('refuses to grant admin to a %s account', async (_label, userOver) => {
      // A dormant grant on a suspended account springs to life the moment the
      // account is restored — the reviewer must resolve the account axis first.
      const { service, users } = build({
        request: makeRequest({ user: { ...APPLICANT, ...userOver } }),
      });
      await expect(service.approve('admin-reviewer', 'req-1', {})).rejects.toMatchObject({
        status: 400,
      });
      expect(users.assignRole).not.toHaveBeenCalled();
    });

    it('fails loudly rather than silently approving when the admin role is unseeded', async () => {
      const { service } = build({ adminRole: null });
      await expect(service.approve('admin-reviewer', 'req-1', {})).rejects.toMatchObject({
        status: 500,
      });
    });

    it('404s for an unknown request', async () => {
      const { service } = build({ request: null });
      await expect(service.approve('admin-reviewer', 'nope', {})).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('reject', () => {
    it('grants nothing and revokes nothing', async () => {
      const { service, users, sessions } = build({ request: makeRequest() });
      // findById returns the PENDING row on the first read and again on reload.
      await service.reject('admin-reviewer', 'req-1', { decisionNote: 'not this cycle' });
      expect(users.assignRole).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('audits the rejection', async () => {
      const { service, audit } = build();
      await service.reject('admin-reviewer', 'req-1', { decisionNote: 'not this cycle' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ADMIN_ACCESS_REJECTED' }),
        undefined,
      );
    });

    it('allows rejecting an applicant whose account is suspended', async () => {
      // Only APPROVAL requires a healthy account; refusing is always allowed.
      const { service } = build({
        request: makeRequest({ user: { ...APPLICANT, status: 'SUSPENDED', isActive: false } }),
      });
      await expect(service.reject('admin-reviewer', 'req-1', {})).resolves.toBeDefined();
    });
  });

  describe('cancelMine', () => {
    it('withdraws the applicant own pending request', async () => {
      const { service, requests, audit } = build({ pending: makeRequest() });
      await service.cancelMine('u-applicant');
      expect(requests.decideIfPending).toHaveBeenCalledWith(
        'req-1',
        expect.objectContaining({ status: 'CANCELLED', decidedByUserId: null }),
        undefined,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ADMIN_ACCESS_CANCELLED' }),
        undefined,
      );
    });

    it('404s when there is nothing pending to cancel', async () => {
      const { service } = build({ pending: null });
      await expect(service.cancelMine('u-applicant')).rejects.toMatchObject({ status: 404 });
    });

    it('409s when a reviewer decided it first', async () => {
      const { service } = build({ pending: makeRequest(), decideCount: 0 });
      await expect(service.cancelMine('u-applicant')).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('listForReview', () => {
    it('defaults to the PENDING queue rather than every request ever made', async () => {
      const { service, requests } = build();
      await service.listForReview({});
      expect(requests.listForReview).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PENDING' }),
      );
    });

    it('caps the page size so a client cannot request the whole table', async () => {
      const { service, requests } = build();
      await service.listForReview({ limit: 10_000 });
      const call = (requests.listForReview as jest.Mock).mock.calls[0][0];
      expect(call.take).toBeLessThanOrEqual(101);
    });
  });
});
