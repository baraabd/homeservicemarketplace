// Additional acceptance postconditions for the unchanged R27 comparison CLI.
// Comparison intentionally permits an incomplete matrix as an observation;
// G2 acceptance must refuse that state and bind both reports to this CI run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const SHA = /^(?!0{40}$)[a-f0-9]{40}$/u;

export function requireCompleteComparison(report, baseline, candidate) {
  assert.match(baseline ?? '', SHA, 'full expected baseline SHA required');
  assert.match(candidate ?? '', SHA, 'full expected candidate SHA required');
  assert.notEqual(baseline, candidate, 'baseline and candidate must be distinct sources');
  assert.equal(report?.schemaVersion, 1, 'unsupported comparison schema');
  assert.equal(report.kind, 'r27-comparison', 'comparison report required');
  assert.equal(report.status, 'MEASURED_NOT_RELEASE_ACCEPTED', 'unexpected comparison status');
  assert.equal(report.source?.baseline?.commit, baseline, 'wrong baseline source');
  assert.equal(report.source?.candidate?.commit, candidate, 'wrong candidate source');
  for (const source of [report.source.baseline, report.source.candidate]) {
    assert.equal(source.measurementHarnessCommit, candidate, 'wrong measurement harness');
    assert.match(source.tree ?? '', SHA, 'full source tree required');
    assert.match(source.lockfileSha256 ?? '', /^[a-f0-9]{64}$/u, 'lock digest required');
  }
  assert.equal(
    report.source.baseline.lockfileSha256,
    report.source.candidate.lockfileSha256,
    'incomparable lock digest',
  );
  assert.equal(report.browser?.status, 'OBSERVED_COMPLETE_MATRIX', 'browser matrix incomplete');
  assert.deepEqual(report.browser.missing, [], 'missing browser observations');
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({
      options: {
        comparison: { type: 'string' },
        baseline: { type: 'string' },
        candidate: { type: 'string' },
      },
    });
    assert.ok(values.comparison, '--comparison is required');
    requireCompleteComparison(
      JSON.parse(readFileSync(resolve(values.comparison), 'utf8')),
      values.baseline,
      values.candidate,
    );
    console.log('PASS exact-source R27 comparison and complete browser matrix');
  } catch (error) {
    console.error(`[r27-acceptance] ${error.message}`);
    process.exitCode = 1;
  }
}
