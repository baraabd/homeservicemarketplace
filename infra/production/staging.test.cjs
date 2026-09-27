'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readSecret, approvedDestinations, validateManifest, inspectSecrets, dockerEnvironment, verifyHttps, deploy, main } = require('./staging.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-release-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourceSha = 'a'.repeat(40);
  const db = (user) => `postgresql://${user}:fixture@db.example.test/app?sslmode=require&sslaccept=strict`;
  const manifest = { schemaVersion: 1, sourceSha, dockerContext: 'default',
    projectName: 'hsm-staging-fixture', externalNetwork: 'hsm-fixture',
    images: Object.fromEntries(['api', 'migrator', 'web'].map((name, i) => [name, `registry.example.test/hsm/${name}@sha256:${String(i + 1).repeat(64)}`])),
    secretFiles: { api: path.join(dir, 'api.env'), migration: path.join(dir, 'migration.env') },
    ports: { api: 14000, web: 18080 }, webOrigin: 'https://web.example.test', apiOrigin: 'https://api.example.test', onboardingV2: false };
  const api = `NODE_ENV=production\nAPP_ENV=staging\nFRONTEND_URL=${manifest.webOrigin}\nCORS_ORIGINS=${manifest.webOrigin}\nDATABASE_URL=${db('app_user')}\n`;
  const migration = `DATABASE_URL=${db('migration_user')}\n`;
  fs.writeFileSync(manifest.secretFiles.api, api, { mode: 0o600 });
  fs.writeFileSync(manifest.secretFiles.migration, migration, { mode: 0o600 });
  const manifestPath = path.join(dir, 'release.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return { dir, manifest, manifestPath, api, migration, db };
}
function runner(manifest, { fail, labels, after, endpoint = 'unix:///var/run/docker.sock' } = {}) {
  const calls = [];
  return { calls, approvedOrigins: { apiOrigin: 'https://api.example.test', webOrigin: 'https://web.example.test' }, run(args, options) {
    calls.push(args);
    assert.equal(options.env.COMPOSE_DISABLE_ENV_FILE, '1');
    assert.equal(options.env.HSM_API_IMAGE, manifest.images.api);
    assert.deepEqual(args.slice(0, 2), ['--context', manifest.dockerContext]);
    if (fail?.(args)) throw new Error('fixture-secret-must-never-escape');
    after?.(args);
    if (args[2] === 'context') return JSON.stringify(endpoint);
    if (args[2] === 'image') return JSON.stringify(labels ?? { 'org.opencontainers.image.revision': manifest.sourceSha, 'io.hsm.web.api-url': manifest.apiOrigin });
    return '';
  } };
}

test('valid release uses explicit immutable images, origins and isolated resources', (t) => {
  const { manifest } = fixture(t);
  assert.equal(validateManifest(manifest), manifest);
});
const invalidManifests = [
  ['version', (m) => { m.schemaVersion = 2; }],
  ['short SHA', (m) => { m.sourceSha = 'abcd'; }],
  ['missing context', (m) => { m.dockerContext = undefined; }],
  ['null context', (m) => { m.dockerContext = null; }],
  ['null network', (m) => { m.externalNetwork = null; }],
  ['shell context', (m) => { m.dockerContext = 'default;echo bad'; }],
  ['developer project', (m) => { m.projectName = 'hsm'; }],
  ['extra property', (m) => { m.allowUnsafe = true; }],
  ['HTTP frontend', (m) => { m.webOrigin = 'http://web.example.test'; }],
  ['origin path', (m) => { m.apiOrigin += '/v1'; }],
  ['origin query', (m) => { m.apiOrigin += '?secret=fixture'; }],
  ['origin credentials', (m) => { m.apiOrigin = 'https://a:b@api.example.test'; }],
  ['implicit flag', (m) => { m.onboardingV2 = 'false'; }],
  ['mutable image', (m) => { m.images.api = 'hsm-api:latest'; }],
  ['missing image', (m) => { delete m.images.migrator; }],
  ['aliased migrator', (m) => { m.images.migrator = m.images.api; }],
  ['relative secret', (m) => { m.secretFiles.api = '.env'; }],
  ['privileged port', (m) => { m.ports.api = 80; }],
  ['fractional port', (m) => { m.ports.api = 4000.5; }],
  ['duplicate ports', (m) => { m.ports.api = m.ports.web; }],
];
for (const [name, change] of invalidManifests) test(`rejects ${name}`, (t) => {
  const { manifest } = fixture(t); change(manifest);
  assert.throws(() => validateManifest(manifest));
});

test('API and migrator values stay out of returned configuration', (t) => {
  const { manifest } = fixture(t);
  const secrets = inspectSecrets(manifest);
  assert.deepEqual([secrets.api, secrets.migration], Object.values(manifest.secretFiles));
  assert.equal(secrets.digests.length, 2);
  assert.equal(JSON.stringify(secrets).includes('fixture@'), false);
  const env = dockerEnvironment(manifest, secrets);
  assert.equal(env.HSM_API_ENV_FILE, secrets.api);
  assert.equal(env.HSM_MIGRATION_ENV_FILE, secrets.migration);
});
const invalidSecrets = [
  ['shared secret file', (f) => { f.manifest.secretFiles.migration = f.manifest.secretFiles.api; }],
  ['same database user', (f) => { fs.writeFileSync(f.manifest.secretFiles.migration, `DATABASE_URL=${f.db('app_user')}`); }],
  ['different database', (f) => { fs.writeFileSync(f.manifest.secretFiles.migration, f.migration.replace('/app?', '/other?')); }],
  ['different schema', (f) => { fs.writeFileSync(f.manifest.secretFiles.migration, f.migration.trim() + '&schema=other'); }],
  ['extra migration secret', (f) => { fs.appendFileSync(f.manifest.secretFiles.migration, 'JWT_ACCESS_SECRET=fixture\n'); }],
  ['plaintext database', (f) => { fs.writeFileSync(f.manifest.secretFiles.api, f.api.replace('sslmode=require', 'sslmode=disable')); }],
  ['invalid certificate mode', (f) => { fs.writeFileSync(f.manifest.secretFiles.api, f.api.replace('sslaccept=strict', 'sslaccept=accept_invalid_certs')); }],
  ['duplicate TLS parameter', (f) => { fs.writeFileSync(f.manifest.secretFiles.migration, f.migration.trim() + '&sslmode=disable'); }],
  ['frontend mismatch', (f) => { fs.writeFileSync(f.manifest.secretFiles.api, f.api.replace('FRONTEND_URL=https://web.', 'FRONTEND_URL=https://wrong.')); }],
  ['CORS mismatch', (f) => { fs.writeFileSync(f.manifest.secretFiles.api, f.api.replace('CORS_ORIGINS=https://web.', 'CORS_ORIGINS=https://wrong.')); }],
  ['development runtime', (f) => { fs.appendFileSync(f.manifest.secretFiles.api, 'NODE_ENV=development\n'); }],
  ['wrong container port', (f) => { fs.appendFileSync(f.manifest.secretFiles.api, 'PORT=4100\n'); }],
  ...['NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'PATH', 'DIRECT_URL', 'VITE_API_URL', 'COMPOSE_FILE', 'DOCKER_HOST'].map((name) => [name, (f) => { fs.appendFileSync(f.manifest.secretFiles.api, `${name}=fixture\n`); }]),
];
for (const [name, change] of invalidSecrets) test(`rejects secret configuration: ${name}`, (t) => {
  const f = fixture(t); change(f);
  assert.throws(() => inspectSecrets(f.manifest));
});
test('secrets resolving inside the checkout are refused', (t) => {
  const { dir, manifest } = fixture(t);
  assert.throws(() => inspectSecrets(manifest, dir), /outside the repository/);
});
test('host secret permissions are restrictive on platforms supporting POSIX modes', (t) => {
  const { manifest } = fixture(t);
  if (process.platform === 'win32') {
    assert.ok(inspectSecrets(manifest)); // Windows ACL evidence is an operator requirement, not a chmod claim.
  } else {
    fs.chmodSync(manifest.secretFiles.api, 0o644);
    assert.throws(() => inspectSecrets(manifest), /other host users/);
  }
});
test('check-only CLI runs without Docker, does not deploy and does not reveal secret values', (t) => {
  const { manifestPath } = fixture(t);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'staging.cjs'), '--check', manifestPath], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).deploymentStarted, false);
  assert.equal(result.stdout.includes('fixture@'), false);
});
test('apply requires the exact release authorization token', async (t) => {
  const { manifestPath } = fixture(t);
  for (const approval of [undefined, 'yes', 'hsm-staging-fixture@old']) {
    await assert.rejects(main(['--apply', manifestPath, ...(approval === undefined ? [] : [approval])]), /authorization/);
  }
});
test('secret parser errors cannot echo a credential value through the CLI', async (t) => {
  const { manifest, manifestPath } = fixture(t);
  fs.writeFileSync(manifest.secretFiles.api, 'DATABASE_URL=fixture-secret-must-never-escape');
  await assert.rejects(main(['--check', manifestPath]), (error) => /values are withheld/.test(error.message) && !error.message.includes('fixture-secret-must-never-escape'));
});

for (const failingStep of ['existing-network', 'image-source', 'runtime-preflight', 'migrations']) test(`deployment stops at ${failingStep}`, async (t) => {
  const { dir, manifest } = fixture(t);
  const hit = (args) => ({ 'existing-network': args[2] === 'network', 'image-source': args[2] === 'image',
    'runtime-preflight': args.includes('run') && args.at(-1) === 'api-preflight',
    migrations: args.includes('run') && args.at(-1) === 'api-migrate' })[failingStep];
  const fake = runner(manifest, { fail: hit });
  await assert.rejects(deploy(manifest, inspectSecrets(manifest), { ...fake, lockDirectory: dir, verify: async () => assert.fail('must not probe after a failed step') }), (error) => error.message.includes(failingStep) && !error.message.includes('fixture-secret'));
  assert.equal(fake.calls.some((args) => args.includes('up')), false);
  if (failingStep !== 'migrations') assert.equal(fake.calls.some((args) => args.includes('run') && args.at(-1) === 'api-migrate'), false);
  assert.equal(fs.existsSync(path.join(dir, `${manifest.projectName}.lock`)), false);
});
test('wrong image revision is rejected before a migration', async (t) => {
  const { dir, manifest } = fixture(t);
  const fake = runner(manifest, { labels: { 'org.opencontainers.image.revision': 'unknown' } });
  await assert.rejects(deploy(manifest, inspectSecrets(manifest), { ...fake, lockDirectory: dir }), /image-source/);
  assert.equal(fake.calls.some((args) => args.includes('run')), false);
});
for (const endpoint of ['ssh://staging', 'tcp://staging:2376']) test(`rejects mismatched file-secret host: ${endpoint}`, async (t) => {
  const { dir, manifest } = fixture(t);
  const fake = runner(manifest, { endpoint });
  await assert.rejects(deploy(manifest, inspectSecrets(manifest), { ...fake, lockDirectory: dir }), /deployment host/);
  assert.equal(fake.calls.length, 1);
});
test('rotation after preflight prevents migration under different credentials', async (t) => {
  const { dir, manifest } = fixture(t);
  const fake = runner(manifest, { after(args) {
    if (args.includes('run') && args.at(-1) === 'api-preflight') fs.appendFileSync(manifest.secretFiles.api, '# changed\n');
  } });
  await assert.rejects(deploy(manifest, inspectSecrets(manifest), { ...fake, lockDirectory: dir }), /before-migration/);
  assert.equal(fake.calls.some((args) => args.includes('run') && args.at(-1) === 'api-migrate'), false);
});
test('successful mocked orchestration is never labelled full staging acceptance', async (t) => {
  const { dir, manifest } = fixture(t);
  const fake = runner(manifest);
  const result = await deploy(manifest, inspectSecrets(manifest), { ...fake, lockDirectory: dir, verify: async () => {} });
  assert.equal(result.status, 'DEPLOYED_NOT_ACCEPTED');
  assert.ok(result.remaining.includes('real test inbox delivery'));
  const runs = fake.calls.filter((args) => args.includes('run')).map((args) => args.at(-1));
  assert.deepEqual(runs, ['api-preflight', 'api-migrate']);
  assert.equal(fake.calls.some((args) => args.includes('down') || args.includes('prune')), false);
});
test('existing lock is not removed, and no Docker step runs', async (t) => {
  const { dir, manifest } = fixture(t);
  const lock = path.join(dir, `${manifest.projectName}.lock`);
  fs.writeFileSync(lock, 'existing');
  const fake = runner(manifest);
  await assert.rejects(deploy(manifest, inspectSecrets(manifest), { ...fake, lockDirectory: dir }), /lock unavailable/);
  assert.equal(fake.calls.length, 0);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'existing');
});
test('concurrent apply of the same project is refused until the first finishes', async (t) => {
  const { dir, manifest } = fixture(t);
  const fake = runner(manifest);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = deploy(manifest, inspectSecrets(manifest), { ...fake, lockDirectory: dir, verify: () => pending });
  await assert.rejects(deploy(manifest, inspectSecrets(manifest), { ...fake, lockDirectory: dir }), /lock unavailable/);
  release();
  await first;
});
test('post-rollout HTTPS failure is explicit and never triggers destructive rollback', async (t) => {
  const { dir, manifest } = fixture(t);
  const fake = runner(manifest);
  await assert.rejects(deploy(manifest, inspectSecrets(manifest), { ...fake, lockDirectory: dir, verify: async () => { throw new Error('fixture-secret'); } }), /HTTPS acceptance failed after application rollout/);
  assert.equal(fake.calls.some((args) => args.includes('down')), false);
});
function probe(manifest, change = () => {}) {
  return async (url, options) => {
    assert.equal(options.redirect, 'error');
    const route = new URL(url).pathname;
    const reply = {
      '/health/live': { status: 'ok' },
      '/health/ready': { ready: true, dependencies: ['postgres', 'redis'].map((name) => ({ name, status: 'up' })) },
      '/build-info.json': { sourceSha: manifest.sourceSha, apiUrl: manifest.apiOrigin, onboardingV2: manifest.onboardingV2 },
      '/v1/auth/me': { error: 'Unauthorized' },
    }[route];
    assert.ok(reply);
    change(route, reply);
    return new Response(JSON.stringify(reply), { status: route === '/v1/auth/me' ? 401 : 200,
      headers: { 'access-control-allow-origin': manifest.webOrigin, 'access-control-allow-credentials': 'true' } });
  };
}
test('HTTPS probes require healthy dependencies, exact build identity and credentialed CORS', async (t) => {
  const { manifest } = fixture(t);
  await verifyHttps(manifest, { apiOrigin: 'https://api.example.test', webOrigin: 'https://web.example.test' }, probe(manifest));
});
for (const [name, change] of [
  ['stale bundle', (route, value) => { if (route === '/build-info.json') value.sourceSha = 'b'.repeat(40); }],
  ['double API version prefix', (route, value) => { if (route === '/build-info.json') value.apiUrl += '/v1'; }],
  ['wrong feature flag', (route, value) => { if (route === '/build-info.json') value.onboardingV2 = true; }],
  ['missing dependency', (route, value) => { if (route === '/health/ready') value.dependencies = []; }],
  ['unready dependency', (route, value) => { if (route === '/health/ready') value.dependencies[0].status = 'down'; }],
]) test(`HTTPS rejects ${name}`, async (t) => {
  const { manifest } = fixture(t);
  await assert.rejects(verifyHttps(manifest, { apiOrigin: 'https://api.example.test', webOrigin: 'https://web.example.test' }, probe(manifest, change)));
});
test('CORS failure is not hidden by a legitimate 401 status', async (t) => {
  const { manifest } = fixture(t);
  const normal = probe(manifest);
  await assert.rejects(verifyHttps(manifest, { apiOrigin: 'https://api.example.test', webOrigin: 'https://web.example.test' }, async (...args) => {
    const response = await normal(...args);
    if (response.status === 401) response.headers.set('access-control-allow-origin', '*');
    return response;
  }), /credentialed CORS/);
});

// PR #117: exercise the object being read, not just the name that was checked.
test('secret validation, parsing and fingerprinting use one descriptor and identical bytes', (t) => {
  const { manifest, api, migration } = fixture(t);
  const open = fs.openSync;
  const read = fs.readSync;
  const descriptors = [];
  const readDescriptors = [];
  t.mock.method(fs, 'openSync', (...args) => {
    const fd = open(...args); descriptors.push(fd); return fd;
  });
  t.mock.method(fs, 'readSync', (fd, ...args) => {
    assert.equal(typeof fd, 'number'); readDescriptors.push(fd); return read(fd, ...args);
  });
  t.mock.method(fs, 'readFileSync', () => assert.fail('Never reopen a secret path for parsing or hashing'));
  const secrets = inspectSecrets(manifest);
  assert.equal(descriptors.length, 2, 'Exactly one open per secret');
  assert.ok(readDescriptors.every((fd) => descriptors.includes(fd)));
  const { createHash } = require('node:crypto');
  assert.deepEqual(secrets.digests, [api, migration].map((text) => createHash('sha256').update(text).digest('hex')));
});

test('a pathname replacement cannot substitute different bytes after the descriptor check', (t) => {
  const { manifest, dir, api } = fixture(t);
  const file = manifest.secretFiles.api;
  const replacement = path.join(dir, 'replacement.env');
  fs.writeFileSync(replacement, 'UNTRUSTED=replacement\n', { mode: 0o600 });
  const fstat = fs.fstatSync;
  let changed = false;
  t.mock.method(fs, 'fstatSync', (fd, options) => {
    const stat = fstat(fd, options);
    if (!changed) {
      changed = true;
      fs.renameSync(file, path.join(dir, 'original.env'));
      fs.renameSync(replacement, file);
    }
    return stat;
  });
  // Some file systems update the original inode's ctime on rename; either
  // reject that change or return the checked inode's original bytes, never
  // the replacement file. In both cases revalidation will reject a new digest.
  try {
    const value = readSecret(file);
    assert.equal(value.values.UNTRUSTED, undefined);
    assert.equal(value.values.NODE_ENV, 'production');
    assert.equal(value.digest, require('node:crypto').createHash('sha256').update(api).digest('hex'));
  } catch (error) {
    assert.match(error.message, /file changed while reading/);
  }
  assert.equal(changed, true);
});

test('growth after descriptor validation stays bounded and closes the descriptor on rejection', (t) => {
  const { manifest } = fixture(t);
  const fstat = fs.fstatSync;
  const read = fs.readSync;
  const close = fs.closeSync;
  let changed = false;
  let bytesRequested = 0;
  let closed = 0;
  t.mock.method(fs, 'fstatSync', (fd, options) => {
    const stat = fstat(fd, options);
    if (!changed) { changed = true; fs.appendFileSync(manifest.secretFiles.api, 'x'.repeat(300000)); }
    return stat;
  });
  t.mock.method(fs, 'readSync', (fd, buffer, offset, length, position) => {
    bytesRequested += length;
    return read(fd, buffer, offset, length, position);
  });
  t.mock.method(fs, 'closeSync', (fd) => { closed += 1; return close(fd); });
  assert.throws(() => readSecret(manifest.secretFiles.api), /file changed while reading/);
  assert.ok(bytesRequested <= 262145);
  assert.equal(closed, 1);
});

for (const kind of ['empty', 'oversized', 'directory']) test(`descriptor validation rejects ${kind} before reading`, (t) => {
  const { manifest, dir } = fixture(t);
  const file = kind === 'directory' ? dir : manifest.secretFiles.api;
  if (kind !== 'directory') fs.writeFileSync(file, kind === 'empty' ? '' : 'x'.repeat(262145));
  t.mock.method(fs, 'readSync', () => assert.fail('Invalid secret must not be read'));
  assert.throws(() => readSecret(file));
});

test('an I/O exception still closes the secret descriptor', (t) => {
  const { manifest } = fixture(t);
  const close = fs.closeSync;
  let closed = 0;
  t.mock.method(fs, 'readSync', () => { throw new Error('synthetic I/O failure'); });
  t.mock.method(fs, 'closeSync', (fd) => { closed += 1; return close(fd); });
  assert.throws(() => readSecret(manifest.secretFiles.api), /synthetic I\/O failure/);
  assert.equal(closed, 1);
});

const operatorOrigins = () => ({ apiOrigin: 'https://api.example.test', webOrigin: 'https://web.example.test' });
for (const supplied of [undefined, {}, { apiOrigin: 'https://api.example.test' },
  { ...operatorOrigins(), apiOrigin: 'http://api.example.test' },
  { ...operatorOrigins(), apiOrigin: 'https://api.example.test/v1' },
  { ...operatorOrigins(), webOrigin: 'https://unapproved.example.test' },
  { ...operatorOrigins(), apiOrigin: 'https://user:password@api.example.test' },
  { ...operatorOrigins(), webOrigin: 'https://web.example.test?secret=fixture' },
]) test(`independent network authorization rejects ${JSON.stringify(supplied)}`, async (t) => {
  const { manifest } = fixture(t);
  await assert.rejects(verifyHttps(manifest, supplied, async () => assert.fail('No request before independent origin authorization')));
});

test('approved origins are immutable independent values, not a reference to the manifest', (t) => {
  const { manifest } = fixture(t);
  const supplied = operatorOrigins();
  const approved = approvedDestinations(manifest, supplied);
  supplied.apiOrigin = 'https://other.example.test';
  manifest.webOrigin = 'https://unapproved.example.test';
  assert.equal(approved.apiOrigin, 'https://api.example.test');
  assert.equal(approved.webOrigin, 'https://web.example.test');
  assert.equal(Object.isFrozen(approved), true);
});

test('manifest destination changes fail before Docker or HTTP activity', async (t) => {
  const { dir, manifest } = fixture(t);
  const secrets = inspectSecrets(manifest);
  const fake = runner(manifest);
  manifest.apiOrigin = 'https://unapproved.example.test';
  await assert.rejects(deploy(manifest, secrets, { ...fake, lockDirectory: dir }), /independent operator authorization/);
  assert.equal(fake.calls.length, 0);
  assert.equal(fs.existsSync(path.join(dir, `${manifest.projectName}.lock`)), false);
});

test('actual apply CLI refuses missing or mismatched destination approval before Docker', (t) => {
  const { manifest, manifestPath } = fixture(t);
  const cli = path.join(__dirname, 'staging.cjs');
  const prefix = [cli, '--apply', manifestPath, `${manifest.projectName}@${manifest.sourceSha}`];
  for (const suffix of [[], ['--api-origin', 'https://unapproved.example.test', '--web-origin', 'https://web.example.test']]) {
    const result = spawnSync(process.execPath, [...prefix, ...suffix], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /independently authorize|independent operator authorization/);
    assert.doesNotMatch(result.stderr, /fixture@|Docker step failed/);
  }
});

test('only independently authorized origins and fixed paths/headers are sent over HTTP', async (t) => {
  const { manifest, api, migration } = fixture(t);
  const transport = probe(manifest);
  const requests = [];
  await verifyHttps(manifest, operatorOrigins(), async (url, options) => {
    requests.push([url, options]);
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    return transport(url, options);
  });
  assert.deepEqual(requests.map(([url]) => url), [
    'https://api.example.test/health/live', 'https://api.example.test/health/ready',
    'https://web.example.test/build-info.json', 'https://api.example.test/v1/auth/me',
  ]);
  assert.deepEqual(requests.map(([, options]) => options.headers), [{}, {}, {},
    { Origin: 'https://web.example.test', 'X-Client-Kind': 'web' }]);
  const serialized = JSON.stringify(requests);
  for (const privateValue of [api, migration, manifest.sourceSha, manifest.secretFiles.api, manifest.images.api]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('redirect and transport failures cannot fall back to unapproved destinations', async (t) => {
  const { manifest } = fixture(t);
  let calls = 0;
  await assert.rejects(verifyHttps(manifest, operatorOrigins(), async (_url, options) => {
    calls += 1;
    assert.equal(options.redirect, 'error');
    throw new TypeError('Synthetic redirect refused');
  }));
  assert.equal(calls, 1);
});

test('reapplying unchanged image digests forces process recreation after authorized secret rotation', async (t) => {
  const { dir, manifest } = fixture(t);
  const fake = runner(manifest);
  const options = { ...fake, lockDirectory: dir, verify: async () => {} };
  const before = inspectSecrets(manifest);
  await deploy(manifest, before, options);
  fs.appendFileSync(manifest.secretFiles.api, '# authorized rotation before the next release\n');
  const after = inspectSecrets(manifest);
  assert.notEqual(before.digests[0], after.digests[0]);
  await deploy(manifest, after, options);
  const rollouts = fake.calls.filter((args) => args.includes('up'));
  assert.equal(rollouts.length, 2);
  assert.ok(rollouts.every((args) => args.includes('--force-recreate')));
  assert.ok(rollouts.every((args) => !args.includes('--renew-anon-volumes')));
});
