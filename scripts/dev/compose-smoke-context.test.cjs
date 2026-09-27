'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { disposableSmokeContext } = require('./compose-smoke-context.cjs');
const root = path.resolve(__dirname, '../..');
const fixture = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };

test('only the complete disposable hosted-runner context is accepted', () => {
  assert.equal(disposableSmokeContext(fixture), true);
  assert.equal(disposableSmokeContext({}), false);
  assert.equal(disposableSmokeContext({ ...fixture, RUNNER_ENVIRONMENT: 'self-hosted' }), false);
});
for (const key of Object.keys(fixture)) {
  test(`missing or false ${key} cannot authorize destructive smoke cleanup`, () => {
    const value = { ...fixture };
    delete value[key];
    assert.equal(disposableSmokeContext(value), false);
    value[key] = 'false';
    assert.equal(disposableSmokeContext(value), false);
  });
}
test('ordinary local CLI exits nonzero before any Docker operation', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'compose-smoke-context.cjs')], {
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '', RUNNER_ENVIRONMENT: '' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BLOCKED/u);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'compose-smoke-context.cjs'), 'utf8'), /require\(['"]node:child_process/u);
});
test('the real shell entrypoint checks context before installing cleanup or invoking Compose', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/ci/compose-smoke.sh'), 'utf8');
  const position = source.indexOf('node scripts/dev/compose-smoke-context.cjs');
  assert.ok(position > source.indexOf('set -euo pipefail'));
  assert.ok(position < source.indexOf('DC=('));
  assert.ok(position < source.indexOf('trap cleanup EXIT'));
  assert.ok(position < source.indexOf('"${DC[@]}" down -v'));
});
