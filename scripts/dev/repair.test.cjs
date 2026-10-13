'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { PNPM_VERSION } = require('../runtime/toolchain.cjs');
const { RepairError, pnpmInvocation, executePnpm, repairWorkspace } = require('./repair.cjs');
const { workspaceStateProblems } = require('./workspace-state.cjs');

const PRIVATE = 'private-fixture-value-must-not-appear';
const SCHEMA = 'generator client {\n provider = "prisma-client-js"\n output = "../generated/prisma"\n}\n';
const GENERATED = 'packages/database/generated/prisma';
const EXPECTED = [
  ['install', '--frozen-lockfile', '--prod=false'],
  ['--filter', '@homeservicemarketplace/database', 'generate'],
  ['exec', 'node', 'scripts/dev/workspace-state.cjs'],
  ['--filter', '@homeservicemarketplace/api', 'typecheck'],
];

async function write(root, file, value) {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, typeof value === 'string' ? value : JSON.stringify(value));
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm dev repair-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await write(root, 'pnpm-lock.yaml', 'lockfileVersion: "9.0"\n');
  await write(root, 'packages/database/package.json', {
    dependencies: { '@prisma/client': '6.12.0' },
  });
  await write(root, 'apps/api/package.json', { dependencies: { sharp: '0.35.5' } });
  await write(root, 'packages/database/prisma/schema.prisma', SCHEMA);
  for (const [consumer, name, version] of [
    ['packages/database', '@prisma/client', '6.11.0'],
    ['apps/api', 'sharp', '0.35.4'],
  ]) {
    await write(root, `${consumer}/node_modules/${name}/package.json`, {
      name, version, main: './index.js',
    });
    await write(root, `${consumer}/node_modules/${name}/index.js`, `throw new Error('${PRIVATE}');\n`);
  }
  await write(root, `${GENERATED}/index.js`, `throw new Error('${PRIVATE}');\n`);
  await write(root, `${GENERATED}/index.d.ts`, 'export declare class PrismaClient {}\n');
  await write(root, `${GENERATED}/package.json`, { version: '6.11.0' });
  await write(root, `${GENERATED}/schema.prisma`, SCHEMA.replace('client {', 'old {'));
  for (const file of ['.env', 'apps/api/.media-uploads/photo', 'apps/api/.restricted-uploads/evidence']) {
    await write(root, file, PRIVATE);
  }
  for (const file of ['repair.cjs', 'workspace-state.cjs']) {
    await write(root, `scripts/dev/${file}`, await fs.readFile(path.join(__dirname, file), 'utf8'));
  }
  // Only the runtime validator is stubbed; recovery orchestration, process
  // launching and the workspace-state checker below are the real sources.
  await write(root, 'scripts/runtime/toolchain.cjs',
    `exports.ROOT = require('node:path').resolve(__dirname, '../..');\n` +
    `exports.PNPM_VERSION = ${JSON.stringify(PNPM_VERSION)};\n` +
    'exports.toolchainProblems = async () => [];\n');
  await write(root, 'pnpm shim (fixture).cjs', `
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync('commands.jsonl', JSON.stringify(args) + '\\n');
const stage = args[0] === 'install' ? 'install'
  : args[0] === 'exec' ? 'verify' : args.at(-1);
if (process.env.FAIL_STAGE === stage) process.exit(19);
if (stage === 'install') {
  if (process.env.CHANGE_LOCK) fs.appendFileSync('pnpm-lock.yaml', '# changed\\n');
  if (!process.env.KEEP_STALE) {
    for (const [consumer, name, version] of [
      ['packages/database', '@prisma/client', '6.12.0'], ['apps/api', 'sharp', '0.35.5']
    ]) {
      fs.writeFileSync(path.join(consumer, 'node_modules', name, 'package.json'),
        JSON.stringify({ name, version, main: './index.js' }));
    }
  }
} else if (stage === 'generate') {
  const output = '${GENERATED}';
  fs.mkdirSync(output, { recursive: true });
  fs.copyFileSync('packages/database/prisma/schema.prisma', path.join(output, 'schema.prisma'));
  fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({ version: '6.12.0' }));
  fs.writeFileSync(path.join(output, 'index.d.ts'), 'export declare class PrismaClient {}\\n');
  fs.writeFileSync(path.join(output, 'index.js'), "throw new Error('${PRIVATE}');\\n");
} else if (stage === 'verify') {
  const child = spawnSync(process.execPath, args.slice(2), { stdio: 'inherit', shell: false });
  process.exit(child.status ?? 1);
} else if (stage !== 'typecheck') {
  process.exit(20);
}
`);
  return {
    root,
    environment: {
      ...process.env,
      NODE_ENV: 'development',
      APP_ENV: 'test',
      npm_execpath: path.join(root, 'pnpm shim (fixture).cjs'),
      npm_config_user_agent: `pnpm/${PNPM_VERSION} npm/? node/${process.versions.node}`,
      FAIL_STAGE: '', CHANGE_LOCK: '', KEEP_STALE: '',
    },
  };
}

function cli(options, args = []) {
  return spawnSync(process.execPath, [path.join(options.root, 'scripts/dev/repair.cjs'), ...args], {
    cwd: options.root,
    env: options.environment,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

async function commands(root) {
  try {
    return (await fs.readFile(path.join(root, 'commands.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

test('real CLI repairs all four reported failures with ordered commands and preserves private files', async (t) => {
  const options = await fixture(t);
  const before = (await workspaceStateProblems(options.root)).join('\n');
  for (const message of ['Installed Prisma client does not match', 'client is stale',
    'client version does not match', 'API sharp dependency']) {
    assert.ok(before.includes(message), before);
  }
  const protectedFiles = ['pnpm-lock.yaml', '.env', 'packages/database/prisma/schema.prisma',
    'apps/api/.media-uploads/photo', 'apps/api/.restricted-uploads/evidence'];
  const protectedBefore = await Promise.all(protectedFiles.map((file) => fs.readFile(path.join(options.root, file))));
  const result = cli(options);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS workspace recovery and API typecheck/u);
  assert.ok(!(result.stdout + result.stderr).includes(PRIVATE));
  assert.deepEqual(await commands(options.root), EXPECTED);
  assert.deepEqual(await workspaceStateProblems(options.root), []);
  assert.deepEqual(await Promise.all(protectedFiles.map((file) => fs.readFile(path.join(options.root, file)))), protectedBefore);
});

for (const [stage, count] of [['install', 1], ['generate', 2], ['verify', 3], ['typecheck', 4]]) {
  test(`${stage} failure retains its exit status and prevents every later command`, async (t) => {
    const options = await fixture(t);
    options.environment.FAIL_STAGE = stage;
    const result = cli(options);
    assert.equal(result.status, 19, result.stderr);
    assert.deepEqual(await commands(options.root), EXPECTED.slice(0, count));
    assert.doesNotMatch(result.stdout, /PASS workspace recovery/u);
  });
}

test('a successful install that leaves version drift cannot reach typecheck or claim recovery', async (t) => {
  const options = await fixture(t);
  options.environment.KEEP_STALE = '1';
  const result = cli(options);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Installed Prisma client does not match/u);
  assert.match(result.stderr, /API sharp dependency/u);
  assert.deepEqual(await commands(options.root), EXPECTED.slice(0, 3));
  assert.doesNotMatch(result.stdout, /PASS workspace recovery/u);
});

test('missing generated outputs are recreated before their verification', async (t) => {
  const options = await fixture(t);
  await fs.rm(path.join(options.root, GENERATED), { recursive: true });
  const result = cli(options);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await workspaceStateProblems(options.root), []);
});

test('force reinstall is explicit and keeps the frozen lockfile requirement', async (t) => {
  const options = await fixture(t);
  const result = cli(options, ['--force']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await commands(options.root))[0], [...EXPECTED[0], '--force']);
});

test('lockfile mutation is detected before generation without destructive rollback', async (t) => {
  const options = await fixture(t);
  options.environment.CHANGE_LOCK = '1';
  const result = cli(options);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /lockfile changed during recovery/u);
  assert.deepEqual(await commands(options.root), EXPECTED.slice(0, 1));
  assert.match(await fs.readFile(path.join(options.root, 'pnpm-lock.yaml'), 'utf8'), /# changed/u);
});

test('missing lockfile prevents every command', async (t) => {
  const options = await fixture(t);
  await fs.unlink(path.join(options.root, 'pnpm-lock.yaml'));
  const result = cli(options);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Restore pnpm-lock.yaml/u);
  assert.deepEqual(await commands(options.root), []);
});

test('unknown or duplicate flags cannot be passed through to install', async (t) => {
  const options = await fixture(t);
  for (const args of [['--ignore-scripts'], ['--force', '--force'], ['--', '--force']]) {
    const result = cli(options, args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Usage: pnpm dev:repair/u);
  }
  assert.deepEqual(await commands(options.root), []);
});

test('production environment refuses local repair', async (t) => {
  const options = await fixture(t);
  for (const variable of ['NODE_ENV', 'APP_ENV']) {
    const result = cli({ ...options, environment: { ...options.environment, [variable]: 'production' } });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /must not run in a production environment/u);
  }
  assert.deepEqual(await commands(options.root), []);
});

test('toolchain mismatch is checked before install', async (t) => {
  const options = await fixture(t);
  await assert.rejects(repairWorkspace({ ...options, log: () => {},
    checkToolchain: async () => ['Node pin mismatch'],
  }), /Node pin mismatch/u);
  assert.deepEqual(await commands(options.root), []);
});

test('the real runtime guard is not bypassed by normal CLI operation', async (t) => {
  const options = await fixture(t);
  await write(options.root, 'scripts/runtime/toolchain.cjs',
    await fs.readFile(path.join(__dirname, '../runtime/toolchain.cjs'), 'utf8'));
  const result = cli(options);
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(await commands(options.root), []);
});

test('Windows JS entry paths with spaces use Node and retain one exact path argument', () => {
  const entry = 'C:\\Program Files\\pnpm\\bin\\pnpm.cjs';
  const invocation = pnpmInvocation({ npm_execpath: entry, npm_config_user_agent: `pnpm/${PNPM_VERSION} npm/?` }, 'win32');
  assert.deepEqual(invocation, { file: process.execPath, prefix: [entry] });
});

test('standalone Windows pnpm executable does not go through Node or a shell', () => {
  const entry = 'C:\\Program Files\\pnpm\\pnpm.exe';
  assert.deepEqual(pnpmInvocation({ npm_execpath: entry, npm_config_user_agent: `pnpm/${PNPM_VERSION}` }, 'win32'), { file: entry, prefix: [] });
});

test('wrong pnpm versions, relative entry points and command shims are rejected', () => {
  for (const [entry, agent, platform] of [
    ['/tmp/pnpm.cjs', 'pnpm/0.0.0 npm/?', 'linux'],
    ['/tmp/pnpm.cjs', `npm/${PNPM_VERSION}`, 'linux'],
    ['pnpm.cjs', `pnpm/${PNPM_VERSION}`, 'linux'],
    ['C:\\pnpm\\pnpm.cmd', `pnpm/${PNPM_VERSION}`, 'win32'],
  ]) {
    assert.throws(() => pnpmInvocation({ npm_execpath: entry, npm_config_user_agent: agent }, platform), RepairError);
  }
});

test('spawn failures have controlled diagnostics rather than leaking local paths', () => {
  assert.throws(() => executePnpm({ file: path.join(os.tmpdir(), PRIVATE, 'missing-executable'), prefix: [] }, [], {
    root: os.tmpdir(), environment: process.env,
  }), (error) => error instanceof RepairError && error.exitCode === 1 && !error.message.includes(PRIVATE));
});

test('unexpected filesystem exceptions have controlled CLI diagnostics', async (t) => {
  const options = await fixture(t);
  await write(options.root, 'scripts/runtime/toolchain.cjs',
    `exports.ROOT = require('node:path').resolve(__dirname, '../..');\n` +
    `exports.PNPM_VERSION = ${JSON.stringify(PNPM_VERSION)};\n` +
    `exports.toolchainProblems = async () => { throw new Error('${PRIVATE}'); };\n`);
  const result = cli(options);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Workspace recovery failed/u);
  assert.ok(!result.stderr.includes(PRIVATE));
  assert.deepEqual(await commands(options.root), []);
});

test('the recovery command is available from the root manifest and preflight diagnostics', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, '../../package.json'), 'utf8'));
  assert.equal(manifest.scripts['dev:repair'], 'node scripts/dev/repair.cjs');
  const preflight = await fs.readFile(path.join(__dirname, 'preflight.cjs'), 'utf8');
  assert.match(preflight, /run pnpm dev:repair from the repository root/u);
  assert.match(preflight, /workspaceStateProblems\(ROOT\)/u);
});
