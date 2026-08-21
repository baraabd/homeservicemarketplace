// Unit tests for the operator bootstrap grants. Drives them against a fake
// Prisma TransactionClient so idempotency, role attachment, and ProviderProfile
// semantics are pinned without a live Postgres.
//
// Phase 4 replaced ONE combined `grantWithTx` (customer + provider + admin, and
// force-activate the ProviderProfile) with two least-privilege routines. The
// assertions that matter most here are the negative ones: granting admin must
// not touch the provider axis, and granting provider must not attach admin.
//
// These routines remain the BOOTSTRAP path only. In-app admin access goes
// through the reviewed AdminAccessRequest lifecycle; in-app provider access
// goes through upgrade -> onboarding -> submit-for-review -> admin approval.
// Pinning them here is what stops a future refactor from quietly re-welding
// the axes together.

import {
  assertGrantNotProductionUnsafe,
  grantAdminWithTx,
  grantProviderWithTx,
} from '@homeservicemarketplace/database';

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

// ─── shared fixtures ─────────────────────────────────────────────────────────

const ACTIVE_USER: FakeUser = {
  id: 'u-1',
  email: 'operator@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: 'ACTIVE',
  emailVerifiedAt: new Date(),
  passwordHash: null,
  deletedAt: null,
};

const withUser = () => makeFakeTx({ users: [{ ...ACTIVE_USER }], roles: SYSTEM_ROLES });

describe('grantAdminWithTx — admin axis only', () => {
  it('attaches customer + admin and NEVER creates a ProviderProfile', async () => {
    // This is the whole point of the Phase 4 split: granting administration
    // must not also mint an approved marketplace seller.
    const tx = withUser();
    const summary = await grantAdminWithTx(tx as never, 'operator@example.com', false);

    expect(summary.kind).toBe('admin');
    expect(summary.userExisted).toBe(true);
    expect(summary.userId).toBe('u-1');
    expect(summary.rolesAttached.sort()).toEqual(['admin', 'customer']);
    expect(summary.rolesAttached).not.toContain('provider');
    expect(tx._state.userRoles.map((ur) => ur.roleId)).not.toContain('role-provider');
    expect(tx._state.providerProfiles).toHaveLength(0);
    expect(tx.providerProfile.create).not.toHaveBeenCalled();
    expect(tx.providerProfile.update).not.toHaveBeenCalled();
  });

  it('leaves an EXISTING provider profile untouched — it never approves one', async () => {
    const tx = makeFakeTx({
      users: [{ ...ACTIVE_USER }],
      roles: SYSTEM_ROLES,
      providerProfiles: [
        {
          id: 'pp-1',
          userId: 'u-1',
          displayName: 'Operator Display',
          initials: 'OD',
          status: 'PENDING_REVIEW',
          availability: 'OFFLINE',
          bio: null,
          headline: null,
        },
      ],
    });
    await grantAdminWithTx(tx as never, 'operator@example.com', false);
    // Still awaiting review. Becoming an admin is not a provider approval.
    expect(tx._state.providerProfiles[0]!.status).toBe('PENDING_REVIEW');
    expect(tx.providerProfile.update).not.toHaveBeenCalled();
  });

  it('is idempotent — a second run produces no new rows', async () => {
    const tx = withUser();
    await grantAdminWithTx(tx as never, 'operator@example.com', false);
    const rolesAfterFirst = tx._state.userRoles.length;

    const summary = await grantAdminWithTx(tx as never, 'operator@example.com', false);
    expect(summary.rolesAttached).toEqual([]);
    expect(summary.rolesAlreadyPresent.sort()).toEqual(['admin', 'customer']);
    expect(tx._state.userRoles).toHaveLength(rolesAfterFirst);
  });

  it('changes nothing when the user is missing and createIfMissing is false', async () => {
    const tx = makeFakeTx({ users: [], roles: SYSTEM_ROLES });
    const summary = await grantAdminWithTx(tx as never, 'ghost@example.com', false);
    expect(summary.userExisted).toBe(false);
    expect(summary.userCreated).toBe(false);
    expect(summary.userId).toBeNull();
    expect(summary.rolesAttached).toEqual([]);
    expect(tx._state.users).toHaveLength(0);
    expect(tx._state.userRoles).toHaveLength(0);
  });

  it('creates a PASSWORDLESS placeholder when createIfMissing is true', async () => {
    const tx = makeFakeTx({ users: [], roles: SYSTEM_ROLES });
    const summary = await grantAdminWithTx(tx as never, 'operator@example.com', true);

    expect(summary.userCreated).toBe(true);
    const created = tx._state.users[0]!;
    // The routine must never write a password hash — the operator uses the
    // normal forgot-password flow.
    expect(created.passwordHash).toBeNull();
    expect(created.email).toBe('operator@example.com');
    expect(created.status).toBe('ACTIVE');
    expect(created.emailVerifiedAt).not.toBeNull();
    expect(summary.rolesAttached.sort()).toEqual(['admin', 'customer']);
    // Still no provider profile.
    expect(tx._state.providerProfiles).toHaveLength(0);
  });

  it('throws a clear error if the admin role is not seeded', async () => {
    const tx = makeFakeTx({
      users: [{ ...ACTIVE_USER }],
      roles: [{ id: 'role-customer', name: 'customer' }],
    });
    await expect(grantAdminWithTx(tx as never, 'operator@example.com', false)).rejects.toThrow(
      /system role "admin" is not seeded/,
    );
  });

  it('never creates a duplicate identity for a case-variant email', async () => {
    const tx = withUser();
    const summary = await grantAdminWithTx(
      tx as never,
      'Operator@EXAMPLE.com'.toLowerCase(),
      false,
    );
    expect(summary.userExisted).toBe(true);
    expect(summary.userId).toBe('u-1');
    expect(tx._state.users).toHaveLength(1);
  });
});

describe('grantProviderWithTx — provider axis only', () => {
  it('attaches customer + provider and NEVER attaches admin', async () => {
    const tx = withUser();
    const summary = await grantProviderWithTx(tx as never, 'operator@example.com', false, false);

    expect(summary.kind).toBe('provider');
    expect(summary.rolesAttached.sort()).toEqual(['customer', 'provider']);
    expect(summary.rolesAttached).not.toContain('admin');
    expect(tx._state.userRoles.map((ur) => ur.roleId)).not.toContain('role-admin');
  });

  it('creates the profile as DRAFT by default — an operator grant is not an approval', async () => {
    // A bootstrap script that activates by default is exactly how
    // "DRAFT/PENDING_REVIEW means nothing" creeps back in.
    const tx = withUser();
    const summary = await grantProviderWithTx(tx as never, 'operator@example.com', false, false);

    expect(summary.providerProfileCreated).toBe(true);
    expect(summary.providerProfileStatus).toBe('DRAFT');
    expect(summary.providerProfilePromotedToActive).toBe(false);
    expect(tx._state.providerProfiles).toHaveLength(1);
    expect(tx._state.providerProfiles[0]!.status).toBe('DRAFT');
  });

  it('creates the profile as ACTIVE only when activation is EXPLICITLY requested', async () => {
    const tx = withUser();
    const summary = await grantProviderWithTx(tx as never, 'operator@example.com', false, true);
    expect(summary.providerProfileStatus).toBe('ACTIVE');
    expect(tx._state.providerProfiles[0]!.status).toBe('ACTIVE');
  });

  it.each(['DRAFT', 'PENDING_REVIEW', 'SUSPENDED', 'REJECTED'] as const)(
    'leaves an existing %s profile alone unless activation is requested',
    async (status) => {
      const tx = makeFakeTx({
        users: [{ ...ACTIVE_USER }],
        roles: SYSTEM_ROLES,
        providerProfiles: [
          {
            id: 'pp-1',
            userId: 'u-1',
            displayName: 'Operator Display',
            initials: 'OD',
            status,
            availability: 'OFFLINE',
            bio: 'preserved bio',
            headline: 'preserved headline',
          },
        ],
      });
      const summary = await grantProviderWithTx(tx as never, 'operator@example.com', false, false);
      expect(summary.providerProfileCreated).toBe(false);
      expect(summary.providerProfilePromotedToActive).toBe(false);
      expect(tx._state.providerProfiles[0]!.status).toBe(status);
      expect(tx.providerProfile.update).not.toHaveBeenCalled();
    },
  );

  it('promotes an existing DRAFT profile to ACTIVE without rewriting editable fields', async () => {
    const tx = makeFakeTx({
      users: [{ ...ACTIVE_USER }],
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
    const summary = await grantProviderWithTx(tx as never, 'operator@example.com', false, true);

    expect(summary.providerProfilePromotedToActive).toBe(true);
    const updated = tx._state.providerProfiles[0]!;
    expect(updated.status).toBe('ACTIVE');
    // Editable fields survive — the routine only moves the status.
    expect(updated.displayName).toBe('Operator Display');
    expect(updated.initials).toBe('OD');
    expect(updated.bio).toBe('preserved bio');
    expect(updated.headline).toBe('preserved headline');
    expect(summary.rolesAttached).toEqual([]);
    expect(summary.rolesAlreadyPresent.sort()).toEqual(['customer', 'provider']);
  });

  it('is idempotent — a second run produces no new roles or profiles', async () => {
    const tx = withUser();
    await grantProviderWithTx(tx as never, 'operator@example.com', false, false);
    const roles = tx._state.userRoles.length;
    const profiles = tx._state.providerProfiles.length;

    const summary = await grantProviderWithTx(tx as never, 'operator@example.com', false, false);
    expect(summary.rolesAttached).toEqual([]);
    expect(summary.providerProfileCreated).toBe(false);
    expect(tx._state.userRoles).toHaveLength(roles);
    expect(tx._state.providerProfiles).toHaveLength(profiles);
  });

  it('changes nothing when the user is missing and createIfMissing is false', async () => {
    const tx = makeFakeTx({ users: [], roles: SYSTEM_ROLES });
    const summary = await grantProviderWithTx(tx as never, 'ghost@example.com', false, false);
    expect(summary.userExisted).toBe(false);
    expect(summary.userId).toBeNull();
    expect(tx._state.providerProfiles).toHaveLength(0);
  });

  it('throws a clear error if the provider role is not seeded', async () => {
    const tx = makeFakeTx({
      users: [{ ...ACTIVE_USER }],
      roles: [{ id: 'role-customer', name: 'customer' }],
    });
    await expect(
      grantProviderWithTx(tx as never, 'operator@example.com', false, false),
    ).rejects.toThrow(/system role "provider" is not seeded/);
  });
});

describe('the two axes stay separate when both are granted', () => {
  it('running both routines yields all three roles and an explicitly-activated profile', async () => {
    // The combined routine this replaced did all of this in one call, with no
    // way to grant one without the other.
    const tx = withUser();
    await grantAdminWithTx(tx as never, 'operator@example.com', false);
    await grantProviderWithTx(tx as never, 'operator@example.com', false, true);

    const roleIds = tx._state.userRoles.map((ur) => ur.roleId).sort();
    expect(roleIds).toEqual(['role-admin', 'role-customer', 'role-provider']);
    expect(tx._state.providerProfiles[0]!.status).toBe('ACTIVE');
  });

  it('granting admin alone leaves the provider axis completely empty', async () => {
    const tx = withUser();
    await grantAdminWithTx(tx as never, 'operator@example.com', false);
    expect(tx._state.providerProfiles).toHaveLength(0);
    expect(tx._state.userRoles.map((ur) => ur.roleId).sort()).toEqual([
      'role-admin',
      'role-customer',
    ]);
  });
});

describe('assertGrantNotProductionUnsafe', () => {
  it('refuses to run in production without the explicit override', () => {
    expect(() => assertGrantNotProductionUnsafe({ NODE_ENV: 'production' })).toThrow(
      /ALLOW_PROD_GRANT/,
    );
  });

  it('allows production only with the explicit override', () => {
    expect(() =>
      assertGrantNotProductionUnsafe({ NODE_ENV: 'production', ALLOW_PROD_GRANT: 'true' }),
    ).not.toThrow();
  });

  it('is a no-op outside production', () => {
    expect(() => assertGrantNotProductionUnsafe({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertGrantNotProductionUnsafe({ NODE_ENV: 'test' })).not.toThrow();
  });
});
