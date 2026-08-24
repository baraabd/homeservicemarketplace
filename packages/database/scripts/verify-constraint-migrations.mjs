#!/usr/bin/env node
// Sprint 2 — constraint-migration verification harness.
//
// The Sprint 2 constraint migrations are forward-only and they touch existing
// rows. "It applied cleanly on my laptop" is evidence for neither half of
// that: the laptop database is empty, so every remediation branch and every
// refusal branch is dead code there.
//
// This harness builds real databases and drives the migrations through the
// four cases that actually matter:
//
//   A  empty database             -> all migrations apply, all 4 indexes exist
//   B  upgraded + auto-remediable -> conflicts resolved, logged, NOTHING deleted
//   C  upgraded + email collision -> migration REFUSES, database left usable
//   D  upgraded + duplicate bids  -> migration REFUSES, database left usable
//
// B is the one that matters most. It asserts not merely that the migration
// succeeded but that every row present beforehand is still present after,
// because the cheap way to satisfy a uniqueness constraint is to delete rows,
// and the entire premise of these migrations is that they never do that.
//
// C and D assert the opposite property: that the migration STOPS. A refusal
// that quietly degraded into "applied anyway" would be the worst outcome of
// the four, so the failure path is tested as deliberately as the success path.
//
// Usage: pnpm --filter @homeservicemarketplace/database verify:migrations
// Requires a reachable Postgres superuser connection (ADMIN_DATABASE_URL, or
// the local docker default) and a generated Prisma client.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const WIN = process.platform === 'win32';

// The snapshot rule lives in a CommonJS lib beside this file so it can be unit
// tested without a Postgres server (apps/api/test/scripts/migration-history.spec.ts).
const require = createRequire(import.meta.url);
const { SPRINT2_START, selectHistoricalMigrations } = require('./migration-history.lib.cjs');

const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
const INDEXES = [
  'provider_category_application_one_pending_uniq',
  'user_email_lower_uniq',
  'address_one_default_per_user_uniq',
  'bid_one_active_per_provider_request_uniq',
];

let failures = 0;
function check(cond, message) {
  if (cond) {
    console.log(`  PASS  ${message}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${message}`);
  }
}

function urlFor(db) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${db}`;
  return u.toString();
}

function prisma(args, opts = {}) {
  return execFileSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: PKG,
    shell: WIN,
    encoding: 'utf8',
    ...opts,
  });
}

function sql(db, script) {
  prisma(['db', 'execute', '--url', urlFor(db), '--stdin'], {
    input: script,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
}

// `prisma db execute` cannot return rows, so reads go through a client bound
// to the throwaway database.
async function query(db, text) {
  const { PrismaClient } = await import('../generated/prisma/index.js');
  const client = new PrismaClient({ datasources: { db: { url: urlFor(db) } } });
  try {
    return await client.$queryRawUnsafe(text);
  } finally {
    await client.$disconnect();
  }
}

async function scalar(db, text) {
  const rows = await query(db, text);
  return Number(Object.values(rows[0])[0]);
}

function recreate(db) {
  sql('postgres', `DROP DATABASE IF EXISTS "${db}";`);
  sql('postgres', `CREATE DATABASE "${db}";`);
}

// A migrations directory holding only the migrations that existed BEFORE this
// sprint, so we can materialise the exact database an upgrade starts from.
//
// The boundary is a NAMED migration, not a date. Selecting by date prefix
// deleted a Sprint 6 migration that merely shared Sprint 2's date and retained
// every Sprint 7/8/9 migration, so this "pre-Sprint-2" database arrived
// carrying the Sprint 9 backfill while missing the Sprint 2 migration that
// creates DataRemediationLog — which the backfill writes to before it changes
// anything. CI: P3018 / 42P01.
function preSprint2Schema() {
  const dir = mkdtempSync(join(tmpdir(), 'hsm-pre-sprint2-'));
  try {
    cpSync(join(PKG, 'prisma'), join(dir, 'prisma'), { recursive: true });

    const migrations = join(dir, 'prisma', 'migrations');
    const entries = readdirSync(migrations, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    }));

    // Throws if the cutoff is missing, duplicated or malformed, or if any entry
    // that is plainly meant to be a migration cannot be placed against it.
    const { keep, drop } = selectHistoricalMigrations(entries, SPRINT2_START);

    for (const name of drop) {
      rmSync(join(migrations, name), { recursive: true, force: true });
    }

    // Verify what was actually written, not what we intended to write. A
    // failed rmSync, a case-insensitive filesystem or a symlink would all
    // leave a post-cutoff migration in place, and the whole point of scenario
    // B is that this baseline is genuinely historical.
    const remaining = readdirSync(migrations, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const late = remaining.filter((name) => name >= SPRINT2_START);
    if (late.length > 0) {
      throw new Error(
        `pre-Sprint-2 snapshot still contains ${late.length} migration(s) at or after ` +
          `${SPRINT2_START}: ${late.join(', ')}`,
      );
    }
    if (remaining.length !== keep.length) {
      throw new Error(
        `pre-Sprint-2 snapshot has ${remaining.length} migrations, expected ${keep.length}`,
      );
    }

    console.log(
      `  pre-Sprint-2 snapshot: ${keep.length} migrations kept, ${drop.length} removed ` +
        `(cutoff ${SPRINT2_START})`,
    );
    return dir;
  } catch (err) {
    // Do not leak the temp directory when the snapshot cannot be built.
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

function deploy(db, schemaDir = PKG) {
  prisma(['migrate', 'deploy', '--schema', join(schemaDir, 'prisma', 'schema.prisma')], {
    env: { ...process.env, DATABASE_URL: urlFor(db) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

// Returns the combined migration output when it fails, or null on success.
function deployExpectingFailure(db) {
  try {
    deploy(db);
    return null;
  } catch (err) {
    return `${err.stderr ?? ''}${err.stdout ?? ''}`;
  }
}

async function indexNames(db) {
  const list = INDEXES.map((i) => `'${i}'`).join(',');
  const rows = await query(db, `SELECT indexname FROM pg_indexes WHERE indexname IN (${list})`);
  return new Set(rows.map((r) => r.indexname));
}

// Minimal fixture: one provider, two categories, one seeker with three
// addresses, one open request. Raw SQL so it does not drift with the seed
// script's current shape.
const FIXTURE = `
INSERT INTO "ServiceCategory" ("id","slug","labelEn","labelAr","icon","sortOrder","isActive","createdAt","updatedAt")
VALUES ('cat-plumb','plumbing','Plumbing','plumbing-ar','wrench',1,true,NOW(),NOW()),
       ('cat-elec','electrical','Electrical','electrical-ar','bolt',2,true,NOW(),NOW());

INSERT INTO "User" ("id","email","firstName","lastName","isActive","createdAt","updatedAt","status")
VALUES ('u-prov','provider@fixture.local','Pat','Provider',true,NOW(),NOW(),'ACTIVE'),
       ('u-seek','seeker@fixture.local','Sam','Seeker',true,NOW(),NOW(),'ACTIVE');

INSERT INTO "ProviderProfile" ("id","userId","displayName","initials","createdAt","updatedAt")
VALUES ('pp-1','u-prov','Pat Provider','PP',NOW(),NOW());

INSERT INTO "Address" ("id","userId","label","city","country","isDefault","type","line1","createdAt","updatedAt")
VALUES ('addr-1','u-seek','Home','Aleppo','SY',true,'HOME','1 Main St',NOW(),NOW() - INTERVAL '2 days'),
       ('addr-2','u-seek','Work','Aleppo','SY',true,'WORK','2 Side St',NOW(),NOW() - INTERVAL '1 day'),
       ('addr-3','u-seek','Other','Aleppo','SY',false,'CUSTOM','3 Back St',NOW(),NOW());

INSERT INTO "ServiceRequest" ("id","seekerUserId","categoryId","addressId","description","status","scheduleType","addressSnapshot","createdAt","updatedAt")
VALUES ('req-1','u-seek','cat-plumb','addr-1','Leaky tap drips constantly','OPEN_FOR_BIDS','ASAP',
        '{"label":"Home","city":"Aleppo","country":"SY","line1":"1 Main St"}'::jsonb,NOW(),NOW());
`;

async function main() {
  console.log('Sprint 2 constraint-migration verification\n');
  const preDir = preSprint2Schema();
  try {
    await scenarios(preDir);
  } finally {
    // Previously this ran only on the success path, so every failing run left
    // a copy of prisma/ behind in the temp directory.
    rmSync(preDir, { recursive: true, force: true });
  }
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

async function scenarios(preDir) {
  // ── A: empty database ────────────────────────────────────────────────────
  console.log('A. empty database');
  recreate('hsm_mig_empty');
  deploy('hsm_mig_empty');
  const aIdx = await indexNames('hsm_mig_empty');
  for (const i of INDEXES) check(aIdx.has(i), `index created: ${i}`);

  // ── B: upgraded database with auto-remediable conflicts ─────────────────
  console.log('\nB. upgraded seeded database with auto-remediable conflicts');
  recreate('hsm_mig_remediate');
  deploy('hsm_mig_remediate', preDir);
  sql('hsm_mig_remediate', FIXTURE);
  // Three PENDING applications for one (provider, category); only the earliest
  // may stay live. A fourth, in a different category, must be left untouched.
  sql(
    'hsm_mig_remediate',
    `INSERT INTO "ProviderCategoryApplication" ("id","providerProfileId","serviceCategoryId","status","createdAt","updatedAt")
     VALUES ('app-old','pp-1','cat-plumb','PENDING',NOW() - INTERVAL '3 days',NOW()),
            ('app-mid','pp-1','cat-plumb','PENDING',NOW() - INTERVAL '2 days',NOW()),
            ('app-new','pp-1','cat-plumb','PENDING',NOW() - INTERVAL '1 day',NOW()),
            ('app-other','pp-1','cat-elec','PENDING',NOW(),NOW());`,
  );
  const beforeApps = await scalar(
    'hsm_mig_remediate',
    'SELECT COUNT(*) FROM "ProviderCategoryApplication"',
  );
  const beforeAddrs = await scalar('hsm_mig_remediate', 'SELECT COUNT(*) FROM "Address"');

  deploy('hsm_mig_remediate');

  const afterApps = await scalar(
    'hsm_mig_remediate',
    'SELECT COUNT(*) FROM "ProviderCategoryApplication"',
  );
  const afterAddrs = await scalar('hsm_mig_remediate', 'SELECT COUNT(*) FROM "Address"');
  check(afterApps === beforeApps, `no application rows deleted (${beforeApps} -> ${afterApps})`);
  check(afterAddrs === beforeAddrs, `no address rows deleted (${beforeAddrs} -> ${afterAddrs})`);

  const live = await query(
    'hsm_mig_remediate',
    `SELECT "id" FROM "ProviderCategoryApplication"
     WHERE "providerProfileId"='pp-1' AND "serviceCategoryId"='cat-plumb'
       AND "status"='PENDING' AND "supersededAt" IS NULL`,
  );
  check(live.length === 1, `exactly one live PENDING application remains (got ${live.length})`);
  check(live[0]?.id === 'app-old', `the EARLIEST application survived (got ${live[0]?.id})`);

  const stillPending = await scalar(
    'hsm_mig_remediate',
    `SELECT COUNT(*) FROM "ProviderCategoryApplication"
     WHERE "id" IN ('app-mid','app-new') AND "status"='PENDING'`,
  );
  check(
    stillPending === 2,
    'superseded rows kept status=PENDING (no fabricated REJECTED decision)',
  );

  const pointBack = await scalar(
    'hsm_mig_remediate',
    `SELECT COUNT(*) FROM "ProviderCategoryApplication"
     WHERE "id" IN ('app-mid','app-new') AND "supersededById"='app-old'`,
  );
  check(pointBack === 2, 'superseded rows point at the surviving application');

  const untouched = await scalar(
    'hsm_mig_remediate',
    `SELECT COUNT(*) FROM "ProviderCategoryApplication"
     WHERE "id"='app-other' AND "supersededAt" IS NULL`,
  );
  check(untouched === 1, 'a non-conflicting application in another category was left alone');

  const defaults = await query(
    'hsm_mig_remediate',
    `SELECT "id" FROM "Address"
     WHERE "userId"='u-seek' AND "isDefault" IS TRUE AND "deletedAt" IS NULL`,
  );
  check(defaults.length === 1, `exactly one default address remains (got ${defaults.length})`);
  check(
    defaults[0]?.id === 'addr-2',
    `the most recently updated default survived (got ${defaults[0]?.id})`,
  );

  const logged = await scalar(
    'hsm_mig_remediate',
    'SELECT COUNT(*) FROM "DataRemediationLog" WHERE "before" IS NOT NULL',
  );
  check(
    logged === 3,
    `every mutated row was logged with its prior state (expected 3, got ${logged})`,
  );

  const bIdx = await indexNames('hsm_mig_remediate');
  for (const i of INDEXES) check(bIdx.has(i), `index created on upgraded db: ${i}`);

  // ── C: email collision must refuse ──────────────────────────────────────
  console.log('\nC. upgraded database with a case-insensitive email collision');
  recreate('hsm_mig_email');
  deploy('hsm_mig_email', preDir);
  sql(
    'hsm_mig_email',
    `INSERT INTO "User" ("id","email","firstName","lastName","isActive","createdAt","updatedAt","status")
     VALUES ('u-lower','collide@fixture.local','A','A',true,NOW(),NOW(),'ACTIVE'),
            ('u-upper','Collide@Fixture.local','B','B',true,NOW(),NOW(),'ACTIVE');`,
  );
  const cErr = deployExpectingFailure('hsm_mig_email') ?? '';
  check(cErr !== '', 'migration refused to apply');
  check(
    /case-insensitive email uniqueness/i.test(cErr),
    'refusal names the constraint it could not enforce',
  );
  check(/u-lower|u-upper/.test(cErr), 'refusal identifies the colliding accounts by id');
  check(!/collide@fixture/i.test(cErr), 'refusal does NOT print email addresses');
  const cIdx = await indexNames('hsm_mig_email');
  check(!cIdx.has('user_email_lower_uniq'), 'the constraint was not left half-applied');
  const cUsers = await scalar('hsm_mig_email', 'SELECT COUNT(*) FROM "User"');
  check(cUsers === 2, 'both colliding accounts still exist; neither merged nor deleted');

  // ── D: duplicate active bids must refuse ────────────────────────────────
  console.log('\nD. upgraded database with duplicate active bids');
  recreate('hsm_mig_bids');
  deploy('hsm_mig_bids', preDir);
  sql('hsm_mig_bids', FIXTURE);
  sql(
    'hsm_mig_bids',
    `INSERT INTO "Bid" ("id","requestId","providerId","amount","pricingType","status","submittedAt","createdAt","updatedAt")
     VALUES ('bid-a','req-1','pp-1',100,'FIXED','PENDING',NOW(),NOW(),NOW()),
            ('bid-b','req-1','pp-1',120,'FIXED','PENDING',NOW(),NOW(),NOW());`,
  );
  const dErr = deployExpectingFailure('hsm_mig_bids') ?? '';
  check(dErr !== '', 'migration refused to apply');
  check(
    /one-active-bid-per-request/i.test(dErr),
    'refusal names the constraint it could not enforce',
  );
  const dBids = await scalar('hsm_mig_bids', 'SELECT COUNT(*) FROM "Bid"');
  check(dBids === 2, 'both live bids still exist; neither was retracted automatically');
  const dIdx = await indexNames('hsm_mig_bids');
  check(
    !dIdx.has('bid_one_active_per_provider_request_uniq'),
    'the constraint was not left half-applied',
  );
}

main().catch((err) => {
  console.error('\nharness error:', err.message);
  process.exit(1);
});
