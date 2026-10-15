// R27 — evaluate measurement reports against the proposed budgets.
//
// Pure: takes parsed JSON, returns findings. Time budgets are skipped unless
// the report says it ran on a hosted runner, because a local or contended
// host measures the host (see docs/performance/post-r18/README.md).

const KIB = 1024;

export function evaluateBundle(budgets, report) {
  const findings = [];
  const b = budgets.bundle;
  const shell = report.shell.js.brotli / KIB;
  findings.push({
    check: 'shell JS (brotli)',
    actual: round(shell),
    limit: b.shellJsBrotliKiBMax,
    pass: shell <= b.shellJsBrotliKiBMax,
  });
  for (const journey of report.journeys) {
    const limit = b.journeyIncrementJsBrotliKiBMax[journey.name];
    if (limit === undefined || !journey.increment) continue;
    const actual = journey.increment.js.brotli / KIB;
    findings.push({
      check: `+${journey.name} JS (brotli)`,
      actual: round(actual),
      limit,
      pass: actual <= limit,
    });
  }
  for (const [lib, allowed] of Object.entries(b.librariesForbiddenOutsideJourneys)) {
    const placement = report.heavyLibraries[lib];
    if (!placement) continue;
    const offenders = Object.entries(placement.renderedBytesByJourney)
      .filter(([journey, bytes]) => bytes > 0 && !allowed.includes(journey))
      .map(([journey]) => journey);
    if (placement.renderedBytesInShell > 0) offenders.unshift('shell');
    findings.push({
      check: `${lib} only in ${allowed.join(', ')}`,
      actual: offenders.length ? offenders.join(', ') : 'contained',
      limit: allowed.join(', '),
      pass: offenders.length === 0,
    });
  }
  return findings;
}

export function evaluateQueries(budgets, report) {
  const findings = [];
  const q = budgets.queries;
  for (const [name, probe] of Object.entries(report.pageSizeInvariance ?? {})) {
    findings.push({
      check: `page-size invariance: ${name}`,
      actual: probe.verdict,
      limit: 'bounded',
      pass: probe.verdict === 'bounded',
    });
  }
  const large = q.seqScanOnLargeTables;
  const rows = report.dataset?.amplification?.rowCountsAfter ?? {};
  for (const [name, plans] of Object.entries(report.plans ?? {})) {
    const scans = plans
      .flatMap((p) => p.scans ?? [])
      .filter(
        (s) =>
          s.node === 'Seq Scan' &&
          large.tables.includes(s.relation) &&
          (rows[s.relation] ?? 0) >= large.minRowsInDataset &&
          !large.allowed.includes(`${name}:${s.relation}`),
      );
    findings.push({
      check: `no seq scan on large tables: ${name}`,
      actual: scans.length ? scans.map((s) => s.relation).join(', ') : 'none',
      limit: 'none',
      pass: scans.length === 0,
    });
  }
  for (const [name, row] of Object.entries(report.phases?.amplified?.scenarios ?? {})) {
    const limit = q.statementsPerRequestMax[name];
    if (limit === undefined) continue;
    findings.push({
      check: `statements: ${name}`,
      actual: row.statements,
      limit,
      pass: row.statements <= limit,
    });
  }
  return findings;
}

const round = (n) => Math.round(n * 10) / 10;
