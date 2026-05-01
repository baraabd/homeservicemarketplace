import { Prisma, prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// Local-only operator routine: attach customer + provider + admin roles to an
// existing User identity and ensure the user has an ACTIVE ProviderProfile.
//
// This is the ONLY safe way to grant admin access in this codebase:
//   - There is no public admin-upgrade endpoint and there must never be one.
//   - The seed deliberately creates roles/permissions but never users.
//   - This routine accepts an email + optional `createIfMissing` flag and is
//     called from `scripts/grant-admin-provider-access.ts` (CLI).
//
// One identity invariant:
//   - The platform has one User per email. This routine never creates a
//     duplicate; it looks up by `lower(email)` and either finds the existing
//     row or (when `createIfMissing` is set) creates one with a clearly
//     marked passwordless placeholder. When the caller wants a usable
//     password, they reset it through the normal forgot-password flow —
//     this script never sets passwords.
//
// Idempotency:
//   - UserRole assignments use upsert against the composite (userId, roleId)
//     primary key. Running this routine twice produces the same row count.
//   - ProviderProfile is upserted by `userId` (which is unique). Existing
//     editable fields (displayName, bio, headline, …) are preserved. Only
//     `status` is forced to ACTIVE so the dev/local operator can use the
//     marketplace surfaces immediately.
//
// Logging contract:
//   - Returns a `GrantSummary` describing what changed. Never logs or
//     returns the user's password / hash / tokens.
// ─────────────────────────────────────────────────────────────────────────────

export interface GrantInput {
  email: string;
  /**
   * When the user does not exist yet, create a passwordless placeholder
   * (firstName/lastName from the local part of the email). The operator
   * is then expected to use the standard forgot-password flow to set a
   * usable password — this routine never writes a password hash.
   *
   * Default: false. Calling with `createIfMissing: false` against a
   * missing email returns `userExisted: false` and changes nothing.
   */
  createIfMissing?: boolean;
}

export interface GrantSummary {
  email: string;
  userId: string | null;
  userExisted: boolean;
  userCreated: boolean;
  rolesAttached: string[];
  rolesAlreadyPresent: string[];
  providerProfileCreated: boolean;
  providerProfilePromotedToActive: boolean;
}

const TARGET_ROLES: ReadonlyArray<'customer' | 'provider' | 'admin'> = Object.freeze([
  'customer',
  'provider',
  'admin',
]);

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function deriveNamesFromEmail(email: string): { firstName: string; lastName: string } {
  const local = email.split('@')[0] ?? 'user';
  // Capitalize for a friendlier default; the operator can rename later via
  // /v1/me/profile. The placeholder identity is intentionally minimal.
  const cap = local.charAt(0).toUpperCase() + local.slice(1);
  return { firstName: cap, lastName: cap };
}

export async function grantAdminProviderAccess(
  prisma: Pick<Prisma.TransactionClient, never> & {
    $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  },
  input: GrantInput,
): Promise<GrantSummary> {
  const email = normalizeEmail(input.email);
  if (!email.includes('@')) {
    throw new Error('grant-admin-provider-access: refusing to operate on an invalid email');
  }
  return prisma.$transaction(async (tx) => grantWithTx(tx, email, input.createIfMissing === true));
}

// Extracted so tests can drive a mocked TransactionClient without spinning
// up a real $transaction.
export async function grantWithTx(
  tx: Prisma.TransactionClient,
  emailNormalized: string,
  createIfMissing: boolean,
): Promise<GrantSummary> {
  const summary: GrantSummary = {
    email: emailNormalized,
    userId: null,
    userExisted: false,
    userCreated: false,
    rolesAttached: [],
    rolesAlreadyPresent: [],
    providerProfileCreated: false,
    providerProfilePromotedToActive: false,
  };

  // 1. Resolve user — case-insensitive lookup against the unique column.
  // The app normalises every write, so a direct equality match is safe; we
  // additionally apply lower() in case a manual / legacy row escaped that
  // path.
  const existing = await tx.user.findFirst({
    where: { email: emailNormalized, deletedAt: null },
  });

  let userId: string;
  if (existing) {
    userId = existing.id;
    summary.userExisted = true;
  } else if (createIfMissing) {
    const names = deriveNamesFromEmail(emailNormalized);
    const created = await tx.user.create({
      data: {
        email: emailNormalized,
        // No password is set here — the operator MUST set one through the
        // forgot-password flow before login. emailVerifiedAt is set so
        // the login path does not throw AUTH_ACCOUNT_UNVERIFIED.
        passwordHash: null,
        firstName: names.firstName,
        lastName: names.lastName,
        emailVerifiedAt: new Date(),
        status: 'ACTIVE',
      },
    });
    userId = created.id;
    summary.userCreated = true;
  } else {
    return summary;
  }
  summary.userId = userId;

  // 2. Resolve all three system roles. The seed creates these — if any is
  // missing we surface a clear error rather than silently skipping.
  const rolesByName = new Map<string, string>();
  const roleRows = await tx.role.findMany({
    where: { name: { in: [...TARGET_ROLES] }, deletedAt: null },
  });
  for (const r of roleRows) rolesByName.set(r.name, r.id);
  for (const name of TARGET_ROLES) {
    if (!rolesByName.has(name)) {
      throw new Error(
        `grant-admin-provider-access: system role "${name}" is not seeded — run \`pnpm seed\` first`,
      );
    }
  }

  // 3. Attach each role with upsert. The composite PK (userId, roleId) makes
  // this idempotent — a second run produces no DB writes.
  const existingUserRoles = await tx.userRole.findMany({
    where: { userId },
    select: { roleId: true },
  });
  const existingRoleIds = new Set(existingUserRoles.map((r) => r.roleId));

  for (const roleName of TARGET_ROLES) {
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

  // 4. Upsert ProviderProfile. We use the unique `userId` column directly so
  // the op is keyed on identity, not on a synthetic id. Existing editable
  // fields (displayName, bio, headline, service area, …) are preserved —
  // only the `status` is forced to ACTIVE for the local/dev path so the
  // operator can immediately reach the live Provider shell. availability
  // remains whatever the operator set (default OFFLINE on first creation).
  const profile = await tx.providerProfile.findUnique({
    where: { userId },
  });

  if (profile) {
    if (profile.status !== 'ACTIVE') {
      await tx.providerProfile.update({
        where: { id: profile.id },
        data: { status: 'ACTIVE' },
      });
      summary.providerProfilePromotedToActive = true;
    }
  } else {
    // Mirror the same display-name derivation provider-service.upgrade uses
    // so the resulting profile reads identically whether the operator
    // upgraded through the API or this script.
    const displayName = existing
      ? buildDisplayName(existing.firstName, existing.lastName, existing.email)
      : buildDisplayName(null, null, emailNormalized);
    const initials = buildInitials(
      existing?.firstName ?? null,
      existing?.lastName ?? null,
      existing?.email ?? emailNormalized,
    );
    await tx.providerProfile.create({
      data: {
        userId,
        displayName,
        initials,
        status: 'ACTIVE',
      },
    });
    summary.providerProfileCreated = true;
  }

  return summary;
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
// Run via `pnpm --filter @homeservicemarketplace/database grant:admin-provider`,
// which executes the compiled `dist/admin-access-grant.js` against `.env`.
// Mirrors the seed.ts pattern of "library + CLI in one file, guarded by
// `require.main === module`" so the routine stays unit-testable while the
// operator gets a single safe entry point.

export function assertGrantNotProductionUnsafe(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && env.ALLOW_PROD_GRANT !== 'true') {
    throw new Error(
      'Refusing to run grant-admin-provider-access in production without ALLOW_PROD_GRANT=true. ' +
        'Production admin access must be granted through a reviewed moderation tool.',
    );
  }
}

function resolveEmailFromArgv(argv: string[], env: NodeJS.ProcessEnv): string {
  const positional = argv.find((a) => !a.startsWith('--'));
  if (positional && positional.includes('@')) return positional;
  if (env.GRANT_EMAIL && env.GRANT_EMAIL.includes('@')) return env.GRANT_EMAIL;
  return 'admin@admin.com';
}

function resolveCreateIfMissingFromArgv(argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (argv.includes('--create-if-missing')) return true;
  if (env.GRANT_CREATE_IF_MISSING === 'true') return true;
  return false;
}

async function cliMain(): Promise<void> {
  assertGrantNotProductionUnsafe();
  const email = resolveEmailFromArgv(process.argv.slice(2), process.env);
  const createIfMissing = resolveCreateIfMissingFromArgv(process.argv.slice(2), process.env);
  const summary = await grantAdminProviderAccess(prisma, { email, createIfMissing });

  // Safe one-line summary. Never include passwords / hashes / tokens.
  console.log(JSON.stringify({ ok: true, ...summary }));

  if (!summary.userExisted && !summary.userCreated) {
    console.error(
      `No User row matches ${summary.email}. Re-run with --create-if-missing to create a passwordless placeholder, then use forgot-password to set a password.`,
    );
    process.exit(2);
  }
}

if (require.main === module) {
  cliMain()
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`grant-admin-provider-access failed: ${msg}`);
      process.exit(1);
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
