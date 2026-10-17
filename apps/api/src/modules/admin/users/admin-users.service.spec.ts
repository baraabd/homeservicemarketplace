import type { Role, User, UserRole } from '@homeservicemarketplace/database';

import type { RoleRepository } from '../../../infrastructure/persistence/iam/role.repository';
import type { SessionRepository } from '../../../infrastructure/persistence/iam/session.repository';
import type { UserRepository } from '../../../infrastructure/persistence/iam/user.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AdminAccessRequestRepository } from '../../../infrastructure/persistence/iam/admin-access-request.repository';
import { SecurityEventsBus } from '../../../shared/security-events/security-events.bus';
import type { AdminAuditService } from '../admin-audit.service';
import { AdminUsersService } from './admin-users.service';

function makeUser(over: Partial<User> = {}): User {
  return {
    id: 'u-1',
    email: 'ada@example.com',
    passwordHash: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    emailVerifiedAt: new Date('2026-01-02T00:00:00Z'),
    failedLoginCount: 0,
    lockedUntil: null,
    mfaEnabled: false,
    mfaEnrolledAt: null,
    mfaSecret: null,
    passwordUpdatedAt: null,
    status: 'ACTIVE',
    ...over,
  } as User;
}

const tx: TransactionRunner = {
  // R17-D: the service row-locks the target user through the transaction.
  run: <T>(fn: (t: never) => Promise<T>) =>
    fn({ $queryRaw: jest.fn().mockResolvedValue([]), $executeRaw: jest.fn() } as never),
} as unknown as TransactionRunner;

interface Mocks {
  users: UserRepository;
  roles: RoleRepository;
  audit: AdminAuditService;
  sessions: SessionRepository;
  securityEvents: SecurityEventsBus;
  adminAccessRequests: AdminAccessRequestRepository;
}

function makeMocks(
  over: {
    user?: User | null;
    rows?: User[];
    roles?: Array<Role>;
  } = {},
): Mocks {
  return {
    sessions: {
      revokeAllForUser: jest.fn().mockResolvedValue({ count: 2 }),
    } as unknown as SessionRepository,
    // D-2/D-4: the admin status flip no longer busts a cache (the per-request
    // check reads the Session row directly). It publishes a post-commit event
    // so live WebSockets are torn down.
    securityEvents: {
      emitAllSessionsRevoked: jest.fn(),
      emitSessionRevoked: jest.fn(),
      emitRolesChanged: jest.fn(),
      emitProviderStatusChanged: jest.fn(),
    } as unknown as SecurityEventsBus,
    users: {
      findById: jest.fn().mockResolvedValue(over.user === undefined ? makeUser() : over.user),
      searchForAdmin: jest.fn().mockResolvedValue(over.rows ?? [makeUser()]),
      update: jest.fn(async (_id, _input) => makeUser({ isActive: false })),
      listRoleNamesForUsers: jest
        .fn()
        .mockImplementation(async (ids: string[]) =>
          ids.map((userId) => ({ userId, role: { name: 'customer' } })),
        ),
      listRoles: jest.fn().mockResolvedValue([
        {
          userId: 'u-1',
          roleId: 'r-customer',
          role: { id: 'r-customer', name: 'customer' } as Role,
        } as UserRole & { role: Role },
      ]),
    } as unknown as UserRepository,
    roles: {
      listAll: jest.fn().mockResolvedValue(
        over.roles ??
          ([
            { id: 'r-admin', name: 'admin', description: 'Platform admin' },
            { id: 'r-provider', name: 'provider', description: null },
            { id: 'r-customer', name: 'customer', description: null },
          ] as Role[]),
      ),
    } as unknown as RoleRepository,
    audit: {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AdminAuditService,
    // Phase 4 â€” axis 3. Default: this user has never asked for admin access.
    adminAccessRequests: {
      findLatestByUserId: jest.fn().mockResolvedValue(null),
      findLatestStatusesByUserIds: jest.fn().mockResolvedValue([]),
    } as unknown as AdminAccessRequestRepository,
  };
}

function makeService(m: Mocks): AdminUsersService {
  return new AdminUsersService(
    m.users,
    m.roles,
    m.audit,
    tx,
    m.sessions,
    m.adminAccessRequests,
    m.securityEvents,
  );
}

describe('AdminUsersService', () => {
  // Phase 4 â€” the dashboard must be able to render THREE separate columns.
  // These tests pin that the summary reports them independently, so no screen
  // has to infer admin standing from the account status.
  describe('the three account axes are reported separately', () => {
    it('an ACTIVE customer is not described as an admin in any field', async () => {
      const m = makeMocks({ user: makeUser({ status: 'ACTIVE' }) });
      const [row] = (await makeService(m).list({})).items;
      expect(row.status).toBe('ACTIVE');
      expect(row.roles).toEqual(['customer']);
      expect(row.adminAccessRequestStatus).toBeNull();
    });

    it('reports a PENDING admin-access request without granting any role', async () => {
      const m = makeMocks({ user: makeUser({ status: 'ACTIVE' }) });
      (m.adminAccessRequests.findLatestStatusesByUserIds as jest.Mock).mockResolvedValue([
        {
          userId: 'u-1',
          status: 'PENDING',
        },
      ]);
      const [row] = (await makeService(m).list({})).items;
      expect(row.adminAccessRequestStatus).toBe('PENDING');
      // Asked is not granted.
      expect(row.roles).not.toContain('admin');
    });

    it('distinguishes "never asked" (null) from "asked and refused" (REJECTED)', async () => {
      const m = makeMocks({ user: makeUser({ status: 'ACTIVE' }) });
      expect((await makeService(m).list({})).items[0].adminAccessRequestStatus).toBeNull();

      (m.adminAccessRequests.findLatestStatusesByUserIds as jest.Mock).mockResolvedValue([
        {
          userId: 'u-1',
          status: 'REJECTED',
        },
      ]);
      expect((await makeService(m).list({})).items[0].adminAccessRequestStatus).toBe('REJECTED');
    });
  });

  it('lists users with cursor pagination', async () => {
    const m = makeMocks({ rows: ['a', 'b'].map((id) => makeUser({ id })) });
    const out = await makeService(m).list({ limit: 50 });
    expect(out.items).toHaveLength(2);
    expect(out.items[0].roles).toEqual(['customer']);
  });

  it('batches only the returned page and never performs per-user reads', async () => {
    const m = makeMocks({ rows: ['a', 'b', 'lookahead'].map((id) => makeUser({ id })) });
    (m.users.listRoleNamesForUsers as jest.Mock).mockResolvedValue([
      { userId: 'a', role: { name: 'admin' } },
      { userId: 'a', role: { name: 'customer' } },
    ]);
    (m.adminAccessRequests.findLatestStatusesByUserIds as jest.Mock).mockResolvedValue([
      { userId: 'b', status: 'REJECTED' },
    ]);
    const out = await makeService(m).list({ limit: 2 });
    expect(out.nextCursor).toBe('b');
    expect(out.items.map((u) => [u.id, u.roles, u.adminAccessRequestStatus])).toEqual([
      ['a', ['admin', 'customer'], null],
      ['b', [], 'REJECTED'],
    ]);
    expect(m.users.listRoleNamesForUsers).toHaveBeenCalledTimes(1);
    expect(m.users.listRoleNamesForUsers).toHaveBeenCalledWith(['a', 'b']);
    expect(m.adminAccessRequests.findLatestStatusesByUserIds).toHaveBeenCalledWith(['a', 'b']);
    expect(m.users.listRoles).not.toHaveBeenCalled();
    expect(m.adminAccessRequests.findLatestByUserId).not.toHaveBeenCalled();
    expect(JSON.stringify(out)).not.toMatch(/passwordHash|mfaSecret|justification/);
  });

  it('does not issue enrichment reads for an empty page', async () => {
    const m = makeMocks({ rows: [] });
    expect(await makeService(m).list({})).toEqual({ items: [], nextCursor: null });
    expect(m.users.listRoleNamesForUsers).not.toHaveBeenCalled();
    expect(m.adminAccessRequests.findLatestStatusesByUserIds).not.toHaveBeenCalled();
  });

  it('detail returns 404 if user is missing', async () => {
    const m = makeMocks({ user: null });
    await expect(makeService(m).detail('u-missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('suspend writes audit row + flips status', async () => {
    const m = makeMocks();
    // Add a `tx?.user.update` shim onto our makeMocks transaction
    const txWithUser = {
      run: <T>(fn: (t: { user: { update: jest.Mock } }) => Promise<T>) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([]),
          $executeRaw: jest.fn(),
          user: { update: jest.fn().mockResolvedValue(makeUser()) },
        } as never),
    } as unknown as TransactionRunner;
    const svc = new AdminUsersService(
      m.users,
      m.roles,
      m.audit,
      txWithUser,
      m.sessions,
      m.adminAccessRequests,
      m.securityEvents,
    );
    await svc.suspend('admin-1', 'u-1');
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: 'admin-1', type: 'ADMIN_USER_SUSPENDED' }),
      expect.anything(),
    );
  });

  it('refuses to suspend self', async () => {
    const m = makeMocks();
    await expect(makeService(m).suspend('u-1', 'u-1')).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('restore writes audit row', async () => {
    const m = makeMocks();
    const txWithUser = {
      run: <T>(fn: (t: { user: { update: jest.Mock } }) => Promise<T>) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([]),
          $executeRaw: jest.fn(),
          user: { update: jest.fn().mockResolvedValue(makeUser()) },
        } as never),
    } as unknown as TransactionRunner;
    const svc = new AdminUsersService(
      m.users,
      m.roles,
      m.audit,
      txWithUser,
      m.sessions,
      m.adminAccessRequests,
      m.securityEvents,
    );
    await svc.restore('admin-1', 'u-1');
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: 'admin-1', type: 'ADMIN_USER_RESTORED' }),
      expect.anything(),
    );
  });

  it('summary does NOT include passwordHash / mfaSecret on the wire', async () => {
    const m = makeMocks();
    const out = await makeService(m).detail('u-1');
    expect(JSON.stringify(out)).not.toContain('passwordHash');
    expect(JSON.stringify(out)).not.toContain('mfaSecret');
  });

  // â”€â”€ Sprint 6.1 â€” canonical PATCH path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe('setStatus (Sprint 6.1)', () => {
    function makeTxWithUserUpdate() {
      return {
        run: <T>(fn: (t: { user: { update: jest.Mock } }) => Promise<T>) =>
          fn({
            $queryRaw: jest.fn().mockResolvedValue([]),
            $executeRaw: jest.fn(),
            user: { update: jest.fn().mockResolvedValue(makeUser()) },
          } as never),
      } as unknown as TransactionRunner;
    }

    it('flips ACTIVE â†’ SUSPENDED + audits + sets isActive=false', async () => {
      const m = makeMocks({ user: makeUser({ status: 'ACTIVE' }) });
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        makeTxWithUserUpdate(),
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      const out = await svc.setStatus('admin-1', 'u-1', { status: 'SUSPENDED', reason: 'fraud' });
      expect(out.user.status).toBe('SUSPENDED');
      expect(out.user.isActive).toBe(false);
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          adminUserId: 'admin-1',
          type: 'ADMIN_USER_SUSPENDED',
          metadata: expect.objectContaining({
            targetUserId: 'u-1',
            targetStatus: 'SUSPENDED',
            previousStatus: 'ACTIVE',
            // R17-D: the length is audited, never the free text.
            reasonLength: 5,
          }),
        }),
        expect.anything(),
      );
      expect(m.users.update).toHaveBeenCalledWith('u-1', { isActive: false }, expect.anything());
    });

    it('flips SUSPENDED â†’ ACTIVE + records the RESTORED audit type', async () => {
      const m = makeMocks({ user: makeUser({ status: 'SUSPENDED', isActive: false }) });
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        makeTxWithUserUpdate(),
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      const out = await svc.setStatus('admin-1', 'u-1', { status: 'ACTIVE' });
      expect(out.user.status).toBe('ACTIVE');
      expect(out.user.isActive).toBe(true);
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ADMIN_USER_RESTORED' }),
        expect.anything(),
      );
    });

    it('refuses to disable self (admin-1 â†’ SUSPENDED on own row)', async () => {
      const m = makeMocks();
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        makeTxWithUserUpdate(),
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      await expect(svc.setStatus('u-1', 'u-1', { status: 'SUSPENDED' })).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
      expect(m.audit.record).not.toHaveBeenCalled();
    });

    it('lets self â†’ ACTIVE pass (no-op idempotent self-restore)', async () => {
      const m = makeMocks({ user: makeUser({ status: 'ACTIVE' }) });
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        makeTxWithUserUpdate(),
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      await expect(svc.setStatus('u-1', 'u-1', { status: 'ACTIVE' })).resolves.toBeDefined();
    });

    it('returns 404 when the target user does not exist', async () => {
      const m = makeMocks({ user: null });
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        makeTxWithUserUpdate(),
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      await expect(
        svc.setStatus('admin-1', 'missing', { status: 'SUSPENDED' }),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });

    it('skips the DB write when status is already at the target (idempotent)', async () => {
      const m = makeMocks({ user: makeUser({ status: 'SUSPENDED', isActive: false }) });
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        makeTxWithUserUpdate(),
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      await svc.setStatus('admin-1', 'u-1', { status: 'SUSPENDED' });
      expect(m.users.update).not.toHaveBeenCalled();
      // Audit row still emitted so the operator's intent is captured.
      expect(m.audit.record).toHaveBeenCalled();
    });
  });

  // â”€â”€ Sprint 01 â€” revoke sessions on suspend / lock (one transaction) â”€â”€
  describe('session revocation on suspend / lock', () => {
    function makeTxWithUserUpdate() {
      return {
        run: <T>(fn: (t: { user: { update: jest.Mock } }) => Promise<T>) =>
          fn({
            $queryRaw: jest.fn().mockResolvedValue([]),
            $executeRaw: jest.fn(),
            user: { update: jest.fn().mockResolvedValue(makeUser()) },
          } as never),
      } as unknown as TransactionRunner;
    }

    it('setStatus â†’ SUSPENDED revokes every session inside the same transaction', async () => {
      const m = makeMocks({ user: makeUser({ status: 'ACTIVE' }) });
      const tx = makeTxWithUserUpdate();
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        tx,
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      await svc.setStatus('admin-1', 'u-1', { status: 'SUSPENDED' });
      // Called with the target user id AND the transaction handle (2nd arg
      // present) so the status flip and the revoke commit atomically.
      expect(m.sessions.revokeAllForUser).toHaveBeenCalledTimes(1);
      const [uid, txArg] = (m.sessions.revokeAllForUser as jest.Mock).mock.calls[0];
      expect(uid).toBe('u-1');
      expect(txArg).toBeDefined();
    });

    it('setStatus â†’ LOCKED revokes every session', async () => {
      const m = makeMocks({ user: makeUser({ status: 'ACTIVE' }) });
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        makeTxWithUserUpdate(),
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      await svc.setStatus('admin-1', 'u-1', { status: 'LOCKED' });
      expect(m.sessions.revokeAllForUser).toHaveBeenCalledWith('u-1', expect.anything());
    });

    it('setStatus â†’ ACTIVE (restore) does NOT revoke sessions', async () => {
      const m = makeMocks({ user: makeUser({ status: 'SUSPENDED', isActive: false }) });
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        makeTxWithUserUpdate(),
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      await svc.setStatus('admin-1', 'u-1', { status: 'ACTIVE' });
      expect(m.sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('setStatus â†’ SUSPENDED invalidates the session-standing cache for immediate blocking', async () => {
      const m = makeMocks({ user: makeUser({ status: 'ACTIVE' }) });
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        makeTxWithUserUpdate(),
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      await svc.setStatus('admin-1', 'u-1', { status: 'SUSPENDED' });
      // REST-side revocation is already durable (sessions were revoked inside
      // the transaction and the per-request check reads them), so what this
      // pins is the post-commit teardown of already-connected sockets.
      expect(m.securityEvents.emitAllSessionsRevoked).toHaveBeenCalledWith({
        userId: 'u-1',
        reason: 'account-suspended',
      });
    });

    it('records the revoked session count in the suspend audit metadata', async () => {
      const m = makeMocks({ user: makeUser({ status: 'ACTIVE' }) });
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        makeTxWithUserUpdate(),
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      await svc.setStatus('admin-1', 'u-1', { status: 'SUSPENDED' });
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ADMIN_USER_SUSPENDED',
          metadata: expect.objectContaining({ revokedSessionCount: 2 }),
        }),
        expect.anything(),
      );
    });

    it('legacy suspend() revokes every session inside the same transaction', async () => {
      const m = makeMocks();
      const txWithUser = {
        run: <T>(fn: (t: { user: { update: jest.Mock } }) => Promise<T>) =>
          fn({
            $queryRaw: jest.fn().mockResolvedValue([]),
            $executeRaw: jest.fn(),
            user: { update: jest.fn().mockResolvedValue(makeUser()) },
          } as never),
      } as unknown as TransactionRunner;
      const svc = new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        txWithUser,
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
      await svc.suspend('admin-1', 'u-1');
      expect(m.sessions.revokeAllForUser).toHaveBeenCalledWith('u-1', expect.anything());
    });
  });

  describe('listRoles (Sprint 6.1)', () => {
    it('returns the seeded roles', async () => {
      const m = makeMocks();
      const out = await makeService(m).listRoles();
      expect(out.items.map((r) => r.name).sort()).toEqual(['admin', 'customer', 'provider']);
    });

    it('forwards the description field for each role', async () => {
      const m = makeMocks();
      const out = await makeService(m).listRoles();
      const adminRow = out.items.find((r) => r.name === 'admin');
      expect(adminRow?.description).toBe('Platform admin');
    });
  });

  describe('list â€” query alias (Sprint 6.1)', () => {
    it('prefers `query` over the legacy `q` when both are present', async () => {
      const m = makeMocks({ rows: [makeUser()] });
      await makeService(m).list({ q: 'old', query: 'new' });
      expect(m.users.searchForAdmin).toHaveBeenCalledWith(expect.objectContaining({ q: 'new' }));
    });

    it('falls back to `q` when `query` is not provided', async () => {
      const m = makeMocks({ rows: [makeUser()] });
      await makeService(m).list({ q: 'legacy' });
      expect(m.users.searchForAdmin).toHaveBeenCalledWith(expect.objectContaining({ q: 'legacy' }));
    });
  });
  // R18 (D-8 safety floor) â€” the platform must keep one administrator in good
  // standing. The SQL itself runs against Postgres in
  // test/integration/r18-admin-floor.integration.spec.ts; these pin the order
  // of locks and the refusal before any write.
  describe('last active administrator', () => {
    function floorTx(row: { target: boolean; others: number }) {
      const calls: string[] = [];
      const client = {
        $executeRaw: jest.fn(async (sql: TemplateStringsArray) => {
          calls.push(sql.join('?').includes('pg_advisory_xact_lock') ? 'floor-lock' : 'execute');
        }),
        $queryRaw: jest.fn(async (sql: TemplateStringsArray) => {
          const text = sql.join('?');
          if (text.includes('FOR UPDATE')) {
            calls.push('row-lock');
            return [];
          }
          calls.push('floor-count');
          return [row];
        }),
        user: { update: jest.fn().mockResolvedValue(makeUser()) },
      };
      const runner = { run: <T>(fn: (t: never) => Promise<T>) => fn(client as never) };
      return { runner: runner as unknown as TransactionRunner, client, calls };
    }

    function service(m: Mocks, runner: TransactionRunner) {
      return new AdminUsersService(
        m.users,
        m.roles,
        m.audit,
        runner,
        m.sessions,
        m.adminAccessRequests,
        m.securityEvents,
      );
    }

    for (const status of ['SUSPENDED', 'LOCKED'] as const) {
      it(`refuses ${status} for the last active admin before writing anything`, async () => {
        const m = makeMocks();
        const { runner, client, calls } = floorTx({ target: true, others: 0 });
        await expect(
          service(m, runner).setStatus('admin-1', 'u-1', { status }),
        ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
        expect(calls).toEqual(['floor-lock', 'row-lock', 'floor-count']);
        expect(m.users.update).not.toHaveBeenCalled();
        expect(client.user.update).not.toHaveBeenCalled();
        expect(m.sessions.revokeAllForUser).not.toHaveBeenCalled();
        expect(m.audit.record).not.toHaveBeenCalled();
        expect(m.securityEvents.emitAllSessionsRevoked).not.toHaveBeenCalled();
      });
    }

    it('legacy suspend refuses the last active admin too', async () => {
      const m = makeMocks();
      const { runner, calls } = floorTx({ target: true, others: 0 });
      await expect(service(m, runner).suspend('admin-1', 'u-1')).rejects.toMatchObject({
        status: 409,
      });
      expect(calls).toEqual(['floor-lock', 'row-lock', 'floor-count']);
      expect(m.sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('suspends an admin while another active admin remains', async () => {
      const m = makeMocks();
      const { runner, calls } = floorTx({ target: true, others: 1 });
      await service(m, runner).setStatus('admin-1', 'u-1', { status: 'SUSPENDED' });
      expect(calls.slice(0, 3)).toEqual(['floor-lock', 'row-lock', 'floor-count']);
      expect(m.sessions.revokeAllForUser).toHaveBeenCalled();
    });

    it('a non-admin target is unaffected by the floor', async () => {
      const m = makeMocks();
      const { runner } = floorTx({ target: false, others: 0 });
      await service(m, runner).setStatus('admin-1', 'u-1', { status: 'SUSPENDED' });
      expect(m.audit.record).toHaveBeenCalled();
    });

    it('a restore never takes the floor lock', async () => {
      const m = makeMocks({ user: makeUser({ status: 'SUSPENDED', isActive: false }) });
      const { runner, calls } = floorTx({ target: false, others: 0 });
      await service(m, runner).setStatus('admin-1', 'u-1', { status: 'ACTIVE' });
      expect(calls).not.toContain('floor-lock');
      expect(calls).not.toContain('floor-count');
    });
  });
});
