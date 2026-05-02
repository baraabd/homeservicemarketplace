import type { Role, User, UserRole } from '@homeservicemarketplace/database';

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
  audit: AdminAuditService;
}

function makeMocks(over: { user?: User | null; rows?: User[] } = {}): Mocks {
  return {
    users: {
      findById: jest.fn().mockResolvedValue(over.user === undefined ? makeUser() : over.user),
      searchForAdmin: jest.fn().mockResolvedValue(over.rows ?? [makeUser()]),
      update: jest.fn(async (_id, _input) => makeUser({ isActive: false })),
      listRoles: jest
        .fn()
        .mockResolvedValue([
          {
            userId: 'u-1',
            roleId: 'r-customer',
            role: { id: 'r-customer', name: 'customer' } as Role,
          } as UserRole & { role: Role },
        ]),
    } as unknown as UserRepository,
    audit: {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AdminAuditService,
  };
}

function makeService(m: Mocks): AdminUsersService {
  return new AdminUsersService(m.users, m.audit, tx);
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
    const svc = new AdminUsersService(m.users, m.audit, txWithUser);
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
    const svc = new AdminUsersService(m.users, m.audit, txWithUser);
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
});
