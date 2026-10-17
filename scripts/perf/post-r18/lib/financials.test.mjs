import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FINANCIAL_INDEX_NAME,
  FINANCIAL_SCALAR_SQL,
  assertFinancialIndex,
  assertFinancialIntegrity,
  assertFinancialPage,
  assertFinancialPlanEvidence,
  cursorMutationObservation,
  financialBoundPlans,
  financialGenericPlans,
  financialIndexCatalog,
  walkFinancialPages,
} from './financials.mjs';

// Contract doubles validate the evidence assertions themselves. Real guarded
// HTTP/database pages are measured separately by the unchanged R27 workflow.
function rows(count = 23) {
  return Array.from({ length: count }, (_, index) => ({
    id: `booking-${String(count - index).padStart(3, '0')}`,
    priceAmount: 105 + index,
    currency: index % 2 ? 'USD' : 'EUR',
    providerId: 'provider-1',
    seekerUserId: 'seeker-1',
    // Deliberate equal timestamps make an id-order regression observable.
    updatedAt: new Date('2026-10-17T12:00:00.000Z'),
  }));
}

function page(expected, offset = 0, limit = 5) {
  const items = expected.slice(offset, offset + limit).map((row) => ({
    id: row.id,
    bookingId: row.id,
    amount: row.priceAmount,
    platformFee: Math.round(row.priceAmount / 10),
    netAmount: row.priceAmount - Math.round(row.priceAmount / 10),
    currency: row.currency,
    occurredAt: row.updatedAt.toISOString(),
    provider: { id: row.providerId },
    seeker: { id: row.seekerUserId },
  }));
  return {
    status: 200,
    body: { items, nextCursor: offset + limit < expected.length ? items.at(-1).id : null },
  };
}

test('financial evidence preserves mixed currencies, rounding and deterministic timestamp ties', () => {
  const expected = rows();
  assert.equal(assertFinancialPage(page(expected), expected, 0, 5).length, 5);
  assert.equal(assertFinancialPage(page(expected, 20), expected, 20, 5).length, 3);
  const maximum = rows(120);
  assert.equal(assertFinancialPage(page(maximum, 0, 100), maximum, 0, 100).length, 100);
});

const changes = {
  'unauthorized response': (response) => {
    response.status = 403;
  },
  'missing body': (response) => {
    response.body = null;
  },
  'missing items': (response) => {
    delete response.body.items;
  },
  'omitted row': (response) => {
    response.body.items.pop();
  },
  'extra row': (response) => {
    response.body.items.push(response.body.items[0]);
  },
  'duplicate row': (response) => {
    response.body.items[1] = response.body.items[0];
  },
  'wrong equal-time ordering': (response) => {
    response.body.items.reverse();
  },
  'wrong booking identity': (response) => {
    response.body.items[0].bookingId = 'foreign';
  },
  'changed amount': (response) => {
    response.body.items[0].amount++;
  },
  'changed currency': (response) => {
    response.body.items[0].currency = 'GBP';
  },
  'wrong provider': (response) => {
    response.body.items[0].provider.id = 'foreign';
  },
  'wrong seeker': (response) => {
    response.body.items[0].seeker.id = 'foreign';
  },
  'fractional fee': (response) => {
    response.body.items[0].platformFee = 1.5;
  },
  'negative net amount': (response) => {
    response.body.items[0].netAmount = -1;
  },
  'changed fee with matching gross': (response) => {
    response.body.items[0].platformFee++;
    response.body.items[0].netAmount--;
  },
  'changed net amount': (response) => {
    response.body.items[0].netAmount++;
  },
  'changed occurrence time': (response) => {
    response.body.items[0].occurredAt = '2026-10-18T12:00:00.000Z';
  },
  'early termination': (response) => {
    response.body.nextCursor = null;
  },
  'unrelated cursor': (response) => {
    response.body.nextCursor = 'foreign';
  },
};
for (const [name, change] of Object.entries(changes)) {
  test(`financial evidence refuses ${name}`, () => {
    const expected = rows();
    const response = page(expected);
    change(response);
    assert.throws(() => assertFinancialPage(response, expected, 0, 5));
  });
}

test('financial evidence refuses a manufactured cursor after the final page', () => {
  const expected = rows();
  const response = page(expected, 20);
  response.body.nextCursor = response.body.items.at(-1).id;
  assert.throws(() => assertFinancialPage(response, expected, 20, 5), /termination/);
});

test('financial evidence rejects unsupported limits and offsets', () => {
  for (const limit of [0, 101, 1.5, NaN])
    assert.throws(() => assertFinancialPage(page(rows()), rows(), 0, limit), /limit/);
  for (const offset of [-1, 0.5, NaN])
    assert.throws(() => assertFinancialPage(page(rows()), rows(), offset, 5), /offset/);
});

test('financial walk proves every page against complete ordered database truth', async () => {
  const expected = rows();
  const paths = [];
  const result = await walkFinancialPages(
    async (path) => {
      paths.push(path);
      const query = new URL(path, 'https://fixture.invalid').searchParams;
      const cursor = query.get('cursor');
      const offset = cursor ? expected.findIndex((row) => row.id === cursor) + 1 : 0;
      return page(expected, offset, Number(query.get('limit')));
    },
    expected,
    5,
  );
  assert.equal(paths.length, 5);
  assert.equal(result.distinctItems, expected.length);
  assert.equal(result.duplicates, 0);
  assert.equal(result.terminated, true);
  assert.match(paths[1], /cursor=booking-019/);
});

test('financial walk cannot certify an empty or single-page fixture', async () => {
  for (const expected of [[], rows(5)])
    await assert.rejects(
      walkFinancialPages(async () => page(expected), expected, 5),
      /multiple populated pages/,
    );
});

test('a repeated page cannot yield a successful financial walk', async () => {
  const expected = rows();
  await assert.rejects(
    walkFinancialPages(async () => page(expected), expected, 5),
    /order\/visibility/,
  );
});

test('monetary integrity evidence fails if an original row or ledger fingerprint changes', () => {
  const before = {
    originalBookings: { count: 18, digest: 'original' },
    ledger: {
      LedgerAccount: { count: 1, digest: 'account' },
      LedgerEntry: { count: 2, digest: 'entry' },
    },
  };
  assertFinancialIntegrity(before, structuredClone(before));
  for (const mutate of [
    (snapshot) => {
      snapshot.originalBookings.count--;
    },
    (snapshot) => {
      snapshot.originalBookings.digest = 'changed';
    },
    (snapshot) => {
      snapshot.ledger.LedgerEntry.count++;
    },
    (snapshot) => {
      snapshot.ledger.LedgerAccount.digest = 'changed';
    },
  ]) {
    const after = structuredClone(before);
    mutate(after);
    assert.throws(() => assertFinancialIntegrity(before, after), /original booking or ledger/);
  }
});

test('cursor mutation records duplicates and omissions without asserting snapshot safety', () => {
  assert.deepEqual(cursorMutationObservation(['a', 'b'], ['c', 'd'], ['a', 'c']), {
    classification: 'MUTABLE_CURSOR_REORDERS_PAGE',
    duplicatesFromEarlierPages: 1,
    omittedFromOriginalNextPage: 1,
    snapshotGuarantee: false,
  });
});

test('an unchanged observed page does not invent a snapshot guarantee', () => {
  assert.deepEqual(cursorMutationObservation(['a', 'b'], ['c', 'd'], ['c', 'd']), {
    classification: 'NO_REORDER_OBSERVED',
    duplicatesFromEarlierPages: 0,
    omittedFromOriginalNextPage: 0,
    snapshotGuarantee: false,
  });
});

function indexCatalog() {
  return {
    name: FINANCIAL_INDEX_NAME,
    entries: [
      {
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
        definition:
          'CREATE INDEX "Booking_status_updatedAt_id_deletedAt_idx" ON public."Booking" USING btree (status, "updatedAt" DESC, id DESC, "deletedAt")',
      },
    ],
  };
}

test('catalog collection records frozen baseline absence without requiring installation', async () => {
  const calls = [];
  const catalog = await financialIndexCatalog({
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rows: [] };
    },
  });
  assert.deepEqual(catalog, { name: FINANCIAL_INDEX_NAME, entries: [] });
  assert.deepEqual(calls[0].parameters, ['public', FINANCIAL_INDEX_NAME]);
  assert.match(calls[0].sql, /^SELECT/);
  assert.throws(() => assertFinancialIndex(catalog), /candidate financial index is missing/);
});

test('catalog collection retains PostgreSQL metadata and does not conceal query failures', async () => {
  const expected = indexCatalog();
  const catalog = await financialIndexCatalog({ query: async () => ({ rows: expected.entries }) });
  assert.deepEqual(catalog, expected);
  assertFinancialIndex(catalog);
  await assert.rejects(
    financialIndexCatalog({
      query: async () => {
        throw Error('catalog unavailable');
      },
    }),
    /catalog unavailable/,
  );
});

test('candidate cannot certify absent, ambiguous or malformed index catalog evidence', () => {
  for (const catalog of [
    null,
    {},
    { name: FINANCIAL_INDEX_NAME, entries: null },
    { name: FINANCIAL_INDEX_NAME, entries: [] },
    { name: FINANCIAL_INDEX_NAME, entries: [null] },
    { name: FINANCIAL_INDEX_NAME, entries: [...indexCatalog().entries, ...indexCatalog().entries] },
  ]) {
    assert.throws(() => assertFinancialIndex(catalog), /financial index/);
  }
});

const catalogChanges = {
  indexSchema: 'other',
  indexName: 'legacy_index',
  tableSchema: 'other',
  tableName: 'Bid',
  method: 'hash',
  valid: false,
  ready: false,
  live: false,
  unique: true,
  primary: true,
  exclusion: true,
  keyCount: 3,
  attributeCount: 5,
  predicate: "status = 'COMPLETED'",
  expressions: 'lower(id)',
  columns: ['status', '"deletedAt"', '"updatedAt"', 'id'],
  descending: [false, true, false, false],
  nullsFirst: [false, false, true, false],
  definition: indexCatalog().entries[0].definition + ' WHERE ("deletedAt" IS NULL)',
};
for (const [field, value] of Object.entries(catalogChanges)) {
  test(`candidate refuses financial index ${field} drift`, () => {
    const catalog = indexCatalog();
    catalog.entries[0][field] = value;
    assert.throws(() => assertFinancialIndex(catalog), /candidate financial index.*mismatch/);
  });
}

function explainEvidence() {
  // A costly sequential scan is valid measured evidence. Neither planner
  // selection nor a latency/cost proposal is an installation assertion.
  const plan = [
    {
      Plan: {
        'Node Type': 'Seq Scan',
        'Relation Name': 'Booking',
        'Total Cost': 1_000_000_000,
        'Plan Rows': 1626,
        'Plan Width': 197,
      },
    },
  ];
  return {
    generic: [{ sql: FINANCIAL_SCALAR_SQL, plan }],
    bound: {
      sql: FINANCIAL_SCALAR_SQL,
      results: [5, 20, 100].map((limit) => ({
        limit,
        parameters: ['COMPLETED', limit + 1, 0],
        plan: structuredClone(plan),
      })),
    },
  };
}

test('generic financial capture retains complete normalized SQL and raw plans without bound identities', async () => {
  const plan = explainEvidence().generic[0].plan;
  const sql = 'SELECT "public"."Booking"."id" FROM "public"."Booking" WHERE status = $1';
  const calls = [];
  const result = await financialGenericPlans(
    {
      query: async (...args) => {
        calls.push(args);
        return { rows: [{ 'QUERY PLAN': plan }] };
      },
    },
    ['BEGIN', sql, sql],
  );
  assert.deepEqual(calls, [[`EXPLAIN (GENERIC_PLAN, FORMAT JSON) ${sql}`]]);
  assert.equal(result.length, 1);
  assert.equal(result[0].sql, sql);
  assert.deepEqual(result[0].plan, plan);
  assert.deepEqual(result[0].seqScansOnLargeTables, ['Booking (est. 1626 rows)']);
  assert.ok(!Object.hasOwn(result[0], 'parameters'));
});

test('failed generic financial capture remains a failure with its normalized statement', async () => {
  const result = await financialGenericPlans(
    {
      query: async () => {
        throw Error('EXPLAIN failed');
      },
    },
    [FINANCIAL_SCALAR_SQL],
  );
  assert.equal(result[0].sql, FINANCIAL_SCALAR_SQL);
  assert.equal(result[0].error, 'EXPLAIN failed');
  assert.throws(
    () => assertFinancialPlanEvidence(result, explainEvidence().bound),
    /generic EXPLAIN failed/,
  );
});

test('bound financial capture retains all measured limits and accepts costly sequential plans', async () => {
  const { generic, bound: expected } = explainEvidence();
  const calls = [];
  const bound = await financialBoundPlans({
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return { rows: [{ 'QUERY PLAN': generic[0].plan }] };
    },
  });
  assert.deepEqual(
    calls.map((call) => call.parameters),
    expected.results.map((row) => row.parameters),
  );
  for (const call of calls)
    assert.equal(call.sql, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${FINANCIAL_SCALAR_SQL}`);
  assertFinancialPlanEvidence(generic, bound);
});

const explainChanges = {
  'empty generic collection': (evidence) => {
    evidence.generic = [];
  },
  'missing generic SQL': (evidence) => {
    delete evidence.generic[0].sql;
  },
  'generic execution error': (evidence) => {
    evidence.generic[0].error = 'failure';
  },
  'missing generic raw plan': (evidence) => {
    delete evidence.generic[0].plan;
  },
  'empty generic raw plan': (evidence) => {
    evidence.generic[0].plan = [];
  },
  'malformed generic root': (evidence) => {
    evidence.generic[0].plan = [{ Plan: {} }];
  },
  'invalid generic cost': (evidence) => {
    evidence.generic[0].plan[0].Plan['Total Cost'] = NaN;
  },
  'no generic Booking read': (evidence) => {
    evidence.generic[0].plan[0].Plan['Relation Name'] = 'User';
  },
  'missing bound evidence': (evidence) => {
    evidence.bound = null;
  },
  'wrong bound projection': (evidence) => {
    evidence.bound.sql = 'SELECT id FROM "Booking"';
  },
  'missing bound collection': (evidence) => {
    delete evidence.bound.results;
  },
  'missing maximum page plan': (evidence) => {
    evidence.bound.results.pop();
  },
  'wrong bound parameters': (evidence) => {
    evidence.bound.results[0].parameters[0] = 'SCHEDULED';
  },
  'bound execution error': (evidence) => {
    evidence.bound.results[0].error = 'failure';
  },
  'empty bound raw plan': (evidence) => {
    evidence.bound.results[0].plan = [];
  },
  'no bound Booking read': (evidence) => {
    evidence.bound.results[0].plan[0].Plan['Relation Name'] = 'User';
  },
};
for (const [name, mutate] of Object.entries(explainChanges)) {
  test(`financial evidence refuses ${name}`, () => {
    const evidence = explainEvidence();
    mutate(evidence);
    assert.throws(() => assertFinancialPlanEvidence(evidence.generic, evidence.bound), /financial/);
  });
}
