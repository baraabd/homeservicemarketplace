'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  extractAll,
  gatesUsedByTests,
  verify,
  requiredChecks,
} = require('./environment-inventory.cjs');

const inventory = () =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'environment-inventory.json'), 'utf8'));
const extracted = extractAll();
const gates = gatesUsedByTests();

test('the committed inventory matches every workflow job, service and test gate', () => {
  assert.deepEqual(verify(inventory(), extracted, gates), []);
});

test('a new CI job that is not inventoried is reported', () => {
  const actual = structuredClone(extracted);
  actual['ci.yml'].jobs['shadow-suite'] = {
    location: 'ubuntu-latest',
    services: [],
    containers: [],
    composeFiles: [],
    gates: [],
  };
  assert.match(verify(inventory(), actual, gates).join('\n'), /ci\.yml#shadow-suite: job is not/);
});

test('a service added to a job without updating the inventory is reported', () => {
  const actual = structuredClone(extracted);
  actual['ci.yml'].jobs['integration-e2e'].services.push('mongo:7');
  assert.match(verify(inventory(), actual, gates).join('\n'), /integration-e2e: services drifted/);
});

test('a test gate that no CI job enables is reported, not silently skipped', () => {
  const used = new Map(gates);
  used.set('RUN_SHADOW_INTEGRATION', new Set(['apps/api/test/shadow.spec.ts']));
  const inv = inventory();
  inv.gates.RUN_SHADOW_INTEGRATION = { owner: 'x', suites: [], setBy: [] };
  assert.match(verify(inv, extracted, used).join('\n'), /RUN_SHADOW_INTEGRATION: no listed CI job/);
});

test('a required check behind a path filter is rejected because it would strand PRs', () => {
  const inv = inventory();
  inv.workflows['observability.yml'].jobs['synthetic-alert'].requiredOnFinalSha = true;
  inv.workflows['observability.yml'].jobs['synthetic-alert'].checkName = 'R23 Linux';
  assert.match(
    verify(inv, extracted, gates).join('\n'),
    /synthetic-alert: a required check must run on every pull request/,
  );
});

test('required checks are the exact reported check names', () => {
  assert.deepEqual(requiredChecks(inventory()), [
    'Analyze JavaScript/TypeScript',
    'CI gate',
    'Dev browser startup (ubuntu-latest)',
    'Dev browser startup (windows-latest)',
    'Production governance',
    'R04 real browser, SMTP and Postgres',
    'R26 cookies, authorization and enforced CSP',
    'Real Seeker Provider Admin startup',
    'Staging boundary gate',
    'Staging image boundaries',
    'Staging release controls (ubuntu-latest)',
    'Staging release controls (windows-latest)',
  ]);
});

test('required checks are a superset of the merge policy and PR acceptance policy', async () => {
  const required = new Set(requiredChecks(inventory()));
  const governance = await import('../../.github/scripts/production-governance.mjs');
  const acceptance = await import('../../.github/scripts/pr-acceptance.mjs');
  const policy = [
    ...governance.REQUIRED_CHECKS,
    ...acceptance.POLICY.flatMap((entry) => entry.jobs),
  ];
  assert.deepEqual(
    policy.filter((name) => !required.has(name)),
    [],
    'every check the existing merge/acceptance policy requires is a required final-SHA check',
  );
});
