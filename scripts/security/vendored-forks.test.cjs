'use strict';

// Graph-level checks for repository-owned security forks (see vendor/*/README.md).
// A fork only remediates an advisory when every consumer actually loads it and
// the vulnerable registry package is absent from the lockfile.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const lockfile = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('deepmerge: the override points every consumer at the owned fork', () => {
  assert.equal(manifest.pnpm.overrides['deepmerge@>=4.2.0 <=4.3.1'], 'file:./vendor/deepmerge');
  assert.match(lockfile, /^ {2}deepmerge@file:vendor\/deepmerge:$/m);
  assert.doesNotMatch(
    lockfile,
    /^ {2}deepmerge@\d/m,
    'a registry deepmerge release is still resolved; the advisory is not remediated',
  );
});

test('deepmerge: jest-config loads the patched fork at runtime', () => {
  // jest-config is a dependency of the API test runner.
  const apiRequire = require('node:module').createRequire(path.join(root, 'apps/api/package.json'));
  const jestRequire = require('node:module').createRequire(apiRequire.resolve('jest/package.json'));
  const jestCliRequire = require('node:module').createRequire(
    jestRequire.resolve('jest-cli/package.json'),
  );
  const configRequire = require('node:module').createRequire(
    jestCliRequire.resolve('jest-config/package.json'),
  );
  const resolved = configRequire.resolve('deepmerge');
  const pkg = JSON.parse(
    fs.readFileSync(path.join(path.dirname(resolved), 'package.json'), 'utf8'),
  );
  assert.equal(pkg.version, '4.3.1-hsm.1');
  assert.equal(path.basename(resolved), 'index.cjs');

  const merge = configRequire('deepmerge');
  const result = merge.all([{}, JSON.parse('{ "__proto__": { "admin": true }, "safe": 1 }')]);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.admin, undefined);
});

test('deepmerge: the fork keeps its upstream license and an exit criterion', () => {
  const dir = path.join(root, 'vendor/deepmerge');
  assert.match(
    fs.readFileSync(path.join(dir, 'license.txt'), 'utf8'),
    /MIT|Permission is hereby granted/,
  );
  assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /## Exit criterion/);
});
