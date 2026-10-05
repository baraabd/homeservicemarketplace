'use strict';

const path = require('node:path');

const PREFIX = 'rl:';
const BATCH_SIZE = 200;
const RESET_FAILED = 'CI_BROWSER_RATE_LIMIT_RESET_FAILED';

// Independent browser commands share one disposable API and one loopback IP.
// Clear only that job's rate budgets BETWEEN commands. Never invoke this inside
// a test or a security scenario that is asserting a limiter's behaviour.
function approvedRedisOptions(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_JOB !== 'phase5-real-api') {
    throw new Error('CI_BROWSER_RATE_LIMIT_RESET_REQUIRES_PHASE5_JOB');
  }
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();
  if (!['', 'development', 'test'].includes(nodeEnv)) {
    throw new Error('CI_BROWSER_RATE_LIMIT_RESET_NON_PRODUCTION_ONLY');
  }
  const host = (env.REDIS_HOST ?? 'localhost').trim().toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('CI_BROWSER_RATE_LIMIT_RESET_LOOPBACK_ONLY');
  }
  const rawPort = String(env.REDIS_PORT ?? '6379');
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('CI_BROWSER_RATE_LIMIT_RESET_INVALID_PORT');
  }
  const rawDb = String(env.REDIS_DB ?? '0');
  const db = Number(rawDb);
  if (!/^\d+$/.test(rawDb) || !Number.isInteger(db) || db < 0 || db > 15) {
    throw new Error('CI_BROWSER_RATE_LIMIT_RESET_INVALID_DATABASE');
  }
  return {
    host,
    port,
    db,
    password: env.REDIS_PASSWORD || undefined,
    lazyConnect: true,
    connectTimeout: 3000,
    commandTimeout: 3000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  };
}

function createRedis(options) {
  // This package lives under apps/api, not the repository root. Loading and
  // connecting are deferred until every disposable-environment guard passes.
  const Redis = require(path.resolve(__dirname, '../../apps/api/node_modules/ioredis'));
  return new Redis(options);
}

async function resetCiBrowserRateLimits({ env = process.env, createClient = createRedis } = {}) {
  const options = approvedRedisOptions(env);
  let client;
  let operationFailed = false;
  let removed = 0;
  try {
    client = createClient(options);
    // Redis failures must not print endpoints, credentials or raw key names.
    client.on('error', () => {});
    await client.connect();
    let cursor = '0';
    do {
      const [next, scanned] = await client.scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', BATCH_SIZE);
      cursor = next;
      const keys = scanned.filter((key) => typeof key === 'string' && key.startsWith(PREFIX));
      for (let offset = 0; offset < keys.length; offset += BATCH_SIZE) {
        removed += await client.unlink(...keys.slice(offset, offset + BATCH_SIZE));
      }
    } while (cursor !== '0');
  } catch {
    operationFailed = true;
  } finally {
    if (client) {
      try {
        await client.quit();
      } catch {
        operationFailed = true;
        // A failed connect/command can leave a socket behind. The bounded
        // client has no reconnect policy; disconnect still closes it.
        try {
          client.disconnect();
        } catch {
          // Keep the sanitized failure below rather than a client's raw error.
        }
      }
    }
  }
  if (operationFailed) throw new Error(RESET_FAILED);
  return removed;
}

if (require.main === module) {
  resetCiBrowserRateLimits()
    .then((removed) => {
      console.log(`Reset ${removed} CI browser rate-budget keys between independent suites.`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { resetCiBrowserRateLimits };
