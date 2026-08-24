import * as argon2 from 'argon2';

import { grantAdminWithTx, grantProviderWithTx } from './admin-access-grant';
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
  // Phase 6 Step 3 — onboarding fields the available-requests filter
  // (apps/api/src/modules/provider/available-requests/available-
  // requests.service.ts) depends on. Without these, providers were
  // created with null city + zero categories so the strict-mode
  // filter silently returned an empty feed for every test run.
  serviceAreaCity: string;
  serviceAreaCountry: string;
  // ServiceCategory slugs (resolved to ids by upsertProviderProfiles
  // after the catalog upsert runs).
  categorySlugs: readonly string[];
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
    serviceAreaCity: 'Riyadh',
    serviceAreaCountry: 'Saudi Arabia',
    categorySlugs: ['plumbing', 'ac-repair'],
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
    serviceAreaCity: 'Riyadh',
    serviceAreaCountry: 'Saudi Arabia',
    categorySlugs: ['electrical', 'ac-repair'],
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
    serviceAreaCity: 'Aleppo',
    serviceAreaCountry: 'Syria',
    categorySlugs: ['plumbing', 'carpentry'],
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
    serviceAreaCity: 'Aleppo',
    serviceAreaCountry: 'Syria',
    categorySlugs: ['cleaning', 'painting'],
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
    serviceAreaCity: 'Gothenburg',
    serviceAreaCountry: 'Sweden',
    categorySlugs: ['electrical', 'painting'],
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
  // Phase 4 — granting admin access is a NARROWER capability than "is an
  // admin". It gates POST /v1/admin/access-requests/:id/approve|reject, so the
  // ability to mint new administrators can later be withheld from a day-to-day
  // admin role without touching the controller. Seeded onto `admin` today
  // because there is only one admin role.
  { key: 'admin:access:grant', description: 'Approve or reject admin access requests' },
  // Sprint 9B — reading a RESTRICTED identity document is a narrower
  // capability than "is an admin", for the same reason admin:access:grant is.
  //
  // Every admin being able to open every passport makes the access audit
  // meaningless: "who looked at this document?" answers "anyone on the team".
  // Holding it separately means the ability can be withheld from a day-to-day
  // admin role without touching a controller, and the audit trail names a
  // meaningfully smaller set of people.
  //
  // Seeded onto `admin` today because there is only one admin role. Splitting
  // it onto a dedicated reviewer role is a Product/Security decision, recorded
  // in the Sprint 9B report rather than guessed at here.
  {
    key: 'verification:evidence:view',
    description: 'Open restricted provider identity evidence',
  },
  // Deciding on a case is separate again from SEEING the evidence: a trainee
  // reviewer may need to read documents without the authority to approve.
  {
    key: 'verification:decide',
    description: 'Approve, reject or otherwise decide a provider verification case',
  },
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
  // Phase 6 Step 3 — resolve category slugs → ids ONCE per call.
  // upsertServiceCategories has already run above so this lookup is
  // guaranteed to find every slug listed in PROVIDER_PROFILES.
  const allCats = await tx.serviceCategory.findMany({
    where: {
      slug: { in: PROVIDER_PROFILES.flatMap((p) => [...p.categorySlugs]) },
      deletedAt: null,
    },
    select: { id: true, slug: true },
  });
  const catIdBySlug = new Map(allCats.map((c) => [c.slug, c.id] as const));

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
        // Phase 6 Step 3 — overwrite city/country on every seed run so
        // a developer-edited dev row is restored to the canonical
        // value. Status is forced to ACTIVE so the dev provider can
        // bid immediately (the strict available-requests filter
        // requires city + at least one category to ALSO be set —
        // both are configured here).
        serviceAreaCity: spec.serviceAreaCity,
        // Sprint 6 — the normalised mirror the fan-out query matches on. The
        // seed writes ProviderProfile directly rather than through the
        // repository, so it is a second writer of serviceAreaCity and has to
        // maintain the key itself. Leaving it null makes every seeded
        // provider invisible to fan-out, which looks like a broken matcher
        // rather than a missing column.
        serviceAreaCityKey: normaliseCityKey(spec.serviceAreaCity),
        serviceAreaCountry: spec.serviceAreaCountry,
        status: 'ACTIVE',
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
        serviceAreaCity: spec.serviceAreaCity,
        serviceAreaCityKey: normaliseCityKey(spec.serviceAreaCity),
        serviceAreaCountry: spec.serviceAreaCountry,
        status: 'ACTIVE',
      },
    });

    // Replace-set semantics for the join table: delete any previous
    // links for this provider, then create the canonical ones. Mirrors
    // the production replaceServiceCategories flow in
    // apps/api/src/infrastructure/persistence/bids/provider-profile.repository.ts:195
    // so the dev seed and the runtime PATCH path produce identical
    // shapes.
    await tx.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: spec.id },
    });
    const links = spec.categorySlugs
      .map((slug) => catIdBySlug.get(slug))
      .filter((id): id is string => Boolean(id))
      .map((serviceCategoryId) => ({ providerProfileId: spec.id, serviceCategoryId }));
    if (links.length > 0) {
      await tx.providerProfileServiceCategory.createMany({ data: links });
    }
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
// `pnpm seed` again. Role attachment delegates to the already-tested
// least-privilege routines in admin-access-grant.ts so this block has no
// separate authz logic to maintain.
//
// Phase 4: admin and provider are attached SEPARATELY. Previously every
// dev user that needed either role went through one combined routine, so an
// admin-only account also received the provider role and an ACTIVE
// ProviderProfile — the exact axis conflation this sprint is removing. An
// admin-only dev user now has no provider profile at all.

interface DevUserSpec {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  /** Pass `true` for the canonical "marketplace seller" accounts. These get
   * the provider role and an ACTIVE ProviderProfile so local runs can reach
   * the live Provider shell without walking the review flow. `false` means
   * NO provider role and NO ProviderProfile — not "a profile nobody looks at". */
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
    // Operator-requested admin account for ad-hoc dashboard testing.
    // Same hashing path as every other dev user — argon2id via the
    // shared ARGON2_OPTIONS that mirror the backend PasswordService
    // (apps/api/src/modules/iam/authentication/services/password.service.ts).
    email: 'test@admin.com',
    firstName: 'Test',
    lastName: 'Admin',
    password: '1qaz2wsx3edc!!',
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

// argon2id parameters MUST match
// apps/api/src/modules/iam/authentication/services/password.service.ts
// so seeded hashes carry the production cost profile and login
// timing stays consistent. (argon2.verify reads the params out of
// the PHC string regardless, so login would still work with default
// options — the alignment is for hash-shape consistency, not
// correctness.)
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

async function upsertDevUsers(tx: Prisma.TransactionClient): Promise<void> {
  // Roles must already exist in this transaction (upsertRoles ran first).
  const roleByName = new Map<string, { id: string }>();
  const roles = await tx.role.findMany({
    where: { name: { in: ['customer', 'provider', 'admin'] } },
  });
  for (const r of roles) roleByName.set(r.name, { id: r.id });

  for (const spec of DEV_USERS) {
    const passwordHash = await argon2.hash(spec.password, ARGON2_OPTIONS);

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

    // Phase 4 — the two axes are granted independently. An admin-only dev
    // user gets the admin role and NOTHING on the provider axis; a
    // provider-only dev user gets no admin role. Both routines are idempotent.
    if (spec.attachAdminRole) {
      await grantAdminWithTx(tx, spec.email, false);
    }
    if (spec.attachProviderRole) {
      // `activate: true` is the deliberate local-sandbox shortcut so seeded
      // provider accounts can reach the live Provider shell immediately. Real
      // providers reach ACTIVE only through submit-for-review + admin approval.
      await grantProviderWithTx(tx, spec.email, false, true);
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
        serviceAreaCityKey: normaliseCityKey('Riyadh'),
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
  // One-shot backfill for the case-insensitive city filter (Sprint
  // 7.x). New requests carry addressSnapshot.cityKey at write time;
  // legacy snapshots written before the normalisation landed need
  // a derived value to start matching against the provider feed.
  // The expression is idempotent — only rows missing cityKey are
  // touched, so re-runs are a no-op.
  await backfillAddressSnapshotCityKey(tx);
  // Sprint 6 — the same idea for the promoted columns. Idempotent, and it
  // repairs rows written by any path that forgot the mirror (including an
  // older build of this very seed).
  await backfillPromotedLocationColumns(tx);
}

/** Sprint 6 — repair rows whose queryable location columns are missing.
 *
 *  The migration backfilled everything that existed when it ran; this catches
 *  anything written since by a path that did not maintain them. Both
 *  statements only touch rows that need it, so re-runs are no-ops.
 *
 *  This is a safety net, not the mechanism: the repository derives these
 *  columns on every write. A row showing up here means a new writer appeared
 *  that bypasses it. */
async function backfillPromotedLocationColumns(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(
    `UPDATE "ServiceRequest"
        SET "locationCityKey" = COALESCE(
              NULLIF(btrim(lower("addressSnapshot" ->> 'cityKey')), ''),
              NULLIF(btrim(lower("addressSnapshot" ->> 'city')), '')
            ),
            "locationLat" = CASE
              WHEN jsonb_typeof("addressSnapshot" -> 'lat') = 'number'
               AND abs(("addressSnapshot" ->> 'lat')::double precision) <= 90
              THEN ("addressSnapshot" ->> 'lat')::double precision
            END,
            "locationLng" = CASE
              WHEN jsonb_typeof("addressSnapshot" -> 'lng') = 'number'
               AND abs(("addressSnapshot" ->> 'lng')::double precision) <= 180
              THEN ("addressSnapshot" ->> 'lng')::double precision
            END
      WHERE "locationCityKey" IS NULL
        AND "addressSnapshot" ? 'city'`,
  );

  await tx.$executeRawUnsafe(
    `UPDATE "ProviderProfile"
        SET "serviceAreaCityKey" = NULLIF(btrim(lower("serviceAreaCity")), '')
      WHERE "serviceAreaCityKey" IS NULL
        AND "serviceAreaCity" IS NOT NULL`,
  );
}

async function backfillAddressSnapshotCityKey(tx: Prisma.TransactionClient): Promise<void> {
  // jsonb concat (`||`) keeps every existing field and overwrites
  // only `cityKey`. lower()+trim() mirror normaliseCityKey() in
  // apps/api/src/modules/requests/requests.service.ts so the seed
  // and the runtime writer can never drift on what "the same city"
  // means. WHERE clause limits the update to the rows that need it
  // — re-runs touch zero rows.
  await tx.$executeRawUnsafe(
    `UPDATE "ServiceRequest"
        SET "addressSnapshot" = "addressSnapshot" || jsonb_build_object(
          'cityKey',
          lower(trim(BOTH ' ' FROM ("addressSnapshot"->>'city')))
        )
      WHERE "addressSnapshot" ? 'city'
        AND NOT ("addressSnapshot" ? 'cityKey')`,
  );
}

export async function seed(): Promise<void> {
  // Guard programmatic callers too — previously only the CLI main() enforced
  // the production safety check, so an import of seed() from another script
  // could bypass it. Cheap to double-check; tests still pin the guard itself.
  assertSeedProductionSafe();
  // ONE transaction, so a partial seed is impossible — but that is far more
  // work than Prisma's 5s interactive-transaction default is sized for. That
  // default is a budget for a web request; this routine upserts the roles,
  // permissions, category tree, demo users and admin grants in a single unit.
  //
  // It had been passing on margin. Under a loaded parallel test run it crossed
  // the line by 39ms and failed with "Transaction already closed: ... the
  // timeout for this transaction was 5000 ms", which would equally be a cold
  // database or a slow CI runner — the seed is a CI deploy step, not only a
  // test fixture. Stating a budget appropriate to a bootstrap routine is the
  // fix; shortening the transaction would trade atomicity for it.
  await prisma.$transaction(seedWithTx, { maxWait: 30_000, timeout: 120_000 });
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
      '      test@admin.com            / 1qaz2wsx3edc!!   (admin)',
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

/** Sprint 6 — the same normalisation the API applies (shared/geo/service-area
 *  `normaliseCityKey`) and the same the migration backfill used
 *  (`btrim(lower(...))`).
 *
 *  Duplicated rather than imported because packages/database must not depend
 *  on apps/api. Three implementations of one rule is a drift risk, so it is
 *  deliberately trivial: if it ever needs to be cleverer than trim+lowercase,
 *  it belongs in this package and the API should import it from here. */
function normaliseCityKey(city: string | null | undefined): string | null {
  if (!city) return null;
  const key = city.trim().toLowerCase();
  return key.length > 0 ? key : null;
}
