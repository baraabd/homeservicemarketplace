'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { parseEnv } = require('node:util');
const { ROOT, toolchainProblems } = require('../runtime/toolchain.cjs');

const API_ENV_PATHS = ['apps/api/.env.local', 'apps/api/.env', '.env.local', '.env'];
const OUTPUTS = ['main.js', 'config/env.schema.js', 'config/env.validation.js', 'config/config.module.js'];

async function apiPort(root = ROOT, environment = process.env) {
  // Match ConfigModule's order: earlier files win, then the process wins.
  // Values are never printed, and no environment variable is mutated.
  const values = {};
  for (const file of [...API_ENV_PATHS].reverse()) {
    try { Object.assign(values, parseEnv(await fs.readFile(path.join(root, file), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('An API environment file is unreadable'); }
  }
  const port = Number(environment.PORT ?? values.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API PORT must be an integer between 1 and 65535');
  return port;
}

async function availablePort(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    const timer = setTimeout(() => {
      server.close(() => {});
      resolve(false);
    }, 3000);
    server.once('error', () => { clearTimeout(timer); resolve(false); });
    server.listen({ port, host, exclusive: true }, () => {
      clearTimeout(timer);
      server.close((error) => resolve(!error));
    });
  });
}

async function missingApiOutputs(root = ROOT) {
  const missing = [];
  for (const file of OUTPUTS) {
    try { await fs.access(path.join(root, 'apps/api/dist', file)); }
    catch (error) { if (error.code === 'ENOENT') missing.push(file); else throw error; }
  }
  return missing;
}

async function prepareApiCache(root = ROOT, repair = true) {
  const missing = await missingApiOutputs(root);
  if (!missing.length) return { missing, cacheRemoved: false };
  const apiDirectory = path.join(root, 'apps/api');
  if ((await fs.lstat(apiDirectory)).isSymbolicLink()) throw new Error('Refusing to modify a redirected API directory');
  const api = await fs.realpath(apiDirectory);
  const cacheDirectory = path.join(root, 'apps/api/.cache');
  let actualCache;
  try { actualCache = await fs.realpath(cacheDirectory); }
  catch (error) { if (error.code === 'ENOENT') return { missing, cacheRemoved: false }; throw error; }
  if (actualCache !== path.join(api, '.cache')) throw new Error('Refusing to modify a redirected API cache directory');
  const cache = path.join(actualCache, 'api-dev.tsbuildinfo');
  try {
    const entry = await fs.lstat(cache);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Refusing to modify a non-regular API build cache');
  } catch (error) { if (error.code === 'ENOENT') return { missing, cacheRemoved: false }; throw error; }
  if (repair) await fs.unlink(cache);
  return { missing, cacheRemoved: repair, cacheNeedsRepair: !repair };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--api', '--check-only'].includes(arg))) throw new Error('Use --api and/or --check-only');
  const problems = await toolchainProblems();
  if (problems.length) throw new Error(problems.join('; '));
  const port = await apiPort();
  const apiOnly = args.includes('--api');
  if (!apiOnly && port === 5173) throw new Error('API and web cannot both use port 5173');
  if (!(await availablePort(port))) throw new Error(`API port ${port} is occupied or unavailable. Stop only the related service yourself or configure another PORT; no process was killed.`);
  if (!apiOnly && !(await availablePort(5173, 'localhost'))) throw new Error('Web port 5173 is occupied or unavailable. No process was killed and no fallback port was selected.');
  const result = await prepareApiCache(ROOT, !args.includes('--check-only'));
  if (result.cacheRemoved) console.log('Removed only the generated API incremental cache because bootstrap outputs are incomplete; the next compiler run must re-emit them.');
  if (result.cacheNeedsRepair) console.log('API incremental cache needs repair; normal dev startup will remove only that generated cache.');
  if (result.missing.length) console.log('API build outputs are incomplete; build:deps and the compiler must finish before API readiness.');
  console.log('PASS dev preflight. This is not API, database or interactive-browser readiness; ports can change after this probe.');
}
module.exports = { API_ENV_PATHS, OUTPUTS, apiPort, availablePort, missingApiOutputs, prepareApiCache };
if (require.main === module) main().catch((error) => {
  // Only controlled diagnostics, never filesystem exceptions containing private paths/values.
  const safe = /^(Use |Node |API |Web |An API |Refusing )/u.test(error.message);
  console.error(`FAIL ${safe ? error.message : 'Dev preflight failed; inspect runtime declarations and generated-cache permissions'}`);
  process.exitCode = 1;
});
