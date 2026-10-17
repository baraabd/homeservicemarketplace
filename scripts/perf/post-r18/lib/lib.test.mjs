import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
import { dirtyPathsFromPorcelain } from './provenance.mjs';
import { compareReports, numericDelta, readReports } from '../compare-reports.mjs';

test('provenance preserves unstaged status columns and unusual filenames', () => {
  assert.deepEqual(
    dirtyPathsFromPorcelain(' M scripts/perf/post-r18/api-boot.mjs\0?? spaced\nname.txt\0'),
    ['scripts/perf/post-r18/api-boot.mjs', 'spaced\nname.txt'],
  );
  assert.deepEqual(dirtyPathsFromPorcelain(''), []);
});

test('provenance includes both sides of a rename without interpreting filename status text', () => {
  assert.deepEqual(dirtyPathsFromPorcelain('R  new-name.txt\0old-name.txt\0 M new-name.txt\0'), [
    'new-name.txt',
    'old-name.txt',
  ]);
  assert.throws(() => dirtyPathsFromPorcelain('R  missing-source\0'), /missing git rename/);
  assert.throws(() => dirtyPathsFromPorcelain('M malformed\0'), /invalid git porcelain/);
});

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

// The fixture uses the retained JSON schemas: named bundle journeys,
// per-phase query scenarios and raw browser rows (not invented percentiles).
function comparisonFixture(commit = 'a') {
  const source = {
    commit: commit.repeat(40),
    tree: commit.repeat(40),
    measurementHarnessCommit: 'c'.repeat(40),
    lockfileSha256: 'd'.repeat(64),
  };
  const common = { schemaVersion: 1, source };
  const counts = { User: 15, ServiceRequest: 10836, Bid: 43344, Booking: 5418 };
  const scenario = {
    path: '/v1/admin/users',
    status: 200,
    items: 15,
    statements: 52,
    latency: summarize([4, 5, 6]),
  };
  return [
    {
      ...common,
      kind: 'r27-bundle-report',
      compression: { gzip: 1, brotli: 11 },
      toolchain: { vite: '6.4.3' },
      buildFlags: {},
      overlays: [],
      journeys: [{ name: 'admin', total: { js: { raw: 100, gzip: 50, brotli: 25 } } }],
    },
    {
      ...common,
      kind: 'r27-api-boot',
      environment: { profile: 'production', workers: 'off' },
      runs: [0, 1, 2].map((run) => ({
        run,
        cache: run ? 'warm-os-cache' : 'first-boot-in-session',
        readyMs: 100 + run,
        rssMiBAtReady: 200,
      })),
    },
    {
      ...common,
      kind: 'r27-query-profile',
      environment: { profile: 'fixture', repeatsPerScenario: 3 },
      dataset: {
        realApi: { seekers: 6, providers: 4 },
        amplification: { copies: 300, rowCountsAfter: counts },
      },
      phases: { amplified: { rowCounts: counts, scenarios: { 'admin users': scenario } } },
      pageSizeInvariance: {
        'admin users': {
          5: { items: 5, statements: 22 },
          20: { items: 15, statements: 52 },
          verdict: 'N+1',
        },
      },
      workloads: [
        {
          name: 'normal',
          concurrency: 2,
          requests: 200,
          cache: 'warm',
          errorRate: 0,
          latencyMs: summarize(Array(200).fill(4)),
        },
      ],
    },
    {
      kind: 'r27-real-browser',
      mode: 'production',
      project: 'desktop-en',
      source: source.commit,
      sourceTree: source.tree,
      harness: source.measurementHarnessCommit,
      browser: '151',
      viewport: { width: 1440, height: 900 },
      results: ['seeker', 'admin'].flatMap((role) =>
        [0, 1, 2].flatMap((repetition) => [
          { role, repetition, cache: 'cold-browser', usefulUiMs: 200 },
          { role, repetition, cache: 'warm-browser', usefulUiMs: 100 },
          { role, repetition, keyboardTransitionMs: 50 },
        ]),
      ),
    },
  ];
}

test('comparison rejects mixed harnesses, source commits and lockfiles', () => {
  const baseline = comparisonFixture();
  for (const key of ['measurementHarnessCommit', 'commit', 'tree', 'lockfileSha256']) {
    const candidate = comparisonFixture('b');
    candidate[1].source = {
      ...candidate[1].source,
      [key]: 'e'.repeat(key === 'lockfileSha256' ? 64 : 40),
    };
    assert.throws(() => compareReports(baseline, candidate), /incomparable.*source/);
  }
  const candidate = comparisonFixture('b');
  for (const report of candidate.slice(0, 3))
    report.source.measurementHarnessCommit = 'e'.repeat(40);
  candidate[3].harness = 'e'.repeat(40);
  assert.throws(() => compareReports(baseline, candidate), /incomparable measurementHarnessCommit/);
});

test('comparison refuses changed datasets, schemas and workload concurrency', () => {
  for (const change of [
    (reports) => {
      reports[2].dataset.amplification.copies = 301;
    },
    (reports) => {
      reports[2].schemaVersion = 2;
    },
    (reports) => {
      reports[2].workloads[0].concurrency = 16;
    },
  ]) {
    const candidate = comparisonFixture('b');
    change(candidate);
    assert.throws(() => compareReports(comparisonFixture(), candidate), /incomparable|unsupported/);
  }
});

test('partial locale/mode evidence remains pending and small samples have no tail percentiles', () => {
  const result = compareReports(comparisonFixture(), comparisonFixture('b'));
  assert.equal(result.browser.status, 'PENDING_INCOMPLETE_MATRIX');
  assert.ok(result.browser.missing.some((key) => key.includes('/development/mobile-ar/')));
  assert.equal(result.boot.readyMs.baseline.n, 3);
  assert.equal('p95' in result.boot.readyMs.baseline, false);
  assert.equal(
    'p99' in
      result.browser.cells['production/desktop-en']['admin/cold-browser'].usefulUiMs.baseline,
    false,
  );
  assert.equal(result.workloads.normal.latencyMs.baseline.p99, 4);
});

test('comparison discovers nested retained-schema JSON and ignores unrelated artifact JSON', () => {
  const directory = mkdtempSync(join(tmpdir(), 'r27-compare-'));
  try {
    mkdirSync(join(directory, 'browser'));
    const reports = comparisonFixture();
    reports[0].source.dirtyPaths = ['cripts/perf/post-r18/api-boot-profile.mjs'];
    reports.forEach((report, index) =>
      writeFileSync(
        join(directory, index === 3 ? 'browser/desktop-en.json' : `${index}.json`),
        JSON.stringify(report),
      ),
    );
    writeFileSync(join(directory, 'unrelated.json'), JSON.stringify({ kind: 'other' }));
    const result = compareReports(readReports(directory), comparisonFixture('b'));
    assert.equal(result.bundle.admin['total/js'].brotli.baseline, 25);
    assert.equal(result.queries.amplified['admin users'].statements.baseline, 52);
    assert.equal(result.pageScaling['admin users']['20'].items.baseline, 15);
    assert.match(result.provenanceWarnings[0], /historical porcelain/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('numeric deltas preserve zeros and unknowns without invented percentages', () => {
  assert.deepEqual(numericDelta(0, 5), { baseline: 0, candidate: 5, delta: 5 });
  assert.deepEqual(numericDelta(0, 0), { baseline: 0, candidate: 0, delta: 0 });
  assert.deepEqual(numericDelta(null, 5), { baseline: null, candidate: 5 });
  assert.deepEqual(numericDelta(5, Number.NaN), { baseline: 5, candidate: null });
  assert.deepEqual(numericDelta(10, 5), {
    baseline: 10,
    candidate: 5,
    delta: -5,
    deltaPercent: -50,
  });
});
