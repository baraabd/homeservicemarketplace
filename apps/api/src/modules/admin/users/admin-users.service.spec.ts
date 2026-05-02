import type { Role, User, UserRole } from '@homeservicemarketplace/database';

import type { RoleRepository } from '../../../infrastructure/persistence/iam/role.repository';
import type { UserRepository } from '../../../infrastructure/persistence/iam/user.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
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
  run: <T>(fn: (t: undefined) => Promise<T>) => fn(undefined),
} as unknown as TransactionRunner;

interface Mocks {
  users: UserRepository;
  roles: RoleRepository;
  audit: AdminAuditService;
}

function makeMocks(
  over: {
    user?: User | null;
    rows?: User[];
    roles?: Array<Role>;
  } = {},
): Mocks {
  return {
    users: {
      findById: jest.fn().mockResolvedValue(over.user === undefined ? makeUser() : over.user),
      searchForAdmin: jest.fn().mockResolvedValue(over.rows ?? [makeUser()]),
      update: jest.fn(async (_id, _input) => makeUser({ isActive: false })),
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
  };
}

function makeService(m: Mocks): AdminUsersService {
  return new AdminUsersService(m.users, m.roles, m.audit, tx);
}

describe('AdminUsersService', () => {
  it('lists users with cursor pagination', async () => {
    const m = makeMocks({ rows: ['a', 'b'].map((id) => makeUser({ id })) });
    const out = await makeService(m).list({ limit: 50 });
    expect(out.items).toHaveLength(2);
    expect(out.items[0].roles).toEqual(['customer']);
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
        fn({ user: { update: jest.fn().mockResolvedValue(makeUser()) } }),
    } as unknown as TransactionRunner;
    const svc = new AdminUsersService(m.users, m.roles, m.audit, txWithUser);
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
        fn({ user: { update: jest.fn().mockResolvedValue(makeUser()) } }),
    } as unknown as TransactionRunner;
    const svc = new AdminUsersService(m.users, m.roles, m.audit, txWithUser);
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

  // ── Sprint 6.1 — canonical PATCH path ────────────────────────────

  describe('setStatus (Sprint 6.1)', () => {
    function makeTxWithUserUpdate() {
      return {
        run: <T>(fn: (t: { user: { update: jest.Mock } }) => Promise<T>) =>
          fn({ user: { update: jest.fn().mockResolvedValue(makeUser()) } }),
      } as unknown as TransactionRunner;
    }

    it('flips ACTIVE → SUSPENDED + audits + sets isActive=false', async () => {
      const m = makeMocks({ user: makeUser({ status: 'ACTIVE' }) });
      const svc = new AdminUsersService(m.users, m.roles, m.audit, makeTxWithUserUpdate());
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
            reason: 'fraud',
          }),
        }),
        expect.anything(),
      );
      expect(m.users.update).toHaveBeenCalledWith('u-1', { isActive: false }, expect.anything());
    });

    it('flips SUSPENDED → ACTIVE + records the RESTORED audit type', async () => {
      const m = makeMocks({ user: makeUser({ status: 'SUSPENDED', isActive: false }) });
      const svc = new AdminUsersService(m.users, m.roles, m.audit, makeTxWithUserUpdate());
      const out = await svc.setStatus('admin-1', 'u-1', { status: 'ACTIVE' });
      expect(out.user.status).toBe('ACTIVE');
      expect(out.user.isActive).toBe(true);
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ADMIN_USER_RESTORED' }),
        expect.anything(),
      );
    });

    it('refuses to disable self (admin-1 → SUSPENDED on own row)', async () => {
      const m = makeMocks();
      const svc = new AdminUsersService(m.users, m.roles, m.audit, makeTxWithUserUpdate());
      await expect(svc.setStatus('u-1', 'u-1', { status: 'SUSPENDED' })).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
      expect(m.audit.record).not.toHaveBeenCalled();
    });

    it('lets self → ACTIVE pass (no-op idempotent self-restore)', async () => {
      const m = makeMocks({ user: makeUser({ status: 'ACTIVE' }) });
      const svc = new AdminUsersService(m.users, m.roles, m.audit, makeTxWithUserUpdate());
      await expect(svc.setStatus('u-1', 'u-1', { status: 'ACTIVE' })).resolves.toBeDefined();
    });

    it('returns 404 when the target user does not exist', async () => {
      const m = makeMocks({ user: null });
      const svc = new AdminUsersService(m.users, m.roles, m.audit, makeTxWithUserUpdate());
      await expect(
        svc.setStatus('admin-1', 'missing', { status: 'SUSPENDED' }),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });

    it('skips the DB write when status is already at the target (idempotent)', async () => {
      const m = makeMocks({ user: makeUser({ status: 'SUSPENDED', isActive: false }) });
      const svc = new AdminUsersService(m.users, m.roles, m.audit, makeTxWithUserUpdate());
      await svc.setStatus('admin-1', 'u-1', { status: 'SUSPENDED' });
      expect(m.users.update).not.toHaveBeenCalled();
      // Audit row still emitted so the operator's intent is captured.
      expect(m.audit.record).toHaveBeenCalled();
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

  describe('list — query alias (Sprint 6.1)', () => {
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
});
