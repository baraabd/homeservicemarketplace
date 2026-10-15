'use strict';
// R22 — read-only outbox health snapshot for the playbooks in
// infra/production/workers/OUTBOX_PLAYBOOKS.md.
//
// SELECT only. Prints counts and identifiers, never payloads, error text or
// the connection string. Every timestamp comparison uses the database clock.
//
//   DATABASE_URL=... node scripts/production/workers/outbox-health.cjs \
//     [--claim-timeout-ms 120000] [--api-dist apps/api/dist]

const path = require('node:path');
const { createRequire } = require('node:module');

function parse(argv) {
  const out = {
    claimTimeoutMs: 120_000,
    apiDist: path.resolve(__dirname, '../../../apps/api/dist'),
  };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--claim-timeout-ms') out.claimTimeoutMs = Number(argv[i + 1]);
    else if (argv[i] === '--api-dist') out.apiDist = path.resolve(argv[i + 1]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!Number.isInteger(out.claimTimeoutMs) || out.claimTimeoutMs <= 0) {
    throw new Error('--claim-timeout-ms must be a positive integer');
  }
  return out;
}

async function snapshot(prisma, claimTimeoutMs) {
  const byStatus = await prisma.$queryRaw`
    SELECT "status"::text AS status, COUNT(*)::int AS n FROM "OutboxEvent" GROUP BY 1 ORDER BY 1`;
  const [age] = await prisma.$queryRaw`
    SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN("availableAt"))), 0)::float AS seconds
    FROM "OutboxEvent" WHERE "status" = 'PENDING'::"OutboxStatus" AND "availableAt" <= NOW()`;
  const leases = await prisma.$queryRaw`
    SELECT "claimedBy" AS worker, COUNT(*)::int AS held,
           EXTRACT(EPOCH FROM (NOW() - MIN("claimedAt")))::float AS "oldestLeaseSeconds"
    FROM "OutboxEvent" WHERE "status" = 'PROCESSING'::"OutboxStatus" GROUP BY 1 ORDER BY 2 DESC`;
  const [expired] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n FROM "OutboxEvent"
    WHERE "status" = 'PROCESSING'::"OutboxStatus"
      AND "claimedAt" < NOW() - make_interval(secs => ${claimTimeoutMs / 1000}::double precision)`;
  const dead = await prisma.$queryRaw`
    SELECT "eventType", COUNT(*)::int AS n, MAX("updatedAt") AS "latest"
    FROM "OutboxEvent" WHERE "status" = 'DEAD'::"OutboxStatus" GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
  const retrying = await prisma.$queryRaw`
    SELECT "eventType", COUNT(*)::int AS n, MAX("attempts")::int AS "maxAttempts"
    FROM "OutboxEvent" WHERE "status" = 'PENDING'::"OutboxStatus" AND "attempts" > 0
    GROUP BY 1 ORDER BY 2 DESC LIMIT 20`;
  const [skew] = await prisma.$queryRaw`SELECT NOW() AS db`;
  return {
    queue: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    oldestDuePendingSeconds: Math.round(age.seconds),
    leases,
    expiredLeases: expired.n,
    deadByType: dead,
    retryingByType: retrying,
    clockSkewMs: new Date(skew.db).getTime() - Date.now(),
  };
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set');
  const { prisma } = createRequire(path.join(args.apiDist, 'main.js'))(
    '@homeservicemarketplace/database',
  );
  try {
    process.stdout.write(
      JSON.stringify(await snapshot(prisma, args.claimTimeoutMs), null, 2) + '\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(
      `outbox-health failed: ${err && err.message ? err.message.split('\n')[0] : err}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = { parse, snapshot };
