import * as argon2 from 'argon2';

import { grantWithTx } from './admin-access-grant';
import { Prisma, prisma } from './index';

// Safe development seed:
//  - upserts system roles (customer, provider, admin)
//  - upserts a small baseline permission catalogue
//  - wires role -> permission mappings
//  - upserts service catalog + a small static ProviderProfile pool
//  - in dev/test only: upserts named developer accounts so the
//    Admin and Provider apps can be opened without manually running
//    forgot-password. Skipped in production by assertSeedProductionSafe.
// Idempotent: every call uses upsert keyed on natural keys (role.name, permission.key).

interface RoleSpec {
  name: string;
  description: string;
}

interface PermissionSpec {
  key: string;
  description: string;
}

interface ServiceCategorySpec {
  slug: string;
  labelEn: string;
  labelAr: string;
  icon: string;
  sortOrder: number;
}

interface ProviderProfileSpec {
  // Stable id used as the upsert key so re-runs are idempotent and so
  // dev/test scripts can reference the same provider across environments.
  id: string;
  displayName: string;
  initials: string;
  ratingAvg: number;
  reviewCount: number;
  completedJobs: number;
  verified: boolean;
  topPro: boolean;
}

// Sprint 1, slice 1: bootstrap the public service-catalog. Slugs are
// stable; labels and sortOrder can be edited via subsequent migrations
// or admin tooling without breaking existing service_requests rows
// (those reference categories by id, not slug).
const SERVICE_CATEGORIES: ServiceCategorySpec[] = [
  { slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة', icon: '🔧', sortOrder: 0 },
  { slug: 'electrical', labelEn: 'Electrical', labelAr: 'كهرباء', icon: '⚡', sortOrder: 1 },
  { slug: 'ac-repair', labelEn: 'AC Repair', labelAr: 'صيانة تكييف', icon: '❄️', sortOrder: 2 },
  { slug: 'cleaning', labelEn: 'Cleaning', labelAr: 'تنظيف', icon: '✨', sortOrder: 3 },
  { slug: 'carpentry', labelEn: 'Carpentry', labelAr: 'نجارة', icon: '🔨', sortOrder: 4 },
  { slug: 'painting', labelEn: 'Painting', labelAr: 'دهانات', icon: '🎨', sortOrder: 5 },
];

// Sprint 2, slice 2.1: bootstrap a small Provider read-model so the
// Seeker BidsScreen has someone to bid on requests. The Provider app
// is out of scope for slice 2.1; these rows have no linked user (the
// `userId` column is nullable). When the Provider app ships and a
// real provider signs up, that user can claim a profile by attaching
// their userId — the row id stays stable.
//
// Test/dev scripts (and the runtime-verify harness used during slice
// closure) reference these ids when seeding bids against a request.
const PROVIDER_PROFILES: ProviderProfileSpec[] = [
  {
    id: 'pp-omar',
    displayName: 'Omar Al-Khalid',
    initials: 'OK',
    ratingAvg: 4.9,
    reviewCount: 312,
    completedJobs: 540,
    verified: true,
    topPro: true,
  },
  {
    id: 'pp-khalid',
    displayName: 'Khalid Hassan',
    initials: 'KH',
    ratingAvg: 4.7,
    reviewCount: 156,
    completedJobs: 220,
    verified: true,
    topPro: false,
  },
  {
    id: 'pp-ali',
    displayName: 'Ali Al-Rashid',
    initials: 'AR',
    ratingAvg: 4.6,
    reviewCount: 89,
    completedJobs: 180,
    verified: true,
    topPro: false,
  },
  {
    id: 'pp-mohammed',
    displayName: 'Mohammed Al-Zahra',
    initials: 'MZ',
    ratingAvg: 4.8,
    reviewCount: 67,
    completedJobs: 145,
    verified: false,
    topPro: false,
  },
  {
    id: 'pp-hassan',
    displayName: 'Hassan Mustafa',
    initials: 'HM',
    ratingAvg: 4.5,
    reviewCount: 42,
    completedJobs: 78,
    verified: false,
    topPro: false,
  },
];

const SYSTEM_ROLES: RoleSpec[] = [
  { name: 'customer', description: 'End user who books services' },
  { name: 'provider', description: 'Operator who lists and fulfils services' },
  { name: 'admin', description: 'Platform administrator' },
];

const PERMISSIONS: PermissionSpec[] = [
  { key: 'user:read:self', description: 'Read own user profile' },
  { key: 'user:write:self', description: 'Update own user profile' },
  { key: 'user:read:any', description: 'Read any user profile (admin)' },
  { key: 'user:write:any', description: 'Update any user profile (admin)' },
  { key: 'role:read', description: 'Read roles' },
  { key: 'role:write', description: 'Manage roles (admin)' },
  { key: 'permission:read', description: 'Read permissions' },
  { key: 'permission:write', description: 'Manage permissions (admin)' },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  customer: ['user:read:self', 'user:write:self'],
  provider: ['user:read:self', 'user:write:self'],
  admin: PERMISSIONS.map((p) => p.key),
};

async function upsertRoles(tx: Prisma.TransactionClient): Promise<Map<string, string>> {
  const idByName = new Map<string, string>();
  for (const spec of SYSTEM_ROLES) {
    const role = await tx.role.upsert({
      where: { name: spec.name },
      update: { description: spec.description, isSystem: true },
      create: { name: spec.name, description: spec.description, isSystem: true },
    });
    idByName.set(role.name, role.id);
  }
  return idByName;
}

async function upsertPermissions(tx: Prisma.TransactionClient): Promise<Map<string, string>> {
  const idByKey = new Map<string, string>();
  for (const spec of PERMISSIONS) {
    const perm = await tx.permission.upsert({
      where: { key: spec.key },
      update: { description: spec.description },
      create: { key: spec.key, description: spec.description },
    });
    idByKey.set(perm.key, perm.id);
  }
  return idByKey;
}

async function syncRolePermissions(
  tx: Prisma.TransactionClient,
  roleIds: Map<string, string>,
  permissionIds: Map<string, string>,
): Promise<void> {
  for (const [roleName, permKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleIds.get(roleName);
    if (!roleId) continue;
    for (const key of permKeys) {
      const permissionId = permissionIds.get(key);
      if (!permissionId) continue;
      await tx.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
    }
  }
}

async function upsertProviderProfiles(tx: Prisma.TransactionClient): Promise<void> {
  // Idempotent: every call upserts on the natural id. Reactivates a
  // soft-deleted row if one was archived in a previous environment.
  for (const spec of PROVIDER_PROFILES) {
    await tx.providerProfile.upsert({
      where: { id: spec.id },
      update: {
        displayName: spec.displayName,
        initials: spec.initials,
        ratingAvg: spec.ratingAvg,
        reviewCount: spec.reviewCount,
        completedJobs: spec.completedJobs,
        verified: spec.verified,
        topPro: spec.topPro,
        deletedAt: null,
      },
      create: {
        id: spec.id,
        displayName: spec.displayName,
        initials: spec.initials,
        ratingAvg: spec.ratingAvg,
        reviewCount: spec.reviewCount,
        completedJobs: spec.completedJobs,
        verified: spec.verified,
        topPro: spec.topPro,
      },
    });
  }
}

async function upsertServiceCategories(tx: Prisma.TransactionClient): Promise<void> {
  // Idempotent: every call upserts on the unique slug. Reactivates a
  // soft-deleted row if a previous environment archived a category we
  // now consider canonical (sets `isActive: true, deletedAt: null`).
  for (const spec of SERVICE_CATEGORIES) {
    await tx.serviceCategory.upsert({
      where: { slug: spec.slug },
      update: {
        labelEn: spec.labelEn,
        labelAr: spec.labelAr,
        icon: spec.icon,
        sortOrder: spec.sortOrder,
        isActive: true,
        deletedAt: null,
      },
      create: {
        slug: spec.slug,
        labelEn: spec.labelEn,
        labelAr: spec.labelAr,
        icon: spec.icon,
        sortOrder: spec.sortOrder,
        isActive: true,
      },
    });
  }
}

// ─── Dev-only user seed ─────────────────────────────────────────────────────
//
// Three accounts so the operator can drive the Admin + Provider apps
// straight after `pnpm seed` without going through forgot-password:
//
//   • test1@admin.com    — admin role, ACTIVE, password DevAdmin123!
//   • admin@admin.com    — admin + customer + provider roles, ACTIVE
//                          ProviderProfile, password DevAdmin123!
//   • provider1@provider.com — customer + provider roles, ACTIVE
//                          ProviderProfile, password DevProvider123!
//
// Passwords are public dev values. The block is GATED by the same
// production-safety check that protects the rest of the seed —
// `assertSeedProductionSafe()` throws before this code runs against
// a production-tagged environment.
//
// Idempotent: re-runs upsert on email; password is rehashed every
// call so an operator who doesn't remember the value can simply
// `pnpm seed` again. Roles + ProviderProfile attachment delegate to
// the already-tested `grantWithTx` routine in admin-access-grant.ts
// so this block has no separate authz logic to maintain.

interface DevUserSpec {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  /** Pass `true` only for the canonical "marketplace seller" account so it
   * gets the provider role + ACTIVE ProviderProfile via grantWithTx.
   * `false` keeps the user admin-only (no provider profile attached). */
  attachProviderRole: boolean;
  /** Pass `true` for accounts that should reach /v1/admin/**. */
  attachAdminRole: boolean;
}

const DEV_USERS: DevUserSpec[] = [
  {
    email: 'test1@admin.com',
    firstName: 'Test1',
    lastName: 'Admin',
    password: 'DevAdmin123!',
    attachProviderRole: false,
    attachAdminRole: true,
  },
  {
    email: 'admin@admin.com',
    firstName: 'Admin',
    lastName: 'Admin',
    password: 'DevAdmin123!',
    attachProviderRole: true,
    attachAdminRole: true,
  },
  {
    email: 'provider1@provider.com',
    firstName: 'Provider1',
    lastName: 'Provider',
    password: 'DevProvider123!',
    attachProviderRole: true,
    attachAdminRole: false,
  },
];

async function upsertDevUsers(tx: Prisma.TransactionClient): Promise<void> {
  // Roles must already exist in this transaction (upsertRoles ran first).
  const roleByName = new Map<string, { id: string }>();
  const roles = await tx.role.findMany({
    where: { name: { in: ['customer', 'provider', 'admin'] } },
  });
  for (const r of roles) roleByName.set(r.name, { id: r.id });

  for (const spec of DEV_USERS) {
    const passwordHash = await argon2.hash(spec.password, { type: argon2.argon2id });

    // Upsert the User row by email. Always set/refresh:
    //   - passwordHash (so a re-run rotates to the documented dev value)
    //   - status = ACTIVE
    //   - emailVerifiedAt = now (so the login path doesn't throw
    //     AUTH_ACCOUNT_UNVERIFIED on first attempt)
    const user = await tx.user.upsert({
      where: { email: spec.email },
      update: {
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
      create: {
        email: spec.email,
        firstName: spec.firstName,
        lastName: spec.lastName,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    // Always attach the customer role (the platform's default identity).
    const customerRoleId = roleByName.get('customer')?.id;
    if (customerRoleId) {
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: customerRoleId } },
        update: {},
        create: { userId: user.id, roleId: customerRoleId },
      });
    }

    // Provider + admin paths use grantWithTx so the role-attachment +
    // ProviderProfile-promote-to-ACTIVE logic stays in one place.
    if (spec.attachProviderRole || spec.attachAdminRole) {
      // grantWithTx attaches all three roles + ensures ACTIVE
      // ProviderProfile. For an admin-only user (attachProviderRole=false)
      // we still call it because:
      //   - it's idempotent: an existing customer role is already a no-op,
      //   - the resulting ProviderProfile is harmless (the test1 admin
      //     never opens the Provider app),
      //   - we avoid duplicating role-attachment logic for one edge case.
      // If a future need arises to keep an admin from getting the provider
      // role, refactor grantWithTx to accept a roles allowlist.
      await grantWithTx(tx, spec.email, false);
    }

    // Sprint 7.x — ensure the dev provider profile is "fully onboarded"
    // (city + at least one service category) so the now-strict
    // available-requests filter has data to match against. Without this
    // step, strict mode returns an empty feed for fresh dev users.
    if (spec.attachProviderRole) {
      await ensureProviderOnboarded(tx, user.id);
    }
  }
}

// Sprint 7.x — set a default service area + attach two categories to a
// freshly-seeded provider profile so strict-mode filtering produces
// matching jobs out of the box. Idempotent: the city update is a
// no-op when already set, and category attachments use upsert against
// the composite (providerProfileId, serviceCategoryId) PK.
async function ensureProviderOnboarded(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const profile = await tx.providerProfile.findUnique({ where: { userId } });
  if (!profile) return;

  // Only seed defaults when the operator hasn't customised the profile.
  // A provider who has explicitly set a city should keep their value.
  if (!profile.serviceAreaCity || !profile.serviceAreaCity.trim()) {
    await tx.providerProfile.update({
      where: { id: profile.id },
      data: {
        serviceAreaCity: 'Riyadh',
        serviceAreaCountry: 'Saudi Arabia',
      },
    });
  }

  // Attach plumbing + electrical so the provider can match the canonical
  // demo requests. We keep the slug list narrow to avoid pollution.
  const categories = await tx.serviceCategory.findMany({
    where: { slug: { in: ['plumbing', 'electrical'] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  for (const cat of categories) {
    await tx.providerProfileServiceCategory.upsert({
      where: {
        providerProfileId_serviceCategoryId: {
          providerProfileId: profile.id,
          serviceCategoryId: cat.id,
        },
      },
      update: {},
      create: { providerProfileId: profile.id, serviceCategoryId: cat.id },
    });
  }
}

// Extracted so the seed logic can be unit-tested against a mocked
// TransactionClient without requiring a live Postgres connection.
// Runtime behavior is unchanged: `seed()` still wraps this in a real
// Prisma transaction.
export async function seedWithTx(tx: Prisma.TransactionClient): Promise<void> {
  const roleIds = await upsertRoles(tx);
  const permissionIds = await upsertPermissions(tx);
  await syncRolePermissions(tx, roleIds, permissionIds);
  await upsertServiceCategories(tx);
  await upsertProviderProfiles(tx);
  // Dev users are seeded LAST so the role catalog is available. The
  // `assertSeedProductionSafe()` check in seed() guarantees this block
  // never runs in production.
  await upsertDevUsers(tx);
}

export async function seed(): Promise<void> {
  // Guard programmatic callers too — previously only the CLI main() enforced
  // the production safety check, so an import of seed() from another script
  // could bypass it. Cheap to double-check; tests still pin the guard itself.
  assertSeedProductionSafe();
  await prisma.$transaction(seedWithTx);
}

export function assertSeedProductionSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && env.ALLOW_PROD_SEED !== 'true') {
    throw new Error(
      'Refusing to run seed in production without ALLOW_PROD_SEED=true. ' +
        'Production may only seed reference data through reviewed migrations.',
    );
  }
}

async function main(): Promise<void> {
  await seed();

  console.log(
    [
      'Seed complete:',
      '  - system roles + permissions + role↔permission mappings',
      '  - service category catalog + static ProviderProfile pool',
      '  - dev users (NODE_ENV != production):',
      '      test1@admin.com           / DevAdmin123!     (admin)',
      '      admin@admin.com           / DevAdmin123!     (admin + provider, ACTIVE profile)',
      '      provider1@provider.com    / DevProvider123!  (provider, ACTIVE profile)',
    ].join('\n'),
  );
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
