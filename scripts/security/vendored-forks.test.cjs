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

test('picomatch: every affected major resolves to its owned security fork', () => {
  assert.equal(manifest.pnpm.overrides['picomatch@>=2.0.0 <3.0.0'], 'file:./vendor/picomatch-v2');
  assert.equal(manifest.pnpm.overrides['picomatch@>=3.0.0 <=4.0.7'], 'file:./vendor/picomatch-v4');
  for (const major of [2, 4]) {
    assert.match(lockfile, new RegExp(`^ {2}picomatch@file:vendor/picomatch-v${major}:$`, 'm'));
    const dir = path.join(root, `vendor/picomatch-v${major}`);
    assert.match(
      fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'),
      /Permission is hereby granted/,
    );
    assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /## Exit criterion/);
  }
  assert.doesNotMatch(lockfile, /^ {2}picomatch@\d/m, 'a vulnerable registry package remains');
});

test('picomatch: installed Jest and Nest CLI consumers load the guarded forks', () => {
  const store = path.join(root, 'node_modules/.pnpm');
  const entries = fs.readdirSync(store);
  const consumers = [
    ['anymatch', 'anymatch@', '2.3.2-hsm.1'],
    ['jest-message-util', 'jest-message-util@', '4.0.7-hsm.1'],
    ['@angular-devkit/core', '@angular-devkit+core@', '4.0.7-hsm.1'],
  ];
  for (const [name, prefix, version] of consumers) {
    const installed = entries.filter((entry) => entry.startsWith(prefix));
    assert.ok(installed.length > 0, `missing real consumer: ${name}`);
    for (const entry of installed) {
      const consumer = require('node:module').createRequire(
        path.join(store, entry, 'node_modules', name, 'package.json'),
      );
      assert.equal(consumer('picomatch/package.json').version, version, name);
      assert.ok(!consumer('picomatch').makeRe('+(*a)').source.includes('[^/]*?'), name);
    }
  }
});
