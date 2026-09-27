'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { API_ENV_PATHS, OUTPUTS, apiPort, availablePort, prepareApiCache } = require('./preflight.cjs');

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hsm-preflight-'));
  await fs.mkdir(path.join(root, 'apps/api/.cache'), { recursive: true });
  return root;
}
async function write(root, file, value = 'generated fixture') {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, value);
}
const remove = (root) => fs.rm(root, { recursive: true, force: true });
const missing = async (file) => { await assert.rejects(fs.access(file), { code: 'ENOENT' }); };

test('API port uses Nest file precedence and never mutates the process input', async () => {
  const root = await fixture();
  const env = { PORT: '4050', PRIVATE_VALUE: 'do-not-log' };
  try {
    assert.equal(await apiPort(root, {}), 4000);
    for (const [index, file] of [...API_ENV_PATHS].reverse().entries()) {
      await write(root, file, `PORT=${4100 + index}\nUNRELATED_SECRET=do-not-log`);
      assert.equal(await apiPort(root, {}), 4100 + index);
    }
    assert.equal(await apiPort(root, env), 4050);
    assert.deepEqual(env, { PORT: '4050', PRIVATE_VALUE: 'do-not-log' });
  } finally { await remove(root); }
});
for (const value of ['', 'not-a-port', '0', '65536', '-1', '42.5']) {
  test(`invalid API port is rejected without echoing its contents: ${value || 'empty'}`, async () => {
    const root = await fixture();
    try { await assert.rejects(apiPort(root, { PORT: value }), /^Error: API PORT must be/u); }
    finally { await remove(root); }
  });
}

test('occupied port is rejected while its existing listener stays alive', async () => {
  const server = net.createServer((socket) => socket.end('owned-by-test'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.equal(await availablePort(port, '127.0.0.1'), false);
    assert.equal(server.listening, true);
    const response = await new Promise((resolve, reject) => {
      let data = '';
      const socket = net.connect(port, '127.0.0.1');
      socket.on('data', (chunk) => { data += chunk; });
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    assert.equal(response, 'owned-by-test');
  } finally { await new Promise((resolve) => server.close(resolve)); }
  assert.equal(await availablePort(port, '127.0.0.1'), true);
});

test('complete outputs preserve incremental cache and all application files', async () => {
  const root = await fixture();
  try {
    for (const output of OUTPUTS) await write(root, `apps/api/dist/${output}`);
    await write(root, 'apps/api/.cache/api-dev.tsbuildinfo', 'keep-cache');
    assert.deepEqual(await prepareApiCache(root), { missing: [], cacheRemoved: false });
    assert.equal(await fs.readFile(path.join(root, 'apps/api/.cache/api-dev.tsbuildinfo'), 'utf8'), 'keep-cache');
  } finally { await remove(root); }
});

test('missing env.schema removes only the stale generated cache; check-only never writes', async () => {
  const root = await fixture();
  try {
    for (const output of OUTPUTS.filter((file) => file !== 'config/env.schema.js')) await write(root, `apps/api/dist/${output}`);
    await write(root, 'apps/api/.cache/api-dev.tsbuildinfo', 'stale');
    for (const file of ['.env', 'apps/api/.media-uploads/photo', 'apps/api/dist/keep.js']) await write(root, file, 'keep');
    const diagnostic = await prepareApiCache(root, false);
    assert.equal(diagnostic.cacheNeedsRepair, true);
    await fs.access(path.join(root, 'apps/api/.cache/api-dev.tsbuildinfo'));
    assert.deepEqual(await prepareApiCache(root), { missing: ['config/env.schema.js'], cacheRemoved: true, cacheNeedsRepair: false });
    await missing(path.join(root, 'apps/api/.cache/api-dev.tsbuildinfo'));
    for (const file of ['.env', 'apps/api/.media-uploads/photo', 'apps/api/dist/keep.js']) assert.equal(await fs.readFile(path.join(root, file), 'utf8'), 'keep');
  } finally { await remove(root); }
});

test('cold output and missing cache are safe and idempotent', async () => {
  const root = await fixture();
  try {
    await fs.rm(path.join(root, 'apps/api/.cache'), { recursive: true });
    const first = await prepareApiCache(root);
    assert.equal(first.cacheRemoved, false);
    assert.deepEqual(first.missing, OUTPUTS);
    assert.deepEqual(await prepareApiCache(root), first);
  } finally { await remove(root); }
});

test('redirected cache directories cannot cause another project cache to be removed', async () => {
  const root = await fixture();
  const outside = await fixture();
  try {
    const cache = path.join(root, 'apps/api/.cache');
    const target = path.join(outside, 'apps/api/.cache');
    await write(outside, 'apps/api/.cache/api-dev.tsbuildinfo', 'unrelated-cache');
    await fs.rm(cache, { recursive: true });
    await fs.symlink(target, cache, 'junction');
    await assert.rejects(prepareApiCache(root), /Refusing/u);
    assert.equal(await fs.readFile(path.join(target, 'api-dev.tsbuildinfo'), 'utf8'), 'unrelated-cache');
  } finally { await remove(root); await remove(outside); }
});

test('redirected API directories preserve the other project cache', async () => {
  const root = await fixture();
  const outside = await fixture();
  try {
    await write(outside, 'apps/api/.cache/api-dev.tsbuildinfo', 'unrelated-cache');
    await fs.rm(path.join(root, 'apps/api'), { recursive: true });
    await fs.symlink(path.join(outside, 'apps/api'), path.join(root, 'apps/api'), 'junction');
    await assert.rejects(prepareApiCache(root), /Refusing/u);
    assert.equal(await fs.readFile(path.join(outside, 'apps/api/.cache/api-dev.tsbuildinfo'), 'utf8'), 'unrelated-cache');
  } finally { await remove(root); await remove(outside); }
});
