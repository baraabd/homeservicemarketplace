'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewEnvironment } = require('./review-runtime.cjs');
const base = { DATABASE_URL: 'postgresql://local:fixture@localhost:5432/hsm', NODE_ENV: 'development', APP_ENV: 'dev' };

test('uses a real scanner without modifying input or enforcement flags', () => {
  const input = { ...base, EVIDENCE_SCANNER_DRIVER: 'none', WORK_ACCESS_ENFORCED: 'true', VERIFICATION_ENFORCED: 'true' };
  const output = reviewEnvironment(input);
  assert.equal(input.EVIDENCE_SCANNER_DRIVER, 'none');
  assert.equal(output.EVIDENCE_SCANNER_DRIVER, 'clamav');
  assert.equal(output.EVIDENCE_SCAN_WORKER_ENABLED, 'true');
  assert.equal(output.WORK_ACCESS_ENFORCED, 'true');
  assert.equal(output.VERIFICATION_ENFORCED, 'true');
});
test('does not enable enforcement flags by implication', () => {
  const output = reviewEnvironment(base);
  assert.equal(output.WORK_ACCESS_ENFORCED, undefined);
  assert.equal(output.VERIFICATION_ENFORCED, undefined);
});
test('preserves configured storage locations', () => {
  const output = reviewEnvironment({ ...base, LOCAL_STORAGE_DIR: '/safe/media', RESTRICTED_STORAGE_DIR: '/safe/private' });
  assert.equal(output.LOCAL_STORAGE_DIR, '/safe/media');
  assert.equal(output.RESTRICTED_STORAGE_DIR, '/safe/private');
});
test('refuses production and staging rather than overriding their identity', () => {
  for (const mode of ['production', 'staging', 'test']) {
    assert.throws(() => reviewEnvironment({ ...base, NODE_ENV: mode }), /local-development-only/);
  }
  for (const mode of ['prod', 'staging', 'test']) {
    assert.throws(() => reviewEnvironment({ ...base, APP_ENV: mode }), /local-development-only/);
  }
});
test('refuses non-local databases without printing credentials', () => {
  assert.throws(() => reviewEnvironment({ ...base, DATABASE_URL: 'postgresql://user:secret@db.example.test/hsm' }), {
    message: 'review-runtime-local-database-required',
  });
});
test('refuses missing and malformed database URLs', () => {
  assert.throws(() => reviewEnvironment({}), /database-url-required/);
  assert.throws(() => reviewEnvironment({ DATABASE_URL: 'not-a-url-secret' }), /database-url-required/);
});
test('refuses S3 instead of silently moving the storage root', () => {
  assert.throws(() => reviewEnvironment({ ...base, STORAGE_DRIVER: 's3' }), /local-storage-required/);
});
test('accepts loopback IPv4 and IPv6 PostgreSQL URLs only', () => {
  for (const host of ['127.0.0.1', '[::1]']) {
    assert.equal(reviewEnvironment({ ...base, DATABASE_URL: `postgresql://local:fixture@${host}/hsm` }).CLAMAV_HOST, '127.0.0.1');
  }
  assert.throws(() => reviewEnvironment({ ...base, DATABASE_URL: 'https://localhost/hsm' }), /local-database-required/);
});
