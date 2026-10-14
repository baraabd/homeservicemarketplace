'use strict';

// Tests for the guarded Prisma generator.
//
//   MOCK   cases inject a fake Prisma run, engine load test and holder list.
//          They prove ordering, locking and record handling, not OS behaviour.
//   REAL   cases start real processes: an interrupted generator killed by the
//          OS, and (Windows only) the real Prisma CLI against an engine that
//          a separate process has actually loaded.

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { generateClient, GenerateError } = require('./generate-client.cjs');
const generation = require('./prisma-generation.cjs');
const { writeGeneratedClient, ENGINE_VERSION } = require('./generation-fixture.cjs');

const SCHEMA = `generator client {
  provider = "prisma-client-js"
  output   = "../generated client/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Example {
  id String @id
}
`;
const DATABASE_DIR = path.resolve(__dirname, '..');

async function fixture(t) {
  // Spaces on purpose: Windows paths with spaces must survive every spawn.
  // Inside packages/database so the pinned @prisma/client resolves from the
  // fixture schema; elsewhere the real Prisma CLI would try to npm-install it
  // into a directory of its choosing (the guard now refuses that case).
  const parent = path.join(DATABASE_DIR, '.test-fixtures');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'hsm prisma guard '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const schemaPath = path.join(root, 'database pkg', 'prisma', 'schema.prisma');
  await fs.mkdir(path.dirname(schemaPath), { recursive: true });
  await fs.writeFile(schemaPath, SCHEMA);
  const output = generation.generatorOutput(schemaPath, SCHEMA);
  return { root, schemaPath, output };
}

function fakePrisma(output, { status = 0, signal = null, text = '', before } = {}) {
  return async () => {
    await before?.();
    if (status === 0 && !signal) writeGeneratedClient(output, SCHEMA, { record: false });
    return { status, signal, output: text };
  };
}

function options(f, overrides = {}) {
  return {
    databaseDir: DATABASE_DIR,
    schemaPath: f.schemaPath,
    root: f.root,
    smoke: () => ENGINE_VERSION,
    // Fixture engines are arbitrary bytes, not the installed Prisma engine.
    engineSource: () => null,
    listHolders: () => null,
    log: () => {},
    lockWaitMs: 2_000,
    ...overrides,
  };
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

const recordOf = (f) => path.join(f.output, generation.RECORD_FILE);

test('MOCK success writes the record only after the engine load test, and removes leftover temp engines', async (t) => {
  const f = await fixture(t);
  const order = [];
  const record = await generateClient(
    options(f, {
      runPrisma: async (...args) => {
        order.push('prisma');
        await fs.mkdir(f.output, { recursive: true });
        await fs.writeFile(path.join(f.output, 'query_engine-windows.dll.node.tmp35664'), 'stale');
        return fakePrisma(f.output)(...args);
      },
      smoke: (engine) => {
        order.push(`smoke:${path.basename(engine)}`);
        return ENGINE_VERSION;
      },
    }),
  );
  assert.equal(record.state, 'complete');
  assert.deepEqual(order, ['prisma', `smoke:${record.nativeEngine}`]);
  assert.ok(await exists(recordOf(f)));
  assert.equal(await exists(path.join(f.output, 'query_engine-windows.dll.node.tmp35664')), false);
  assert.equal(await exists(generation.lockPath(f.output)), false);
  assert.deepEqual(await generation.generationProblems({ schemaPath: f.schemaPath }), []);
});

test('MOCK a nonzero Prisma exit propagates and invalidates the previous record', async (t) => {
  const f = await fixture(t);
  await generateClient(options(f, { runPrisma: fakePrisma(f.output) }));
  assert.ok(await exists(recordOf(f)));
  await assert.rejects(
    generateClient(options(f, { runPrisma: fakePrisma(f.output, { status: 7 }) })),
    (error) =>
      error instanceof GenerateError && error.exitCode === 7 && /exit code 7/u.test(error.message),
  );
  assert.equal(await exists(recordOf(f)), false);
  assert.equal(await exists(generation.lockPath(f.output)), false);
  assert.deepEqual(await generation.generationProblems({ schemaPath: f.schemaPath }), [
    'record-missing',
  ]);
});

test('MOCK Prisma rewriting the client then failing EPERM on the engine leaves an invalid state', async (t) => {
  const f = await fixture(t);
  await generateClient(options(f, { runPrisma: fakePrisma(f.output) }));
  const { nativeEngine: engine } = JSON.parse(await fs.readFile(recordOf(f), 'utf8'));
  const text = `Error: EPERM: operation not permitted, rename '${path.join(f.output, `${engine}.tmp35664`)}' -> '${path.join(f.output, engine)}'`;
  await assert.rejects(
    generateClient(
      options(f, {
        listHolders: () => [{ pid: 4242, name: 'node' }],
        runPrisma: async () => {
          // The JS client is rewritten for a newer engine; the old engine stays.
          writeGeneratedClient(f.output, SCHEMA, {
            record: false,
            engineVersion: 'b'.repeat(40),
            engineBytes: 'fixture engine bytes',
          });
          return { status: 1, signal: null, output: text };
        },
      }),
    ),
    (error) =>
      /During generation: the Prisma query engine .* is in use/u.test(error.message) &&
      /node \(PID 4242\)/u.test(error.message) &&
      /dev preflight will refuse to start/u.test(error.message),
  );
  assert.deepEqual(await generation.generationProblems({ schemaPath: f.schemaPath }), [
    'record-missing',
  ]);
});

test('MOCK a Prisma run stopped by a signal is not complete', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    generateClient(
      options(f, { runPrisma: fakePrisma(f.output, { status: null, signal: 'SIGTERM' }) }),
    ),
    /stopped by SIGTERM/u,
  );
  assert.equal(await exists(recordOf(f)), false);
});

test('MOCK an engine that does not load, or reports another commit, gets no record', async (t) => {
  const f = await fixture(t);
  for (const smoke of [() => null, () => 'f'.repeat(40)]) {
    await assert.rejects(
      generateClient(options(f, { runPrisma: fakePrisma(f.output), smoke })),
      /did not load in a separate process or reports a different version/u,
    );
    assert.equal(await exists(recordOf(f)), false);
  }
});

test('MOCK a reported success with the engine missing gets no record', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    generateClient(
      options(f, {
        runPrisma: async () => {
          const { engine } = writeGeneratedClient(f.output, SCHEMA, { record: false });
          await fs.rm(path.join(f.output, engine));
          return { status: 0, signal: null, output: '' };
        },
      }),
    ),
    /is missing after generation/u,
  );
  assert.equal(await exists(recordOf(f)), false);
});

test('MOCK concurrent generations of one output never overlap', async (t) => {
  const f = await fixture(t);
  let active = 0;
  let peak = 0;
  const slow = fakePrisma(f.output, {
    before: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 150));
      active -= 1;
    },
  });
  const results = await Promise.all(
    [1, 2, 3].map(() => generateClient(options(f, { runPrisma: slow, lockWaitMs: 10_000 }))),
  );
  assert.equal(peak, 1);
  assert.equal(results.length, 3);
  assert.deepEqual(await generation.generationProblems({ schemaPath: f.schemaPath }), []);
});

test('MOCK a live generation holding the lock makes another attempt fail within its bound', async (t) => {
  const f = await fixture(t);
  const lock = generation.lockPath(f.output);
  await fs.mkdir(lock, { recursive: true });
  // This test process is alive, so the lock is not stale.
  await fs.writeFile(
    path.join(lock, 'owner.json'),
    JSON.stringify({ pid: process.pid, host: os.hostname() }),
  );
  const started = Date.now();
  await assert.rejects(
    generateClient(options(f, { runPrisma: fakePrisma(f.output), lockWaitMs: 400 })),
    new RegExp(`Another Prisma generation \\(process ${process.pid}\\) is running`, 'u'),
  );
  assert.ok(Date.now() - started < 5_000);
  assert.ok(await exists(lock), 'a lock owned by someone else is never removed');
});

test('REAL an interrupted generator leaves a stale lock and no record; the next run recovers', async (t) => {
  const f = await fixture(t);
  await generateClient(options(f, { runPrisma: fakePrisma(f.output) }));
  // A real child process enters generation and is killed by the OS mid-run.
  const driver = `
    const { generateClient } = require(${JSON.stringify(path.join(__dirname, 'generate-client.cjs'))});
    generateClient({
      databaseDir: ${JSON.stringify(DATABASE_DIR)},
      schemaPath: ${JSON.stringify(f.schemaPath)},
      log: () => {},
      engineSource: () => null,
      runPrisma: () => { console.log('IN_GENERATION'); return new Promise(() => {}); },
    });`;
  const child = spawn(process.execPath, ['-e', driver], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('driver did not start')), 20_000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('IN_GENERATION')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await exited;
  assert.equal(await exists(recordOf(f)), false);
  assert.deepEqual(await generation.generationProblems({ schemaPath: f.schemaPath }), [
    'generation-in-progress-or-interrupted',
    'record-missing',
  ]);
  const logs = [];
  await generateClient(
    options(f, { runPrisma: fakePrisma(f.output), log: (line) => logs.push(line) }),
  );
  assert.ok(
    logs.some((line) => /Removed a stale generation lock/u.test(line)),
    logs.join('\n'),
  );
  assert.deepEqual(await generation.generationProblems({ schemaPath: f.schemaPath }), []);
});

// ── REAL Windows engine lock with the real Prisma CLI ─────────────────────

function runGenerator(f) {
  const driver = `
    const { generateClient } = require(${JSON.stringify(path.join(__dirname, 'generate-client.cjs'))});
    generateClient({ databaseDir: ${JSON.stringify(DATABASE_DIR)}, schemaPath: ${JSON.stringify(f.schemaPath)}, root: ${JSON.stringify(f.root)} })
      .catch((error) => { console.error('FAIL ' + error.message); process.exitCode = error.exitCode || 1; });`;
  return spawnSync(process.execPath, ['-e', driver], {
    encoding: 'utf8',
    timeout: 300_000,
    windowsHide: true,
  });
}

async function startHolder(engine) {
  const holder = spawn(
    process.execPath,
    ['-e', "require(process.argv[1]); console.log('LOADED'); setInterval(() => {}, 1000)", engine],
    { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('holder did not load the engine')), 30_000);
    holder.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('LOADED')) {
        clearTimeout(timer);
        resolve();
      }
    });
    holder.once('exit', () => reject(new Error('holder exited early')));
  });
  return holder;
}

test(
  'REAL Windows: a loaded engine makes generation fail safely, and it succeeds once the holder exits',
  { skip: process.platform !== 'win32' && 'needs Windows image-file locking', timeout: 600_000 },
  async (t) => {
    const f = await fixture(t);
    const first = runGenerator(f);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const engine = path.join(f.output, 'query_engine-windows.dll.node');

    const holder = await startHolder(engine);
    const gone = new Promise((resolve) => holder.once('exit', resolve));
    // Stopped and awaited inside the test, never in a hook: the fixture's
    // directory removal cannot delete an engine that is still loaded.
    const stopHolder = async () => {
      if (holder.exitCode === null && holder.signalCode === null) holder.kill();
      await gone;
    };
    try {
      // 1. The lock is real: Windows refuses a write handle to a loaded image.
      assert.equal(await generation.engineAccess(engine), 'busy');

      // The original failure, with the real Prisma CLI and no guard: EPERM on
      // the engine rename after the JavaScript client was rewritten.
      const cli = require.resolve('prisma/build/index.js', { paths: [DATABASE_DIR] });
      const raw = spawnSync(process.execPath, [cli, 'generate', '--schema', f.schemaPath], {
        cwd: DATABASE_DIR,
        encoding: 'utf8',
        timeout: 300_000,
        windowsHide: true,
      });
      assert.notEqual(raw.status, 0);
      assert.match(raw.stdout + raw.stderr, /EPERM[\s\S]*query_engine-windows\.dll\.node/u);

      // 2. The guarded generator fails safely while the lock exists.
      const locked = runGenerator(f);
      assert.equal(locked.status, 1, locked.stdout + locked.stderr);
      assert.match(locked.stderr, /is in use by another process/u);
      assert.ok(locked.stderr.includes(`node (PID ${holder.pid})`), locked.stderr);
      assert.deepEqual(await generation.generationProblems({ schemaPath: f.schemaPath }), [
        'record-missing',
      ]);

      // 3. The holder exits and the lock is released.
      await stopHolder();
      assert.equal(await generation.engineAccess(engine), 'free');

      // 4. Recovery succeeds after the release.
      const recovered = runGenerator(f);
      assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
      assert.deepEqual(await generation.generationProblems({ schemaPath: f.schemaPath }), []);
    } finally {
      await stopHolder();
    }
  },
);

test(
  'REAL generation on this platform writes a record naming its own native engine',
  { skip: process.platform === 'win32' && 'covered by the Windows lock test', timeout: 600_000 },
  async (t) => {
    const f = await fixture(t);
    const result = runGenerator(f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const record = JSON.parse(await fs.readFile(recordOf(f), 'utf8'));
    assert.equal(record.platform, process.platform);
    assert.notEqual(record.nativeEngine, 'query_engine-windows.dll.node');
    assert.ok(Object.hasOwn(record.engines, record.nativeEngine));
    assert.deepEqual(await generation.generationProblems({ schemaPath: f.schemaPath }), []);
  },
);

test('MOCK Prisma is never started when the pinned client is not resolvable (no self-install)', async (t) => {
  const f = await fixture(t);
  let started = false;
  await assert.rejects(
    generateClient(
      options(f, {
        clientResolvable: () => false,
        runPrisma: async () => {
          started = true;
          return { status: 0, signal: null, output: '' };
        },
      }),
    ),
    /would try to install packages itself/u,
  );
  assert.equal(started, false);
  assert.equal(await exists(recordOf(f)), false);
});
