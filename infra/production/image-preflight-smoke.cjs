'use strict';
// Disposable CI image tests. These prove packaging/configuration rejection, not
// delivery to a live inbox, real DB grants or acceptance of a hosted release.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const image = process.argv[2];
if (!image || process.argv.length !== 3) throw new Error('Provide the disposable API image tag');
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  assert.ifError(result.error);
  return result;
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-ci-preflight-'));
try {
  const envFile = path.join(root, 'runtime.env');
  const values = {
    NODE_ENV: 'production', APP_ENV: 'staging',
    DATABASE_URL: 'postgresql://fixture:fixture@db.example.test/app?sslmode=require&sslaccept=strict',
    JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
    FRONTEND_URL: 'https://web.example.test', CORS_ORIGINS: 'https://web.example.test',
    SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'noreply@example.test',
    REDIS_TLS: 'true', REDIS_PASSWORD: randomBytes(24).toString('hex'),
    EVIDENCE_SCANNER_DRIVER: 'clamav', CLAMAV_HOST: 'scanner.example.test', EVIDENCE_SCAN_WORKER_ENABLED: 'true',
    STORAGE_DRIVER: 's3', S3_BUCKET: 'public-fixture', S3_RESTRICTED_BUCKET: 'restricted-fixture',
    S3_PORTFOLIO_BUCKET: 'portfolio-fixture',
  };
  fs.writeFileSync(envFile, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 });
  // Docker reads this host file; there are only disposable generated credentials.
  // --network none proves preflight does not connect to or mutate dependencies.
  const prefix = ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true', '--env-file', envFile];
  const valid = docker([...prefix, image, 'node', 'deploy/check-runtime.cjs', '/app']);
  assert.equal(valid.status, 0, 'The packaged API must validate a complete synthetic configuration');
  assert.match(valid.stdout, /PASS production runtime configuration preflight/);
  for (const [key, value] of [['COOKIE_SECURE', 'false'], ['REDIS_TLS', 'false'],
    ['DATABASE_URL', 'postgresql://fixture:fixture@db.example.test/app'],
    ['S3_RESTRICTED_BUCKET', 'public-fixture'], ['SMTP_HOST', ''], ['EVIDENCE_SCAN_WORKER_ENABLED', 'false']]) {
    const invalid = docker([...prefix, '-e', `${key}=${value}`, image, 'node', 'deploy/check-runtime.cjs', '/app']);
    assert.equal(invalid.status, 1, `${key} must be rejected by the built preflight`);
    assert.equal((invalid.stdout + invalid.stderr).includes(values.JWT_ACCESS_SECRET), false);
  }
  const guarded = docker([...prefix, '-e', 'COOKIE_SECURE=false', image, 'node', 'deploy/start-api.cjs', '/app']);
  assert.equal(guarded.status, 1, 'The guarded API command must stop before bootstrap with unsafe configuration');
  assert.equal((guarded.stdout + guarded.stderr).includes('Nest application successfully started'), false);
  console.log('PASS packaged API preflight and unsafe-start refusal (isolated CI only)');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
