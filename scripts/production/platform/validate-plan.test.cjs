'use strict';

// Disposable declarations exercise the offline plan boundary. They are never
// hosted evidence, account authorization, a role grant, or deployment inputs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { validatePlan, planFingerprint, main } = require('./validate-plan.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const CLI = path.join(__dirname, 'validate-plan.cjs');
const PLAN = path.join(ROOT, 'infra/production/platform/topology.json');
const EDGE = path.join(ROOT, 'infra/production/edge/edge-policy.json');
const FROZEN_SOURCE = '40cdac5c9ce6acaa8dedc0385984a807ae9a84d0';
const SHA256 = /^[a-f0-9]{64}$/u;
const PRIVATE_SENTINEL = 'R28_TEST_PRIVATE_VALUE_MUST_NOT_APPEAR';

function source() {
  return {
    plan: JSON.parse(fs.readFileSync(PLAN, 'utf8')),
    edgePolicy: JSON.parse(fs.readFileSync(EDGE, 'utf8')),
  };
}

function fixture(t, value = source().plan) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-r28-validator-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'plan.json');
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
  return { directory, file, value };
}

function cli(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 512 * 1024,
    ...options,
  });
}

function cliReport(result, exitCode) {
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, exitCode, result.stderr || result.stdout);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(PRIVATE_SENTINEL, 'u'));
  if (exitCode === 1) {
    assert.equal(result.stdout.trim(), '');
    const failure = JSON.parse(result.stderr.trim());
    assert.equal(failure.status, 'INVALID_CONFIGURATION');
    assert.equal(failure.deploymentStarted, false);
    assert.equal(failure.authorizationVerified, false);
    assert.match(failure.code, /^R28_[A-Z_]+$/u);
    return failure;
  }
  assert.equal(result.stderr.trim(), '');
  return JSON.parse(result.stdout.trim());
}

function assertConfigurationOnly(report, complete = false) {
  assert.equal(report.status, 'CONFIGURATION_ONLY');
  assert.equal(report.deploymentStarted, false);
  assert.equal(report.authorizationVerified, false);
  assert.equal(report.targetInputsComplete, complete);
  assert.equal(
    report.hostedStatus,
    complete ? 'HOSTED_EVIDENCE_PENDING' : 'HOSTED_ENVIRONMENT_BLOCKED',
  );
  assert.match(report.planSha256, SHA256);
  assert.ok(Array.isArray(report.blockers));
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .reverse()
        .map((key) => [key, reverseKeys(value[key])]),
    );
  }
  return value;
}

function fullDeclarations() {
  const { plan, edgePolicy } = source();
  Object.assign(plan.target, {
    provider: 'fixture-provider',
    accountId: 'fixture-account',
    region: 'fixture-region',
    hostId: 'fixture-host',
    dnsZoneId: 'fixture-dns-zone',
    registryHost: 'registry.example.test',
    registryRepositories: {
      api: 'registry.example.test/hsm/api',
      migrator: 'registry.example.test/hsm/migrator',
      web: 'registry.example.test/hsm/web',
    },
    secretStoreId: 'fixture-secret-store',
    operatorApprovalRef: 'fixture:unverified-operator-reference',
    spendApprovalRef: 'fixture:unverified-budget-reference',
    monthlyCostCeiling: { amount: 100, currency: 'USD' },
  });
  plan.release = {
    schemaVersion: 1,
    sourceSha: 'a'.repeat(40),
    dockerContext: 'default',
    projectName: 'hsm-staging-r28-fixture',
    externalNetwork: 'hsm-r28-fixture',
    images: {
      api: `registry.example.test/hsm/api@sha256:${'1'.repeat(64)}`,
      migrator: `registry.example.test/hsm/migrator@sha256:${'2'.repeat(64)}`,
      web: `registry.example.test/hsm/web@sha256:${'3'.repeat(64)}`,
    },
    secretFiles: {
      api: path.join(os.tmpdir(), 'hsm-r28-unread-snapshots', 'api.snapshot'),
      migration: path.join(os.tmpdir(), 'hsm-r28-unread-snapshots', 'migration.snapshot'),
    },
    ports: { api: 14328, web: 15328 },
    webOrigin: 'https://staging.example.test',
    apiOrigin: 'https://staging.example.test',
    onboardingV2: false,
  };
  Object.assign(plan.services.postgres, {
    resourceId: 'fixture:database:staging',
    host: 'db.staging.example.test',
    database: 'hsm_r28_fixture',
    apiRole: 'hsm_api',
    migratorRole: 'hsm_migrator',
    privilegeEvidenceRef: 'fixture:unverified-postgres-policy',
  });
  Object.assign(plan.services.redis, {
    resourceId: 'fixture:redis:staging',
    host: 'redis.staging.example.test',
    aclEvidenceRef: 'fixture:unverified-redis-acl',
  });
  Object.assign(plan.services.storage, {
    publicBucket: 'hsm-r28-fixture-public',
    portfolioStagingBucket: 'hsm-r28-fixture-portfolio',
    restrictedBucket: 'hsm-r28-fixture-restricted',
    accessEvidenceRef: 'fixture:unverified-storage-access',
  });
  Object.assign(plan.services.smtp, {
    provider: 'fixture-mail',
    host: 'smtp.example.test',
    senderDomain: 'sender.example.test',
    deliveryEvidenceRef: 'fixture:unverified-mail-delivery',
  });
  Object.assign(plan.services.clamav, {
    resourceId: 'fixture:clamav:staging',
    host: 'clamav.staging.example.test',
    verdictEvidenceRef: 'fixture:unverified-scan-verdict',
  });
  Object.assign(plan.network, {
    externalNetwork: 'hsm-r28-fixture',
    boundaryEvidenceRef: 'fixture:unverified-network-boundary',
  });
  Object.assign(plan.secrets, {
    apiSnapshotId: 'fixture:immutable-api-snapshot',
    migrationSnapshotId: 'fixture:immutable-migrator-snapshot',
    rotationLockEvidenceRef: 'fixture:unverified-rotation-serialization',
  });
  for (const key of Object.keys(plan.provenance)) {
    plan.provenance[key] = `fixture:unverified-${key}`;
  }
  Object.assign(plan.isolation.production, {
    databaseResourceId: 'fixture:database:production',
    redisResourceId: 'fixture:redis:production',
    storageBuckets: [
      'hsm-production-public',
      'hsm-production-portfolio',
      'hsm-production-restricted',
    ],
  });
  Object.assign(plan.isolation.restore, {
    targetRef: 'fixture:restore-target',
    databaseResourceId: 'fixture:database:restore',
    redisResourceId: 'fixture:redis:restore',
    storageBuckets: ['hsm-restore-public', 'hsm-restore-portfolio', 'hsm-restore-restricted'],
    networkId: 'hsm-r28-restore',
    approvalRef: 'fixture:unverified-restore-authority',
  });
  Object.assign(plan.isolation.hostedTests, {
    targetRef: 'fixture:hosted-test-target',
    approvalRef: 'fixture:unverified-test-authority',
  });
  plan.recovery.ownerApprovalRef = 'fixture:unverified-recovery-proposal';
  plan.recovery.restoreEvidenceRef = 'fixture:unverified-restore-report';
  edgePolicy.origin = 'https://staging.example.test';
  edgePolicy.tls.certificateRef = 'fixture:unverified-certificate';
  edgePolicy.csp.integrationEvidenceRef = 'fixture:unverified-csp-integration';
  edgePolicy.applicationEvidenceRef = 'fixture:unverified-edge-application';
  // The test supplies this separate object explicitly. Production operators
  // must obtain destinations independently of any unreviewed plan document.
  const approvedOrigins = {
    apiOrigin: 'https://staging.example.test',
    webOrigin: 'https://staging.example.test',
  };
  return { plan, edgePolicy, approvedOrigins };
}

function at(value, field) {
  return field.split('.').reduce((current, key) => current[key], value);
}

function set(value, field, replacement) {
  const keys = field.split('.');
  const last = keys.pop();
  keys.reduce((current, key) => current[key], value)[last] = replacement;
}

test('fully populated declarations are compatible with the existing staging manifest', () => {
  const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
  const { validateManifest } = require(path.join(ROOT, 'infra/production/staging.cjs'));
  assert.equal(validateManifest(plan.release), plan.release);
  assert.notEqual(plan.release.sourceSha, plan.frozenBaseSha);
  const report = validatePlan(plan, { edgePolicy, approvedOrigins });
  assertConfigurationOnly(report, true);
  const serialized = JSON.stringify(report);
  for (const unverified of [
    plan.target.accountId,
    plan.target.operatorApprovalRef,
    plan.services.postgres.privilegeEvidenceRef,
    plan.release.secretFiles.api,
    plan.release.secretFiles.migration,
  ]) {
    assert.ok(!serialized.includes(unverified), 'reports contain no private target values');
  }
});

test('filled evidence-reference strings cannot promote a plan to hosted or release acceptance', () => {
  const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
  assertConfigurationOnly(validatePlan(plan, { edgePolicy, approvedOrigins }), true);
  for (const claimed of ['SANDBOX_ACCEPTED', 'HOSTED_ACCEPTED', 'RELEASE_ACCEPTED', 'DEPLOYED']) {
    const changed = structuredClone(plan);
    changed.status = claimed;
    assert.throws(() => validatePlan(changed, { edgePolicy, approvedOrigins }));
    const changedEdge = structuredClone(edgePolicy);
    changedEdge.status = claimed;
    assert.throws(() => validatePlan(plan, { edgePolicy: changedEdge, approvedOrigins }));
  }
});

test('changing a selected target or edge asset origin invalidates a previously reviewed hash', () => {
  const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
  const expectedPlanSha256 = planFingerprint(plan, edgePolicy);
  const changed = structuredClone(plan);
  changed.target.accountId = 'fixture-different-account';
  assert.notEqual(planFingerprint(changed, edgePolicy), expectedPlanSha256);
  assert.throws(() => validatePlan(changed, { edgePolicy, approvedOrigins, expectedPlanSha256 }));
  const changedEdge = structuredClone(edgePolicy);
  changedEdge.csp.extraAssetOrigins = ['https://cdn.example.test'];
  assert.notEqual(planFingerprint(plan, changedEdge), expectedPlanSha256);
  assert.throws(() =>
    validatePlan(plan, { edgePolicy: changedEdge, approvedOrigins, expectedPlanSha256 }),
  );
});

for (const field of Object.keys(source().plan)) {
  test(`rejects an omitted required plan field: ${field}`, () => {
    const { plan } = source();
    delete plan[field];
    assert.throws(() => validatePlan(plan));
  });
}

for (const field of [
  'target',
  'target.registryRepositories',
  'target.monthlyCostCeiling',
  'release',
  'release.images',
  'release.ports',
  'release.secretFiles',
  'services',
  'services.postgres',
  'services.postgres.apiPrivileges',
  'services.postgres.migratorPrivileges',
  'services.redis',
  'services.storage',
  'services.smtp',
  'services.clamav',
  'services.mongo',
  'runtime',
  'runtime.workerPlacement',
  'network',
  'secrets',
  'provenance',
  'isolation',
  'isolation.production',
  'isolation.restore',
  'isolation.hostedTests',
  'recovery',
  'recovery.postgres',
  'recovery.storage',
  'policy',
]) {
  test(`closed plan contract rejects unknown nested fields in ${field}`, () => {
    const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
    at(plan, field).undocumentedBypass = PRIVATE_SENTINEL;
    assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins }));
  });
}

for (const field of ['tls', 'cookies', 'cors', 'csp', 'realtime', 'privateMedia', 'proxy']) {
  test(`closed edge contract rejects unknown nested fields in ${field}`, () => {
    const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
    edgePolicy[field].undocumentedBypass = PRIVATE_SENTINEL;
    assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins }));
  });
}

const unsafePlans = [
  ['different frozen source', 'frozenBaseSha', 'b'.repeat(40)],
  ['production environment', 'environment', 'production'],
  ['unapproved PostgreSQL version', 'services.postgres.majorVersion', 17],
  ['unverified PostgreSQL certificates', 'services.postgres.tls', 'require'],
  ['unapproved Redis version', 'services.redis.majorVersion', 8],
  ['shared Redis instance', 'services.redis.dedicated', false],
  ['unencrypted Redis', 'services.redis.tls', false],
  ['unauthenticated Redis', 'services.redis.auth', 'none'],
  ['parallel storage authority', 'services.storage.authority', 'custom-storage.json'],
  ['plaintext SMTP port', 'services.smtp.port', 25],
  ['public ClamAV', 'services.clamav.exposure', 'public'],
  ['silently enabled Mongo', 'services.mongo.enabled', true],
  ['unsupported replica topology', 'runtime.apiReplicas', 2],
  ['invented standalone outbox binary', 'runtime.workerPlacement.outbox', 'dist/outbox.worker.js'],
  ['invented scanner binary', 'runtime.workerPlacement.evidenceScan', 'dist/scanner.worker.js'],
  ['incorrect retention placement', 'runtime.workerPlacement.evidenceRetention', 'api'],
  [
    'incorrect dispute worker entrypoint',
    'runtime.workerPlacement.disputeMaintenance',
    'worker.js',
  ],
  ['public API listener', 'network.apiBind', '0.0.0.0'],
  ['public web listener bypassing edge', 'network.webBind', '0.0.0.0'],
  ['public database ingress', 'network.databasePublicAccess', true],
  ['public Redis ingress', 'network.redisPublicAccess', true],
  ['public management ingress', 'network.managementPublicAccess', true],
  ['unbounded proxy trust', 'network.trustProxyHops', true],
  ['additional public listener', 'network.publicListeners', ['https-edge:443', 'postgres:5432']],
  ['secret delivery through environment arguments', 'secrets.delivery', 'docker-build-args'],
  ['rotation racing deployment', 'secrets.serializedRotation', false],
  ['restore outbound side effects', 'isolation.restore.outboundDelivery', 'enabled'],
  ['unapproved recovery acceptance', 'recovery.decision', 'APPROVED'],
  ['backup without WAL archive', 'recovery.postgres.method', 'daily-dump'],
  ['disabled storage versions', 'recovery.storage.versioning', 'Suspended'],
  ['parallel retention authority', 'recovery.storage.retentionAuthority', 'custom-retention.json'],
  ['live money activation', 'policy.liveMoneyEnabled', true],
  ['verification policy change', 'policy.verification', 'enabled'],
  ['work-access policy change', 'policy.workAccess', 'disabled'],
  ['demo provider initialization', 'policy.demoProviders', true],
  ['automatic administrator grant', 'policy.adminGrants', true],
  ['unapproved dispute enforcement', 'policy.disputeMode', 'enforce'],
  ['unapproved retention enforcement', 'policy.evidenceRetentionMode', 'enforce'],
  ['negative budget', 'target.monthlyCostCeiling.amount', -1],
  ['nonfinite budget', 'target.monthlyCostCeiling.amount', Infinity],
  ['NaN budget', 'target.monthlyCostCeiling.amount', NaN],
  ['fractional backup retention', 'recovery.postgres.retentionDays', 1.5],
  ['zero recovery point objective', 'recovery.postgres.rpoSeconds', 0],
  ['negative restore time objective', 'recovery.postgres.rtoSeconds', -1],
  ['oversized evidence reference', 'target.operatorApprovalRef', 'x'.repeat(256)],
  ['credential-bearing reference', 'target.operatorApprovalRef', 'https://user:pass@example.test'],
  ['shell-template reference', 'target.hostId', '${EXECUTE_THIS}'],
  ['control characters in a reference', 'target.hostId', 'host\r\nheader'],
  ['URL in a service hostname', 'services.postgres.host', 'https://db.example.test'],
  ['credentials in a service hostname', 'services.redis.host', 'user:pass@redis.example.test'],
];
for (const [name, field, value] of unsafePlans) {
  test(`rejects unsafe plan: ${name}`, () => {
    const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
    set(plan, field, value);
    assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins }));
  });
}

const serviceHostFields = [
  'services.postgres.host',
  'services.redis.host',
  'services.smtp.host',
  'services.smtp.senderDomain',
  'services.clamav.host',
];
const invalidDnsHosts = [
  ['empty label', 'a..b'],
  ['label with a leading hyphen', 'a.-b.test'],
  ['label with a trailing hyphen', 'a.b-.test'],
  ['64-character label', `${'a'.repeat(64)}.test`],
  ['254-character hostname', [63, 63, 63, 62].map((length) => 'a'.repeat(length)).join('.')],
];
for (const [name, hostname] of invalidDnsHosts) {
  for (const field of serviceHostFields) {
    test(`DNS boundary rejects ${name} in ${field}`, () => {
      const { plan, edgePolicy } = source();
      set(plan, field, hostname);
      assert.throws(() => validatePlan(plan, { edgePolicy }));
    });
  }

  test(`DNS boundary rejects ${name} in the registry host`, () => {
    const { plan, edgePolicy } = source();
    plan.target.registryHost = hostname;
    assert.throws(() => validatePlan(plan, { edgePolicy }));
  });

  for (const kind of ['api', 'migrator', 'web']) {
    test(`DNS boundary rejects ${name} in the declared ${kind} repository host`, () => {
      const { plan, edgePolicy } = source();
      // An unselected registry must not let a malformed repository host pass.
      plan.target.registryRepositories[kind] = `${hostname}/hsm/${kind}`;
      assert.throws(() => validatePlan(plan, { edgePolicy }));
    });

    test(`DNS boundary rejects ${name} in the ${kind} image repository host`, () => {
      const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
      // Avoid an unrelated registry/repository mismatch masking DNS validation.
      plan.target.registryHost = null;
      plan.target.registryRepositories[kind] = null;
      plan.release.images[kind] = `${hostname}/hsm/${kind}@sha256:${'1'.repeat(64)}`;
      assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins }));
    });
  }

  for (const field of ['origin', 'csp.extraAssetOrigins']) {
    test(`DNS boundary rejects ${name} in edge ${field}`, () => {
      const { plan, edgePolicy } = source();
      const origin = `https://${hostname}`;
      set(edgePolicy, field, field === 'origin' ? origin : [origin]);
      assert.throws(() => validatePlan(plan, { edgePolicy }));
    });
  }

  test(`DNS boundary rejects ${name} in release origins when the edge is unselected`, () => {
    const { plan, edgePolicy } = fullDeclarations();
    edgePolicy.origin = null;
    plan.release.apiOrigin = `https://${hostname}`;
    plan.release.webOrigin = `https://${hostname}`;
    // No edge match or independent-origin mismatch can mask this boundary.
    assert.throws(() => validatePlan(plan, { edgePolicy }));
  });
}

for (const [name, hostname] of [
  ['an internal single-label hostname', 'service'],
  ['a 63-character DNS label', `${'a'.repeat(63)}.example.test`],
  ['a canonical IPv4 address', '192.0.2.10'],
]) {
  test(`DNS boundary preserves ${name} across services, images and origins`, () => {
    const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
    for (const field of serviceHostFields) set(plan, field, hostname);
    plan.target.registryHost = hostname;
    for (const kind of ['api', 'migrator', 'web']) {
      const digest = plan.release.images[kind].split('@')[1];
      plan.target.registryRepositories[kind] = `${hostname}/hsm/${kind}`;
      plan.release.images[kind] = `${hostname}/hsm/${kind}@${digest}`;
    }
    const origin = `https://${hostname}`;
    plan.release.apiOrigin = origin;
    plan.release.webOrigin = origin;
    edgePolicy.origin = origin;
    edgePolicy.csp.extraAssetOrigins = [origin];
    approvedOrigins.apiOrigin = origin;
    approvedOrigins.webOrigin = origin;
    assertConfigurationOnly(validatePlan(plan, { edgePolicy, approvedOrigins }), true);
  });
}

test('DNS boundary accepts a 253-character hostname with valid individual labels', () => {
  const { plan, edgePolicy } = source();
  const hostname = [63, 63, 63, 61].map((length) => 'a'.repeat(length)).join('.');
  assert.equal(hostname.length, 253);
  for (const field of serviceHostFields) set(plan, field, hostname);
  plan.target.registryHost = hostname;
  edgePolicy.origin = `https://${hostname}`;
  edgePolicy.csp.extraAssetOrigins = [`https://${hostname}`];
  assertConfigurationOnly(validatePlan(plan, { edgePolicy }));
});

for (const field of Object.keys(source().plan.services.postgres.apiPrivileges)) {
  test(`API policy cannot enable ${field}`, () => {
    const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
    plan.services.postgres.apiPrivileges[field] = true;
    assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins }));
  });
}

for (const field of Object.keys(source().plan.services.postgres.migratorPrivileges)) {
  test(`migrator policy cannot weaken ${field}`, () => {
    const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
    plan.services.postgres.migratorPrivileges[field] =
      !plan.services.postgres.migratorPrivileges[field];
    assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins }));
  });
}

const unsafeEdges = [
  ['legacy TLS', 'tls.minimumVersion', 'TLSv1.0'],
  ['certificate bypass', 'tls.certificateVerification', false],
  ['unreviewed HSTS preload', 'tls.preload', true],
  ['insecure cookies', 'cookies.secure', false],
  ['cross-subdomain cookie', 'cookies.domain', '.example.test'],
  ['broad refresh-cookie path', 'cookies.refreshPath', '/'],
  ['weakened refresh SameSite', 'cookies.refreshSameSite', 'none'],
  ['weakened CSRF SameSite', 'cookies.csrfSameSite', 'none'],
  ['JavaScript-readable access token', 'cookies.accessHttpOnly', false],
  ['dropped Set-Cookie', 'cookies.preserveSetCookie', false],
  ['wildcard CORS', 'cors.mode', '*'],
  ['null Origin acceptance', 'cors.rejectNullOrigin', false],
  ['reflected CORS', 'cors.reflectOrigin', true],
  ['missing-Origin upgrade acceptance', 'cors.missingOrigin', 'allow-all'],
  ['CORS header stripping', 'cors.forwardToApi', false],
  ['report-only browser CSP', 'csp.webMode', 'report-only'],
  ['disabled API CSP', 'csp.apiMode', 'off'],
  ['unsafe evaluation', 'csp.allowUnsafeEval', true],
  ['wildcard script sources', 'csp.scriptSources', ['*']],
  ['scheme-wide connection sources', 'csp.connectSources', ['https:', 'wss:']],
  ['WebSocket-only topology', 'realtime.transports', ['websocket']],
  ['lost upgrade headers', 'realtime.forwardUpgrade', false],
  ['unauthorized upgrade origins', 'realtime.requireAllowedOrigin', false],
  ['buffered SSE', 'realtime.sseBuffering', true],
  ['cached SSE', 'realtime.sseCache', true],
  ['compressed SSE', 'realtime.sseCompression', true],
  ['fabricated multi-instance acceptance', 'realtime.multiInstanceStatus', 'ACCEPTED'],
  ['authenticated response caching', 'privateMedia.cacheAuthenticatedResponses', true],
  [
    'restricted documents on CDN',
    'privateMedia.cdnPrefixes',
    ['requests/', 'avatars/', 'verification/'],
  ],
  ['lost private namespace protection', 'privateMedia.neverCdnPrefixes', ['verification/']],
  ['stripped media authentication', 'privateMedia.stripAuthHeaders', true],
  ['spoofed forwarding headers', 'proxy.overwriteForwardedHeaders', false],
  ['direct public API', 'proxy.allowDirectApiAccess', true],
  ['public management edge', 'proxy.managementExposure', 'public'],
];
for (const [name, field, value] of unsafeEdges) {
  test(`rejects unsafe edge: ${name}`, () => {
    const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
    set(edgePolicy, field, value);
    assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins }));
  });
}

test('management route matching and private realtime route ordering cannot be weakened', () => {
  for (const change of [
    (edge) => (edge.routes.find((route) => route.path === '/metrics').match = 'exact'),
    (edge) => (edge.routes.find((route) => route.path === '/metrics').upstream = 'api'),
    (edge) => (edge.routes.find((route) => route.path === '/v1/me/events').cache = 'public'),
    (edge) => edge.routes.reverse(),
  ]) {
    const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
    change(edgePolicy);
    assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins }));
  }
});

const crossFieldMutations = [
  [
    'API and migrator share a database role',
    (plan) => {
      plan.services.postgres.migratorRole = plan.services.postgres.apiRole;
    },
  ],
  [
    'API role names PostgreSQL superuser',
    (plan) => {
      plan.services.postgres.apiRole = 'postgres';
    },
  ],
  [
    'migrator role names a provider superuser',
    (plan) => {
      plan.services.postgres.migratorRole = 'rds_superuser';
    },
  ],
  [
    'API role names a built-in privileged role',
    (plan) => {
      plan.services.postgres.apiRole = 'pg_write_all_data';
    },
  ],
  [
    'container stop equals outbox grace',
    (plan) => {
      plan.runtime.containerStopGraceSeconds = 20;
    },
  ],
  [
    'container stop precedes outbox grace',
    (plan) => {
      plan.runtime.containerStopGraceSeconds = 19;
    },
  ],
  [
    'implicit TLS on the STARTTLS port',
    (plan) => {
      plan.services.smtp.tlsMode = 'implicit-tls';
    },
  ],
  [
    'STARTTLS on the implicit TLS port',
    (plan) => {
      plan.services.smtp.port = 465;
    },
  ],
  [
    'shared secret snapshot identities',
    (plan) => {
      plan.secrets.migrationSnapshotId = plan.secrets.apiSnapshotId;
    },
  ],
  [
    'staging and production share a physical database',
    (plan) => {
      plan.isolation.production.databaseResourceId = plan.services.postgres.resourceId;
    },
  ],
  [
    'restore reaches the production database',
    (plan) => {
      plan.isolation.restore.databaseResourceId = plan.isolation.production.databaseResourceId;
    },
  ],
  [
    'staging and production share Redis',
    (plan) => {
      plan.isolation.production.redisResourceId = plan.services.redis.resourceId;
    },
  ],
  [
    'restore reaches staging Redis',
    (plan) => {
      plan.isolation.restore.redisResourceId = plan.services.redis.resourceId;
    },
  ],
  [
    'public and restricted storage share a bucket',
    (plan) => {
      plan.services.storage.restrictedBucket = plan.services.storage.publicBucket;
    },
  ],
  [
    'staging storage aliases a production bucket',
    (plan) => {
      plan.isolation.production.storageBuckets[0] = plan.services.storage.publicBucket;
    },
  ],
  [
    'restore aliases a production object namespace',
    (plan) => {
      plan.isolation.restore.storageBuckets[1] = plan.isolation.production.storageBuckets[1];
    },
  ],
  [
    'restore shares the staging network',
    (plan) => {
      plan.isolation.restore.networkId = plan.network.externalNetwork;
    },
  ],
  [
    'restore reuses the selected staging host',
    (plan) => {
      plan.isolation.restore.targetRef = plan.target.hostId;
    },
  ],
  [
    'destructive restore and browser tests share a target',
    (plan) => {
      plan.isolation.hostedTests.targetRef = plan.isolation.restore.targetRef;
    },
  ],
  [
    'release network differs from reviewed topology',
    (plan) => {
      plan.release.externalNetwork = 'different-network';
    },
  ],
  [
    'release image uses a different registry',
    (plan) => {
      plan.release.images.api = `other.example.test/hsm/api@sha256:${'1'.repeat(64)}`;
    },
  ],
  [
    'same registry serves an unapproved repository',
    (plan) => {
      plan.release.images.api = `registry.example.test/unapproved/api@sha256:${'1'.repeat(64)}`;
    },
  ],
  [
    'declared repository belongs to a different registry',
    (plan) => {
      plan.target.registryRepositories.web = 'other.example.test/hsm/web';
    },
  ],
  [
    'declared repository includes a mutable tag',
    (plan) => {
      plan.target.registryRepositories.api += ':latest';
    },
  ],
  [
    'release image is mutable',
    (plan) => {
      plan.release.images.api = 'registry.example.test/hsm/api:latest';
    },
  ],
  [
    'release substitutes the API image for the migrator',
    (plan) => {
      plan.release.images.migrator = plan.release.images.api;
    },
  ],
  [
    'release aliases local ports',
    (plan) => {
      plan.release.ports.api = plan.release.ports.web;
    },
  ],
  [
    'release secrets point inside the repository',
    (plan) => {
      plan.release.secretFiles.api = path.join(ROOT, 'unsafe-secret-file');
    },
  ],
  [
    'release secret path is relative',
    (plan) => {
      plan.release.secretFiles.api = 'api.env';
    },
  ],
  [
    'release secret paths refer to the same snapshot',
    (plan) => {
      plan.release.secretFiles.migration = plan.release.secretFiles.api;
    },
  ],
  [
    'release secret paths alias after normalization',
    (plan) => {
      const api = plan.release.secretFiles.api;
      plan.release.secretFiles.migration =
        path.dirname(api) + path.sep + 'alias' + path.sep + '..' + path.sep + path.basename(api);
    },
  ],
  [
    'release secret path contains a control character',
    (plan) => {
      plan.release.secretFiles.api += '\n';
    },
  ],
];
for (const [name, change] of crossFieldMutations) {
  test(`cross-field boundary rejects: ${name}`, () => {
    const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
    change(plan);
    assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins }));
  });
}

test('both supported SMTP TLS modes are accepted only with their matching ports', () => {
  const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
  assertConfigurationOnly(validatePlan(plan, { edgePolicy, approvedOrigins }), true);
  plan.services.smtp.port = 465;
  plan.services.smtp.tlsMode = 'implicit-tls';
  assertConfigurationOnly(validatePlan(plan, { edgePolicy, approvedOrigins }), true);
});

test('missing independently supplied origins remain a blocker even with every field filled', () => {
  const { plan, edgePolicy } = fullDeclarations();
  const report = validatePlan(plan, { edgePolicy });
  assertConfigurationOnly(report);
  assert.ok(
    report.blockers.some((blocker) => blocker.id === 'INDEPENDENT_ORIGIN_APPROVAL_REQUIRED'),
  );
});

test('the prepared same-origin topology rejects an unintegrated cross-origin release', () => {
  const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
  plan.release.apiOrigin = 'https://api.example.test';
  approvedOrigins.apiOrigin = 'https://api.example.test';
  assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins }));
});

test('an edge origin cannot disagree with the declared release destination', () => {
  const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
  edgePolicy.origin = 'https://different.example.test';
  assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins }));
});

for (const invalid of [
  null,
  {},
  { apiOrigin: 'https://staging.example.test' },
  { apiOrigin: 'https://staging.example.test', webOrigin: 'https://other.example.test' },
  { apiOrigin: 'http://staging.example.test', webOrigin: 'http://staging.example.test' },
]) {
  test(`invalid independent origins are rejected (${JSON.stringify(invalid)})`, () => {
    const { plan, edgePolicy } = fullDeclarations();
    assert.throws(() => validatePlan(plan, { edgePolicy, approvedOrigins: invalid }));
  });
}

for (const origin of [
  'http://staging.example.test',
  'https://staging.example.test/',
  'https://staging.example.test/v1',
  'https://staging.example.test?value=private',
  'https://staging.example.test#fragment',
  'https://user:pass@staging.example.test',
  'https://*.example.test',
  'https://staging.example.test:443',
  'https://staging.example.test;directive',
  'https://${ORIGIN}',
]) {
  test(`edge and CSP origins reject noncanonical or injected values: ${origin}`, () => {
    const { plan, edgePolicy } = source();
    const invalidEdge = structuredClone(edgePolicy);
    invalidEdge.origin = origin;
    assert.throws(() => validatePlan(plan, { edgePolicy: invalidEdge }));
    const invalidAsset = structuredClone(edgePolicy);
    invalidAsset.csp.extraAssetOrigins = [origin];
    assert.throws(() => validatePlan(plan, { edgePolicy: invalidAsset }));
  });
}

test('duplicate CSP origins cannot be hidden in an array', () => {
  const { plan, edgePolicy } = source();
  edgePolicy.csp.extraAssetOrigins = ['https://cdn.example.test', 'https://cdn.example.test'];
  assert.throws(() => validatePlan(plan, { edgePolicy }));
});

test('missing target evidence stays blocked without being reclassified as verified', () => {
  const cases = [
    ['target.accountId', null],
    ['target.spendApprovalRef', null],
    ['target.monthlyCostCeiling.currency', null],
    ['services.postgres.privilegeEvidenceRef', null],
    ['services.redis.aclEvidenceRef', null],
    ['services.storage.accessEvidenceRef', null],
    ['services.smtp.deliveryEvidenceRef', null],
    ['services.clamav.verdictEvidenceRef', null],
    ['network.boundaryEvidenceRef', null],
    ['secrets.rotationLockEvidenceRef', null],
    ['provenance.apiAttestationRef', null],
    ['isolation.restore.approvalRef', null],
    ['isolation.production.storageBuckets', []],
    ['isolation.restore.storageBuckets', ['hsm-restore-public']],
    ['isolation.hostedTests.approvalRef', null],
    ['recovery.ownerApprovalRef', null],
    ['recovery.restoreEvidenceRef', null],
  ];
  for (const [field, missing] of cases) {
    const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
    set(plan, field, missing);
    const report = validatePlan(plan, { edgePolicy, approvedOrigins });
    assertConfigurationOnly(report);
    assert.ok(
      report.blockers.some((blocker) => blocker.fields.includes(field)),
      field,
    );
  }
  for (const field of [
    'origin',
    'tls.certificateRef',
    'csp.integrationEvidenceRef',
    'applicationEvidenceRef',
  ]) {
    const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
    set(edgePolicy, field, null);
    const report = validatePlan(plan, { edgePolicy, approvedOrigins });
    assertConfigurationOnly(report);
    assert.ok(report.blockers.some((blocker) => blocker.fields.includes(`edge.${field}`)));
  }
});

for (const edgePolicy of [null, false, 0, '', [], {}]) {
  test(`explicit invalid edge policy cannot fall back to the default (${JSON.stringify(edgePolicy)})`, () => {
    assert.throws(() => validatePlan(source().plan, { edgePolicy }));
  });
}

test('the committed plan validates as configuration only on the accepted frozen source', () => {
  const { plan, edgePolicy } = source();
  const before = JSON.stringify({ plan, edgePolicy });
  assert.equal(plan.frozenBaseSha, FROZEN_SOURCE);
  const report = validatePlan(plan, { edgePolicy });
  assertConfigurationOnly(report);
  assert.ok(report.blockers.length > 0);
  for (const blocker of report.blockers) {
    assert.equal(typeof blocker.id, 'string');
    assert.equal(typeof blocker.owner, 'string');
    assert.ok(Array.isArray(blocker.fields));
  }
  assert.equal(JSON.stringify({ plan, edgePolicy }), before, 'validation must not mutate inputs');
});

test('default edge policy and explicitly supplied policy produce the same fingerprint', () => {
  const { plan, edgePolicy } = source();
  assert.equal(planFingerprint(plan), planFingerprint(plan, edgePolicy));
  assert.equal(validatePlan(plan).planSha256, planFingerprint(plan, edgePolicy));
});

test('plan fingerprint is stable under recursive object-key reordering', () => {
  const { plan, edgePolicy } = source();
  assert.equal(
    planFingerprint(plan, edgePolicy),
    planFingerprint(reverseKeys(plan), reverseKeys(edgePolicy)),
  );
});

test('a matching independently supplied plan hash succeeds and a stale one fails', () => {
  const { plan, edgePolicy } = source();
  const expectedPlanSha256 = planFingerprint(plan, edgePolicy);
  assertConfigurationOnly(validatePlan(plan, { edgePolicy, expectedPlanSha256 }));
  const other = expectedPlanSha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
  assert.throws(() => validatePlan(plan, { edgePolicy, expectedPlanSha256: other }));
  for (const invalid of ['', null, 'a'.repeat(63), 'A'.repeat(64), `${other}\n`]) {
    assert.throws(() => validatePlan(plan, { edgePolicy, expectedPlanSha256: invalid }));
  }
});

for (const invalid of [null, undefined, [], '', 1, true]) {
  test(`rejects a non-object plan (${String(invalid)})`, () => {
    assert.throws(() => validatePlan(invalid));
  });
}

test('unknown fields cannot smuggle input values into reports or errors', () => {
  const { plan, edgePolicy } = source();
  plan[PRIVATE_SENTINEL] = PRIVATE_SENTINEL;
  assert.throws(
    () => validatePlan(plan, { edgePolicy }),
    (error) => {
      assert.equal(typeof error.message, 'string');
      assert.ok(!error.message.includes(PRIVATE_SENTINEL));
      return true;
    },
  );
});

test('main returns the report and does not change process.exitCode', () => {
  const before = process.exitCode;
  const result = main(['--check']);
  assert.equal(result.exitCode, 0);
  assertConfigurationOnly(result.report);
  assert.equal(process.exitCode, before);
});

test('CLI checks the default plan independently of the caller working directory', (t) => {
  const { directory } = fixture(t);
  const report = cliReport(cli(['--check'], { cwd: directory }), 0);
  assertConfigurationOnly(report);
});

test('CLI reads an explicit plan without creating result, lock or secret files', (t) => {
  const { directory, file } = fixture(t);
  const before = fs.readFileSync(file);
  const entries = fs.readdirSync(directory).sort();
  assertConfigurationOnly(cliReport(cli(['--check', file]), 0));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(fs.readdirSync(directory).sort(), entries);
});

test('require-target reports exit 2 for missing inputs, preserving configuration-only status', (t) => {
  const { file } = fixture(t);
  const result = main(['--check', file, '--require-target']);
  assert.equal(result.exitCode, 2);
  assertConfigurationOnly(result.report);
  assertConfigurationOnly(cliReport(cli(['--check', file, '--require-target']), 2));
});

test('CLI binds its report to the independently supplied fingerprint', (t) => {
  const { plan, edgePolicy } = source();
  const { file } = fixture(t, plan);
  const hash = planFingerprint(plan, edgePolicy);
  assert.equal(cliReport(cli(['--check', file, '--expected-plan-sha', hash]), 0).planSha256, hash);
  cliReport(cli(['--check', file, '--expected-plan-sha', '0'.repeat(64)]), 1);
});

test('external plan and edge files can satisfy input completeness without claiming deployment', (t) => {
  const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
  const { directory, file } = fixture(t, plan);
  const edgeFile = path.join(directory, 'edge-policy.json');
  fs.writeFileSync(edgeFile, JSON.stringify(edgePolicy), { mode: 0o600 });
  const args = [
    '--check',
    file,
    '--edge-policy',
    edgeFile,
    '--api-origin',
    approvedOrigins.apiOrigin,
    '--web-origin',
    approvedOrigins.webOrigin,
    '--expected-plan-sha',
    planFingerprint(plan, edgePolicy),
    '--require-target',
  ];
  const result = main(args);
  assert.equal(result.exitCode, 0);
  assertConfigurationOnly(result.report, true);
  assertConfigurationOnly(cliReport(cli(args), 0), true);
  assert.equal(result.report.blockers.length, 0);
  assert.ok(result.report.remainingHostedChecks.length > 0);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['edge-policy.json', 'plan.json']);
});

test('CLI leaves fully populated declarations blocked when separate origins are absent', (t) => {
  const { plan, edgePolicy } = fullDeclarations();
  const { directory, file } = fixture(t, plan);
  const edgeFile = path.join(directory, 'edge-policy.json');
  fs.writeFileSync(edgeFile, JSON.stringify(edgePolicy), { mode: 0o600 });
  const args = ['--check', file, '--edge-policy', edgeFile, '--require-target'];
  const report = cliReport(cli(args), 2);
  assertConfigurationOnly(report);
  assert.equal(report.blockers[0].id, 'INDEPENDENT_ORIGIN_APPROVAL_REQUIRED');
});

test('CLI fingerprints the actual supplied edge file rather than only its plan', (t) => {
  const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
  const { directory, file } = fixture(t, plan);
  const oldHash = planFingerprint(plan, edgePolicy);
  edgePolicy.csp.extraAssetOrigins = ['https://cdn.example.test'];
  const edgeFile = path.join(directory, 'edge-policy.json');
  fs.writeFileSync(edgeFile, JSON.stringify(edgePolicy), { mode: 0o600 });
  const failure = cliReport(
    cli([
      '--check',
      file,
      '--edge-policy',
      edgeFile,
      '--api-origin',
      approvedOrigins.apiOrigin,
      '--web-origin',
      approvedOrigins.webOrigin,
      '--expected-plan-sha',
      oldHash,
    ]),
    1,
  );
  assert.equal(failure.code, 'R28_PLAN_HASH_MISMATCH');
});

for (const bytes of ['null', 'false', '0', '""', '[]', '{}']) {
  test(`CLI rejects an explicit invalid edge document (${bytes})`, (t) => {
    const { directory, file } = fixture(t);
    const edgeFile = path.join(directory, 'edge-policy.json');
    fs.writeFileSync(edgeFile, bytes, { mode: 0o600 });
    cliReport(cli(['--check', file, '--edge-policy', edgeFile]), 1);
  });
}

for (const args of [
  [],
  ['--apply'],
  ['--check', '--apply'],
  ['--check', '--unknown'],
  ['--check', '--check'],
  ['--check', '--require-target', '--require-target'],
  ['--check', '--expected-plan-sha'],
  ['--check', '--edge-policy'],
  ['--check', '--api-origin'],
  ['--check', '--web-origin'],
  ['--check', '--api-origin', 'https://api.example.test'],
  ['--check', '--web-origin', 'https://web.example.test'],
  ['--check', '--expected-plan-sha', PRIVATE_SENTINEL],
]) {
  test(`CLI rejects unsupported or incomplete arguments: ${args.join(' ') || 'none'}`, () => {
    cliReport(cli(args), 1);
  });
}

for (const [name, bytes] of [
  ['empty', ''],
  ['invalid JSON', `{"value":"${PRIVATE_SENTINEL}"`],
  ['JSON null', 'null'],
  ['array', '[]'],
  ['oversized', ' '.repeat(1024 * 1024 + 1)],
]) {
  test(`CLI rejects ${name} files without returning their contents`, (t) => {
    const { file } = fixture(t);
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    cliReport(cli(['--check', file]), 1);
  });
}

test('CLI rejects directories and missing paths without exposing local filenames', (t) => {
  const { directory } = fixture(t);
  const missing = path.join(directory, PRIVATE_SENTINEL);
  cliReport(cli(['--check', directory]), 1);
  cliReport(cli(['--check', missing]), 1);
});

test('CLI rejects a symlink input before reading its target', (t) => {
  const { directory, file } = fixture(t);
  const link = path.join(directory, 'linked-plan.json');
  fs.symlinkSync(file, link);
  cliReport(cli(['--check', link]), 1);
});

for (const [name, symlinkFallback] of [
  ['a replaced regular file', false],
  ['a symlink when O_NOFOLLOW is unavailable', true],
]) {
  test(`post-open identity rejects ${name} before reading any bytes`, (t) => {
    const { directory, file } = fixture(t);
    const input = symlinkFallback ? path.join(directory, 'linked-plan.json') : file;
    const replacement = path.join(directory, 'replacement.json');
    if (symlinkFallback) fs.symlinkSync(file, input);
    else fs.writeFileSync(replacement, fs.readFileSync(file), { mode: 0o600 });
    const script = `
      'use strict';
      const fs = require('node:fs');
      const { readJsonFile } = require(${JSON.stringify(CLI)});
      const input = ${JSON.stringify(input)};
      const replacement = ${JSON.stringify(replacement)};
      const symlinkFallback = ${JSON.stringify(symlinkFallback)};
      const open = fs.openSync;
      const read = fs.readSync;
      const close = fs.closeSync;
      const result = { code: null, opened: 0, reads: 0, closes: 0, replaced: false };
      let inputDescriptor;
      fs.openSync = function (file, flags, ...rest) {
        // Simulate only this input's platform fallback; leave fs.constants intact.
        if (file === input && symlinkFallback) flags &= ~(fs.constants.O_NOFOLLOW || 0);
        const descriptor = open.call(this, file, flags, ...rest);
        if (file === input) {
          inputDescriptor = descriptor;
          result.opened += 1;
          if (!symlinkFallback) {
            // Both files contain valid JSON; only their inode identities differ.
            fs.renameSync(replacement, input);
            result.replaced = true;
          }
        }
        return descriptor;
      };
      fs.readSync = function (descriptor, ...rest) {
        if (descriptor === inputDescriptor) {
          result.reads += 1;
          throw new Error('R28_TEST_UNEXPECTED_INPUT_READ');
        }
        return read.call(this, descriptor, ...rest);
      };
      fs.closeSync = function (descriptor, ...rest) {
        if (descriptor === inputDescriptor) result.closes += 1;
        return close.call(this, descriptor, ...rest);
      };
      try { readJsonFile(input); }
      catch (error) { result.code = error.code; }
      result.descriptorClosed = false;
      try { fs.fstatSync(inputDescriptor); }
      catch (error) { result.descriptorClosed = error.code === 'EBADF'; }
      process.stdout.write(JSON.stringify(result));
    `;
    const result = spawnSync(process.execPath, ['--eval', script], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      code: 'R28_INPUT_FILE_INVALID',
      opened: 1,
      reads: 0,
      closes: 1,
      replaced: !symlinkFallback,
      descriptorClosed: true,
    });
  });
}

test('a plan changed during its descriptor read is rejected, not partially validated', (t) => {
  const { file } = fixture(t);
  const script = `
    'use strict';
    const fs = require('node:fs');
    const input = ${JSON.stringify(file)};
    const open = fs.openSync;
    const read = fs.readSync;
    let inputDescriptor;
    let changed = false;
    fs.openSync = function (file, ...rest) {
      const descriptor = open.call(this, file, ...rest);
      if (file === input) inputDescriptor = descriptor;
      return descriptor;
    };
    fs.readSync = function (descriptor, ...rest) {
      const count = read.call(this, descriptor, ...rest);
      if (descriptor === inputDescriptor && !changed) {
        changed = true;
        fs.appendFileSync(input, ' ');
      }
      return count;
    };
    const { main } = require(${JSON.stringify(CLI)});
    try { main(['--check', input]); process.exitCode = 1; }
    catch (error) { process.stdout.write(String(error.code)); }
  `;
  const result = spawnSync(process.execPath, ['--eval', script], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'R28_INPUT_CHANGED');
});

test('validation and approval fingerprint use one immutable schema snapshot', () => {
  const schemaFile = path.join(ROOT, 'infra/production/platform/inputs.schema.json');
  const script = `
    'use strict';
    const fs = require('node:fs');
    const path = require('node:path');
    const { validatePlan, planFingerprint } = require(${JSON.stringify(CLI)});
    const plan = JSON.parse(fs.readFileSync(${JSON.stringify(PLAN)}, 'utf8'));
    const edgePolicy = JSON.parse(fs.readFileSync(${JSON.stringify(EDGE)}, 'utf8'));
    const expected = planFingerprint(plan, edgePolicy);
    const open = fs.openSync;
    let schemaReads = 0;
    fs.openSync = function (file, ...rest) {
      if (typeof file === 'string' && path.resolve(file) === ${JSON.stringify(schemaFile)}) {
        schemaReads += 1;
      }
      return open.call(this, file, ...rest);
    };
    const report = validatePlan(plan, { edgePolicy });
    process.stdout.write(JSON.stringify({ expected, actual: report.planSha256, schemaReads }));
  `;
  const result = spawnSync(process.execPath, ['--eval', script], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.actual, report.expected);
  assert.equal(report.schemaReads, 1, 'a reread could hash rules that were never validated');
});

test('complete-input check performs no network, subprocess, mutation or declared/ambient secret read', (t) => {
  const { plan, edgePolicy, approvedOrigins } = fullDeclarations();
  const { directory, file } = fixture(t, plan);
  const edgeFile = path.join(directory, 'edge-policy.json');
  fs.writeFileSync(edgeFile, JSON.stringify(edgePolicy), { mode: 0o600 });
  const ambientSecret = path.join(directory, '.env');
  fs.writeFileSync(ambientSecret, PRIVATE_SENTINEL, { mode: 0o600 });
  const args = [
    '--check',
    file,
    '--edge-policy',
    edgeFile,
    '--api-origin',
    approvedOrigins.apiOrigin,
    '--web-origin',
    approvedOrigins.webOrigin,
    '--require-target',
  ];
  const script = `
    'use strict';
    const fs = require('node:fs');
    const path = require('node:path');
    const forbidden = () => { throw new Error('R28_FORBIDDEN_SIDE_EFFECT'); };
    const secrets = new Set(${JSON.stringify([ambientSecret, ...Object.values(plan.release.secretFiles)])});
    for (const name of ['openSync', 'readFileSync', 'statSync', 'lstatSync',
      'realpathSync', 'readlinkSync', 'existsSync']) {
      const original = fs[name];
      fs[name] = function (file, ...rest) {
        if (typeof file === 'string' && secrets.has(path.resolve(file))) forbidden();
        return original.call(this, file, ...rest);
      };
    }
    for (const name of ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync',
      'createWriteStream', 'mkdir', 'mkdirSync', 'rm', 'rmSync', 'unlink', 'unlinkSync',
      'rename', 'renameSync', 'chmod', 'chmodSync', 'chown', 'chownSync', 'truncate',
      'truncateSync', 'symlink', 'symlinkSync', 'link', 'linkSync']) fs[name] = forbidden;
    for (const name of ['writeFile', 'appendFile', 'mkdir', 'rm', 'unlink', 'rename',
      'chmod', 'chown', 'truncate', 'symlink', 'link']) fs.promises[name] = forbidden;
    for (const module of ['node:http', 'node:https']) {
      const api = require(module);
      api.request = api.get = api.createServer = forbidden;
    }
    for (const module of ['node:net', 'node:tls']) {
      const api = require(module);
      api.connect = api.createConnection = api.createServer = forbidden;
    }
    require('node:dns').lookup = forbidden;
    require('node:dns').resolve = forbidden;
    const child = require('node:child_process');
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile',
      'execFileSync', 'fork']) child[name] = forbidden;
    globalThis.fetch = forbidden;
    const { main } = require(${JSON.stringify(CLI)});
    const result = main(${JSON.stringify(args)});
    process.stdout.write(JSON.stringify(result.report));
    process.exitCode = result.exitCode;
  `;
  const result = spawnSync(process.execPath, ['--eval', script], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 15_000,
  });
  assertConfigurationOnly(cliReport(result, 0), true);
  assert.equal(fs.readFileSync(ambientSecret, 'utf8'), PRIVATE_SENTINEL);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['.env', 'edge-policy.json', 'plan.json']);
});

test('concurrent CLI readers produce the same result and leave their shared input intact', async (t) => {
  const { directory, file } = fixture(t);
  const bytes = fs.readFileSync(file);
  const run = () =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, '--check', file], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (value) => (stdout += value));
      child.stderr.setEncoding('utf8').on('data', (value) => (stderr += value));
      child.on('error', reject);
      child.on('close', (status, signal) => resolve({ stdout, stderr, status, signal }));
    });
  const results = await Promise.all(Array.from({ length: 4 }, run));
  const reports = results.map((result) => cliReport(result, 0));
  reports.forEach((report) => assertConfigurationOnly(report));
  reports.forEach((report) => assert.deepEqual(report, reports[0]));
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.deepEqual(fs.readdirSync(directory), ['plan.json']);
});
