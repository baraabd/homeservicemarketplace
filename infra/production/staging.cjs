#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const SHA = /^[a-f0-9]{40}$/u;
const IMAGE = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/u;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/u;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}
function keys(value, expected, label) {
  requireCondition(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key)),
  `${label}: exact documented fields are required`);
}
function origin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password;
  } catch { return false; }
}

function validateManifest(value) {
  keys(value, ['schemaVersion', 'sourceSha', 'dockerContext', 'projectName', 'externalNetwork',
    'images', 'secretFiles', 'ports', 'webOrigin', 'apiOrigin', 'onboardingV2'], 'manifest');
  requireCondition(value.schemaVersion === 1 && typeof value.sourceSha === 'string' && SHA.test(value.sourceSha), 'manifest: version 1 and a full source SHA are required');
  requireCondition([value.dockerContext, value.externalNetwork].every((name) => typeof name === 'string' && NAME.test(name)), 'manifest: explicit Docker context and existing network are required');
  requireCondition(typeof value.projectName === 'string' && /^hsm-staging-[a-z0-9-]{1,48}$/u.test(value.projectName), 'manifest: an isolated hsm-staging-* project is required');
  requireCondition(origin(value.webOrigin) && origin(value.apiOrigin), 'manifest: canonical HTTPS origins are required');
  requireCondition(typeof value.onboardingV2 === 'boolean', 'manifest: onboardingV2 must be explicit');
  keys(value.images, ['api', 'migrator', 'web'], 'images');
  requireCondition(Object.values(value.images).every((image) => typeof image === 'string' && IMAGE.test(image)), 'images: all three images must use immutable SHA-256 digests');
  requireCondition(new Set(Object.values(value.images)).size === 3, 'images: API, migrator and web must be separate images');
  keys(value.secretFiles, ['api', 'migration'], 'secretFiles');
  requireCondition(Object.values(value.secretFiles).every((file) => typeof file === 'string' && path.isAbsolute(file)), 'secretFiles: absolute external paths are required');
  keys(value.ports, ['api', 'web'], 'ports');
  requireCondition(Object.values(value.ports).every((port) => Number.isInteger(port) && port >= 1024 && port <= 65535) &&
    value.ports.api !== value.ports.web, 'ports: distinct non-privileged loopback ports are required');
  return value;
}

function readSecret(file, root = ROOT) {
  const resolved = fs.realpathSync(file);
  const relative = path.relative(fs.realpathSync(root), resolved);
  requireCondition(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'secretFiles: secrets must resolve outside the repository');
  // Validate and read ONE open object, never stat(path) followed by read(path).
  // Windows has no O_NOFOLLOW/O_NONBLOCK; descriptor checks still apply there.
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  const descriptor = fs.openSync(resolved, flags);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    const limit = 262144;
    requireCondition(before.isFile() && before.size > 0n && before.size <= BigInt(limit), 'secretFiles: bounded regular files are required');
    requireCondition(process.platform === 'win32' || (before.mode & 0o007n) === 0n, 'secretFiles: deny all access to other host users');
    // Bound the read itself: a file growing after fstat must not allocate an
    // unbounded buffer. Parse and fingerprint the very same verified bytes.
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(descriptor, buffer, size, buffer.length - size, size);
      if (count === 0) break;
      size += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    requireCondition(size <= limit && BigInt(size) === before.size &&
      ['dev', 'ino', 'size', 'mode', 'mtimeNs', 'ctimeNs'].every((key) => before[key] === after[key]),
    'secretFiles: file changed while reading; revalidate release inputs');
    const bytes = buffer.subarray(0, size);
    return { resolved, values: parseEnv(bytes.toString('utf8')),
      digest: createHash('sha256').update(bytes).digest('hex') };
  } finally {
    fs.closeSync(descriptor);
  }
}
function postgresIdentity(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('database: a valid PostgreSQL URL is required'); }
  requireCondition(['postgresql:', 'postgres:'].includes(url.protocol) && url.username && url.pathname.length > 1 &&
    url.searchParams.getAll('sslmode').length === 1 && url.searchParams.get('sslmode') === 'require' &&
    url.searchParams.getAll('sslaccept').length === 1 && url.searchParams.get('sslaccept') === 'strict',
  'database: require PostgreSQL TLS and strict certificate verification');
  return { user: decodeURIComponent(url.username), database: decodeURIComponent(url.pathname), schema: url.searchParams.get('schema') || 'public' };
}

function inspectSecrets(manifest, root = ROOT) {
  const api = readSecret(manifest.secretFiles.api, root);
  const migration = readSecret(manifest.secretFiles.migration, root);
  requireCondition(api.resolved !== migration.resolved, 'secretFiles: separate API and migration files are required');
  const env = api.values;
  requireCondition(env.NODE_ENV === 'production' && env.APP_ENV === 'staging', 'runtime: only explicit production/staging labels are accepted');
  requireCondition(env.FRONTEND_URL === manifest.webOrigin && (!env.PORT || env.PORT === '4000'), 'runtime: frontend origin and API port must match the release');
  if (manifest.apiOrigin !== manifest.webOrigin) {
    requireCondition((env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).includes(manifest.webOrigin), 'runtime: the exact cross-origin frontend must be allowed');
  }
  requireCondition(Object.keys(env).every((key) => !/^(?:NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|PATH|LD_PRELOAD|LD_LIBRARY_PATH|DIRECT_URL|MIGRATION_DATABASE_URL)$/u.test(key) && !/^(?:VITE_|COMPOSE_|DOCKER_)/u.test(key)), 'runtime: startup overrides, migration credentials and browser variables are forbidden in API secrets');
  keys(migration.values, ['DATABASE_URL'], 'migration secret');
  const appIdentity = postgresIdentity(env.DATABASE_URL);
  const migrationIdentity = postgresIdentity(migration.values.DATABASE_URL);
  requireCondition(appIdentity.user !== migrationIdentity.user, 'database: application and migration identities must differ');
  requireCondition(appIdentity.database === migrationIdentity.database && appIdentity.schema === migrationIdentity.schema, 'database: application and migrator must target the same database and schema');
  return { api: api.resolved, migration: migration.resolved,
    digests: [api.digest, migration.digest] };
}

function secretDigest(file) {
  return readSecret(file).digest;
}
function assertUnchangedSecrets(secrets) {
  requireCondition([secrets.api, secrets.migration].every((file, index) =>
    secretDigest(file) === secrets.digests[index]), 'secretFiles: release inputs changed; revalidate before applying');
}

function dockerEnvironment(manifest, secrets) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:COMPOSE_|HSM_|DOCKER_HOST$|DOCKER_CONTEXT$)/u.test(key)));
  return { ...env, COMPOSE_DISABLE_ENV_FILE: '1',
    HSM_STAGING_PROJECT: manifest.projectName, HSM_API_IMAGE: manifest.images.api,
    HSM_MIGRATOR_IMAGE: manifest.images.migrator, HSM_WEB_IMAGE: manifest.images.web,
    HSM_API_ENV_FILE: secrets.api, HSM_MIGRATION_ENV_FILE: secrets.migration,
    HSM_API_PORT: String(manifest.ports.api), HSM_WEB_PORT: String(manifest.ports.web),
    HSM_RUNTIME_NETWORK: manifest.externalNetwork };
}

function execute(args, options) {
  const result = spawnSync('docker', args, { ...options, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 600000, shell: false, windowsHide: true });
  // Third-party stderr can include DSNs. Never return it to the report.
  requireCondition(!result.error && result.status === 0, 'Docker step failed; inspect protected operator diagnostics before retrying');
  return result.stdout;
}

/** Network authority comes from separate, explicit operator CLI arguments,
 * not from a release file. Never derive defaults for these from the manifest.
 * This boundary is for a trusted operator process, not a public HTTP service.
 */
function approvedDestinations(manifest, supplied) {
  keys(supplied, ['apiOrigin', 'webOrigin'], 'approved destinations');
  requireCondition(origin(supplied.apiOrigin) && origin(supplied.webOrigin), 'approved destinations: canonical HTTPS origins are required');
  requireCondition(manifest.apiOrigin === supplied.apiOrigin && manifest.webOrigin === supplied.webOrigin,
    'approved destinations: release origins differ from independent operator authorization');
  return Object.freeze({ apiOrigin: supplied.apiOrigin, webOrigin: supplied.webOrigin });
}

async function verifyHttps(manifest, supplied, request = fetch) {
  const approved = approvedDestinations(manifest, supplied);
  requireCondition(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'HTTPS: certificate verification must not be disabled');
  async function get(url, expectedStatus = 200, headers = {}) {
    const response = await request(url, { method: 'GET', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000), headers });
    requireCondition(response.status === expectedStatus, 'HTTPS: unexpected response or unavailable service');
    return response;
  }
  // Only independent approved origins and fixed paths/headers reach the
  // transport. No file bytes, DSN, digest, source SHA or manifest field is sent.
  const live = await (await get(`${approved.apiOrigin}/health/live`)).json();
  const ready = await (await get(`${approved.apiOrigin}/health/ready`)).json();
  requireCondition(live.status === 'ok' && ready.ready === true && Array.isArray(ready.dependencies) &&
    ['postgres', 'redis'].every((name) => ready.dependencies.some((dep) => dep.name === name && dep.status === 'up')) &&
    ready.dependencies.every((dep) => dep.status === 'up'), 'HTTPS: live/readiness payloads are not healthy');
  const build = await (await get(`${approved.webOrigin}/build-info.json`)).json();
  requireCondition(build.sourceSha === manifest.sourceSha && build.apiUrl === approved.apiOrigin && build.onboardingV2 === manifest.onboardingV2, 'HTTPS: the deployed web build identity or build-time flags differ');
  const unauthenticated = await get(`${approved.apiOrigin}/v1/auth/me`, 401, { Origin: approved.webOrigin, 'X-Client-Kind': 'web' });
  if (approved.apiOrigin !== approved.webOrigin) {
    requireCondition(unauthenticated.headers.get('access-control-allow-origin') === approved.webOrigin &&
      unauthenticated.headers.get('access-control-allow-credentials') === 'true', 'HTTPS: browser credentialed CORS is not configured correctly');
  }
}

async function applyRelease(manifest, secrets, { run = execute, verify = verifyHttps, approvedOrigins } = {}) {
  const env = dockerEnvironment(manifest, secrets);
  const docker = (...args) => run(['--context', manifest.dockerContext, ...args], { cwd: ROOT, env });
  const compose = (...args) => docker('compose', '--project-directory', ROOT, '--file', path.join(__dirname, 'docker-compose.staging.yml'), '--project-name', manifest.projectName, ...args);
  const phases = [];
  function phase(name, action) {
    try { const result = action(); phases.push(name); return result; }
    catch { throw new Error(`staging: ${name} failed; no automatic rollback, cleanup or retry was performed`); }
  }
  // File-backed Compose secrets use paths on the daemon host. Refuse an SSH/TCP
  // context rather than validating local files but mounting different remote ones.
  const endpoint = phase('context', () => JSON.parse(docker('context', 'inspect', manifest.dockerContext, '--format', '{{json .Endpoints.docker.Host}}')));
  requireCondition(typeof endpoint === 'string' && /^(?:unix|npipe):\/\//u.test(endpoint), 'context: run this launcher on the deployment host with a local daemon');
  phase('existing-network', () => docker('network', 'inspect', manifest.externalNetwork));
  phase('compose-config', () => compose('config', '--quiet'));
  phase('pull-digests', () => compose('pull', 'api-preflight', 'api-migrate', 'api', 'web'));
  phase('image-source', () => {
    for (const [kind, image] of Object.entries(manifest.images)) {
      const labels = JSON.parse(docker('image', 'inspect', image, '--format', '{{json .Config.Labels}}'));
      requireCondition(labels?.['org.opencontainers.image.revision'] === manifest.sourceSha, 'image source mismatch');
      if (kind === 'web') requireCondition(labels?.['io.hsm.web.api-url'] === manifest.apiOrigin, 'web API origin mismatch');
    }
  });
  phase('secret-consistency', () => assertUnchangedSecrets(secrets));
  phase('runtime-preflight', () => compose('run', '--rm', '--no-deps', 'api-preflight'));
  phase('secret-consistency-before-migration', () => assertUnchangedSecrets(secrets));
  phase('migrations', () => compose('run', '--rm', '--no-deps', 'api-migrate'));
  phase('secret-consistency-before-rollout', () => assertUnchangedSecrets(secrets));
  phase('application-readiness', () => compose('up', '--detach', '--wait', '--wait-timeout', '180', '--no-deps', '--force-recreate', 'api', 'web'));
  try { await verify(manifest, approvedOrigins); phases.push('https-and-build-identity'); }
  catch { throw new Error('staging: HTTPS acceptance failed after application rollout; no automatic rollback was performed'); }
  return { status: 'DEPLOYED_NOT_ACCEPTED', sourceSha: manifest.sourceSha, images: manifest.images, phases,
    remaining: ['real test inbox delivery', 'storage ownership and anonymous-denial tests', 'scanner verdict and worker delivery', 'database grants and restore evidence', 'authenticated browser cookies and journeys'] };
}

// Cooperative host-local lock, not a replacement for RBAC or CI protection.
// A process crash leaves the lock in place for an operator to investigate; never
// guess that an old timestamp makes an in-flight database migration safe to race.
async function deploy(manifest, secrets, options = {}) {
  validateManifest(manifest);
  const approvedOrigins = approvedDestinations(manifest, options.approvedOrigins);
  requireCondition(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'HTTPS: certificate verification must not be disabled');
  const lockFile = path.join(options.lockDirectory || os.tmpdir(), `${manifest.projectName}.lock`);
  let descriptor;
  try { descriptor = fs.openSync(lockFile, 'wx', 0o600); }
  catch { throw new Error('staging: deployment lock unavailable; investigate the existing deployment before retrying'); }
  const identity = fs.fstatSync(descriptor);
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, sourceSha: manifest.sourceSha }));
    return await applyRelease(manifest, secrets, { ...options, approvedOrigins });
  } finally {
    fs.closeSync(descriptor);
    try {
      const current = fs.lstatSync(lockFile);
      if (current.ino === identity.ino && current.dev === identity.dev) fs.unlinkSync(lockFile);
    } catch { /* Leave unknown/replaced lock files for the operator. */ }
  }
}

async function main(args = process.argv.slice(2)) {
  const [mode, manifestPath, approval, ...extra] = args;
  requireCondition((mode === '--check' || mode === '--apply') && manifestPath &&
    (mode !== '--check' || (approval === undefined && extra.length === 0)),
  'usage: node staging.cjs --check manifest.json OR --apply manifest.json project@source-sha --api-origin https://api-host --web-origin https://web-host');
  let manifest;
  try { manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))); }
  catch { throw new Error('manifest: cannot read a valid release manifest; no deployment started'); }
  if (mode === '--apply') requireCondition(approval === `${manifest.projectName}@${manifest.sourceSha}`, 'approval: explicit project@source-sha authorization is required');
  let approvedOrigins;
  if (mode === '--apply') {
    requireCondition(extra.length === 4 && extra[0] === '--api-origin' && extra[2] === '--web-origin',
      'approval: independently authorize --api-origin and --web-origin; never copy unreviewed file values');
    approvedOrigins = approvedDestinations(manifest, { apiOrigin: extra[1], webOrigin: extra[3] });
  }
  let secrets;
  try { secrets = inspectSecrets(manifest); }
  catch { throw new Error('secrets: external files or runtime/identity constraints failed; values are withheld'); }
  if (mode === '--check') return { status: 'CONFIGURATION_ONLY', sourceSha: manifest.sourceSha, deploymentStarted: false };
  return deploy(manifest, secrets, { approvedOrigins });
}
if (require.main === module) {
  main().then((report) => console.log(JSON.stringify(report, null, 2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { readSecret, approvedDestinations, validateManifest, inspectSecrets, dockerEnvironment, verifyHttps, deploy, main };
