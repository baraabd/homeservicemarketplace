// Compare retained R27 artifacts without turning incomplete evidence into acceptance.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { summarize } from './lib/stats.mjs';

const KINDS = ['r27-bundle-report', 'r27-api-boot', 'r27-query-profile'];
const OPTIONAL = ['r27-api-boot-profile', 'r27-real-browser'];
const PROJECTS = ['desktop-en', 'mobile-ar', 'desktop-ar', 'mobile-en'];
const MODES = ['production', 'development'];
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const same = (a, b, label) => assert.deepEqual(a, b, `incomparable ${label}`);

export function numericDelta(baseline, candidate) {
  const result = {
    baseline: finite(baseline) ? baseline : null,
    candidate: finite(candidate) ? candidate : null,
  };
  if (finite(baseline) && finite(candidate)) {
    result.delta = candidate - baseline;
    if (baseline !== 0) result.deltaPercent = ((candidate - baseline) / baseline) * 100;
  }
  return result;
}

export function readReports(directory) {
  const reports = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) reports.push(...readReports(path));
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      const report = JSON.parse(readFileSync(path, 'utf8'));
      if ([...KINDS, ...OPTIONAL].includes(report.kind)) reports.push(report);
    }
  }
  return reports;
}

function validate(reports) {
  const indexed = {};
  const browsers = [];
  for (const report of reports) {
    assert.ok([...KINDS, ...OPTIONAL].includes(report.kind), 'unknown report kind');
    if (report.kind === 'r27-real-browser') {
      assert.ok(
        report.schemaVersion === undefined || report.schemaVersion === 1,
        'unsupported browser schema',
      );
      assert.ok(
        MODES.includes(report.mode) && PROJECTS.includes(report.project),
        'unknown browser matrix cell',
      );
      assert.ok(Array.isArray(report.results), 'missing browser observations');
      assert.ok(
        !browsers.some((r) => r.mode === report.mode && r.project === report.project),
        'duplicate browser matrix cell',
      );
      browsers.push(report);
    } else {
      assert.equal(report.schemaVersion, 1, 'unsupported report schema');
      assert.ok(!indexed[report.kind], 'duplicate report kind');
      indexed[report.kind] = report;
    }
  }
  for (const kind of KINDS) assert.ok(indexed[kind], `missing ${kind}`);
  const source = indexed[KINDS[0]].source;
  for (const key of ['commit', 'tree', 'measurementHarnessCommit'])
    assert.match(source?.[key] ?? '', /^[a-f0-9]{40}$/, `missing source ${key}`);
  assert.match(source.lockfileSha256 ?? '', /^[a-f0-9]{64}$/, 'missing lockfile digest');
  for (const report of Object.values(indexed)) {
    for (const key of ['commit', 'tree', 'measurementHarnessCommit', 'lockfileSha256'])
      same(report.source?.[key], source[key], `source ${key} within artifact directory`);
  }
  for (const report of browsers) {
    same(report.source, source.commit, 'browser source');
    same(report.sourceTree, source.tree, 'browser source tree');
    same(report.harness, source.measurementHarnessCommit, 'browser harness');
  }
  return {
    bundle: indexed[KINDS[0]],
    boot: indexed[KINDS[1]],
    query: indexed[KINDS[2]],
    browsers,
    source,
  };
}

function metrics(a, b, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => finite(a?.[key]) || finite(b?.[key]))
      .map((key) => [key, numericDelta(a?.[key], b?.[key])]),
  );
}

function summaryPair(a, b) {
  const clean = (value) => {
    if (!value || !Number.isInteger(value.n) || value.n < 0) return null;
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key]) => !(key === 'p95' && value.n < 20) && !(key === 'p99' && value.n < 100),
      ),
    );
  };
  return { baseline: clean(a), candidate: clean(b), p50: numericDelta(a?.p50, b?.p50) };
}

function observations(a, b, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => [...a, ...b].some((r) => key in r))
      .map((key) => [
        key,
        summaryPair(summarize(a.map((r) => r[key])), summarize(b.map((r) => r[key]))),
      ]),
  );
}

function browserComparison(a, b) {
  const missing = [];
  const cells = {};
  for (const mode of MODES)
    for (const project of PROJECTS) {
      const reports = [a, b].map((side) =>
        side.browsers.find((r) => r.mode === mode && r.project === project),
      );
      if (reports.every(Boolean)) {
        for (const key of ['browser', 'viewport', 'fixtureThrottleIsolation'])
          same(reports[0][key], reports[1][key], `browser ${key}`);
      }
      const groups = {};
      for (const role of ['seeker', 'admin'])
        for (const cache of ['cold-browser', 'warm-browser', 'transition']) {
          const rows = reports.map((report) =>
            (report?.results ?? []).filter(
              (r) =>
                r.role === role &&
                (cache === 'transition' ? 'keyboardTransitionMs' in r : r.cache === cache),
            ),
          );
          for (let side = 0; side < 2; side++) {
            const repetitions = rows[side].map((r) => r.repetition).sort();
            assert.equal(
              new Set(repetitions).size,
              repetitions.length,
              'duplicate browser repetition',
            );
            if (JSON.stringify(repetitions) !== '[0,1,2]')
              missing.push(
                `${side === 0 ? 'baseline' : 'candidate'}/${mode}/${project}/${role}/${cache}`,
              );
          }
          if (rows.some((items) => items.length))
            groups[`${role}/${cache}`] = observations(rows[0], rows[1], [
              'usefulUiMs',
              'documentTtfbMs',
              'domContentLoadedMs',
              'scriptTransferBytes',
              'scriptEncodedBytes',
              'scriptDurationMs',
              'keyboardTransitionMs',
            ]);
        }
      if (Object.keys(groups).length) cells[`${mode}/${project}`] = groups;
    }
  return {
    status: missing.length ? 'PENDING_INCOMPLETE_MATRIX' : 'OBSERVED_COMPLETE_MATRIX',
    missing,
    cells,
  };
}

export function compareReports(baselineReports, candidateReports) {
  const a = validate(baselineReports),
    b = validate(candidateReports);
  for (const key of ['measurementHarnessCommit', 'lockfileSha256'])
    same(a.source[key], b.source[key], key);
  for (const key of ['compression', 'toolchain', 'buildFlags', 'overlays'])
    same(a.bundle[key], b.bundle[key], `bundle ${key}`);
  for (const key of ['environment', 'dataset']) {
    assert.ok(a.query[key] && b.query[key], `missing query ${key}`);
    same(a.query[key], b.query[key], `query ${key}`);
  }
  assert.ok(
    a.query.dataset.realApi && a.query.dataset.amplification?.rowCountsAfter,
    'missing dataset provenance',
  );
  same(a.boot.environment, b.boot.environment, 'boot environment');
  assert.ok(Array.isArray(a.boot.runs) && Array.isArray(b.boot.runs), 'missing boot observations');
  same(
    a.boot.runs.map((r) => r.cache),
    b.boot.runs.map((r) => r.cache),
    'boot sample/cache design',
  );
  const bundle = {};
  same(
    a.bundle.journeys.map((r) => r.name).sort(),
    b.bundle.journeys.map((r) => r.name).sort(),
    'bundle journeys',
  );
  for (const left of a.bundle.journeys) {
    const right = b.bundle.journeys.find((r) => r.name === left.name);
    bundle[left.name] = {};
    for (const part of ['total', 'increment'])
      for (const type of ['js', 'css']) {
        const value = metrics(left[part]?.[type], right[part]?.[type], ['raw', 'gzip', 'brotli']);
        if (Object.keys(value).length) bundle[left.name][`${part}/${type}`] = value;
      }
  }
  const queries = {};
  same(Object.keys(a.query.phases).sort(), Object.keys(b.query.phases).sort(), 'query phases');
  for (const phase of Object.keys(a.query.phases)) {
    const left = a.query.phases[phase],
      right = b.query.phases[phase];
    same(left.rowCounts, right.rowCounts, `dataset rows for ${phase}`);
    same(
      Object.keys(left.scenarios).sort(),
      Object.keys(right.scenarios).sort(),
      `query scenarios ${phase}`,
    );
    queries[phase] = {};
    for (const name of Object.keys(left.scenarios)) {
      const x = left.scenarios[name],
        y = right.scenarios[name];
      same(x.path, y.path, 'query endpoint');
      queries[phase][name] = {
        ...metrics(x, y, ['status', 'items', 'statements', 'dbTimeMs', 'responseBytes']),
        latency: summaryPair(x.latency, y.latency),
      };
    }
  }
  const pageScaling = {};
  same(
    Object.keys(a.query.pageSizeInvariance).sort(),
    Object.keys(b.query.pageSizeInvariance).sort(),
    'page scaling scenarios',
  );
  for (const name of Object.keys(a.query.pageSizeInvariance)) {
    const x = a.query.pageSizeInvariance[name],
      y = b.query.pageSizeInvariance[name];
    same(Object.keys(x).sort(), Object.keys(y).sort(), 'page sizes');
    pageScaling[name] = { verdict: { baseline: x.verdict, candidate: y.verdict } };
    for (const size of Object.keys(x).filter((key) => key !== 'verdict'))
      pageScaling[name][size] = metrics(x[size], y[size], ['status', 'items', 'statements']);
  }
  const workloads = {};
  same(
    (a.query.workloads ?? []).map((r) => r.name).sort(),
    (b.query.workloads ?? []).map((r) => r.name).sort(),
    'workload names',
  );
  for (const x of a.query.workloads ?? []) {
    const y = b.query.workloads.find((r) => r.name === x.name);
    for (const key of ['concurrency', 'requests', 'cache']) same(x[key], y[key], `workload ${key}`);
    workloads[x.name] = {
      ...metrics(x, y, [
        'concurrency',
        'requests',
        'errorRate',
        'elapsedSeconds',
        'apiCpuSeconds',
        'apiRssPeakMiB',
      ]),
      latencyMs: summaryPair(x.latencyMs, y.latencyMs),
      statusCounts: { baseline: x.statusCounts, candidate: y.statusCounts },
    };
  }
  return {
    schemaVersion: 1,
    kind: 'r27-comparison',
    status: 'MEASURED_NOT_RELEASE_ACCEPTED',
    source: { baseline: a.source, candidate: b.source },
    provenanceWarnings: [a, b].flatMap((side, index) =>
      side.source.dirtyPaths?.some((path) => path.startsWith('cripts/perf/post-r18/'))
        ? [
            `${index === 0 ? 'baseline' : 'candidate'}: historical porcelain parsing truncated a dirty-path prefix; retained verbatim. Commit/tree/harness/lock identities were still checked.`,
          ]
        : [],
    ),
    hosts: { baseline: a.bundle.host, candidate: b.bundle.host },
    dataset: a.query.dataset,
    bundle,
    boot: observations(a.boot.runs, b.boot.runs, [
      'liveMs',
      'readyMs',
      'rssMiBAtReady',
      'rssMiBAfterProbes',
    ]),
    overload: { baseline: a.boot.overload, candidate: b.boot.overload },
    queries,
    pageScaling,
    workloads,
    browser: browserComparison(a, b),
    limits: [
      'Same harness and declared dataset; separate hosts and run times remain potential confounders. No production capacity or release acceptance claim.',
      'Boot/browser statistics use recorded observations only. Query/workload statistics are retained summaries, not reconstructed raw samples.',
      'p95 omitted below 20 observations; p99 omitted below 100. Reportable tails are empirical, not production SLO confidence.',
      'Missing browser locale, viewport, mode or repetitions remain pending; screenshots alone do not complete a measurement cell.',
      'A missing or null metric is unknown; zero baseline has no percentage delta. Build time is not a page metric.',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({
      options: {
        baseline: { type: 'string' },
        candidate: { type: 'string' },
        'out-json': { type: 'string' },
      },
    });
    assert.ok(
      values.baseline && values.candidate && values['out-json'],
      'required: --baseline <directory> --candidate <directory> --out-json <path>',
    );
    const report = compareReports(
      readReports(resolve(values.baseline)),
      readReports(resolve(values.candidate)),
    );
    writeFileSync(resolve(values['out-json']), `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      `[r27-compare] ${report.browser.status}; ${report.browser.missing.length} missing browser groups`,
    );
  } catch (error) {
    console.error(`[r27-compare] ${error.message}`);
    process.exitCode = 1;
  }
}
