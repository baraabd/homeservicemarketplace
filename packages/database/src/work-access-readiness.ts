import { prisma, type PrismaTx } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// R18 (D-19) — work-access enforcement readiness.
//
// ADR 0013 §5 step 3: before WORK_ACCESS_ENFORCED is switched on in any
// environment, the number of providers holding a live work-access grant must
// equal the number of providers who work today under the legacy rule
// (ProviderProfile.status = ACTIVE). Migration
// 20260824084700_sprint09_backfill_legacy_work_access_grants asserted that
// once, at deploy time. Since then the legacy /approve path (both flags off)
// has kept activating providers WITHOUT a grant, so the count must be read
// again immediately before the flip; the migration's check proves nothing
// about rows written after it ran.
//
//   check (default)  read-only counts; exit 1 while any working provider
//                    lacks a live grant
//   --apply          grant the missing ones, at most --limit per run, exactly
//                    as the Sprint 9 migration did (LEGACY_BACKFILL, no
//                    expiry, no actor, verificationState untouched), with a
//                    DataRemediationLog row written first for each
//
// Output is counts only: no ids, names, emails or contact details.
// ─────────────────────────────────────────────────────────────────────────────

export const BACKFILL_MIGRATION_TAG = 'r18_work_access_readiness_backfill';
export const DEFAULT_BACKFILL_LIMIT = 500;
export const MAX_BACKFILL_LIMIT = 5000;

export interface WorkAccessReadiness {
  /** Providers allowed to work under the legacy rule (status ACTIVE, not deleted). */
  workingProviders: number;
  /** Of those, how many hold a live grant (what WORK_ACCESS_ENFORCED requires). */
  withLiveGrant: number;
  /** Working providers WORK_ACCESS_ENFORCED=true would deny today. */
  missingLiveGrant: number;
  /** Of the working providers, how many are VERIFIED (what VERIFICATION_ENFORCED requires). */
  verified: number;
  /** Working providers VERIFICATION_ENFORCED=true would deny today. */
  notVerified: number;
  /** True only when enabling WORK_ACCESS_ENFORCED would deny no working provider. */
  workAccessReady: boolean;
}

type Client = Pick<PrismaTx, '$queryRaw' | '$executeRaw'>;

// The live-grant predicate is the one the capability service and the Sprint 9
// migration use: ACTIVE, not revoked, started, and not yet expired. It reads
// clock_timestamp(), not NOW(): NOW() is frozen at the start of the
// transaction, and the backfill reads this inside a long one.
export async function readWorkAccessReadiness(db: Client): Promise<WorkAccessReadiness> {
  const [row] = await db.$queryRaw<Array<{ working: number; granted: number; verified: number }>>`
    SELECT
      count(*)::int AS "working",
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "ProviderWorkAccessGrant" g
        WHERE g."providerProfileId" = p."id"
          AND g."status" = 'ACTIVE'
          AND g."revokedAt" IS NULL
          AND g."grantedAt" <= clock_timestamp()
          AND (g."expiresAt" IS NULL OR g."expiresAt" > clock_timestamp())
      ))::int AS "granted",
      count(*) FILTER (WHERE p."verificationState" = 'VERIFIED')::int AS "verified"
    FROM "ProviderProfile" p
    WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL`;
  const working = row?.working ?? 0;
  const granted = row?.granted ?? 0;
  const verified = row?.verified ?? 0;
  return {
    workingProviders: working,
    withLiveGrant: granted,
    missingLiveGrant: working - granted,
    verified,
    notVerified: working - verified,
    workAccessReady: working === granted,
  };
}

export interface BackfillResult {
  granted: number;
  before: WorkAccessReadiness;
  after: WorkAccessReadiness;
}

export function resolveBackfillLimit(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith('--limit='));
  if (!flag) return DEFAULT_BACKFILL_LIMIT;
  const value = Number(flag.slice('--limit='.length));
  if (!Number.isInteger(value) || value < 1 || value > MAX_BACKFILL_LIMIT) {
    throw new Error(`--limit must be an integer from 1 to ${MAX_BACKFILL_LIMIT}`);
  }
  return value;
}

/**
 * Grants at most `limit` missing working providers inside the caller's
 * transaction. Restartable: each run takes the next missing rows, and a row
 * that already has a live grant is never selected again. One run at a time
 * (transaction advisory lock); the selected profiles are row-locked so a
 * concurrent suspension waits for, or is seen by, this run.
 */
export async function backfillMissingGrantsWithTx(
  tx: Client,
  limit: number = DEFAULT_BACKFILL_LIMIT,
): Promise<BackfillResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BACKFILL_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_BACKFILL_LIMIT}`);
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BACKFILL_MIGRATION_TAG}))`;
  const before = await readWorkAccessReadiness(tx);
  const targets = await tx.$queryRaw<Array<{ id: string; verificationState: string | null }>>`
    SELECT p."id", p."verificationState"::text AS "verificationState"
    FROM "ProviderProfile" p
    WHERE p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "ProviderWorkAccessGrant" g
        WHERE g."providerProfileId" = p."id"
          AND g."status" = 'ACTIVE'
          AND g."revokedAt" IS NULL
          AND g."grantedAt" <= clock_timestamp()
          AND (g."expiresAt" IS NULL OR g."expiresAt" > clock_timestamp())
      )
    ORDER BY p."id"
    LIMIT ${limit}
    FOR UPDATE OF p`;
  for (const target of targets) {
    // Recoverability first: the log row precedes the grant it explains.
    await tx.$executeRaw`
      INSERT INTO "DataRemediationLog"
        ("id", "migration", "constraintName", "entity", "entityId", "action", "before", "details", "createdAt")
      VALUES (
        gen_random_uuid()::text, ${BACKFILL_MIGRATION_TAG}, 'every_working_provider_holds_a_grant',
        'ProviderProfile', ${target.id}, 'GRANTED_LEGACY_WORK_ACCESS',
        jsonb_build_object('status', 'ACTIVE', 'verificationState', ${target.verificationState}::text, 'liveGrantsBefore', 0),
        jsonb_build_object('source', 'LEGACY_BACKFILL',
          'note', 'Activated under the legacy single-status process without a grant; identity not verified by this step.'),
        NOW())`;
    // Same shape as the Sprint 9 migration: no case, no human actor, no
    // expiry, and verificationState is left exactly as it was.
    await tx.$executeRaw`
      INSERT INTO "ProviderWorkAccessGrant"
        ("id", "providerProfileId", "status", "reason", "source", "caseId",
         "grantedAt", "grantedByUserId", "expiresAt", "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid()::text, ${target.id}, 'ACTIVE', 'LEGACY_APPROVED', 'LEGACY_BACKFILL', NULL,
        NOW(), NULL, NULL, NOW(), NOW())`;
  }
  const after = await readWorkAccessReadiness(tx);
  return { granted: targets.length, before, after };
}

export function assertBackfillNotProductionUnsafe(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && env.ALLOW_PROD_WORK_ACCESS_BACKFILL !== 'true') {
    throw new Error(
      'Refusing to write work-access grants in production without ' +
        'ALLOW_PROD_WORK_ACCESS_BACKFILL=true. Run the read-only check first and take a backup.',
    );
  }
}

async function cliMain(): Promise<void> {
  const argv = process.argv.slice(2);
  if (!argv.includes('--apply')) {
    const readiness = await readWorkAccessReadiness(prisma);
    console.log(JSON.stringify({ mode: 'check', ...readiness }));
    if (!readiness.workAccessReady) process.exitCode = 1;
    return;
  }
  assertBackfillNotProductionUnsafe();
  const limit = resolveBackfillLimit(argv);
  const result = await prisma.$transaction((tx) => backfillMissingGrantsWithTx(tx, limit), {
    timeout: 120_000,
  });
  console.log(JSON.stringify({ mode: 'apply', limit, ...result }));
  if (!result.after.workAccessReady) process.exitCode = 1;
}

if (require.main === module) {
  cliMain()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'work-access readiness failed');
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
