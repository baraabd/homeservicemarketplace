// R27 — populated financial-list evidence. The existing laneDb() identity
// guard owns the database connection. Writes below are restricted to this
// harness's amplified bookings; amounts, owners and ledger rows are untouched.
import assert from 'node:assert/strict';

import { api, expectStatus, newJar } from './http.mjs';
import { scansOf, seqScanFindings, statementLabel } from './plans.mjs';

export const FINANCIAL_PATH = '/v1/admin/financials/bookings';
const CLONE = /^r27c[1-9][0-9]*_/;

export async function completeFinancialFixture(provider, bookingId) {
  for (const transition of ['start', 'complete']) {
    expectStatus(
      await api(provider.jar, `/v1/me/provider/bookings/${bookingId}/${transition}`, {
        method: 'POST',
      }),
      200,
      `financial fixture ${transition}`,
    );
  }
}

/** Counts only: fixture identities and response bodies never enter the report. */
export async function financialDistribution(db) {
  return (
    await db.query(`SELECT status, "deletedAt" IS NOT NULL AS deleted, count(*)::int AS count
      FROM "Booking" GROUP BY 1, 2 ORDER BY 1, 2`)
  ).rows;
}

/** Exact original-row and ledger fingerprints before/after fixture work. */
export async function financialIntegritySnapshot(db) {
  const originalBookings = (
    await db.query(`SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(to_jsonb(b)::text, '' ORDER BY id), '')) AS digest
      FROM "Booking" b WHERE id !~ '^r27c[1-9][0-9]*_'`)
  ).rows[0];
  const ledger = {};
  for (const table of ['LedgerAccount', 'LedgerTransaction', 'LedgerEntry']) {
    ledger[table] = (
      await db.query(`SELECT count(*)::int AS count,
        md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY id), '')) AS digest
        FROM "${table}" t`)
    ).rows[0];
  }
  return { originalBookings, ledger };
}

export function assertFinancialIntegrity(before, after) {
  assert.deepEqual(after, before, 'fixture changed an original booking or ledger row');
}

/** A clone must retain the original financial and ownership values exactly. */
export async function assertClonedFinancialValues(db) {
  const { rows } = await db.query(`SELECT count(*)::int AS mismatches
    FROM "Booking" clone
    LEFT JOIN "Booking" original
      ON original.id = regexp_replace(clone.id, '^r27c[1-9][0-9]*_', '')
    WHERE clone.id ~ '^r27c[1-9][0-9]*_' AND (
      original.id IS NULL OR
      ROW(clone."priceAmount", clone.currency, clone."seekerUserId", clone."providerId")
        IS DISTINCT FROM
      ROW(original."priceAmount", original.currency, original."seekerUserId", original."providerId"))`);
  assert.equal(rows[0].mismatches, 0, 'amplified booking changed financial or ownership values');
}

async function eligibleRows(db) {
  // Prisma treats its timestamp-without-time-zone columns as UTC. pg's
  // default parser otherwise interprets them in the harness host's timezone.
  const { rows } = await db.query(`SELECT id, "priceAmount", currency,
      "updatedAt" AT TIME ZONE 'UTC' AS "updatedAt", "providerId", "seekerUserId"
      FROM "Booking" WHERE status = 'COMPLETED' AND "deletedAt" IS NULL
      ORDER BY "updatedAt" DESC, id DESC`);
  return rows;
}

/** Fail closed on missing rows, reordered ties, duplicates or changed money. */
export function assertFinancialPage(response, expected, offset, limit) {
  assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= 100, 'invalid financial limit');
  assert.ok(Number.isInteger(offset) && offset >= 0, 'invalid financial offset');
  assert.equal(response.status, 200, 'financial page did not return HTTP 200');
  const { items, nextCursor } = response.body ?? {};
  assert.ok(Array.isArray(items), 'financial items must be an array');
  const wanted = expected.slice(offset, offset + limit);
  assert.equal(items.length, wanted.length, 'financial page omitted or added rows');
  for (let index = 0; index < wanted.length; index++) {
    const item = items[index];
    const row = wanted[index];
    assert.equal(item.id, row.id, 'financial row order/visibility mismatch');
    assert.equal(item.bookingId, row.id, 'financial booking identity mismatch');
    assert.equal(item.amount, row.priceAmount, 'financial amount mismatch');
    assert.equal(item.currency, row.currency, 'financial currency mismatch');
    assert.equal(item.provider?.id, row.providerId, 'financial provider mismatch');
    assert.equal(item.seeker?.id, row.seekerUserId, 'financial seeker mismatch');
    assert.ok(Number.isSafeInteger(item.platformFee) && item.platformFee >= 0, 'invalid fee');
    assert.ok(Number.isSafeInteger(item.netAmount) && item.netAmount >= 0, 'invalid net amount');
    // apiEnv() passes no fee override; the accepted runtime default is 1000 bps.
    assert.equal(item.platformFee, Math.round(row.priceAmount / 10), 'financial fee mismatch');
    assert.equal(item.platformFee + item.netAmount, row.priceAmount, 'financial split mismatch');
    assert.equal(
      item.occurredAt,
      new Date(row.updatedAt).toISOString(),
      'financial occurrence timestamp mismatch',
    );
  }
  assert.equal(
    nextCursor,
    offset + limit < expected.length ? wanted.at(-1).id : null,
    'financial cursor or termination mismatch',
  );
  return items;
}

const pagePath = (limit, cursor = null) =>
  `${FINANCIAL_PATH}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

export async function walkFinancialPages(read, expected, limit = 20) {
  assert.ok(expected.length > limit, 'financial pagination requires multiple populated pages');
  let cursor = null;
  let offset = 0;
  let pages = 0;
  do {
    const response = await read(pagePath(limit, cursor));
    const items = assertFinancialPage(response, expected, offset, limit);
    offset += items.length;
    pages += 1;
    cursor = response.body.nextCursor;
    assert.ok(pages <= Math.ceil(expected.length / limit), 'financial walk did not terminate');
  } while (cursor);
  assert.equal(offset, expected.length, 'financial walk missed eligible rows');
  return {
    pass: true,
    pages,
    distinctItems: offset,
    duplicates: 0,
    terminated: true,
    orderedDatabaseTruthMatched: true,
    financialValuesMatched: true,
  };
}

export function cursorMutationObservation(firstIds, originalNextIds, actualIds) {
  const earlier = new Set(firstIds);
  const actual = new Set(actualIds);
  const duplicates = actualIds.filter((id) => earlier.has(id)).length;
  const omittedFromOriginalNextPage = originalNextIds.filter((id) => !actual.has(id)).length;
  return {
    classification:
      duplicates || omittedFromOriginalNextPage
        ? 'MUTABLE_CURSOR_REORDERS_PAGE'
        : 'NO_REORDER_OBSERVED',
    duplicatesFromEarlierPages: duplicates,
    omittedFromOriginalNextPage,
    snapshotGuarantee: false,
  };
}

/**
 * A separate SQL client commits between real HTTP pages, reproducing a
 * concurrent writer without a timing race. This characterizes the ID cursor;
 * it does not reinterpret mutable updatedAt ordering as snapshot pagination.
 */
async function mutationEvidence(db, jar, expected) {
  const limit = 20;
  const earlierIds = [];
  let offset = 0;
  let cursor = null;
  do {
    const page = await api(jar, pagePath(limit, cursor));
    earlierIds.push(...assertFinancialPage(page, expected, offset, limit).map((row) => row.id));
    offset += page.body.items.length;
    cursor = page.body.nextCursor;
    assert.ok(cursor, 'mutation probe needs another financial page');
  } while (!CLONE.test(cursor));
  const pivot = expected[offset - 1];
  const deleted = expected.slice(offset).find((row) => CLONE.test(row.id));
  assert.ok(deleted, 'mutation probe needs an unread amplified completed booking');
  const originalNext = expected.slice(offset, offset + limit).map((row) => row.id);
  let cursorSortChange;
  try {
    const changed = await db.query(
      `UPDATE "Booking" SET "updatedAt" =
      (SELECT MAX("updatedAt") + INTERVAL '1 day' FROM "Booking")
      WHERE id = $1 AND id ~ '^r27c[1-9][0-9]*_' AND status = 'COMPLETED'
        AND "deletedAt" IS NULL RETURNING id`,
      [cursor],
    );
    assert.equal(changed.rowCount, 1, 'cursor mutation escaped its disposable clone');
    const after = await eligibleRows(db);
    const next = await api(jar, pagePath(limit, cursor));
    const items = assertFinancialPage(
      next,
      after,
      after.findIndex((row) => row.id === cursor) + 1,
      limit,
    );
    cursorSortChange = cursorMutationObservation(
      earlierIds,
      originalNext,
      items.map((row) => row.id),
    );
  } finally {
    await db.query(
      `UPDATE "Booking" SET "updatedAt" = $2
      WHERE id = $1 AND id ~ '^r27c[1-9][0-9]*_'`,
      [cursor, pivot.updatedAt.toISOString()],
    );
  }
  try {
    const changed = await db.query(
      `UPDATE "Booking" SET "deletedAt" = NOW()
      WHERE id = $1 AND id ~ '^r27c[1-9][0-9]*_' AND status = 'COMPLETED'
        AND "deletedAt" IS NULL RETURNING id`,
      [deleted.id],
    );
    assert.equal(changed.rowCount, 1, 'deletion probe escaped its disposable clone');
    const after = await eligibleRows(db);
    const next = await api(jar, pagePath(limit, cursor));
    assertFinancialPage(next, after, after.findIndex((row) => row.id === cursor) + 1, limit);
    assert.ok(
      !next.body.items.some((row) => row.id === deleted.id),
      'deleted financial row leaked',
    );
  } finally {
    await db.query(
      `UPDATE "Booking" SET "deletedAt" = NULL
      WHERE id = $1 AND id ~ '^r27c[1-9][0-9]*_'`,
      [deleted.id],
    );
  }
  assert.deepEqual(await eligibleRows(db), expected, 'mutation probe failed to restore fixture');
  await assertClonedFinancialValues(db);
  return {
    writerSchedule: 'separate PostgreSQL client commits between guarded HTTP page requests',
    cursorSortChange,
    unreadSoftDeletionExcluded: true,
    fixtureRestored: true,
    monetaryValuesPreserved: true,
  };
}

export async function financialListEvidence(db, fixtures) {
  const expected = await eligibleRows(db);
  assert.ok(expected.length > 100, 'financial fixture must exercise the supported maximum page');
  const before = await financialIntegritySnapshot(db);
  const limits = {};
  for (const limit of [5, 20, 100]) {
    const response = await api(fixtures.admin.jar, pagePath(limit));
    limits[limit] = { items: assertFinancialPage(response, expected, 0, limit).length, pass: true };
  }
  const pagination = await walkFinancialPages((path) => api(fixtures.admin.jar, path), expected);
  const authorization = [];
  for (const [role, jar, status] of [
    ['anonymous', newJar(), 401],
    ['seeker', fixtures.seekers[0].jar, 403],
    ['provider', fixtures.providers[0].jar, 403],
  ]) {
    const response = await api(jar, FINANCIAL_PATH);
    assert.equal(response.status, status, 'unauthorized financial read was not rejected');
    authorization.push({ role, status: response.status, pass: true });
  }
  const concurrentUpdates = await mutationEvidence(db, fixtures.admin.jar, expected);
  assertFinancialIntegrity(before, await financialIntegritySnapshot(db));
  return {
    limits,
    pagination,
    authorization,
    concurrentUpdates,
    ledgerAndOriginalRowsPreserved: true,
  };
}

export const FINANCIAL_INDEX_NAME = 'Booking_status_updatedAt_id_deletedAt_idx';
const FINANCIAL_INDEX_DEFINITION =
  'CREATE INDEX "Booking_status_updatedAt_id_deletedAt_idx" ON public."Booking" USING btree (status, "updatedAt" DESC, id DESC, "deletedAt")';

/** Read on both runtimes. An absent index is expected on the frozen baseline. */
export async function financialIndexCatalog(db) {
  const { rows } = await db.query(
    `SELECT index_namespace.nspname AS "indexSchema", index_relation.relname AS "indexName",
        table_namespace.nspname AS "tableSchema", table_relation.relname AS "tableName",
        access_method.amname AS method,
        i.indisvalid AS valid, i.indisready AS ready, i.indislive AS live,
        i.indisunique AS unique, i.indisprimary AS primary, i.indisexclusion AS exclusion,
        i.indnkeyatts::int AS "keyCount", i.indnatts::int AS "attributeCount",
        pg_get_expr(i.indpred, i.indrelid) AS predicate,
        pg_get_expr(i.indexprs, i.indrelid) AS expressions,
        ARRAY(SELECT pg_get_indexdef(i.indexrelid, ordinal, false)
          FROM generate_series(1, i.indnatts) AS position(ordinal) ORDER BY ordinal) AS columns,
        ARRAY(SELECT pg_index_column_has_property(i.indexrelid, ordinal, 'desc')
          FROM generate_series(1, i.indnkeyatts) AS position(ordinal) ORDER BY ordinal) AS descending,
        ARRAY(SELECT pg_index_column_has_property(i.indexrelid, ordinal, 'nulls_first')
          FROM generate_series(1, i.indnkeyatts) AS position(ordinal) ORDER BY ordinal) AS "nullsFirst",
        pg_get_indexdef(i.indexrelid, 0, false) AS definition
      FROM pg_index i
      JOIN pg_class index_relation ON index_relation.oid = i.indexrelid
      JOIN pg_namespace index_namespace ON index_namespace.oid = index_relation.relnamespace
      JOIN pg_class table_relation ON table_relation.oid = i.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_relation.relnamespace
      JOIN pg_am access_method ON access_method.oid = index_relation.relam
      WHERE index_namespace.nspname = $1 AND index_relation.relname = $2`,
    ['public', FINANCIAL_INDEX_NAME],
  );
  return { name: FINANCIAL_INDEX_NAME, entries: rows };
}

/** Candidate-only installation check; it imposes no planner choice or budget. */
export function assertFinancialIndex(catalog) {
  assert.equal(catalog?.name, FINANCIAL_INDEX_NAME, 'financial index catalog target mismatch');
  assert.ok(Array.isArray(catalog.entries), 'financial index catalog entries are missing');
  assert.equal(catalog.entries.length, 1, 'candidate financial index is missing or ambiguous');
  const expected = {
    indexSchema: 'public',
    indexName: FINANCIAL_INDEX_NAME,
    tableSchema: 'public',
    tableName: 'Booking',
    method: 'btree',
    valid: true,
    ready: true,
    live: true,
    unique: false,
    primary: false,
    exclusion: false,
    keyCount: 4,
    attributeCount: 4,
    predicate: null,
    expressions: null,
    columns: ['status', '"updatedAt"', 'id', '"deletedAt"'],
    descending: [false, true, true, false],
    nullsFirst: [false, true, true, false],
    definition: FINANCIAL_INDEX_DEFINITION,
  };
  for (const [field, value] of Object.entries(expected)) {
    assert.deepEqual(
      catalog.entries[0]?.[field],
      value,
      `candidate financial index ${field} mismatch`,
    );
  }
}

/** pg_stat_statements supplies normalized SQL; no bound identities are retained. */
export async function financialGenericPlans(db, queries) {
  const results = [];
  for (const sql of [...new Set(queries)].filter((query) => /^\s*SELECT/i.test(query))) {
    const statement = statementLabel(sql);
    try {
      const { rows } = await db.query(`EXPLAIN (GENERIC_PLAN, FORMAT JSON) ${sql}`);
      const plan = rows[0]['QUERY PLAN'];
      const scans = scansOf(plan);
      results.push({
        statement,
        sql,
        plan,
        totalCost: plan[0].Plan['Total Cost'],
        scans,
        seqScansOnLargeTables: seqScanFindings(
          scans,
          new Set(['ServiceRequest', 'Bid', 'Booking']),
        ),
      });
    } catch (error) {
      results.push({ statement, sql, error: error.message.slice(0, 160) });
    }
  }
  return results;
}

// All Booking scalar columns, matching findMany's default scalar selection.
// Prisma's exact normalized generic statements remain in report.plans; these
// are labelled parameter-bound equivalent first-page reads, not hydration SQL.
export const FINANCIAL_SCALAR_SQL = `SELECT b.* FROM public."Booking" b
  WHERE b.status = $1::public."BookingStatus" AND b."deletedAt" IS NULL
  ORDER BY b."updatedAt" DESC, b.id DESC LIMIT $2 OFFSET $3`;

export async function financialBoundPlans(db) {
  const results = [];
  for (const limit of [5, 20, 100]) {
    const parameters = ['COMPLETED', limit + 1, 0];
    const plan = (
      await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${FINANCIAL_SCALAR_SQL}`, parameters)
    ).rows[0]['QUERY PLAN'];
    results.push({ limit, parameters, plan, scans: scansOf(plan) });
  }
  return {
    scope: 'parameter-bound equivalent first-page Booking scalar read; excludes relation hydration',
    sql: FINANCIAL_SCALAR_SQL,
    results,
  };
}

/** Missing/failed evidence is an error on either runtime; scans and costs are observations. */
export function assertFinancialPlanEvidence(generic, bound) {
  const completePlan = (plan) =>
    Array.isArray(plan) &&
    plan.length === 1 &&
    typeof plan[0]?.Plan?.['Node Type'] === 'string' &&
    plan[0].Plan['Node Type'].length > 0 &&
    Number.isFinite(plan[0].Plan['Total Cost']);
  assert.ok(Array.isArray(generic) && generic.length > 0, 'financial generic plans are missing');
  for (const row of generic) {
    assert.ok(
      !row.error &&
        typeof row.sql === 'string' &&
        /^\s*SELECT/i.test(row.sql) &&
        completePlan(row.plan),
      'financial generic EXPLAIN failed or is incomplete',
    );
  }
  assert.ok(
    generic.some((row) => scansOf(row.plan).some((scan) => scan.relation === 'Booking')),
    'financial generic evidence has no Booking read',
  );
  assert.equal(bound?.sql, FINANCIAL_SCALAR_SQL, 'financial bound SQL mismatch');
  assert.ok(Array.isArray(bound.results), 'financial bound plans are missing');
  assert.deepEqual(
    bound.results.map((row) => row.limit),
    [5, 20, 100],
    'financial bound limits mismatch',
  );
  for (const row of bound.results) {
    assert.deepEqual(
      row.parameters,
      ['COMPLETED', row.limit + 1, 0],
      'financial bound parameters mismatch',
    );
    assert.ok(
      !row.error && completePlan(row.plan),
      'financial bound EXPLAIN failed or is incomplete',
    );
    assert.ok(
      scansOf(row.plan).some((scan) => scan.relation === 'Booking'),
      'financial bound evidence has no Booking read',
    );
  }
}
