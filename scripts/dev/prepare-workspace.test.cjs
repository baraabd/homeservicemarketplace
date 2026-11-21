'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { PNPM_VERSION } = require('../runtime/toolchain.cjs');
const { inspectWorkspaceState, workspaceStateProblems } = require('./workspace-state.cjs');
const { prepareWorkspace, assertApiStopped } = require('./prepare-workspace.cjs');
const { writeGeneratedClient } = require('../../packages/database/scripts/generation-fixture.cjs');

const PRIVATE = 'private-fixture-value-must-not-appear';
const SCHEMA =
  'generator client {\n provider = "prisma-client-js"\n output = "../generated/prisma"\n}\n';
const GENERATED = 'packages/database/generated/prisma';
const EXPECTED = [
  ['--filter', '@homeservicemarketplace/database', 'generate'],
  ['--filter', '@homeservicemarketplace/api', 'typecheck'],
];

async function write(root, file, value) {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, typeof value === 'string' ? value : JSON.stringify(value));
}

async function fixture(t, stale = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm dev preparation '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(root, 'pnpm-lock.yaml', 'lockfileVersion: "9.0"\n');
  await write(root, 'packages/database/package.json', {
    dependencies: { '@prisma/client': '6.12.0' },
    devDependencies: { prisma: '6.12.0' },
  });
  await write(root, 'apps/api/package.json', { dependencies: { sharp: '0.35.5' } });
  for (const [consumer, name, version] of [
    ['packages/database', '@prisma/client', '6.12.0'],
    ['packages/database', 'prisma', '6.12.0'],
    ['apps/api', 'sharp', '0.35.5'],
  ]) {
    await write(root, `${consumer}/node_modules/${name}/package.json`, {
      name,
      version,
      main: './index.js',
    });
    await write(
      root,
      `${consumer}/node_modules/${name}/index.js`,
      `throw new Error('${PRIVATE}');\n`,
    );
  }
  // Mirror Prisma 6.12's published exports: the root types export is absent,
  // while the executable CLI subpath is present and must be the inspected one.
  await write(root, 'packages/database/node_modules/prisma/package.json', {
    name: 'prisma',
    version: '6.12.0',
    main: './build/index.js',
    exports: {
      '.': './build/types.js',
      './build/index.js': './build/index.js',
      './package.json': './package.json',
    },
  });
  await write(
    root,
    'packages/database/node_modules/prisma/build/index.js',
    `throw new Error('${PRIVATE}');\n`,
  );
  await write(root, 'packages/database/prisma/schema.prisma', SCHEMA);
  writeGeneratedClient(path.join(root, GENERATED), stale ? `${SCHEMA}// older schema\n` : SCHEMA);
  for (const file of [
    '.env',
    'apps/api/.media-uploads/photo',
    'apps/api/.restricted-uploads/evidence',
  ]) {
    await write(root, file, PRIVATE);
  }
  for (const file of ['prepare-workspace.cjs', 'workspace-state.cjs', 'repair.cjs']) {
    await write(root, `scripts/dev/${file}`, await fs.readFile(path.join(__dirname, file), 'utf8'));
  }
  for (const file of ['prisma-generation.cjs', 'generate-client.cjs', 'generation-fixture.cjs']) {
    await write(
      root,
      `packages/database/scripts/${file}`,
      await fs.readFile(path.join(__dirname, '../../packages/database/scripts', file), 'utf8'),
    );
  }
  // Runtime and port discovery have independent suites. The real preparation
  // CLI, structured inspector, guarded generator and child launcher run here.
  // Only pnpm/Prisma outputs are fixtures: no install, native library or DB.
  await write(
    root,
    'scripts/runtime/toolchain.cjs',
    `exports.ROOT = require('node:path').resolve(__dirname, '../..');\n` +
      `exports.PNPM_VERSION = ${JSON.stringify(PNPM_VERSION)};\n` +
      'exports.toolchainProblems = async () => [];\n',
  );
  await write(
    root,
    'scripts/dev/preflight.cjs',
    'exports.apiPort = async () => 4000;\nexports.availablePort = async () => true;\n',
  );
  await write(
    root,
    'pnpm shim (fixture).cjs',
    `
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync('commands.jsonl', JSON.stringify(args) + '\\n');
const stage = args.at(-1);
if (process.env.FAIL_STAGE === stage) process.exit(19);
if (stage === 'generate') {
  if (process.env.KEEP_STALE) process.exit(0);
  const { generateClient } = require('./packages/database/scripts/generate-client.cjs');
  const { writeGeneratedClient, ENGINE_VERSION } = require('./packages/database/scripts/generation-fixture.cjs');
  generateClient({
    runPrisma: async ({ schemaPath }) => {
      if (process.env.LOCKED_ENGINE) return {
        status: 23,
        output: 'EPERM rename query_engine-windows.dll.node.tmp456 query_engine-windows.dll.node',
      };
      writeGeneratedClient('${GENERATED}', fs.readFileSync(schemaPath, 'utf8'), { record: false });
      return { status: 0 };
    },
    smoke: () => ENGINE_VERSION,
    engineSource: () => null,
    listHolders: () => [{ pid: 4242, name: 'node' }],
  }).then(() => {
    if (process.env.CHANGE_LOCK) fs.appendFileSync('pnpm-lock.yaml', '# changed\\n');
  }).catch(error => { console.error(error.message); process.exitCode = error.exitCode || 1; });
} else if (stage === 'typecheck') {
  if (process.env.CHANGE_SCHEMA) fs.appendFileSync('packages/database/prisma/schema.prisma', '// new change\\n');
} else process.exit(29);
`,
  );
  return {
    root,
    environment: {
      ...process.env,
      NODE_ENV: 'development',
      APP_ENV: 'dev',
      npm_execpath: path.join(root, 'pnpm shim (fixture).cjs'),
      npm_config_user_agent: `pnpm/${PNPM_VERSION} npm/? node/${process.versions.node}`,
      FAIL_STAGE: '',
      KEEP_STALE: '',
      CHANGE_LOCK: '',
      CHANGE_SCHEMA: '',
      LOCKED_ENGINE: '',
    },
  };
}

function cli(options, args = []) {
  return spawnSync(
    process.execPath,
    [path.join(options.root, 'scripts/dev/prepare-workspace.cjs'), ...args],
    {
      cwd: os.tmpdir(),
      env: options.environment,
      encoding: 'utf8',
      timeout: 20_000,
    },
  );
}

async function commands(root) {
  try {
    return (await fs.readFile(path.join(root, 'commands.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

test('stale generated artifacts have structured regeneration eligibility; diagnostics stay read-only', async (t) => {
  const options = await fixture(t);
  const state = await inspectWorkspaceState(options.root, { forGeneration: true });
  assert.equal(state.canRegenerate, true);
  assert.deepEqual(
    state.issues.map(({ category, code }) => ({ category, code })),
    [{ category: 'generated', code: 'schema-stale' }],
  );
  assert.deepEqual(
    await workspaceStateProblems(options.root),
    state.issues.map((entry) => entry.message),
  );
  assert.deepEqual(await commands(options.root), []);
});

test('real preparation CLI regenerates once, verifies and typechecks, preserving source/private files', async (t) => {
  const options = await fixture(t);
  const protectedFiles = [
    'pnpm-lock.yaml',
    '.env',
    'packages/database/prisma/schema.prisma',
    'packages/database/package.json',
    'apps/api/package.json',
    'apps/api/.media-uploads/photo',
    'apps/api/.restricted-uploads/evidence',
  ];
  const before = await Promise.all(
    protectedFiles.map((file) => fs.readFile(path.join(options.root, file))),
  );
  const result = cli(options);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS dev workspace preparation and API typecheck/u);
  assert.ok(!(result.stdout + result.stderr).includes(PRIVATE));
  assert.deepEqual(await commands(options.root), EXPECTED);
  assert.deepEqual(await workspaceStateProblems(options.root), []);
  assert.deepEqual(
    await Promise.all(protectedFiles.map((file) => fs.readFile(path.join(options.root, file)))),
    before,
  );
  const again = cli(options);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /No generation or dependency changes/u);
  assert.deepEqual(await commands(options.root), EXPECTED);
});

test('already current workspace starts without running pnpm commands', async (t) => {
  const options = await fixture(t, false);
  const result = cli(options);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await commands(options.root), []);
});

test('missing generated client uses the same guarded generation path', async (t) => {
  const options = await fixture(t);
  await fs.rm(path.join(options.root, GENERATED), { recursive: true });
  const result = cli(options);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(await commands(options.root), EXPECTED);
  assert.deepEqual(await workspaceStateProblems(options.root), []);
});

for (const [directory, name, version] of [
  ['packages/database', '@prisma/client', '6.11.0'],
  ['packages/database', 'prisma', '6.11.0'],
  ['apps/api', 'sharp', '0.35.4'],
]) {
  test(`installed ${name} drift requires explicit repair and never generates or installs`, async (t) => {
    const options = await fixture(t);
    await write(options.root, `${directory}/node_modules/${name}/package.json`, {
      name,
      version,
      main: './index.js',
    });
    const result = cli(options);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /pnpm dev:repair/u);
    assert.deepEqual(await commands(options.root), []);
    assert.ok(!(result.stdout + result.stderr).includes(PRIVATE));
  });
}

test('missing source schema prevents every command', async (t) => {
  const options = await fixture(t);
  await fs.unlink(path.join(options.root, 'packages/database/prisma/schema.prisma'));
  const result = cli(options);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source schema is missing or unreadable/u);
  assert.deepEqual(await commands(options.root), []);
});

test('generator output outside this checkout is never automatically rewritten', async (t) => {
  const options = await fixture(t);
  await write(
    options.root,
    'packages/database/prisma/schema.prisma',
    SCHEMA.replace('../generated/prisma', '../../../../outside'),
  );
  const result = cli(options);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Automatic Prisma preparation requires/u);
  assert.deepEqual(await commands(options.root), []);
});

test('redirected output preserves the other workspace', async (t) => {
  const options = await fixture(t);
  const other = await fixture(t, false);
  const otherSchema = await fs.readFile(path.join(other.root, GENERATED, 'schema.prisma'));
  await fs.rm(path.join(options.root, GENERATED), { recursive: true });
  await fs.symlink(
    path.join(other.root, GENERATED),
    path.join(options.root, GENERATED),
    'junction',
  );
  await write(options.root, 'packages/database/prisma/schema.prisma', `${SCHEMA}// new schema\n`);
  const result = cli(options);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /redirected directory/u);
  assert.deepEqual(await commands(options.root), []);
  assert.deepEqual(
    await fs.readFile(path.join(other.root, GENERATED, 'schema.prisma')),
    otherSchema,
  );
});

test('a redirected entry inside generated output cannot reach generation', async (t) => {
  const options = await fixture(t);
  const other = await fixture(t, false);
  await fs.symlink(
    path.join(other.root, 'apps/api/.restricted-uploads'),
    path.join(options.root, GENERATED, 'runtime'),
    'junction',
  );
  const result = cli(options);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /redirected directory/u);
  assert.deepEqual(await commands(options.root), []);
  assert.equal(
    await fs.readFile(path.join(other.root, 'apps/api/.restricted-uploads/evidence'), 'utf8'),
    PRIVATE,
  );
});

for (const [stage, count] of [
  ['generate', 1],
  ['typecheck', 2],
]) {
  test(`${stage} failure stops startup with the original exit code`, async (t) => {
    const options = await fixture(t);
    options.environment.FAIL_STAGE = stage;
    const result = cli(options);
    assert.equal(result.status, 19, result.stderr);
    assert.deepEqual(await commands(options.root), EXPECTED.slice(0, count));
    assert.doesNotMatch(result.stdout, /PASS dev workspace preparation/u);
  });
}

test('canonical generator EPERM refusal cannot reach typecheck or leave a completion record', async (t) => {
  const options = await fixture(t);
  options.environment.LOCKED_ENGINE = '1';
  const result = cli(options);
  assert.equal(result.status, 23, result.stderr);
  assert.match(result.stderr, /node \(PID 4242\)/u);
  assert.match(result.stderr, /stop the API/u);
  assert.deepEqual(await commands(options.root), EXPECTED.slice(0, 1));
  await assert.rejects(fs.access(path.join(options.root, GENERATED, '.hsm-generation.json')), {
    code: 'ENOENT',
  });
});

test('a successful command with stale output is rejected before typecheck', async (t) => {
  const options = await fixture(t);
  options.environment.KEEP_STALE = '1';
  const result = cli(options);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /client is stale/u);
  assert.deepEqual(await commands(options.root), EXPECTED.slice(0, 1));
});

test('a schema changed during typecheck is rejected by the final freshness check', async (t) => {
  const options = await fixture(t);
  options.environment.CHANGE_SCHEMA = '1';
  const result = cli(options);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /client is stale/u);
  assert.deepEqual(await commands(options.root), EXPECTED);
  assert.doesNotMatch(result.stdout, /PASS dev workspace preparation/u);
});

test('lockfile mutation stops preparation without reverting unrelated changes', async (t) => {
  const options = await fixture(t);
  options.environment.CHANGE_LOCK = '1';
  const result = cli(options);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /lockfile changed during preparation/u);
  assert.deepEqual(await commands(options.root), EXPECTED.slice(0, 1));
  assert.match(await fs.readFile(path.join(options.root, 'pnpm-lock.yaml'), 'utf8'), /# changed/u);
});

test('production, wrong pnpm and unsupported flags cannot initiate preparation', async (t) => {
  const options = await fixture(t);
  for (const change of [
    { NODE_ENV: 'production' },
    { APP_ENV: 'prod' },
    { APP_ENV: 'production' },
    { npm_config_user_agent: 'pnpm/0.0.0' },
  ]) {
    const result = cli({ ...options, environment: { ...options.environment, ...change } });
    assert.equal(result.status, 1);
  }
  assert.equal(cli(options, ['--force']).status, 1);
  assert.deepEqual(await commands(options.root), []);
});

test('runtime mismatch and occupied API port stop before any generated changes', async (t) => {
  const options = await fixture(t);
  await assert.rejects(
    prepareWorkspace({
      ...options,
      checkToolchain: async () => ['Node pin mismatch'],
      log: () => {},
    }),
    /Node pin mismatch/u,
  );
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    prepareWorkspace({
      ...options,
      environment: { ...options.environment, PORT: String(server.address().port) },
      checkToolchain: async () => [],
      checkApiStopped: assertApiStopped,
      log: () => {},
    }),
    /occupied or unavailable/u,
  );
  assert.equal(server.listening, true);
  assert.deepEqual(await commands(options.root), []);
});

test('normal dev hooks prepare before read-only preflight; doctor remains read-only', async () => {
  const root = JSON.parse(await fs.readFile(path.join(__dirname, '../../package.json'), 'utf8'));
  const api = JSON.parse(
    await fs.readFile(path.join(__dirname, '../../apps/api/package.json'), 'utf8'),
  );
  assert.match(
    root.scripts.dev,
    /^node scripts\/dev\/prepare-workspace\.cjs && node scripts\/dev\/preflight\.cjs &&/u,
  );
  assert.equal(root.scripts['dev:prepare'], 'node scripts/dev/prepare-workspace.cjs');
  assert.equal(root.scripts['dev:doctor'], 'node scripts/dev/preflight.cjs --check-only');
  for (const hook of ['predev', 'predev:fast']) {
    assert.equal(
      api.scripts[hook],
      'node ../../scripts/dev/prepare-workspace.cjs && node ../../scripts/dev/preflight.cjs --api',
    );
  }
});
