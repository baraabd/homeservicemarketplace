#!/usr/bin/env node
// R27 — statements per request, plans and pagination for the hot lists.
//
// 1. Starts the built API on the lane stack (fixture profile, workers off).
// 2. Seeds seekers, providers, requests, bids and bookings through the real
//    endpoints (see lib/fixtures.mjs).
// 3. For each list read, resets pg_stat_statements, makes ONE request and
//    counts the statements it caused, then repeats for latency.
// 4. Clones the request/bid/booking graph (lib/amplify.mjs) and measures
//    again. A list whose statement count grows with the data is an N+1.
// 5. Captures a generic plan for every distinct read and flags sequential
//    scans on the large tables; walks cursor pages for duplicates.
// 6. Records Cache-Control/ETag/Vary of every read for the cache audit, and
//    runs the cross-user and cross-role cache/authorization negatives.
//
// Usage: node scripts/perf/post-r18/query-profile.mjs [--copies 300] [--out-json path]

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { amplify, rowCounts } from './lib/amplify.mjs';
import { startApi, stopApi } from './lib/api-process.mjs';
import { laneDb } from './lib/db.mjs';
import {
  assertClonedFinancialValues,
  assertFinancialIndex,
  assertFinancialIntegrity,
  assertFinancialPlanEvidence,
  completeFinancialFixture,
  financialBoundPlans,
  financialDistribution,
  financialGenericPlans,
  financialIndexCatalog,
  financialIntegritySnapshot,
  financialListEvidence,
} from './lib/financials.mjs';
import {
  acceptBid,
  adminSession,
  leafCategoryId,
  postRequest,
  registerSeeker,
  submitBid,
  workingProvider,
} from './lib/fixtures.mjs';
import { api, newJar } from './lib/http.mjs';
import { LANE } from './lib/lane-env.mjs';
import { classifyStatements, scansOf, seqScanFindings, statementLabel } from './lib/plans.mjs';
import { REPO_ROOT, hostProvenance, sourceProvenance } from './lib/provenance.mjs';
import { summarize } from './lib/stats.mjs';
import { measureWorkloads } from './profile-workloads.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const COPIES = Number(option('copies', 300));
const OUT = option('out-json', null);
const ASSERT_REPAIRS = args.includes('--assert-repairs');
const SEEKERS = 6;
const PROVIDERS = 4;
const REQUESTS_PER_SEEKER = 6;
const ACCEPTS_PER_SEEKER = 3;
const REPEATS = 5;
const LARGE = new Set(['ServiceRequest', 'Bid', 'Booking']);

function scenarios(f) {
  const s = f.seekers[0];
  const p = f.providers[0];
  // Provider 1 holds accepted bookings; the fresh provider has bid on nothing,
  // so the open-request feed is not empty for it.
  const booked = f.providers[1];
  const fresh = f.freshProvider;
  const r = s.requestIds[0];
  return [
    { name: 'auth/me (seeker)', who: s, path: '/v1/auth/me' },
    { name: 'seeker requests', who: s, path: '/v1/me/requests', paged: true },
    { name: 'seeker request detail', who: s, path: `/v1/me/requests/${r}` },
    { name: 'seeker bids on a request', who: s, path: `/v1/me/requests/${r}/bids` },
    { name: 'seeker bookings', who: s, path: '/v1/me/bookings', paged: true },
    { name: 'seeker notifications', who: s, path: '/v1/me/notifications', paged: true },
    { name: 'seeker conversations', who: s, path: '/v1/me/conversations' },
    {
      name: 'provider available requests',
      who: fresh,
      path: '/v1/provider/available-requests',
      paged: true,
    },
    { name: 'provider bids', who: p, path: '/v1/provider/bids', paged: true },
    { name: 'provider bookings', who: booked, path: '/v1/provider/bookings', paged: true },
    { name: 'provider portfolio', who: p, path: '/v1/me/provider/portfolio' },
    { name: 'admin users', who: f.admin, path: '/v1/admin/users', paged: true },
    { name: 'admin providers', who: f.admin, path: '/v1/admin/providers' },
    {
      name: 'admin category applications',
      who: f.admin,
      path: '/v1/admin/category-applications?status=PENDING',
    },
    { name: 'admin disputes', who: f.admin, path: '/v1/admin/disputes' },
    {
      name: 'admin financial bookings',
      who: f.admin,
      path: '/v1/admin/financials/bookings',
      paged: true,
    },
    { name: 'admin audit logs', who: f.admin, path: '/v1/admin/audit-logs' },
  ];
}

async function captured(db) {
  const { rows } = await db.query(
    `SELECT queryid::text AS id, query, calls, total_exec_time, rows
       FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND query NOT ILIKE '%pg_stat_statements%'
        AND query NOT ILIKE 'SET application_name%'`,
  );
  return rows;
}

const itemsOf = (body) =>
  Array.isArray(body)
    ? body
    : Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.data)
        ? body.data
        : null;

async function measure(db, scenario) {
  await db.query('SELECT pg_stat_statements_reset()');
  const first = await api(scenario.who.jar, scenario.path);
  if (first.status !== 200) throw new Error(`${scenario.name} returned HTTP ${first.status}`);
  const counted = classifyStatements(await captured(db));
  const latencies = [];
  for (let i = 0; i < REPEATS; i += 1) {
    const r = await api(scenario.who.jar, scenario.path);
    if (r.status !== first.status)
      throw new Error(`${scenario.name} changed status ${first.status} -> ${r.status}`);
    latencies.push(r.ms);
  }
  return {
    status: first.status,
    items: itemsOf(first.body)?.length ?? null,
    responseBytes: first.bytes,
    statements: counted.statements,
    txControl: counted.control,
    statementLabels: counted.data.map((row) => `${statementLabel(row.query)} x${row.calls}`).sort(),
    dbTimeMs:
      Math.round(counted.data.reduce((sum, row) => sum + Number(row.total_exec_time), 0) * 100) /
      100,
    latency: summarize(latencies),
    headers: first.headers,
    queries: counted.data.map((row) => row.query),
  };
}

/**
 * Page-size invariance: the same list at limit=5 and limit=20. A statement
 * count that rises with the page size is a per-item query (N+1), whatever
 * the dataset size.
 */
async function pageSizeProbe(db, scenario) {
  const counts = {};
  for (const limit of [5, 20]) {
    const sep = scenario.path.includes('?') ? '&' : '?';
    await db.query('SELECT pg_stat_statements_reset()');
    const res = await api(scenario.who.jar, `${scenario.path}${sep}limit=${limit}`);
    const counted = classifyStatements(await captured(db));
    counts[limit] = {
      status: res.status,
      items: itemsOf(res.body)?.length ?? null,
      statements: counted.statements,
      perTable: counted.data.map((row) => `${statementLabel(row.query)} x${row.calls}`).sort(),
    };
  }
  const grew = counts[20].items > counts[5].items;
  return {
    ...counts,
    verdict: !grew
      ? 'not-exercised (page did not grow)'
      : counts[20].statements > counts[5].statements
        ? 'N+1'
        : 'bounded',
  };
}

async function plansFor(db, queries) {
  const out = [];
  for (const query of [...new Set(queries)]) {
    if (!/^\s*SELECT/i.test(query)) continue;
    try {
      const { rows } = await db.query(`EXPLAIN (GENERIC_PLAN, FORMAT JSON) ${query}`);
      const plan = rows[0]['QUERY PLAN'];
      const scans = scansOf(plan);
      out.push({
        statement: statementLabel(query),
        totalCost: plan[0].Plan['Total Cost'],
        scans,
        seqScansOnLargeTables: seqScanFindings(scans, LARGE),
      });
    } catch (error) {
      out.push({ statement: statementLabel(query), error: error.message.slice(0, 160) });
    }
  }
  return out;
}

/** Follow cursors; report duplicates and whether the walk terminated. */
async function walkPages(jar, path, limit, maxPages = 60) {
  const seen = new Set();
  let duplicates = 0;
  let pages = 0;
  let cursor = null;
  let shape = null;
  do {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${sep}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await api(jar, url);
    if (res.status !== 200) return { error: `HTTP ${res.status} on page ${pages + 1}` };
    const items = itemsOf(res.body) ?? [];
    shape =
      shape ??
      Object.keys(res.body ?? {})
        .sort()
        .join(',');
    for (const item of items) {
      if (seen.has(item.id)) duplicates += 1;
      seen.add(item.id);
    }
    pages += 1;
    cursor = res.body?.nextCursor ?? res.body?.pageInfo?.nextCursor ?? null;
  } while (cursor && pages < maxPages);
  return { pages, distinctItems: seen.size, duplicates, terminated: !cursor, responseKeys: shape };
}

async function negatives(f) {
  const [a, b] = f.seekers;
  const provider = f.providers[0];
  const results = [];
  const check = async (name, jar, path, allowed) => {
    const res = await api(jar, path);
    results.push({
      name,
      path: path.replace(/[a-z0-9]{20,}/gi, ':id'),
      status: res.status,
      pass: allowed.includes(res.status),
    });
  };
  await check('anonymous cannot read a seeker list', newJar(), '/v1/me/requests', [401]);
  await check(
    "seeker B cannot read seeker A's request",
    b.jar,
    `/v1/me/requests/${a.requestIds[0]}`,
    [403, 404],
  );
  await check(
    "seeker B cannot read bids on A's request",
    b.jar,
    `/v1/me/requests/${a.requestIds[0]}/bids`,
    [403, 404],
  );
  await check('seeker cannot read the admin user list', a.jar, '/v1/admin/users', [403]);
  await check('provider cannot read the admin user list', provider.jar, '/v1/admin/users', [403]);
  await check('seeker cannot read provider bids', a.jar, '/v1/provider/bids', [403]);

  // A validator from user A's response must never yield 304 for user B.
  const raw = async (jar, path, extra = {}) =>
    fetch(`${LANE.api}${path}`, {
      headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...extra },
    });
  for (const path of ['/v1/auth/me', '/v1/me/requests', '/v1/me/bookings']) {
    const fromA = await raw(a.jar, path);
    await fromA.arrayBuffer();
    const etag = fromA.headers.get('etag');
    if (!etag) {
      results.push({
        name: `no validator to replay on ${path}`,
        path,
        status: fromA.status,
        pass: true,
      });
      continue;
    }
    const asB = await raw(b.jar, path, { 'If-None-Match': etag });
    await asB.arrayBuffer();
    results.push({
      name: `A's ETag replayed by B on ${path} is not 304`,
      path,
      status: asB.status,
      pass: asB.status === 200,
    });
    const asA = await raw(a.jar, path, { 'If-None-Match': etag });
    await asA.arrayBuffer();
    results.push({
      name: `A's own ETag on ${path} (revalidation behaviour, informational)`,
      path,
      status: asA.status,
      pass: true,
    });
  }

  // Logout must end the session for every later read, cached client state aside.
  const c = await registerSeeker();
  const before = await api(c.jar, '/v1/auth/me');
  const snapshot = new Map(c.jar);
  await api(c.jar, '/v1/auth/logout', { method: 'POST' });
  const replay = await api(snapshot, '/v1/me/requests');
  results.push({
    name: 'session cookies replayed after logout are refused',
    path: '/v1/me/requests',
    status: replay.status,
    pass: before.status === 200 && replay.status === 401,
  });
  return results;
}

async function bidCountContract(db, fixtures) {
  const owner = fixtures.seekers[0];
  const requestId = owner.requestIds[0]; // Open request: no accepted booking/ledger.
  const bids = await db.query('SELECT id FROM "Bid" WHERE "requestId"=$1 ORDER BY id', [requestId]);
  if (bids.rows.length !== 4) throw new Error('expected four original fixture bids');
  await db.query('UPDATE "Bid" SET status=\'WITHDRAWN\' WHERE id IN ($1,$2)', [
    bids.rows[0].id,
    bids.rows[1].id,
  ]);
  await db.query('UPDATE "Bid" SET "deletedAt"=NOW() WHERE id=$1', [bids.rows[2].id]);
  const read = async () => {
    const list = await api(owner.jar, '/v1/me/requests?limit=100');
    // The amplified graph sorts after the original; use the scoped detail to
    // compare its semantics and walk to the original page deterministically.
    let page = list;
    let row = page.body.items.find((item) => item.id === requestId);
    let count = 0;
    while (!row && page.body.nextCursor && count++ < 100) {
      page = await api(
        owner.jar,
        '/v1/me/requests?limit=100&cursor=' + encodeURIComponent(page.body.nextCursor),
      );
      if (page.status !== 200) throw new Error('bid-count page failed');
      row = page.body.items.find((item) => item.id === requestId);
    }
    const detail = await api(owner.jar, '/v1/me/requests/' + requestId);
    if (!row || detail.status !== 200) throw new Error('fixture request disappeared');
    return { list: row.bidsCount, detail: detail.body.bidsCount };
  };
  const one = await read();
  await db.query('UPDATE "Bid" SET status=\'WITHDRAWN\' WHERE id=$1', [bids.rows[3].id]);
  const zero = await read();
  const pass = one.list === 1 && one.detail === 1 && zero.list === 0 && zero.detail === 0;
  if (!pass) throw new Error('visible-bid count contract failed: ' + JSON.stringify({ one, zero }));
  return {
    pass,
    one,
    zero,
    fixture: 'Only four bids on one open disposable request changed; no financial row altered.',
  };
}

async function main() {
  const db = await laneDb();
  await db.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
  const handle = await startApi({
    logFile: join(mkdtempSync(join(tmpdir(), 'hsm-r27-q-')), 'api.log'),
  });
  try {
    const categoryId = await leafCategoryId(db);
    const providers = [];
    for (let i = 0; i < PROVIDERS; i += 1) providers.push(await workingProvider(db, categoryId));
    const freshProvider = await workingProvider(db, categoryId);
    const seekers = [];
    for (let i = 0; i < SEEKERS; i += 1) {
      const seeker = await registerSeeker();
      seeker.requestIds = [];
      for (let j = 0; j < REQUESTS_PER_SEEKER; j += 1)
        seeker.requestIds.push(await postRequest(seeker, categoryId));
      seekers.push(seeker);
    }
    let bookings = 0;
    let completedBookings = 0;
    for (const seeker of seekers) {
      for (const [j, requestId] of seeker.requestIds.entries()) {
        const bids = [];
        for (const [k, provider] of providers.entries())
          bids.push(await submitBid(provider, requestId, 100 + k * 5));
        // Keep the first request of each seeker open so its bid list stays readable.
        if (j >= 1 && j <= ACCEPTS_PER_SEEKER) {
          const bookingId = await acceptBid(seeker, requestId, bids[j % bids.length]);
          // One guarded completion per seeker supplies actual financial rows.
          // Provider 1's booked-list fixture remains scheduled and populated.
          if (j === 2) {
            await completeFinancialFixture(providers[j % bids.length], bookingId);
            completedBookings += 1;
          }
          bookings += 1;
        }
      }
    }
    const admin = await adminSession();
    const fixtures = { seekers, providers, freshProvider, admin };
    console.log(
      `[r27-query] seeded ${SEEKERS} seekers, ${PROVIDERS} providers, ${bookings} bookings via the real API`,
    );

    const phases = {};
    const run = async (phase) => {
      const rows = {};
      for (const scenario of scenarios(fixtures)) {
        rows[scenario.name] = {
          path: scenario.path.replace(/[a-z0-9]{20,}/gi, ':id'),
          ...(await measure(db, scenario)),
        };
      }
      phases[phase] = {
        rowCounts: await rowCounts(db),
        financialDistribution: await financialDistribution(db),
        scenarios: rows,
      };
      console.log(`[r27-query] ${phase}: ${JSON.stringify(phases[phase].rowCounts)}`);
    };
    await run('base');
    const originalFinancialIntegrity = await financialIntegritySnapshot(db);
    const amplified = await amplify(db, COPIES);
    assertFinancialIntegrity(originalFinancialIntegrity, await financialIntegritySnapshot(db));
    await assertClonedFinancialValues(db);
    console.log(`[r27-query] amplified x${COPIES}`);
    await run('amplified');

    const comparison = Object.keys(phases.base.scenarios).map((name) => {
      const b = phases.base.scenarios[name];
      const a = phases.amplified.scenarios[name];
      return {
        name,
        path: b.path,
        status: [b.status, a.status],
        items: [b.items, a.items],
        statements: [b.statements, a.statements],
        bounded: a.status === b.status && a.statements <= b.statements,
        p50Ms: [b.latency.p50, a.latency.p50],
        dbTimeMs: [b.dbTimeMs, a.dbTimeMs],
      };
    });

    const pageSize = {};
    for (const scenario of scenarios(fixtures).filter((sc) => sc.paged)) {
      pageSize[scenario.name] = await pageSizeProbe(db, scenario);
    }

    const plans = {};
    for (const [name, row] of Object.entries(phases.amplified.scenarios)) {
      plans[name] =
        name === 'admin financial bookings'
          ? await financialGenericPlans(db, row.queries)
          : await plansFor(db, row.queries);
    }
    const financialScalarPlans = await financialBoundPlans(db);
    const financialIndex = await financialIndexCatalog(db);
    const pagination = {
      'provider bids': await walkPages(
        providers[0].jar,
        '/v1/provider/bids',
        20,
        Math.ceil(amplified.Bid / 20) + 1,
      ),
      'seeker requests': await walkPages(
        seekers[0].jar,
        '/v1/me/requests',
        20,
        Math.ceil(amplified.ServiceRequest / 20) + 1,
      ),
      'seeker bookings': await walkPages(
        seekers[0].jar,
        '/v1/me/bookings',
        20,
        Math.ceil(amplified.Booking / 20) + 1,
      ),
      'provider bookings': await walkPages(
        providers[1].jar,
        '/v1/provider/bookings',
        20,
        Math.ceil(amplified.Booking / 20) + 1,
      ),
      'provider available requests': await walkPages(
        freshProvider.jar,
        '/v1/provider/available-requests',
        20,
        Math.ceil(amplified.ServiceRequest / 20) + 1,
      ),
    };
    const cacheAuth = await negatives(fixtures);
    const financials = await financialListEvidence(db, fixtures);
    const bidCounts = await bidCountContract(db, fixtures);
    const workloads = await measureWorkloads(handle.pid, () =>
      api(seekers[0].jar, '/v1/me/requests?limit=20'),
    );
    for (const [name, walk] of Object.entries(pagination)) {
      if (walk.error || walk.duplicates || !walk.terminated || walk.distinctItems === 0) {
        throw new Error('pagination contract failed: ' + name);
      }
    }
    for (const phase of Object.values(phases)) {
      for (const row of Object.values(phase.scenarios)) delete row.queries;
    }
    const report = {
      schemaVersion: 1,
      kind: 'r27-query-profile',
      measuredAt: new Date().toISOString(),
      source: sourceProvenance(),
      host: hostProvenance(),
      dataset: {
        realApi: {
          seekers: SEEKERS,
          providers: PROVIDERS,
          requestsPerSeeker: REQUESTS_PER_SEEKER,
          bookings,
          completedBookings,
        },
        amplification: {
          copies: COPIES,
          tables: ['ServiceRequest', 'Bid', 'Booking'],
          rowCountsAfter: amplified,
          financialFixture:
            'completed clones preserve amounts and owners; every tenth completed generation is soft-deleted; day-boundary completion ties exercise id ordering',
        },
        limits:
          'clones share the real users: per-user histories are heavy; user/notification/audit tables stay small',
      },
      environment: {
        profile: 'fixture (NODE_ENV=development, APP_ENV=test), background workers off',
        database:
          'postgres:16-alpine with pg_stat_statements and auto_explain, loopback, lane-only',
        repeatsPerScenario: REPEATS,
      },
      comparison,
      phases,
      pageSizeInvariance: pageSize,
      plans,
      financialScalarPlans,
      financialIndex,
      financials: {
        ...financials,
        amplificationPreservedOriginalRowsAndLedger: true,
        clonedFinancialValuesMatchOriginals: true,
        budgetDecision: 'PROPOSED_THRESHOLDS_REMAIN_UNAPPROVED',
      },
      pagination,
      cacheAuthorization: cacheAuth,
      bidCountContract: bidCounts,
      workloads,
      repairAssertionsEnabled: ASSERT_REPAIRS,
    };
    // Preserve actual measurements and catalog metadata even when a repair
    // assertion fails. The CI result, not the existence of this report, gates acceptance.
    if (OUT) writeFileSync(resolve(REPO_ROOT, OUT), `${JSON.stringify(report, null, 2)}\n`);
    assertFinancialPlanEvidence(plans['admin financial bookings'], financialScalarPlans);
    if (ASSERT_REPAIRS) {
      assertFinancialIndex(financialIndex);
      if (pageSize['admin users'].verdict !== 'bounded') throw new Error('admin user N+1 remains');
      if (
        plans['seeker requests'].some(
          (plan) =>
            plan.error || plan.seqScansOnLargeTables?.some((scan) => scan.startsWith('Bid ')),
        )
      ) {
        throw new Error('page bid count still scans the large Bid table');
      }
    }
    for (const c of comparison) {
      console.log(
        `  ${c.name.padEnd(30)} ${String(c.status)} items ${String(c.items).padEnd(9)} stmts ${String(c.statements).padEnd(7)} ${c.bounded ? 'bounded' : 'GROWS'}  p50 ${c.p50Ms.join(' -> ')} ms`,
      );
    }
    const seqs = Object.entries(plans).flatMap(([n, ps]) =>
      ps.flatMap((p) => (p.seqScansOnLargeTables ?? []).map((s) => `${n}: ${s}`)),
    );
    console.log(
      `[r27-query] seq scans on large tables: ${seqs.length ? `\n    ${seqs.join('\n    ')}` : 'none'}`,
    );
    for (const [n, v] of Object.entries(pageSize)) {
      console.log(
        `  page-size ${n}: ${v.verdict} (limit 5 -> ${v[5].statements} stmts/${v[5].items} items, limit 20 -> ${v[20].statements}/${v[20].items})`,
      );
    }
    for (const [n, w] of Object.entries(pagination))
      console.log(`  page walk ${n}: ${JSON.stringify(w)}`);
    for (const r of cacheAuth) console.log(`  ${r.pass ? 'PASS' : 'FAIL'} ${r.status} ${r.name}`);
    if (cacheAuth.some((r) => !r.pass)) process.exitCode = 2;
  } finally {
    await stopApi(handle);
    await db.end();
  }
}

main().catch((error) => {
  console.error(`[r27-query] failed: ${error.message}`);
  process.exitCode = 1;
});
