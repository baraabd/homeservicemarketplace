'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ROOT } = require('../runtime/toolchain.cjs');
const { missingApiOutputs, prepareApiCache } = require('./preflight.cjs');

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || !['verify', 'simulate-missing-output'].includes(mode)) throw new Error('Invalid mode');
  assert.deepEqual(await missingApiOutputs(), [], 'API bootstrap outputs must exist');
  if (mode === 'verify') {
    require(path.join(ROOT, 'apps/api/dist/config/env.schema.js'));
    require(path.join(ROOT, 'apps/api/dist/config/env.validation.js'));
    console.log('PASS real compiled API configuration can be loaded; this is not live API readiness');
    return;
  }
  // Fault injection is restricted to a disposable CI checkout, after a real
  // development compile. No user data, migrations or .env files are removed.
  assert.equal(process.env.CI, 'true', 'Fault injection requires a disposable CI checkout');
  await fs.access(path.join(ROOT, 'apps/api/.cache/api-dev.tsbuildinfo'));
  await fs.unlink(path.join(ROOT, 'apps/api/dist/config/env.schema.js'));
  const result = await prepareApiCache();
  assert.equal(result.cacheRemoved, true);
  assert.deepEqual(result.missing, ['config/env.schema.js']);
  console.log('PASS missing real env.schema output invalidates only its stale incremental cache; recompile and verify next');
}
main().catch(() => { console.error('FAIL real API emission regression check'); process.exitCode = 1; });
