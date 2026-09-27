'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { NODE_VERSION, ROOT, DECLARATIONS, toolchainProblems } = require('./toolchain.cjs');
const files = ['package.json', '.devcontainer/devcontainer.json', ...Object.keys(DECLARATIONS)];

test('all checked-in declarations agree with the candidate runtime', async () => {
  // This tests declaration consistency, not a claim about this process version.
  assert.deepEqual(await toolchainProblems(ROOT, null), []);
});
test('an unsupported executing Node fails closed', async () => {
  for (const version of ['20.18.1', '22.16.0', '24.20.0', '25.0.0', undefined]) {
    const problems = await toolchainProblems(ROOT, version === undefined ? '' : version);
    assert.ok(problems.some((problem) => problem.startsWith('Node ')));
  }
});
for (const file of files) {
  test(`missing or altered declaration is rejected: ${file}`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-toolchain-'));
    try {
      for (const name of files) {
        await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
        await fs.copyFile(path.join(ROOT, name), path.join(root, name));
      }
      assert.deepEqual(await toolchainProblems(root, NODE_VERSION), []);
      const target = path.join(root, file);
      const text = await fs.readFile(target, 'utf8');
      await fs.writeFile(target, file.endsWith('devcontainer.json') ? '{}' : text.replaceAll(NODE_VERSION, '20.18.1'));
      assert.ok((await toolchainProblems(root, NODE_VERSION)).length);
      await fs.unlink(target);
      assert.ok((await toolchainProblems(root, NODE_VERSION)).length);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}

test('CLI checks the real executing runtime and labels declaration-only results', () => {
  const { spawnSync } = require('node:child_process');
  const cli = path.join(ROOT, 'scripts/runtime/toolchain.cjs');
  const actual = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(actual.status, process.versions.node === NODE_VERSION ? 0 : 1);
  const declarations = spawnSync(process.execPath, [cli, '--declarations'], { encoding: 'utf8' });
  assert.equal(declarations.status, 0);
  assert.match(declarations.stdout, /executing Node was not certified/u);
  assert.equal(spawnSync(process.execPath, [cli, '--skip-checks']).status, 1);
});
