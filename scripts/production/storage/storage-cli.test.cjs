'use strict';
// node --test scripts/production/storage/storage-cli.test.cjs
// Argument handling only. Real-storage behaviour of the same CLIs is exercised
// by apps/api/test/integration/r20-storage against S3-compatible storage.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parse } = require('./storage-inventory.cjs');
const { envConfig } = require('./storage-doctor.cjs');

test('inventory requires a namespace, an env-var bucket reference and an output file', () => {
  const a = parse([
    'inventory',
    '--namespace',
    'restricted',
    '--bucket-env',
    'S3_RESTRICTED_BUCKET',
    '--out',
    'x.json',
    '--deep',
  ]);
  assert.equal(a.namespace, 'restricted');
  assert.equal(a.bucketEnv, 'S3_RESTRICTED_BUCKET');
  assert.equal(a.deep, true);
  assert.throws(() => parse(['inventory', '--bucket-env', 'B', '--out', 'x']), /--namespace/);
  assert.throws(
    () => parse(['inventory', '--namespace', 'restricted', '--bucket-env', 'B']),
    /--out/,
  );
});

test('a bucket NAME is never accepted on the command line', () => {
  assert.throws(
    () =>
      parse(['inventory', '--namespace', 'public', '--bucket-env', 'my-real-bucket', '--out', 'x']),
    /environment variable/,
  );
});

test('unknown commands, namespaces and flags are refused', () => {
  assert.throws(() => parse(['delete', '--bucket-env', 'B']), /unknown command/);
  assert.throws(
    () => parse(['inventory', '--namespace', 'all', '--bucket-env', 'B', '--out', 'x']),
    /--namespace/,
  );
  assert.throws(
    () => parse(['verify-restore', '--bucket-env', 'B', '--force']),
    /missing value|unknown/,
  );
  assert.throws(() => parse(['verify-restore', '--bucket-env', 'B']), /--inventory/);
});

test('doctor env config coerces the path-style flag like the env schema and drops empty values', () => {
  const c = envConfig({ S3_FORCE_PATH_STYLE: 'true', S3_BUCKET: '', STORAGE_DRIVER: 's3' });
  assert.equal(c.get('S3_FORCE_PATH_STYLE'), true);
  assert.equal(c.get('S3_BUCKET'), undefined);
  assert.equal(c.get('STORAGE_DRIVER'), 's3');
  assert.equal(envConfig({}).get('S3_FORCE_PATH_STYLE'), false);
});
