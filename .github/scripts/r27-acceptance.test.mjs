import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireCompleteComparison } from './r27-acceptance.mjs';

const baseline = '1'.repeat(40);
const candidate = '2'.repeat(40);
const complete = () => ({
  schemaVersion: 1,
  kind: 'r27-comparison',
  status: 'MEASURED_NOT_RELEASE_ACCEPTED',
  source: {
    baseline: {
      commit: baseline,
      tree: '3'.repeat(40),
      measurementHarnessCommit: candidate,
      lockfileSha256: 'a'.repeat(64),
    },
    candidate: {
      commit: candidate,
      tree: '4'.repeat(40),
      measurementHarnessCommit: candidate,
      lockfileSha256: 'a'.repeat(64),
    },
  },
  browser: { status: 'OBSERVED_COMPLETE_MATRIX', missing: [] },
});

test('complete comparison remains measured evidence, not a release approval', () => {
  const report = complete();
  assert.equal(requireCompleteComparison(report, baseline, candidate), true);
  assert.equal(report.status, 'MEASURED_NOT_RELEASE_ACCEPTED');
});

for (const [label, change, message] of [
  [
    'observational incomplete matrix',
    (r) => (r.browser.status = 'PENDING_INCOMPLETE_MATRIX'),
    /incomplete/u,
  ],
  [
    'missing locale/viewport observations',
    (r) => r.browser.missing.push('candidate/production/mobile-ar/seeker/cold-browser'),
    /missing browser/u,
  ],
  ['absent browser evidence', (r) => delete r.browser, /incomplete/u],
  [
    'historical candidate artifact',
    (r) => (r.source.candidate.commit = '5'.repeat(40)),
    /wrong candidate/u,
  ],
  [
    'historical baseline artifact',
    (r) => (r.source.baseline.commit = '6'.repeat(40)),
    /wrong baseline/u,
  ],
  [
    'different harness',
    (r) => (r.source.baseline.measurementHarnessCommit = baseline),
    /wrong measurement/u,
  ],
  [
    'different dependency lock',
    (r) => (r.source.baseline.lockfileSha256 = 'b'.repeat(64)),
    /incomparable/u,
  ],
  ['missing tree', (r) => delete r.source.candidate.tree, /source tree/u],
  ['invented release success', (r) => (r.status = 'RELEASE_ACCEPTED'), /unexpected comparison/u],
]) {
  test(`refuses ${label}`, () => {
    const report = complete();
    change(report);
    assert.throws(() => requireCompleteComparison(report, baseline, candidate), message);
  });
}

test('refuses abbreviated and self-comparison inputs', () => {
  assert.throws(
    () => requireCompleteComparison(complete(), '1234567', candidate),
    /full expected/u,
  );
  assert.throws(() => requireCompleteComparison(complete(), candidate, candidate), /distinct/u);
});
