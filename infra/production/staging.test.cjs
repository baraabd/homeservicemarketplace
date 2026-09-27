'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateManifest, inspectSecrets, dockerEnvironment, verifyHttps, deploy, main } = require('./staging.cjs');

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
  return { calls, run(args, options) {
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
  await verifyHttps(manifest, probe(manifest));
});
for (const [name, change] of [
  ['stale bundle', (route, value) => { if (route === '/build-info.json') value.sourceSha = 'b'.repeat(40); }],
  ['double API version prefix', (route, value) => { if (route === '/build-info.json') value.apiUrl += '/v1'; }],
  ['wrong feature flag', (route, value) => { if (route === '/build-info.json') value.onboardingV2 = true; }],
  ['missing dependency', (route, value) => { if (route === '/health/ready') value.dependencies = []; }],
  ['unready dependency', (route, value) => { if (route === '/health/ready') value.dependencies[0].status = 'down'; }],
]) test(`HTTPS rejects ${name}`, async (t) => {
  const { manifest } = fixture(t);
  await assert.rejects(verifyHttps(manifest, probe(manifest, change)));
});
test('CORS failure is not hidden by a legitimate 401 status', async (t) => {
  const { manifest } = fixture(t);
  const normal = probe(manifest);
  await assert.rejects(verifyHttps(manifest, async (...args) => {
    const response = await normal(...args);
    if (response.status === 401) response.headers.set('access-control-allow-origin', '*');
    return response;
  }), /credentialed CORS/);
});
