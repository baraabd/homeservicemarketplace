'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');

/** This launcher is for native local development, never production or remote databases. */
function reviewEnvironment(input) {
  if (input.NODE_ENV && input.NODE_ENV !== 'development') throw new Error('review-runtime-local-development-only');
  if (input.APP_ENV && input.APP_ENV !== 'dev') throw new Error('review-runtime-local-development-only');
  let database;
  try { database = new URL(input.DATABASE_URL); } catch { throw new Error('review-runtime-database-url-required'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
    throw new Error('review-runtime-local-database-required');
  }
  if (input.STORAGE_DRIVER && input.STORAGE_DRIVER !== 'local') {
    throw new Error('review-runtime-local-storage-required');
  }
  return {
    ...input,
    NODE_ENV: 'development', APP_ENV: 'dev',
    EVIDENCE_SCANNER_DRIVER: 'clamav', EVIDENCE_SCAN_WORKER_ENABLED: 'true',
    EVIDENCE_SCAN_INTERVAL_MS: '5000', CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: '3310',
  };
}

function run(command, args, env) {
  const windows = process.platform === 'win32';
  // Only constant repository commands go through cmd.exe, never user input or secrets.
  const result = windows && command === 'pnpm'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm --filter @homeservicemarketplace/api dev:clean'], { cwd: ROOT, env, stdio: 'inherit' })
    : spawnSync(command, args, { cwd: ROOT, env, stdio: 'inherit' });
  if (result.error || result.signal || result.status !== 0) throw new Error('review-runtime-command-failed');
}

function main() {
  const env = reviewEnvironment(process.env);
  // The separate project only starts the scanner. It does not recreate databases,
  // seed users, change file roots, migrate data, or remove any volume.
  run('docker', ['compose', '-p', 'hsm-review', '-f', 'infra/docker/docker-compose.review.yml',
    'up', '-d', '--wait', '--wait-timeout', '300', 'clamav'], process.env);
  console.log('Real local scanner ready. Starting the API with the scan worker enabled.');
  run('pnpm', ['--filter', '@homeservicemarketplace/api', 'dev:clean'], env);
}

module.exports = { reviewEnvironment };
if (require.main === module) {
  try { main(); } catch (error) {
    // Never print raw process.env, connection strings, or credentials.
    console.error(error instanceof Error ? error.message : 'review-runtime-failed');
    process.exitCode = 1;
  }
}
