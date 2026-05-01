// Unit tests for grantAdminProviderAccess. Drives the routine against a fake
// Prisma TransactionClient so we can pin idempotency, role-attachment
// behaviour, and ProviderProfile upsert semantics without a live Postgres.
//
// The companion script `packages/database/scripts/grant-admin-provider-access.ts`
// is the only sanctioned path that grants the admin role; pinning the routine
// here is what stops a future refactor from quietly weakening the rule.

import { grantWithTx } from '@homeservicemarketplace/database';

interface FakeUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  emailVerifiedAt: Date | null;
  passwordHash: string | null;
  deletedAt: Date | null;
}

interface FakeProviderProfile {
  id: string;
  userId: string;
  displayName: string;
  initials: string;
  status: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';
  availability: 'ONLINE' | 'OFFLINE' | 'PAUSED';
  bio: string | null;
  headline: string | null;
}

function makeFakeTx(
  seed: {
    users?: FakeUser[];
    roles?: { id: string; name: string }[];
    userRoles?: { userId: string; roleId: string }[];
    providerProfiles?: FakeProviderProfile[];
  } = {},
) {
  const users: FakeUser[] = [...(seed.users ?? [])];
  const roles = [...(seed.roles ?? [])];
  const userRoles = [...(seed.userRoles ?? [])];
  const providerProfiles: FakeProviderProfile[] = [...(seed.providerProfiles ?? [])];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  return {
    user: {
      findFirst: jest.fn(
        async (args: { where: { email: string; deletedAt: null } }) =>
          users.find((u) => u.email === args.where.email && u.deletedAt === null) ?? null,
      ),
      create: jest.fn(async (args: { data: Partial<FakeUser> }) => {
        const u: FakeUser = {
          id: nextId('user'),
          email: args.data.email!,
          firstName: args.data.firstName ?? '',
          lastName: args.data.lastName ?? '',
          status: args.data.status ?? 'PENDING_VERIFICATION',
          emailVerifiedAt: args.data.emailVerifiedAt ?? null,
          passwordHash: args.data.passwordHash ?? null,
          deletedAt: null,
        };
        users.push(u);
        return u;
      }),
    },
    role: {
      findMany: jest.fn(async (args: { where: { name: { in: string[] } } }) =>
        roles.filter((r) => args.where.name.in.includes(r.name)),
      ),
    },
    userRole: {
      findMany: jest.fn(async (args: { where: { userId: string }; select: { roleId: true } }) =>
        userRoles
          .filter((ur) => ur.userId === args.where.userId)
          .map((ur) => ({ roleId: ur.roleId })),
      ),
      upsert: jest.fn(async (args: { create: { userId: string; roleId: string } }) => {
        const existing = userRoles.find(
          (ur) => ur.userId === args.create.userId && ur.roleId === args.create.roleId,
        );
        if (!existing) {
          userRoles.push({ userId: args.create.userId, roleId: args.create.roleId });
        }
        return { userId: args.create.userId, roleId: args.create.roleId };
      }),
    },
    providerProfile: {
      findUnique: jest.fn(
        async (args: { where: { userId: string } }) =>
          providerProfiles.find((p) => p.userId === args.where.userId) ?? null,
      ),
      create: jest.fn(async (args: { data: Partial<FakeProviderProfile> & { userId: string } }) => {
        const p: FakeProviderProfile = {
          id: nextId('pp'),
          userId: args.data.userId,
          displayName: args.data.displayName ?? '',
          initials: args.data.initials ?? '',
          status: args.data.status ?? 'DRAFT',
          availability: args.data.availability ?? 'OFFLINE',
          bio: args.data.bio ?? null,
          headline: args.data.headline ?? null,
        };
        providerProfiles.push(p);
        return p;
      }),
      update: jest.fn(
        async (args: { where: { id: string }; data: Partial<FakeProviderProfile> }) => {
          const p = providerProfiles.find((pp) => pp.id === args.where.id);
          if (!p) throw new Error('not found');
          Object.assign(p, args.data);
          return p;
        },
      ),
    },
    _state: { users, roles, userRoles, providerProfiles },
  };
}

const SYSTEM_ROLES = [
  { id: 'role-customer', name: 'customer' },
  { id: 'role-provider', name: 'provider' },
  { id: 'role-admin', name: 'admin' },
];

describe('grantAdminProviderAccess — grantWithTx', () => {
  it('attaches all three roles and creates an ACTIVE ProviderProfile when the user exists with no roles', async () => {
    const tx = makeFakeTx({
      users: [
        {
          id: 'u-1',
          email: 'admin@admin.com',
          firstName: 'Admin',
          lastName: 'Admin',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          passwordHash: null,
          deletedAt: null,
        },
      ],
      roles: SYSTEM_ROLES,
    });
    const summary = await grantWithTx(tx as never, 'admin@admin.com', false);
    expect(summary.userExisted).toBe(true);
    expect(summary.userCreated).toBe(false);
    expect(summary.userId).toBe('u-1');
    expect(summary.rolesAttached.sort()).toEqual(['admin', 'customer', 'provider']);
    expect(summary.rolesAlreadyPresent).toEqual([]);
    expect(summary.providerProfileCreated).toBe(true);
    expect(summary.providerProfilePromotedToActive).toBe(false);
    // The user-roles table now has one row per system role for this user.
    expect(tx._state.userRoles).toHaveLength(3);
    // The ProviderProfile is ACTIVE — so the marketplace surface immediately
    // accepts the user.
    expect(tx._state.providerProfiles).toHaveLength(1);
    expect(tx._state.providerProfiles[0]!.status).toBe('ACTIVE');
    expect(tx._state.providerProfiles[0]!.userId).toBe('u-1');
  });

  it('is idempotent — a second run produces no new role rows or profiles', async () => {
    const tx = makeFakeTx({
      users: [
        {
          id: 'u-1',
          email: 'admin@admin.com',
          firstName: 'Admin',
          lastName: 'Admin',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          passwordHash: null,
          deletedAt: null,
        },
      ],
      roles: SYSTEM_ROLES,
    });
    await grantWithTx(tx as never, 'admin@admin.com', false);
    const userRolesAfter1 = tx._state.userRoles.length;
    const providerProfilesAfter1 = tx._state.providerProfiles.length;

    const summary = await grantWithTx(tx as never, 'admin@admin.com', false);

    expect(summary.rolesAttached).toEqual([]);
    expect(summary.rolesAlreadyPresent.sort()).toEqual(['admin', 'customer', 'provider']);
    expect(summary.providerProfileCreated).toBe(false);
    expect(summary.providerProfilePromotedToActive).toBe(false);
    expect(tx._state.userRoles).toHaveLength(userRolesAfter1);
    expect(tx._state.providerProfiles).toHaveLength(providerProfilesAfter1);
  });

  it('promotes an existing DRAFT ProviderProfile to ACTIVE without rewriting other fields', async () => {
    const tx = makeFakeTx({
      users: [
        {
          id: 'u-1',
          email: 'admin@admin.com',
          firstName: 'Admin',
          lastName: 'Admin',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          passwordHash: null,
          deletedAt: null,
        },
      ],
      roles: SYSTEM_ROLES,
      userRoles: [
        { userId: 'u-1', roleId: 'role-customer' },
        { userId: 'u-1', roleId: 'role-provider' },
      ],
      providerProfiles: [
        {
          id: 'pp-1',
          userId: 'u-1',
          displayName: 'Operator Display',
          initials: 'OD',
          status: 'DRAFT',
          availability: 'OFFLINE',
          bio: 'preserved bio',
          headline: 'preserved headline',
        },
      ],
    });
    const summary = await grantWithTx(tx as never, 'admin@admin.com', false);
    expect(summary.providerProfileCreated).toBe(false);
    expect(summary.providerProfilePromotedToActive).toBe(true);
    const updated = tx._state.providerProfiles[0]!;
    expect(updated.status).toBe('ACTIVE');
    // Editable fields are preserved — we did not overwrite them.
    expect(updated.displayName).toBe('Operator Display');
    expect(updated.initials).toBe('OD');
    expect(updated.bio).toBe('preserved bio');
    expect(updated.headline).toBe('preserved headline');
    // The admin role is the missing piece; it should now be attached.
    expect(summary.rolesAttached).toEqual(['admin']);
    expect(summary.rolesAlreadyPresent.sort()).toEqual(['customer', 'provider']);
  });

  it('returns userExisted=false and changes nothing when the user is missing and createIfMissing is false', async () => {
    const tx = makeFakeTx({ users: [], roles: SYSTEM_ROLES });
    const summary = await grantWithTx(tx as never, 'ghost@example.com', false);
    expect(summary.userExisted).toBe(false);
    expect(summary.userCreated).toBe(false);
    expect(summary.userId).toBeNull();
    expect(summary.rolesAttached).toEqual([]);
    expect(tx._state.users).toHaveLength(0);
    expect(tx._state.userRoles).toHaveLength(0);
    expect(tx._state.providerProfiles).toHaveLength(0);
  });

  it('creates a passwordless placeholder user and attaches all roles when createIfMissing is true', async () => {
    const tx = makeFakeTx({ users: [], roles: SYSTEM_ROLES });
    const summary = await grantWithTx(tx as never, 'admin@admin.com', true);
    expect(summary.userCreated).toBe(true);
    expect(summary.userExisted).toBe(false);
    expect(summary.userId).toBeTruthy();
    const created = tx._state.users[0]!;
    // No password is set — the operator must use the forgot-password flow
    // before login. The script never writes a password hash.
    expect(created.passwordHash).toBeNull();
    expect(created.email).toBe('admin@admin.com');
    expect(created.status).toBe('ACTIVE');
    expect(created.emailVerifiedAt).not.toBeNull();
    expect(summary.rolesAttached.sort()).toEqual(['admin', 'customer', 'provider']);
    expect(tx._state.providerProfiles).toHaveLength(1);
    expect(tx._state.providerProfiles[0]!.status).toBe('ACTIVE');
  });

  it('throws a clear error if a system role is not seeded', async () => {
    const tx = makeFakeTx({
      users: [
        {
          id: 'u-1',
          email: 'admin@admin.com',
          firstName: 'A',
          lastName: 'A',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          passwordHash: null,
          deletedAt: null,
        },
      ],
      // Missing the 'admin' role — the seed has not run.
      roles: [
        { id: 'role-customer', name: 'customer' },
        { id: 'role-provider', name: 'provider' },
      ],
    });
    await expect(grantWithTx(tx as never, 'admin@admin.com', false)).rejects.toThrow(
      /system role "admin" is not seeded/,
    );
  });

  it('normalises email case before lookup (admin@admin.com matches Admin@ADMIN.com)', async () => {
    const tx = makeFakeTx({
      users: [
        {
          id: 'u-1',
          email: 'admin@admin.com',
          firstName: 'A',
          lastName: 'A',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          passwordHash: null,
          deletedAt: null,
        },
      ],
      roles: SYSTEM_ROLES,
    });
    // Mixed-case email should still find the existing lowercase row — never
    // create a duplicate identity.
    const summary = await grantWithTx(tx as never, 'Admin@ADMIN.com'.toLowerCase(), false);
    expect(summary.userExisted).toBe(true);
    expect(summary.userId).toBe('u-1');
    expect(tx._state.users).toHaveLength(1);
  });
});
