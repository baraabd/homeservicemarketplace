import { Prisma, prisma } from './index';

// Safe development seed:
//  - upserts system roles (customer, provider, admin)
//  - upserts a small baseline permission catalogue
//  - wires role -> permission mappings
//  - DOES NOT create users or any credentials
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

  console.log('Seed complete: system roles + permissions + role↔permission mappings');
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
