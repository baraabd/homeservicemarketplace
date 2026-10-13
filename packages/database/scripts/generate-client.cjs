'use strict';

// Guarded `prisma generate` for this workspace. Every generation path (the
// `generate` package script used by dev:repair, CI and the API image) runs
// through here, so the completion record means the same thing everywhere.
//
//   1. One generation at a time per output directory (a lock directory that
//      records its owner; a lock whose owner process has exited is stale).
//   2. Remove the previous completion record BEFORE anything is written, so
//      a failed or interrupted attempt can never leave an earlier "complete"
//      record next to newer, partial output.
//   3. Refuse early, changing nothing, if a process has the query engine
//      loaded (Windows cannot replace it; Prisma would rewrite the JS client
//      and then fail on the engine rename).
//   4. Run the pinned Prisma CLI through the current Node executable, no
//      shell, bounded by a timeout. Its exit status is propagated.
//   5. Check the result: required files, the native engine byte-identical to
//      the installed @prisma/engines copy, and the engine loaded in a
//      separate short-lived process that reports the expected commit. That
//      process has exited before this one continues.
//   6. Only then write the completion record (atomically) and release the lock.
//
// Bounded waits only: the lock wait and the Prisma run both have a deadline.
// No process is ever signalled except the Prisma child this script started.

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const {
  RECORD_FILE,
  RECORD_SCHEMA_VERSION,
  REQUIRED_OUTPUTS,
  PRISMA_ENGINE_TEMP,
  GenerationStateError,
  schemaFingerprint,
  generatorOutput,
  clientFacts,
  libraryEngineFile,
  sha256File,
  lockPath,
  engineAccess,
} = require('./prisma-generation.cjs');

const DATABASE_DIR = path.resolve(__dirname, '..');
const DEFAULT_LOCK_WAIT_MS = 120_000;
const DEFAULT_GENERATE_TIMEOUT_MS = 600_000;
const LOCK_POLL_MS = 250;
const SMOKE_TIMEOUT_MS = 30_000;

class GenerateError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function relative(file, root) {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') ? rel : path.basename(file);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error.code === 'EPERM';
  }
}

async function acquireLock(output, { waitMs, log, now = Date.now, sleep }) {
  const lock = lockPath(output);
  const deadline = now() + waitMs;
  let reportedWait = false;
  for (;;) {
    try {
      await fs.mkdir(lock);
      const owner = { pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() };
      await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify(owner));
      return async () => {
        await fs.rm(lock, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let owner = null;
    try {
      owner = JSON.parse(await fs.readFile(path.join(lock, 'owner.json'), 'utf8'));
    } catch {
      // The owner may be between mkdir and writing owner.json; wait.
    }
    if (owner && owner.host === os.hostname() && !processAlive(owner.pid)) {
      await fs.rm(lock, { recursive: true, force: true });
      log(
        `Removed a stale generation lock: its owner (process ${owner.pid}) is no longer running. That attempt did not complete.`,
      );
      continue;
    }
    if (now() >= deadline) {
      throw new GenerateError(
        `Another Prisma generation${owner ? ` (process ${owner.pid})` : ''} is running for this checkout. ` +
          'Wait for it to finish, then run the command again. Nothing was changed.',
      );
    }
    if (!reportedWait) {
      log('Waiting for another Prisma generation of this checkout to finish...');
      reportedWait = true;
    }
    await sleep(LOCK_POLL_MS);
  }
}

/** Read-only list of processes that have `engine` loaded (Windows only). */
function windowsEngineHolders(engine) {
  if (process.platform !== 'win32') return null;
  const script =
    "$t=$env:HSM_ENGINE_PATH; Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $p=$_; try { foreach ($m in $p.Modules) { if ($m.FileName -ieq $t) { '{0}{1}{2}' -f $p.Id,[char]9,$p.ProcessName; break } } } catch {} }";
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env: { ...process.env, HSM_ENGINE_PATH: engine },
      encoding: 'utf8',
      timeout: 20_000,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) return null;
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, name] = line.split('\t');
      return { pid: Number(pid), name };
    });
}

function engineLockedMessage(engine, root, stage, holders) {
  const lines = [
    `${stage}: the Prisma query engine ${relative(engine, root)} is in use by another process, so it cannot be replaced.`,
  ];
  if (holders?.length) {
    lines.push(
      `Processes that have this engine loaded: ${holders.map((h) => `${h.name} (PID ${h.pid})`).join(', ')}.`,
    );
  } else if (holders) {
    lines.push(
      'No process visible to this user lists it as loaded; a security scanner or an elevated process may hold it. Wait a minute and retry.',
    );
  }
  lines.push(
    'Release it: stop the API dev server (Ctrl+C in its terminal), Prisma Studio, and any test run that uses this checkout, then run the same command again.',
    'Nothing was regenerated; the previous completion record was removed, so dev preflight will refuse to start until generation succeeds.',
  );
  return lines.join('\n');
}

function runPrismaCli({ databaseDir, schemaPath, timeoutMs }) {
  let cli;
  try {
    cli = require.resolve('prisma/build/index.js', { paths: [databaseDir] });
  } catch {
    throw new GenerateError(
      'The pinned Prisma CLI is not installed for packages/database. Run pnpm install --frozen-lockfile first.',
    );
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, 'generate', '--schema', schemaPath], {
      cwd: databaseDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    let tail = '';
    const keep = (chunk) => {
      tail = (tail + chunk.toString()).slice(-65_536);
    };
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      keep(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      keep(chunk);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ status: null, signal: null, output: tail, spawnFailed: true });
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, output: tail, timedOut });
    });
  });
}

/** Load the engine in a separate process that exits before we continue. */
function engineCommit(engine) {
  const result = spawnSync(
    process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(require(process.argv[1]).version()))', engine],
    { encoding: 'utf8', timeout: SMOKE_TIMEOUT_MS, windowsHide: true },
  );
  if (result.error || result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout).commit ?? null;
  } catch {
    return null;
  }
}

function installedEngineSource(databaseDir, file) {
  try {
    const prismaPackage = require.resolve('prisma/package.json', { paths: [databaseDir] });
    const enginesPackage = require.resolve('@prisma/engines/package.json', {
      paths: [path.dirname(prismaPackage)],
    });
    return path.join(path.dirname(enginesPackage), file);
  } catch {
    return null;
  }
}

async function verifyOutput({ output, databaseDir, root, smoke, engineSource }) {
  for (const file of REQUIRED_OUTPUTS) {
    try {
      if (!(await fs.stat(path.join(output, file))).isFile()) throw new Error();
    } catch {
      throw new GenerateError(
        `Generation reported success but ${file} is missing from the output.`,
      );
    }
  }
  const facts = clientFacts(await fs.readFile(path.join(output, 'index.js'), 'utf8'));
  if (!facts.clientVersion || !facts.engineVersion || !facts.engineType) {
    throw new GenerateError('The generated client does not state its client and engine versions.');
  }
  const engines = {};
  let nativeEngine;
  if (facts.engineType === 'library') {
    if (!facts.nativeTarget) {
      throw new GenerateError('The generated client names no native binary target.');
    }
    nativeEngine = libraryEngineFile(facts.nativeTarget);
    const names = new Set([...facts.engines, nativeEngine]);
    for (const name of names) {
      const file = path.join(output, name);
      try {
        engines[name] = await sha256File(file);
      } catch {
        throw new GenerateError(
          `The query engine ${relative(file, root)} is missing after generation.`,
        );
      }
    }
    const source = engineSource(databaseDir, nativeEngine);
    if (source) {
      let sourceDigest = null;
      try {
        sourceDigest = await sha256File(source);
      } catch {
        // Not every install keeps the engine there; the load test still runs.
      }
      if (sourceDigest && sourceDigest !== engines[nativeEngine]) {
        throw new GenerateError(
          `The query engine ${relative(path.join(output, nativeEngine), root)} differs from the installed Prisma engine; the engine was not replaced.`,
        );
      }
    }
    const commit = smoke(path.join(output, nativeEngine));
    if (commit !== facts.engineVersion) {
      throw new GenerateError(
        `The query engine ${relative(path.join(output, nativeEngine), root)} did not load in a separate process or reports a different version than the client expects.`,
      );
    }
  } else {
    throw new GenerateError(
      `Engine type "${facts.engineType}" is not supported by the generation guard; update scripts/prisma-generation.cjs.`,
    );
  }
  return { facts, engines, nativeEngine };
}

async function removePrismaTempEngines(output) {
  let removed = 0;
  for (const name of await fs.readdir(output)) {
    if (!PRISMA_ENGINE_TEMP.test(name)) continue;
    try {
      await fs.unlink(path.join(output, name));
      removed += 1;
    } catch {
      // Still open somewhere; it is only disk space, leave it.
    }
  }
  return removed;
}

function prismaClientResolvable(directory) {
  try {
    require.resolve('@prisma/client/package.json', { paths: [directory] });
    return true;
  } catch {
    return false;
  }
}

async function generateClient({
  databaseDir = DATABASE_DIR,
  schemaPath = path.join(databaseDir, 'prisma/schema.prisma'),
  root = path.resolve(databaseDir, '../..'),
  runPrisma = runPrismaCli,
  smoke = engineCommit,
  engineSource = installedEngineSource,
  clientResolvable = prismaClientResolvable,
  listHolders = windowsEngineHolders,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
  timeoutMs = DEFAULT_GENERATE_TIMEOUT_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
} = {}) {
  let schemaText;
  try {
    schemaText = await fs.readFile(schemaPath, 'utf8');
  } catch {
    throw new GenerateError('The Prisma schema is missing or unreadable.');
  }
  let output;
  try {
    output = generatorOutput(schemaPath, schemaText);
  } catch (error) {
    throw new GenerateError(
      error instanceof GenerationStateError ? error.message : 'Unreadable generator block.',
    );
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  const release = await acquireLock(output, { waitMs: lockWaitMs, log, sleep });
  try {
    // From here until the final write, the output is "not complete".
    await fs.rm(path.join(output, RECORD_FILE), { force: true });

    let existing = [];
    try {
      existing = (await fs.readdir(output)).filter((name) =>
        /^(?:lib)?query_engine-[A-Za-z0-9._-]+\.node$/u.test(name),
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const name of existing) {
      const engine = path.join(output, name);
      const access = await engineAccess(engine);
      if (access === 'busy') {
        throw new GenerateError(
          engineLockedMessage(engine, root, 'Before generation', listHolders(engine)),
        );
      }
      if (access === 'denied') {
        throw new GenerateError(
          `Before generation: this user may not write ${relative(engine, root)} (permission or read-only attribute). Fix the file's permissions; do not run the project as administrator. Nothing was regenerated.`,
        );
      }
    }

    // When @prisma/client is not resolvable from the schema, `prisma generate`
    // runs its own npm install into a directory it chooses, which can be
    // outside the repository (observed: the user's home folder). Never let
    // that happen; the pinned client comes only from pnpm install.
    if (!clientResolvable(path.dirname(schemaPath))) {
      throw new GenerateError(
        'The pinned @prisma/client is not installed where this schema can resolve it, so Prisma would try to install packages itself. Run pnpm install --frozen-lockfile first. Nothing was regenerated.',
      );
    }
    log('Generating Prisma Client...');
    const result = await runPrisma({ databaseDir, schemaPath, timeoutMs });
    if (result.spawnFailed) throw new GenerateError('The Prisma CLI could not be started.');
    if (result.timedOut) {
      throw new GenerateError('Prisma generation exceeded its time limit and was stopped.');
    }
    if (result.signal || result.status !== 0) {
      // Prisma names the engine it failed to replace (rename <tmp> -> <engine>).
      const text = result.output ?? '';
      const named = /\b(?:EPERM|EBUSY)\b/u.test(text)
        ? /((?:lib)?query_engine-[A-Za-z0-9._-]+?\.node)(?!\.tmp)/u.exec(
            text.replace(/\.node\.tmp\d+/gu, '.node.tmp'),
          )?.[1]
        : null;
      const lockedEngine = named ? path.join(output, named) : null;
      if (lockedEngine) {
        throw new GenerateError(
          engineLockedMessage(lockedEngine, root, 'During generation', listHolders(lockedEngine)),
          result.status || 1,
        );
      }
      throw new GenerateError(
        `Prisma generation failed${result.signal ? ` (stopped by ${result.signal})` : ` with exit code ${result.status}`}; see its output above. The completion record was not written.`,
        Number.isInteger(result.status) && result.status > 0 ? result.status : 1,
      );
    }

    const { facts, engines, nativeEngine } = await verifyOutput({
      output,
      databaseDir,
      root,
      smoke,
      engineSource,
    });
    const record = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      state: 'complete',
      schema: schemaFingerprint(schemaText),
      clientVersion: facts.clientVersion,
      engineVersion: facts.engineVersion,
      engineType: facts.engineType,
      nativeTarget: facts.nativeTarget,
      nativeEngine,
      engines,
      platform: process.platform,
      arch: process.arch,
      completedAt: new Date().toISOString(),
    };
    const temporary = path.join(output, `${RECORD_FILE}.${process.pid}.tmp`);
    await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
    await fs.rename(temporary, path.join(output, RECORD_FILE));
    const removed = await removePrismaTempEngines(output);
    if (removed) log(`Removed ${removed} leftover Prisma temporary engine file(s).`);
    log(
      `PASS Prisma Client ${facts.clientVersion} generated and its ${nativeEngine} engine loaded in a separate process. This is not database or application readiness.`,
    );
    return record;
  } finally {
    await release();
  }
}

module.exports = {
  GenerateError,
  generateClient,
  acquireLock,
  engineLockedMessage,
  processAlive,
  windowsEngineHolders,
};

if (require.main === module) {
  if (process.argv.length > 2) {
    console.error('Usage: node scripts/generate-client.cjs');
    process.exitCode = 1;
  } else {
    generateClient().catch((error) => {
      console.error(
        `FAIL ${error instanceof GenerateError ? error.message : 'Prisma generation failed unexpectedly; the completion record was not written.'}`,
      );
      process.exitCode = error instanceof GenerateError ? error.exitCode : 1;
    });
  }
}
