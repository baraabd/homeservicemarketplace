'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { workspaceStateProblems } = require('./workspace-state.cjs');

const SCHEMA =
  'generator client {\n  provider = "prisma-client-js"\n  output = "../generated/prisma"\n}\n';
const GENERATED = 'packages/database/generated/prisma';
const PRIVATE = 'private-fixture-value-must-not-appear';

async function write(root, file, contents) {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}

async function writeJson(root, file, value) {
  await write(root, file, JSON.stringify(value));
}

async function dependency(root, consumer, name, version) {
  const directory = `${consumer}/node_modules/${name}`;
  await writeJson(root, `${directory}/package.json`, { name, version, main: './index.js' });
  // Resolving metadata must never evaluate this module (or a native binding).
  await write(root, `${directory}/index.js`, `throw new Error('${PRIVATE}');\n`);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-workspace-state-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await writeJson(root, 'packages/database/package.json', {
    dependencies: { '@prisma/client': '6.12.0' },
  });
  await writeJson(root, 'apps/api/package.json', { dependencies: { sharp: '0.35.5' } });
  await dependency(root, 'packages/database', '@prisma/client', '6.12.0');
  await dependency(root, 'apps/api', 'sharp', '0.35.5');
  await write(root, 'packages/database/prisma/schema.prisma', SCHEMA);
  await write(root, `${GENERATED}/schema.prisma`, SCHEMA);
  await write(root, `${GENERATED}/index.js`, `throw new Error('${PRIVATE}');\n`);
  await write(root, `${GENERATED}/index.d.ts`, 'export declare class PrismaClient {}\n');
  await writeJson(root, `${GENERATED}/package.json`, { version: '6.12.0' });
  return root;
}

test('current generated client and consumer dependencies pass without evaluating any module', async (t) => {
  const root = await fixture(t);
  assert.deepEqual(await workspaceStateProblems(root), []);
});

test('a schema change is detected even when timestamps and file size match', async (t) => {
  const root = await fixture(t);
  const schemaPath = path.join(root, 'packages/database/prisma/schema.prisma');
  const before = await fs.stat(schemaPath);
  await fs.writeFile(schemaPath, SCHEMA.replace('generator client', 'generator newerx'));
  await fs.utimes(schemaPath, before.atime, before.mtime);
  assert.equal((await fs.stat(schemaPath)).size, before.size);
  const problems = await workspaceStateProblems(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Generated Prisma client is stale/u);
  assert.match(problems[0], /pnpm --filter @homeservicemarketplace\/database generate/u);
  assert.match(problems[0], /pnpm --filter @homeservicemarketplace\/api typecheck/u);
});

test('Windows CRLF source and LF generated schema have the same fingerprint', async (t) => {
  const root = await fixture(t);
  await write(root, 'packages/database/prisma/schema.prisma', SCHEMA.replace(/\n/gu, '\r\n'));
  assert.deepEqual(await workspaceStateProblems(root), []);
});

test('Prisma column alignment and indentation changes do not mark a fresh client stale', async (t) => {
  const root = await fixture(t);
  await write(
    root,
    'packages/database/prisma/schema.prisma',
    `${SCHEMA}\nmodel Example {\n  id   String   @id\n  label   String @default("two words")\n}\n`,
  );
  await write(
    root,
    `${GENERATED}/schema.prisma`,
    `${SCHEMA}\nmodel Example {\n  id    String @id\n  label String @default("two words")\n}\n`,
  );
  assert.deepEqual(await workspaceStateProblems(root), []);
});

test('whitespace and escaped quotes inside a schema value remain part of the fingerprint', async (t) => {
  const root = await fixture(t);
  const schema = `${SCHEMA}\nmodel Example {\n  label String @default("one \\"two\\" words")\n}\n`;
  await write(root, 'packages/database/prisma/schema.prisma', schema);
  await write(root, `${GENERATED}/schema.prisma`, schema.replace('one ', 'one'));
  assert.match((await workspaceStateProblems(root)).join('\n'), /client is stale/u);
});

for (const output of ['index.js', 'index.d.ts', 'schema.prisma', 'package.json']) {
  test(`missing generated ${output} is diagnosed before compilation`, async (t) => {
    const root = await fixture(t);
    await fs.unlink(path.join(root, GENERATED, output));
    assert.match((await workspaceStateProblems(root)).join('\n'), /client is incomplete/u);
  });
}

test('a directory in place of generated declarations is not accepted as an output', async (t) => {
  const root = await fixture(t);
  const declarations = path.join(root, GENERATED, 'index.d.ts');
  await fs.unlink(declarations);
  await fs.mkdir(declarations);
  assert.match((await workspaceStateProblems(root)).join('\n'), /client is incomplete/u);
});

test('installed and generated Prisma version drift both produce recovery diagnostics', async (t) => {
  const root = await fixture(t);
  await dependency(root, 'packages/database', '@prisma/client', '6.11.0');
  let problems = await workspaceStateProblems(root);
  assert.match(problems.join('\n'), /Installed Prisma client does not match/u);
  assert.match(problems.join('\n'), /pnpm install --frozen-lockfile/u);
  await dependency(root, 'packages/database', '@prisma/client', '6.12.0');
  await writeJson(root, `${GENERATED}/package.json`, { version: '6.11.0' });
  problems = await workspaceStateProblems(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Generated Prisma client version does not match/u);
});

test('missing Prisma dependency and missing sharp are reported together', async (t) => {
  const root = await fixture(t);
  await fs.rm(path.join(root, 'packages/database/node_modules'), { recursive: true });
  await fs.rm(path.join(root, 'apps/api/node_modules'), { recursive: true });
  const diagnostic = (await workspaceStateProblems(root)).join('\n');
  assert.match(diagnostic, /Prisma client dependency is missing/u);
  assert.match(diagnostic, /API sharp dependency is missing/u);
  assert.match(diagnostic, /pnpm install --frozen-lockfile/u);
  assert.doesNotMatch(diagnostic, /MODULE_NOT_FOUND|Cannot find module/u);
  assert.ok(!diagnostic.includes(root));
});

test('sharp is resolved from the API consumer ahead of an unrelated root package', async (t) => {
  const root = await fixture(t);
  await dependency(root, '.', 'sharp', '9.9.9');
  assert.deepEqual(await workspaceStateProblems(root), []);
  await dependency(root, 'apps/api', 'sharp', '0.35.4');
  assert.match((await workspaceStateProblems(root)).join('\n'), /API sharp dependency/u);
});

test('sharp metadata without a resolvable entry is not accepted', async (t) => {
  const root = await fixture(t);
  await fs.unlink(path.join(root, 'apps/api/node_modules/sharp/index.js'));
  assert.match((await workspaceStateProblems(root)).join('\n'), /API sharp dependency/u);
});

test('sharp metadata is readable when package exports hide package.json', async (t) => {
  const root = await fixture(t);
  await writeJson(root, 'apps/api/node_modules/sharp/package.json', {
    name: 'sharp',
    version: '0.35.5',
    exports: { '.': { require: './dist/index.cjs' } },
  });
  await write(
    root,
    'apps/api/node_modules/sharp/dist/index.cjs',
    `throw new Error('${PRIVATE}');\n`,
  );
  assert.deepEqual(await workspaceStateProblems(root), []);
});

test('malformed metadata and a missing source schema never reveal raw file contents or paths', async (t) => {
  const root = await fixture(t);
  await write(root, `${GENERATED}/package.json`, PRIVATE);
  await write(root, 'apps/api/node_modules/sharp/package.json', PRIVATE);
  await fs.unlink(path.join(root, 'packages/database/prisma/schema.prisma'));
  const diagnostic = (await workspaceStateProblems(root)).join('\n');
  assert.match(diagnostic, /Prisma source schema is missing/u);
  assert.match(diagnostic, /Generated Prisma client metadata is unreadable/u);
  assert.match(diagnostic, /API sharp dependency/u);
  assert.ok(!diagnostic.includes(PRIVATE));
  assert.ok(!diagnostic.includes(root));
  assert.doesNotMatch(diagnostic, /SyntaxError|ENOENT|JSON at position/u);
});

async function preflightFixture(t) {
  const root = await fixture(t);
  for (const name of ['preflight.cjs', 'workspace-state.cjs']) {
    await write(root, `scripts/dev/${name}`, await fs.readFile(path.join(__dirname, name), 'utf8'));
  }
  // Runtime validation has its own suite. This CLI fixture isolates the real
  // preflight's ordering and read-only behavior without copying all CI files.
  await write(
    root,
    'scripts/runtime/toolchain.cjs',
    "exports.ROOT = require('node:path').resolve(__dirname, '../..');\n" +
      'exports.toolchainProblems = async () => [];\n',
  );
  for (const file of [
    '.env',
    'apps/api/.cache/api-dev.tsbuildinfo',
    'apps/api/.media-uploads/photo',
    'apps/api/.restricted-uploads/evidence',
  ]) {
    await write(root, file, PRIVATE);
  }
  return root;
}

async function snapshot(root) {
  const files = {};
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else files[path.relative(root, file)] = (await fs.readFile(file)).toString('base64');
    }
  }
  await visit(root);
  return files;
}

test('normal preflight diagnoses stale Prisma and missing sharp before cache repair', async (t) => {
  const root = await preflightFixture(t);
  await write(root, `${GENERATED}/schema.prisma`, 'stale generated schema\n');
  await fs.rm(path.join(root, 'apps/api/node_modules/sharp'), { recursive: true });
  const before = await snapshot(root);
  const result = spawnSync(process.execPath, ['scripts/dev/preflight.cjs', '--api'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, PORT: PRIVATE },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Generated Prisma client is stale/u);
  assert.match(result.stderr, /API sharp dependency/u);
  assert.doesNotMatch(result.stdout, /PASS/u);
  assert.ok(!(result.stdout + result.stderr).includes(PRIVATE));
  assert.deepEqual(await snapshot(root), before);
});

test('successful check-only preflight leaves incomplete API outputs and every fixture file unchanged', async (t) => {
  const root = await preflightFixture(t);
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const before = await snapshot(root);
  const result = spawnSync(
    process.execPath,
    ['scripts/dev/preflight.cjs', '--api', '--check-only'],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, PORT: String(port) },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cache needs repair/u);
  assert.match(result.stdout, /PASS dev preflight/u);
  assert.ok(!(result.stdout + result.stderr).includes(PRIVATE));
  assert.deepEqual(await snapshot(root), before);
});
