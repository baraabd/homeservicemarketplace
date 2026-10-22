import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../workflows/r27-performance.yml', import.meta.url), 'utf8');
const checkout = workflow
  .split('- name: Checkout immutable runtime under test')[1]
  ?.split('- name:')[0];
const expression = checkout?.match(/ref: \$\{\{ (.+) \}\}/u)?.[1];
const env = {
  R27_BASELINE_SHA: '1'.repeat(40),
  R27_REPAIR_BASELINE_SHA: '2'.repeat(40),
  R27_CANDIDATE_SHA: '3'.repeat(40),
};

for (const [source, expected] of [
  ['baseline', env.R27_BASELINE_SHA],
  ['repair-baseline', env.R27_REPAIR_BASELINE_SHA],
  ['candidate', env.R27_CANDIDATE_SHA],
]) {
  test(`${source} checks out its own immutable source`, () => {
    assert.ok(expression, 'runtime checkout expression must exist');
    // This expression uses the shared Actions/JavaScript string, equality and
    // boolean syntax. Exercise the actual workflow expression, not a copy.
    assert.equal(
      runInNewContext(expression, { matrix: { source }, env }, { timeout: 100 }),
      expected,
    );
  });
}

test('repair-baseline identity and dependency checks stay mandatory', () => {
  assert.match(workflow, /source: \[baseline, candidate, repair-baseline\]/u);
  assert.match(
    workflow,
    /git merge-base --is-ancestor "\$R27_REPAIR_BASELINE_SHA" "\$R27_HARNESS_SHA"/u,
  );
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$R27_REPAIR_BASELINE_SHA"/u);
  assert.match(workflow, /cmp --silent pnpm-lock.yaml ..\/harness\/pnpm-lock.yaml/u);
  assert.match(workflow, /run: test "\$MEASURE_RESULT" = success/u);
  assert.match(workflow, /node scripts\/perf\/post-r18\/check-budgets.mjs/u);
  assert.doesNotMatch(workflow, /continue-on-error:/u);
});
