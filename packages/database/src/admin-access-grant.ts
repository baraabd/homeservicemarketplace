import { Prisma, prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// Local/operator bootstrap routines.
//
// Phase 4 split: this file used to expose ONE routine,
// `grantAdminProviderAccess`, which attached customer + provider + admin in a
// single call AND force-activated a ProviderProfile. That is three independent
// decisions welded together:
//
//   - "this person may administer the platform"  (the admin role)
//   - "this person may sell on the marketplace"  (the provider role)
//   - "their provider application is approved"   (ProviderProfile ACTIVE)
//
// Bundling them meant the only sanctioned way to create the first admin also
// silently minted an approved marketplace seller, and there was no way to grant
// one without the other. They are now two least-privilege routines:
//
//   grantAdminAccess(...)     → customer + admin roles. NEVER touches
//                               ProviderProfile.
//   grantProviderAccess(...)  → customer + provider roles and a DRAFT
//                               ProviderProfile. Activation requires an
//                               explicit, separate opt-in, because approving a
//                               provider is a review decision.
//
// Both remain the bootstrap path only. The in-app path for admin access is the
// reviewed AdminAccessRequest lifecycle (POST /v1/me/admin-access →
// POST /v1/admin/access-requests/:id/approve); the in-app path for providers is
// upgrade → complete onboarding → submit-for-review → admin approval. There is
// no public endpoint that grants either, and there must never be one.
//
// One identity invariant:
//   - One User per email. Neither routine creates a duplicate; both look up the
//     normalised email and either find the row or (with `createIfMissing`)
//     create a clearly-marked passwordless placeholder. Neither ever writes a
//     password — the operator uses the normal forgot-password flow.
//
// Idempotency:
//   - Role attachment upserts against the composite (userId, roleId) PK.
//   - ProviderProfile is keyed on the unique `userId`. Existing editable fields
//     are preserved.
//
// Logging contract:
//   - Returns a summary describing what changed. Never logs or returns a
//     password, hash, or token.
// ─────────────────────────────────────────────────────────────────────────────

export interface GrantInput {
  email: string;
  /**
   * When the user does not exist yet, create a passwordless placeholder. The
   * operator then sets a password through the standard forgot-password flow —
   * these routines never write a password hash.
   *
   * Default: false. Against a missing email this returns `userExisted: false`
   * and changes nothing.
   */
  createIfMissing?: boolean;
}

export interface ProviderGrantInput extends GrantInput {
  /**
   * Force the ProviderProfile to ACTIVE instead of leaving it DRAFT.
   *
   * Off by default and deliberately awkward to reach: activation is a REVIEW
   * decision (the admin approves a submitted application), and a bootstrap
   * script that activates by default is how "PENDING_REVIEW/DRAFT means
   * nothing" creeps back in. Use it only for a local sandbox where you need to
   * reach the live Provider shell without running the review flow.
   */
  activate?: boolean;
}

export interface GrantSummaryBase {
  email: string;
  userId: string | null;
  userExisted: boolean;
  userCreated: boolean;
  rolesAttached: string[];
  rolesAlreadyPresent: string[];
}

export interface AdminGrantSummary extends GrantSummaryBase {
  kind: 'admin';
}

export interface ProviderGrantSummary extends GrantSummaryBase {
  kind: 'provider';
  providerProfileCreated: boolean;
  providerProfileStatus: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED' | null;
  providerProfilePromotedToActive: boolean;
}

// Admin grant attaches `customer` alongside `admin` so the identity still has
// an ordinary persona — an admin who cannot use the customer surfaces is a
// worse operator experience with no security benefit. It does NOT attach
// `provider`.
const ADMIN_ROLES: ReadonlyArray<'customer' | 'admin'> = Object.freeze(['customer', 'admin']);
const PROVIDER_ROLES: ReadonlyArray<'customer' | 'provider'> = Object.freeze([
  'customer',
  'provider',
]);

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function deriveNamesFromEmail(email: string): { firstName: string; lastName: string } {
  const local = email.split('@')[0] ?? 'user';
  const cap = local.charAt(0).toUpperCase() + local.slice(1);
  return { firstName: cap, lastName: cap };
}

type TxCapable = Pick<Prisma.TransactionClient, never> & {
  $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
};

function assertUsableEmail(email: string, routine: string): void {
  if (!email.includes('@')) {
    throw new Error(`${routine}: refusing to operate on an invalid email`);
  }
}

// ─── admin ───────────────────────────────────────────────────────────────────

export async function grantAdminAccess(
  client: TxCapable,
  input: GrantInput,
): Promise<AdminGrantSummary> {
  const email = normalizeEmail(input.email);
  assertUsableEmail(email, 'grant-admin-access');
  return client.$transaction((tx) => grantAdminWithTx(tx, email, input.createIfMissing === true));
}

// Extracted so tests can drive a mocked TransactionClient without a real
// $transaction.
export async function grantAdminWithTx(
  tx: Prisma.TransactionClient,
  emailNormalized: string,
  createIfMissing: boolean,
): Promise<AdminGrantSummary> {
  const summary: AdminGrantSummary = {
    kind: 'admin',
    email: emailNormalized,
    userId: null,
    userExisted: false,
    userCreated: false,
    rolesAttached: [],
    rolesAlreadyPresent: [],
  };

  const resolved = await resolveUser(tx, emailNormalized, createIfMissing, summary);
  if (!resolved) return summary;

  await attachRoles(tx, resolved.userId, ADMIN_ROLES, summary, 'grant-admin-access');
  // No ProviderProfile work here, by design. Granting administration must not
  // create a marketplace seller.
  return summary;
}

// ─── provider ────────────────────────────────────────────────────────────────

export async function grantProviderAccess(
  client: TxCapable,
  input: ProviderGrantInput,
): Promise<ProviderGrantSummary> {
  const email = normalizeEmail(input.email);
  assertUsableEmail(email, 'grant-provider-access');
  return client.$transaction((tx) =>
    grantProviderWithTx(tx, email, input.createIfMissing === true, input.activate === true),
  );
}

export async function grantProviderWithTx(
  tx: Prisma.TransactionClient,
  emailNormalized: string,
  createIfMissing: boolean,
  activate: boolean,
): Promise<ProviderGrantSummary> {
  const summary: ProviderGrantSummary = {
    kind: 'provider',
    email: emailNormalized,
    userId: null,
    userExisted: false,
    userCreated: false,
    rolesAttached: [],
    rolesAlreadyPresent: [],
    providerProfileCreated: false,
    providerProfileStatus: null,
    providerProfilePromotedToActive: false,
  };

  const resolved = await resolveUser(tx, emailNormalized, createIfMissing, summary);
  if (!resolved) return summary;
  const { userId, user } = resolved;

  await attachRoles(tx, userId, PROVIDER_ROLES, summary, 'grant-provider-access');

  const profile = await tx.providerProfile.findUnique({ where: { userId } });

  if (profile) {
    summary.providerProfileStatus = profile.status;
    if (activate && profile.status !== 'ACTIVE') {
      await tx.providerProfile.update({
        where: { id: profile.id },
        data: { status: 'ACTIVE', reviewedAt: new Date(), rejectionReason: null },
      });
      summary.providerProfilePromotedToActive = true;
      summary.providerProfileStatus = 'ACTIVE';
    }
    return summary;
  }

  // DRAFT by default — identical to what POST /v1/me/provider/upgrade produces,
  // so a bootstrapped provider goes through the same onboarding and review the
  // product actually requires. `--activate` is the explicit escape hatch.
  const status = activate ? 'ACTIVE' : 'DRAFT';
  await tx.providerProfile.create({
    data: {
      userId,
      displayName: buildDisplayName(
        user?.firstName ?? null,
        user?.lastName ?? null,
        emailNormalized,
      ),
      initials: buildInitials(user?.firstName ?? null, user?.lastName ?? null, emailNormalized),
      status,
      ...(activate ? { reviewedAt: new Date() } : {}),
    },
  });
  summary.providerProfileCreated = true;
  summary.providerProfileStatus = status;
  summary.providerProfilePromotedToActive = activate;
  return summary;
}

// ─── shared helpers ──────────────────────────────────────────────────────────

interface ResolvedUser {
  userId: string;
  user: { firstName: string; lastName: string; email: string } | null;
}

async function resolveUser(
  tx: Prisma.TransactionClient,
  emailNormalized: string,
  createIfMissing: boolean,
  summary: GrantSummaryBase,
): Promise<ResolvedUser | null> {
  const existing = await tx.user.findFirst({
    where: { email: emailNormalized, deletedAt: null },
  });

  if (existing) {
    summary.userExisted = true;
    summary.userId = existing.id;
    return {
      userId: existing.id,
      user: {
        firstName: existing.firstName,
        lastName: existing.lastName,
        email: existing.email,
      },
    };
  }

  if (!createIfMissing) return null;

  const names = deriveNamesFromEmail(emailNormalized);
  const created = await tx.user.create({
    data: {
      email: emailNormalized,
      // No password. The operator MUST set one through forgot-password.
      // emailVerifiedAt is stamped so login does not throw
      // AUTH_ACCOUNT_UNVERIFIED on the placeholder.
      passwordHash: null,
      firstName: names.firstName,
      lastName: names.lastName,
      emailVerifiedAt: new Date(),
      status: 'ACTIVE',
    },
  });
  summary.userCreated = true;
  summary.userId = created.id;
  return { userId: created.id, user: null };
}

async function attachRoles(
  tx: Prisma.TransactionClient,
  userId: string,
  roleNames: ReadonlyArray<string>,
  summary: GrantSummaryBase,
  routine: string,
): Promise<void> {
  const roleRows = await tx.role.findMany({
    where: { name: { in: [...roleNames] }, deletedAt: null },
  });
  const rolesByName = new Map(roleRows.map((r) => [r.name, r.id]));
  for (const name of roleNames) {
    if (!rolesByName.has(name)) {
      throw new Error(`${routine}: system role "${name}" is not seeded — run \`pnpm seed\` first`);
    }
  }

  const existingUserRoles = await tx.userRole.findMany({
    where: { userId },
    select: { roleId: true },
  });
  const existingRoleIds = new Set(existingUserRoles.map((r) => r.roleId));

  for (const roleName of roleNames) {
    const roleId = rolesByName.get(roleName)!;
    if (existingRoleIds.has(roleId)) {
      summary.rolesAlreadyPresent.push(roleName);
      continue;
    }
    await tx.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    });
    summary.rolesAttached.push(roleName);
  }
}

function buildDisplayName(
  firstName: string | null,
  lastName: string | null,
  email: string,
): string {
  const f = (firstName ?? '').trim();
  const l = (lastName ?? '').trim();
  if (f && l) return `${f} ${l}`;
  if (f) return f;
  if (l) return l;
  const local = email.split('@')[0] ?? '';
  return local;
}

function buildInitials(firstName: string | null, lastName: string | null, email: string): string {
  const f = (firstName ?? '').trim();
  const l = (lastName ?? '').trim();
  if (f && l) return (f[0]! + l[0]!).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  if (l) return l.slice(0, 2).toUpperCase();
  const local = (email.split('@')[0] ?? '').trim();
  return local.slice(0, 2).toUpperCase();
}

// ─── CLI entry point ────────────────────────────────────────────────────────
//
// Run via:
//   pnpm --filter @homeservicemarketplace/database grant:admin    <email> [--create-if-missing]
//   pnpm --filter @homeservicemarketplace/database grant:provider <email> [--create-if-missing] [--activate]
//
// Mirrors the seed.ts "library + CLI in one file, guarded by
// `require.main === module`" pattern so the routines stay unit-testable while
// the operator gets a single safe entry point per capability.

export function assertGrantNotProductionUnsafe(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && env.ALLOW_PROD_GRANT !== 'true') {
    throw new Error(
      'Refusing to run an access-grant routine in production without ALLOW_PROD_GRANT=true. ' +
        'Production admin access must be granted through the reviewed AdminAccessRequest flow.',
    );
  }
}

export function resolveEmailFromArgv(argv: string[], env: NodeJS.ProcessEnv): string {
  const positional = argv.find((a) => !a.startsWith('--'));
  if (positional && positional.includes('@')) return positional;
  if (env.GRANT_EMAIL && env.GRANT_EMAIL.includes('@')) return env.GRANT_EMAIL;
  return 'admin@admin.com';
}

export function resolveCreateIfMissingFromArgv(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (argv.includes('--create-if-missing')) return true;
  if (env.GRANT_CREATE_IF_MISSING === 'true') return true;
  return false;
}

export function resolveActivateFromArgv(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (argv.includes('--activate')) return true;
  if (env.GRANT_ACTIVATE_PROVIDER === 'true') return true;
  return false;
}

// Which routine to run is taken from argv (`--provider`) or the script name, so
// the two capabilities can never be invoked by accident from one command.
async function cliMain(): Promise<void> {
  assertGrantNotProductionUnsafe();
  const argv = process.argv.slice(2);
  const email = resolveEmailFromArgv(argv, process.env);
  const createIfMissing = resolveCreateIfMissingFromArgv(argv, process.env);
  const wantsProvider = argv.includes('--provider') || process.env.GRANT_KIND === 'provider';

  const summary = wantsProvider
    ? await grantProviderAccess(prisma, {
        email,
        createIfMissing,
        activate: resolveActivateFromArgv(argv, process.env),
      })
    : await grantAdminAccess(prisma, { email, createIfMissing });

  // Safe one-line summary. Never include passwords / hashes / tokens.
  console.log(JSON.stringify({ ok: true, ...summary }));

  if (!summary.userExisted && !summary.userCreated) {
    console.error(
      `No User row matches ${summary.email}. Re-run with --create-if-missing to create a ` +
        `passwordless placeholder, then use forgot-password to set a password.`,
    );
    process.exit(2);
  }
}

if (require.main === module) {
  cliMain()
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`access-grant failed: ${msg}`);
      process.exit(1);
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
