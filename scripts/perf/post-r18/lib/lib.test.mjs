import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  attribute,
  bytesMatching,
  chunksContaining,
  dynamicEntryFor,
  increment,
  initialChunkSet,
  ownerOf,
  sizeOf,
  staticClosure,
} from './bundle-graph.mjs';
import { evaluateBundle, evaluateQueries } from './budgets.mjs';
import { classifyStatements, scansOf, seqScanFindings, statementLabel } from './plans.mjs';
import { percentile, summarize } from './stats.mjs';

const s = (raw) => ({ raw, gzip: raw / 2, brotli: raw / 4 });
const PNPM = '/repo/node_modules/.pnpm/recharts@2.15.2/node_modules/recharts/lib/index.js';

// entry -> shared (static); entry ~> admin (dynamic); admin -> charts, shared.
const chunks = {
  'entry.js': {
    isEntry: true,
    imports: ['shared.js'],
    dynamicImports: ['admin.js'],
    css: ['entry.css'],
    facadeModuleId: 'index.html',
    modules: { '/repo/apps/web/src/main.tsx': 10 },
    sizes: s(100),
  },
  'shared.js': {
    isEntry: false,
    imports: [],
    dynamicImports: [],
    css: [],
    modules: { '/repo/node_modules/.pnpm/react@19/node_modules/react/index.js': 40 },
    sizes: s(40),
  },
  'admin.js': {
    isEntry: false,
    isDynamicEntry: true,
    imports: ['charts.js', 'shared.js'],
    dynamicImports: [],
    css: ['admin.css', 'entry.css'],
    facadeModuleId: 'src/app/pages/AdminPage.tsx',
    modules: { '/repo/apps/web/src/app/components/admin/AdminRouteContent.tsx': 20 },
    sizes: s(20),
  },
  'charts.js': {
    isEntry: false,
    imports: [],
    dynamicImports: [],
    css: [],
    modules: { [PNPM]: 300 },
    sizes: s(300),
  },
};
const assets = { 'entry.css': { sizes: s(8) }, 'admin.css': { sizes: s(4) } };

test('the initial graph is the entry plus its static imports only', () => {
  assert.deepEqual([...initialChunkSet(chunks)].sort(), ['entry.js', 'shared.js']);
});

test('a lazy route costs only what it adds beyond the loaded graph', () => {
  const added = increment(chunks, 'admin.js', initialChunkSet(chunks));
  assert.deepEqual([...added].sort(), ['admin.js', 'charts.js']);
  const size = sizeOf(chunks, assets, added);
  assert.equal(size.js.raw, 320);
  // entry.css is listed by admin too; it is counted once per set, not per chunk.
  assert.equal(size.css.raw, 12);
  assert.equal(size.files, 4);
});

test('an unknown chunk fails loudly instead of under-reporting', () => {
  assert.throws(() => staticClosure(chunks, ['missing.js']), /unknown chunk/);
});

test('pnpm store paths are attributed to the innermost package', () => {
  assert.equal(ownerOf(PNPM), 'recharts');
  assert.equal(
    ownerOf('C:\\r\\node_modules\\.pnpm\\@mui+material@7\\node_modules\\@mui\\material\\Button.js'),
    '@mui/material',
  );
  assert.equal(
    ownerOf('/repo/apps/web/src/app/components/admin/X.tsx'),
    'web:app/components/admin',
  );
  assert.equal(ownerOf('/repo/packages/contracts/src/index.ts'), 'workspace:contracts');
});

test('attribution ranks owners by rendered bytes', () => {
  const ranked = attribute(chunks, new Set(['admin.js', 'charts.js']));
  assert.deepEqual(ranked[0], { owner: 'recharts', renderedBytes: 300 });
});

test('library bytes are summed per set, not flagged by presence', () => {
  assert.equal(bytesMatching(chunks, new Set(['admin.js', 'charts.js']), /recharts/), 300);
  assert.equal(bytesMatching(chunks, new Set(['entry.js', 'shared.js']), /recharts/), 0);
});

test('heavy-library lookup and facade resolution are exact', () => {
  assert.deepEqual(chunksContaining(chunks, /\/node_modules\/recharts\//), ['charts.js']);
  assert.equal(dynamicEntryFor(chunks, 'src/app/pages/AdminPage.tsx'), 'admin.js');
  assert.equal(dynamicEntryFor(chunks, 'src/app/pages/Nope.tsx'), null);
});

test('a lazy page merged into a shared chunk resolves to the chunk that holds it', () => {
  const merged = {
    'entry.js': { ...chunks['entry.js'], dynamicImports: ['mixed.js'] },
    'mixed.js': {
      isEntry: false,
      isDynamicEntry: true,
      imports: [],
      dynamicImports: [],
      css: [],
      facadeModuleId: 'src/app/components/provider/ProviderApp.tsx',
      modules: {
        '/repo/apps/web/src/app/pages/ProviderPage.tsx': 1,
        '/repo/apps/web/src/app/components/provider/ProviderApp.tsx': 9,
      },
      sizes: s(10),
    },
  };
  assert.equal(dynamicEntryFor(merged, 'src/app/pages/ProviderPage.tsx'), 'mixed.js');
});

test('nearest-rank percentiles return observed values', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(sorted, 50), 5);
  assert.equal(percentile(sorted, 95), 10);
  assert.equal(percentile([], 50), null);
  assert.throws(() => percentile(sorted, 0), RangeError);
});

test('small samples do not report tail percentiles', () => {
  const five = summarize([5, 1, 3, 2, 4]);
  assert.equal(five.p50, 3);
  assert.equal(five.p95, null);
  assert.equal(five.p99, null);
  assert.equal(five.confidence, 'median-only');
  const twenty = summarize(Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(twenty.p95, 19);
  assert.equal(twenty.confidence, 'p95-reportable');
});

test('failed observations are counted, not dropped silently', () => {
  const result = summarize([1, Number.NaN, 2, undefined, Infinity]);
  assert.equal(result.n, 2);
  assert.equal(result.invalid, 3);
});

// ── budgets ──────────────────────────────────────────────────────────────────

const budgets = {
  bundle: {
    shellJsBrotliKiBMax: 10,
    journeyIncrementJsBrotliKiBMax: { admin: 5 },
    librariesForbiddenOutsideJourneys: { recharts: ['admin-dashboard-charts'] },
  },
  queries: {
    seqScanOnLargeTables: { tables: ['Bid'], minRowsInDataset: 1000, allowed: [] },
    statementsPerRequestMax: { 'provider bids': 4 },
  },
};
const kib = (n) => ({ js: { brotli: n * 1024 } });

test('bundle budgets flag an oversized journey and a misplaced library', () => {
  const findings = evaluateBundle(budgets, {
    shell: kib(9),
    journeys: [{ name: 'admin', increment: kib(6) }],
    heavyLibraries: {
      recharts: { renderedBytesInShell: 0, renderedBytesByJourney: { admin: 500 } },
    },
  });
  assert.deepEqual(
    findings.map((f) => f.pass),
    [true, false, false],
  );
  assert.equal(findings[2].actual, 'admin');
});

test('a library in the shell is always an offender', () => {
  const [, finding] = evaluateBundle(
    { ...budgets, bundle: { ...budgets.bundle, journeyIncrementJsBrotliKiBMax: {} } },
    {
      shell: kib(1),
      journeys: [],
      heavyLibraries: { recharts: { renderedBytesInShell: 1, renderedBytesByJourney: {} } },
    },
  );
  assert.equal(finding.pass, false);
  assert.equal(finding.actual, 'shell');
});

test('query budgets fail N+1, large-table seq scans and statement growth', () => {
  const findings = evaluateQueries(budgets, {
    dataset: { amplification: { rowCountsAfter: { Bid: 5000 } } },
    pageSizeInvariance: { 'admin users': { verdict: 'N+1' } },
    plans: { 'provider bids': [{ scans: [{ node: 'Seq Scan', relation: 'Bid' }] }] },
    phases: { amplified: { scenarios: { 'provider bids': { statements: 5 } } } },
  });
  assert.deepEqual(
    findings.map((f) => [f.check, f.pass]),
    [
      ['page-size invariance: admin users', false],
      ['no seq scan on large tables: provider bids', false],
      ['statements: provider bids', false],
    ],
  );
});

test('a seq scan on a table below the size threshold is not a finding', () => {
  const [finding] = evaluateQueries(budgets, {
    dataset: { amplification: { rowCountsAfter: { Bid: 40 } } },
    plans: { x: [{ scans: [{ node: 'Seq Scan', relation: 'Bid' }] }] },
  });
  assert.equal(finding.pass, true);
});

test('statement classification separates transaction control from reads', () => {
  const result = classifyStatements([
    { query: 'BEGIN', calls: 2 },
    { query: 'COMMIT', calls: 2 },
    { query: 'SELECT "public"."Bid"."id" FROM "public"."Bid" WHERE 1=1', calls: 3 },
  ]);
  assert.equal(result.statements, 3);
  assert.equal(result.control, 4);
  assert.equal(statementLabel(result.data[0].query), 'SELECT Bid');
});

test('plan walking finds nested scans and filters by table size', () => {
  const plan = [
    {
      Plan: {
        'Node Type': 'Nested Loop',
        Plans: [
          { 'Node Type': 'Seq Scan', 'Relation Name': 'Bid', 'Plan Rows': 900 },
          {
            'Node Type': 'Index Scan',
            'Relation Name': 'User',
            'Index Name': 'User_pkey',
            'Plan Rows': 1,
          },
        ],
      },
    },
  ];
  const scans = scansOf(plan);
  assert.equal(scans.length, 2);
  assert.deepEqual(seqScanFindings(scans, new Set(['Bid'])), ['Bid (est. 900 rows)']);
  assert.deepEqual(seqScanFindings(scans, new Set(['Booking'])), []);
});
