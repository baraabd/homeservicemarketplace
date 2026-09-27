'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkRuntime, printResult } = require('./check-runtime.cjs');
const { startApi } = require('./start-api.cjs');
function fixture(t, policy = 'module.exports.deploymentReadinessProblems = () => []') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-built-api-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist/config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/config/env.validation.js'), 'module.exports.validateEnv = (env) => env;');
  fs.writeFileSync(path.join(root, 'dist/config/runtime-policy.js'), policy);
  return root;
}
test('read-only preflight consumes the supplied built API, without bootstrapping it', (t) => {
  const apiRoot = fixture(t);
  const result = checkRuntime({ apiRoot });
  assert.deepEqual(result, { ok: true, problems: [] });
});
test('missing build and malformed policy result are non-PASS', (t) => {
  const apiRoot = fixture(t, 'module.exports.deploymentReadinessProblems = () => ({ ok: true })');
  assert.equal(checkRuntime({ apiRoot }).ok, false);
  assert.equal(checkRuntime({ apiRoot: path.join(apiRoot, 'missing') }).ok, false);
});
test('validation exceptions cannot disclose secrets', (t) => {
  const apiRoot = fixture(t, 'throw new Error("sensitive-dsn-fixture");');
  assert.equal(JSON.stringify(checkRuntime({ apiRoot })).includes('sensitive-dsn-fixture'), false);
});
test('a failed strict policy prevents the API module from loading', (t) => {
  const apiRoot = fixture(t, 'module.exports.deploymentReadinessProblems = () => ["COOKIE_SECURE: required"];');
  const lines = [];
  const output = { error: (line) => lines.push(line), log: (line) => lines.push(line) };
  assert.equal(startApi({ apiRoot, output, load: () => assert.fail('must not bootstrap') }), false);
  assert.match(lines[0], /COOKIE_SECURE/);
});
test('successful guard loads exactly the checked API in the same process', (t) => {
  const apiRoot = fixture(t);
  const loaded = [];
  assert.equal(startApi({ apiRoot, output: { log() {}, error() {} }, load: (name) => loaded.push(name) }), true);
  assert.deepEqual(loaded, [path.join(apiRoot, 'dist/main.js')]);
});
test('CLI failure has a nonzero exit code and no secret-bearing exception', (t) => {
  const apiRoot = fixture(t, 'throw new Error("sensitive-dsn-fixture");');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'check-runtime.cjs'), apiRoot], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal((result.stdout + result.stderr).includes('sensitive-dsn-fixture'), false);
});
test('report never promotes a configuration check to real integration acceptance', () => {
  const lines = [];
  printResult({ ok: true, problems: [] }, { log: (line) => lines.push(line) });
  assert.match(lines.join('\n'), /remain separate release gates/);
});
