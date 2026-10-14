#!/usr/bin/env node
// R27 — compare saved reports with budgets.proposed.json.
//
// Usage: node scripts/perf/post-r18/check-budgets.mjs \
//          --bundle docs/performance/post-r18/bundle-baseline.json \
//          --queries docs/performance/post-r18/query-profile-baseline.json
// Exits 1 when any check fails. The budgets are proposals: a failure is a
// finding to report, not an automatic release decision.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { evaluateBundle, evaluateQueries } from './lib/budgets.mjs';
import { REPO_ROOT } from './lib/provenance.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const load = (path) => JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8'));

const budgets = load('scripts/perf/post-r18/budgets.proposed.json');
const findings = [];
if (option('bundle')) findings.push(...evaluateBundle(budgets, load(option('bundle'))));
if (option('queries')) findings.push(...evaluateQueries(budgets, load(option('queries'))));
if (findings.length === 0) {
  console.error('nothing to check: pass --bundle and/or --queries');
  process.exit(2);
}
for (const f of findings) {
  console.log(`${f.pass ? 'PASS' : 'FAIL'}  ${f.check}: ${f.actual} (limit ${f.limit})`);
}
const failed = findings.filter((f) => !f.pass).length;
console.log(`${findings.length - failed} passed, ${failed} failed (budgets: ${budgets.status})`);
process.exitCode = failed ? 1 : 0;
