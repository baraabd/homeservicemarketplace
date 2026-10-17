#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateManifest, approvedDestinations } = require('../../../infra/production/staging.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const INPUT_SCHEMA = path.join(ROOT, 'infra/production/platform/inputs.schema.json');
const DEFAULT_PLAN = path.join(ROOT, 'infra/production/platform/topology.json');
const DEFAULT_EDGE = path.join(ROOT, 'infra/production/edge/edge-policy.json');
const MAX_INPUT_BYTES = 262144;
const HASH = /^[a-f0-9]{64}$/u;
const ANNOTATIONS = new Set([
  '$schema',
  '$id',
  '$defs',
  'title',
  'description',
  '$comment',
  'default',
  'examples',
]);
const KEYWORDS = new Set([
  '$ref',
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'anyOf',
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function requireCondition(condition, code) {
  if (!condition) fail(code);
}

/** Only JSON metadata is read. Secret paths inside a release are never opened. */
function readJsonFile(file) {
  let fd;
  try {
    requireCondition(typeof file === 'string' && file.length > 0, 'R28_INPUT_FILE_INVALID');
    requireCondition(!fs.lstatSync(file).isSymbolicLink(), 'R28_INPUT_FILE_INVALID');
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0),
    );
    const before = fs.fstatSync(fd, { bigint: true });
    requireCondition(
      before.isFile() && before.size > 0n && before.size <= BigInt(MAX_INPUT_BYTES),
      'R28_INPUT_FILE_INVALID',
    );
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, size);
      if (count === 0) break;
      size += count;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    requireCondition(
      size <= MAX_INPUT_BYTES &&
        BigInt(size) === before.size &&
        ['dev', 'ino', 'size', 'mode', 'mtimeNs', 'ctimeNs'].every(
          (key) => before[key] === after[key],
        ),
      'R28_INPUT_CHANGED',
    );
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } catch (error) {
    if (error.code === 'R28_INPUT_CHANGED') throw error;
    fail('R28_INPUT_FILE_INVALID');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (
    value &&
    typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key]))
        .join(',') +
      '}'
    );
  }
  fail('R28_NON_JSON_INPUT');
}

function jsonType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object')
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value))
    );
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return ['string', 'boolean'].includes(type) && typeof value === type;
}

/**
 * This is the closed subset used by the checked-in schema, not a general JSON
 * Schema implementation. Unsupported schema keywords and external references
 * fail closed instead of silently weakening validation. No schema is fetched.
 */
function assertSchemaVocabulary(schema) {
  const inspect = (node, depth = 0) => {
    requireCondition(
      node && typeof node === 'object' && !Array.isArray(node) && depth <= 40,
      'R28_SCHEMA_UNSUPPORTED',
    );
    for (const key of Object.keys(node)) {
      requireCondition(ANNOTATIONS.has(key) || KEYWORDS.has(key), 'R28_SCHEMA_UNSUPPORTED');
    }
    if (node.$ref !== undefined) {
      requireCondition(
        /^#\/\$defs\/[A-Za-z][A-Za-z0-9]*$/u.test(node.$ref) &&
          Object.hasOwn(schema.$defs || {}, node.$ref.slice(8)),
        'R28_SCHEMA_UNSUPPORTED',
      );
    }
    for (const collection of [node.$defs, node.properties]) {
      if (collection) for (const child of Object.values(collection)) inspect(child, depth + 1);
    }
    if (node.items) inspect(node.items, depth + 1);
    if (node.anyOf) for (const child of node.anyOf) inspect(child, depth + 1);
  };
  inspect(schema);
}

function schemaProblems(value, node, root, label = '$', depth = 0) {
  if (depth > 40) return [label + ':depth'];
  if (node.$ref) {
    const referenced = schemaProblems(
      value,
      root.$defs[node.$ref.slice(8)],
      root,
      label,
      depth + 1,
    );
    if (referenced.length) return referenced;
  }
  if (
    node.anyOf &&
    !node.anyOf.some((branch) => schemaProblems(value, branch, root, label, depth + 1).length === 0)
  ) {
    return [label + ':anyOf'];
  }
  if (
    node.type &&
    !(Array.isArray(node.type) ? node.type : [node.type]).some((type) => jsonType(value, type))
  )
    return [label + ':type'];
  if (Object.hasOwn(node, 'const') && canonicalJson(value) !== canonicalJson(node.const))
    return [label + ':const'];
  if (node.enum && !node.enum.some((item) => canonicalJson(item) === canonicalJson(value)))
    return [label + ':enum'];
  const problems = [];
  if (typeof value === 'string') {
    if (node.minLength !== undefined && [...value].length < node.minLength)
      problems.push(label + ':minLength');
    if (node.maxLength !== undefined && [...value].length > node.maxLength)
      problems.push(label + ':maxLength');
    if (node.pattern && !new RegExp(node.pattern, 'u').test(value))
      problems.push(label + ':pattern');
  }
  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) problems.push(label + ':minimum');
    if (node.maximum !== undefined && value > node.maximum) problems.push(label + ':maximum');
  }
  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems)
      problems.push(label + ':minItems');
    if (node.maxItems !== undefined && value.length > node.maxItems)
      return [...problems, label + ':maxItems'];
    if (node.uniqueItems && new Set(value.map(canonicalJson)).size !== value.length)
      problems.push(label + ':uniqueItems');
    if (node.items)
      for (let i = 0; i < value.length; i += 1)
        problems.push(
          ...schemaProblems(value[i], node.items, root, label + '[' + i + ']', depth + 1),
        );
  }
  if (jsonType(value, 'object')) {
    if ((node.required || []).some((key) => !Object.hasOwn(value, key)))
      problems.push(label + ':required');
    if (
      node.additionalProperties === false &&
      Object.keys(value).some((key) => !Object.hasOwn(node.properties || {}, key))
    )
      problems.push(label + ':additionalProperties');
    for (const [key, child] of Object.entries(node.properties || {})) {
      if (Object.hasOwn(value, key))
        problems.push(...schemaProblems(value[key], child, root, label + '.' + key, depth + 1));
    }
  }
  return problems;
}

function assertShape(value, schema, definition) {
  const problems = schemaProblems(value, definition || schema, schema);
  requireCondition(problems.length === 0, 'R28_SCHEMA_INVALID');
}

function fingerprintSnapshot(plan, edgePolicy, schema) {
  // A policy/schema change invalidates old approval fingerprints as well.
  return createHash('sha256')
    .update(
      canonicalJson({
        validatorContract: 'hsm.platform-validator/v1',
        schema,
        plan,
        edgePolicy,
      }),
    )
    .digest('hex');
}

function planFingerprint(plan, edgePolicy = readJsonFile(DEFAULT_EDGE)) {
  return fingerprintSnapshot(plan, edgePolicy, readJsonFile(INPUT_SCHEMA));
}

function dnsHostname(value) {
  return (
    value.length <= 253 &&
    value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  );
}

function canonicalOrigin(value) {
  if (value === null) return true;
  try {
    const url = new URL(value);
    return (
      typeof value === 'string' &&
      url.protocol === 'https:' &&
      url.origin === value &&
      !url.username &&
      !url.password &&
      dnsHostname(url.hostname) &&
      !/[\s;\\]/u.test(value)
    );
  } catch {
    return false;
  }
}

function distinct(values, code) {
  const selected = values.filter((value) => value !== null);
  requireCondition(new Set(selected).size === selected.length, code);
}

function nullPaths(value, prefix) {
  if (value === null) return [prefix];
  if (Array.isArray(value)) {
    if (value.length === 0 && prefix.endsWith('.storageBuckets')) return [prefix];
    return value.flatMap((item, index) => nullPaths(item, prefix + '[' + index + ']'));
  }
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([key, item]) =>
      nullPaths(item, prefix ? prefix + '.' + key : key),
    );
  return [];
}

function repositoryReference(value, registryHost) {
  if (value === null) return;
  const slash = value.indexOf('/');
  requireCondition(
    slash > 0 &&
      value
        .slice(slash + 1)
        .split('/')
        .every((part) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(part)),
    'R28_REGISTRY_REPOSITORY_INVALID',
  );
  const host = value.slice(0, slash);
  try {
    const url = new URL('https://' + host);
    requireCondition(
      url.host === host &&
        dnsHostname(url.hostname) &&
        !url.username &&
        !url.password &&
        url.pathname === '/',
      'R28_REGISTRY_REPOSITORY_INVALID',
    );
  } catch {
    fail('R28_REGISTRY_REPOSITORY_INVALID');
  }
  if (registryHost !== null) requireCondition(host === registryHost, 'R28_REGISTRY_MISMATCH');
}

function externalSecretPaths(secretFiles) {
  const selected = Object.values(secretFiles).map((file) => {
    requireCondition(
      ![...file].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
      'R28_SECRET_PATH_INVALID',
    );
    const resolved = path.resolve(file);
    const relative = path.relative(ROOT, resolved);
    requireCondition(
      relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
      'R28_SECRET_PATH_INSIDE_REPOSITORY',
    );
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  });
  distinct(selected, 'R28_SECRET_PATHS_MUST_DIFFER');
}

function validatePlan(plan, options = {}) {
  const schema = readJsonFile(INPUT_SCHEMA);
  const edge = options.edgePolicy === undefined ? readJsonFile(DEFAULT_EDGE) : options.edgePolicy;
  assertSchemaVocabulary(schema);
  assertShape(plan, schema);
  requireCondition(schema.$defs?.edgePolicy, 'R28_SCHEMA_UNSUPPORTED');
  assertShape(edge, schema, schema.$defs.edgePolicy);
  requireCondition(canonicalOrigin(edge.origin), 'R28_EDGE_ORIGIN_INVALID');
  requireCondition(
    edge.csp.extraAssetOrigins.every(canonicalOrigin),
    'R28_EDGE_ASSET_ORIGIN_INVALID',
  );
  requireCondition(
    plan.runtime.containerStopGraceSeconds * 1000 > plan.runtime.outboxShutdownGraceMs,
    'R28_WORKER_SHUTDOWN_GRACE_INSUFFICIENT',
  );
  requireCondition(
    plan.network.trustProxyHops === edge.proxy.trustProxyHops,
    'R28_PROXY_BOUNDARY_MISMATCH',
  );
  const { postgres, redis, storage, smtp } = plan.services;
  distinct([postgres.apiRole, postgres.migratorRole], 'R28_DATABASE_ROLES_MUST_DIFFER');
  requireCondition(
    [postgres.apiRole, postgres.migratorRole].every(
      (role) =>
        role === null ||
        (!role.startsWith('pg_') &&
          !['postgres', 'rds_superuser', 'azure_pg_admin', 'cloudsqlsuperuser'].includes(role)),
    ),
    'R28_DATABASE_PRIVILEGED_ROLE_FORBIDDEN',
  );
  requireCondition(
    (smtp.port === 465 && smtp.tlsMode === 'implicit-tls') ||
      (smtp.port === 587 && smtp.tlsMode === 'starttls-required'),
    'R28_SMTP_TLS_MISMATCH',
  );
  distinct(
    [plan.secrets.apiSnapshotId, plan.secrets.migrationSnapshotId],
    'R28_SECRET_SNAPSHOTS_MUST_DIFFER',
  );
  const { production, restore, hostedTests } = plan.isolation;
  distinct(
    [postgres.resourceId, production.databaseResourceId, restore.databaseResourceId],
    'R28_DATABASE_ENVIRONMENTS_MUST_DIFFER',
  );
  distinct(
    [redis.resourceId, production.redisResourceId, restore.redisResourceId],
    'R28_REDIS_ENVIRONMENTS_MUST_DIFFER',
  );
  distinct(
    [
      storage.publicBucket,
      storage.portfolioStagingBucket,
      storage.restrictedBucket,
      ...production.storageBuckets,
      ...restore.storageBuckets,
    ],
    'R28_STORAGE_NAMESPACES_MUST_DIFFER',
  );
  distinct([plan.network.externalNetwork, restore.networkId], 'R28_RESTORE_NETWORK_MUST_DIFFER');
  distinct([plan.target.hostId, restore.targetRef], 'R28_RESTORE_TARGET_MUST_DIFFER');
  distinct([hostedTests.targetRef, restore.targetRef], 'R28_RESTORE_AND_TEST_TARGETS_MUST_DIFFER');
  requireCondition(
    plan.recovery.postgres.rpoSeconds <= plan.recovery.postgres.retentionDays * 86400,
    'R28_RECOVERY_WINDOW_INVALID',
  );
  for (const repository of Object.values(plan.target.registryRepositories)) {
    repositoryReference(repository, plan.target.registryHost);
  }
  if (plan.target.registryHost !== null) {
    try {
      const url = new URL('https://' + plan.target.registryHost);
      requireCondition(
        url.host === plan.target.registryHost &&
          dnsHostname(url.hostname) &&
          !url.username &&
          !url.password &&
          url.pathname === '/',
        'R28_REGISTRY_HOST_INVALID',
      );
    } catch {
      fail('R28_REGISTRY_HOST_INVALID');
    }
  }
  if (plan.release !== null) {
    // Reuse the existing manifest authority, never invoke its deployment path.
    try {
      validateManifest(plan.release);
    } catch {
      fail('R28_RELEASE_MANIFEST_INVALID');
    }
    requireCondition(
      canonicalOrigin(plan.release.apiOrigin) && canonicalOrigin(plan.release.webOrigin),
      'R28_RELEASE_ORIGIN_INVALID',
    );
    requireCondition(plan.release.apiOrigin === plan.release.webOrigin, 'R28_SAME_ORIGIN_REQUIRED');
    requireCondition(
      edge.origin === null || edge.origin === plan.release.apiOrigin,
      'R28_EDGE_RELEASE_ORIGIN_MISMATCH',
    );
    requireCondition(
      plan.network.externalNetwork === null ||
        plan.network.externalNetwork === plan.release.externalNetwork,
      'R28_RELEASE_NETWORK_MISMATCH',
    );
    externalSecretPaths(plan.release.secretFiles);
    for (const [kind, image] of Object.entries(plan.release.images)) {
      const repository = image.slice(0, image.indexOf('@'));
      repositoryReference(repository, plan.target.registryHost);
      const declared = plan.target.registryRepositories[kind];
      requireCondition(
        declared === null || declared === repository,
        'R28_IMAGE_REPOSITORY_MISMATCH',
      );
    }
    if (options.approvedOrigins !== undefined) {
      try {
        approvedDestinations(plan.release, options.approvedOrigins);
      } catch {
        fail('R28_INDEPENDENT_ORIGIN_APPROVAL_MISMATCH');
      }
    }
  } else {
    requireCondition(options.approvedOrigins === undefined, 'R28_ORIGIN_APPROVAL_REQUIRES_RELEASE');
  }
  // Bind the report to the same schema snapshot that was validated above.
  const planSha256 = fingerprintSnapshot(plan, edge, schema);
  if (options.expectedPlanSha256 !== undefined) {
    requireCondition(
      typeof options.expectedPlanSha256 === 'string' && HASH.test(options.expectedPlanSha256),
      'R28_PLAN_HASH_INVALID',
    );
    requireCondition(options.expectedPlanSha256 === planSha256, 'R28_PLAN_HASH_MISMATCH');
  }
  const blockers = [];
  const group = (id, owner, fields) => {
    if (fields.length) blockers.push({ id, owner, fields: [...new Set(fields)].sort() });
  };
  group(
    'HOSTED_TARGET_AUTHORITY_REQUIRED',
    'Infrastructure and spending owner',
    nullPaths(plan.target, 'target'),
  );
  group(
    'HOSTED_SERVICE_INPUTS_REQUIRED',
    'Database, storage, mail and security owners',
    nullPaths(plan.services, 'services'),
  );
  group('HOSTED_RELEASE_INPUTS_REQUIRED', 'Release owner', nullPaths(plan.release, 'release'));
  group('HOSTED_NETWORK_EVIDENCE_REQUIRED', 'Network owner', nullPaths(plan.network, 'network'));
  group(
    'HOSTED_SECRET_DELIVERY_REQUIRED',
    'Secret rotation operator',
    nullPaths(plan.secrets, 'secrets'),
  );
  group(
    'REGISTRY_PROVENANCE_REQUIRED',
    'Release and registry owner',
    nullPaths(plan.provenance, 'provenance'),
  );
  const isolationMissing = nullPaths(plan.isolation, 'isolation');
  for (const name of ['production', 'restore']) {
    if (plan.isolation[name].storageBuckets.length !== 3)
      isolationMissing.push('isolation.' + name + '.storageBuckets');
  }
  group(
    'ISOLATED_TARGETS_REQUIRED',
    'Infrastructure owner and R35/R36/R37 coordinator',
    isolationMissing,
  );
  group(
    'RECOVERY_ACCEPTANCE_REQUIRED',
    'Data owner and R36 coordinator',
    nullPaths(plan.recovery, 'recovery'),
  );
  group(
    'EDGE_INTEGRATION_EVIDENCE_REQUIRED',
    'Edge owner and R25/R26 coordinator',
    nullPaths(edge, 'edge').filter((field) => field !== 'edge.cookies.domain'),
  );
  if (plan.release !== null && options.approvedOrigins === undefined) {
    group('INDEPENDENT_ORIGIN_APPROVAL_REQUIRED', 'Release operator', [
      'approvedOrigins.apiOrigin',
      'approvedOrigins.webOrigin',
    ]);
  }
  const targetInputsComplete = blockers.length === 0;
  return {
    sprint: 'R28',
    status: 'CONFIGURATION_ONLY',
    hostedStatus: targetInputsComplete ? 'HOSTED_EVIDENCE_PENDING' : 'HOSTED_ENVIRONMENT_BLOCKED',
    deploymentStarted: false,
    authorizationVerified: false,
    targetInputsComplete,
    planSha256,
    blockers,
    remainingHostedChecks: [
      'Owner authorization for exact account, resources, region, cost and plan hash',
      'Effective database grants, storage ACLs, Redis isolation and public ingress denial',
      'Verified registry provenance and deployed immutable image/source identity',
      'Applied edge CSP/CORS/cookies/TLS and both realtime transports',
      'External email, scanner verdicts, private-media denial and durable worker delivery',
      'Approved recovery objectives, isolated restore and representative hosted browser journeys',
    ],
  };
}

function main(args = process.argv.slice(2)) {
  requireCondition(
    Array.isArray(args) && args.every((arg) => typeof arg === 'string') && args[0] === '--check',
    'R28_USAGE',
  );
  let input = DEFAULT_PLAN;
  const options = {};
  let requireTarget = false;
  let index = 1;
  if (args[index] !== undefined && !args[index].startsWith('--')) input = args[index++];
  const seen = new Set();
  let apiOrigin;
  let webOrigin;
  while (index < args.length) {
    const flag = args[index++];
    requireCondition(
      [
        '--api-origin',
        '--web-origin',
        '--expected-plan-sha',
        '--edge-policy',
        '--require-target',
      ].includes(flag) && !seen.has(flag),
      'R28_USAGE',
    );
    seen.add(flag);
    if (flag === '--require-target') {
      requireTarget = true;
      continue;
    }
    const value = args[index++];
    requireCondition(
      typeof value === 'string' && value.length > 0 && !value.startsWith('--'),
      'R28_USAGE',
    );
    if (flag === '--api-origin') apiOrigin = value;
    if (flag === '--web-origin') webOrigin = value;
    if (flag === '--expected-plan-sha') options.expectedPlanSha256 = value;
    if (flag === '--edge-policy') options.edgePolicy = readJsonFile(value);
  }
  requireCondition((apiOrigin === undefined) === (webOrigin === undefined), 'R28_USAGE');
  if (apiOrigin !== undefined) options.approvedOrigins = { apiOrigin, webOrigin };
  const report = validatePlan(readJsonFile(input), options);
  return { report, exitCode: requireTarget && !report.targetInputsComplete ? 2 : 0 };
}

if (require.main === module) {
  try {
    const { report, exitCode } = main();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = exitCode;
  } catch (error) {
    const code = /^R28_[A-Z_]+$/u.test(error.code || '') ? error.code : 'R28_CONFIGURATION_INVALID';
    console.error(
      JSON.stringify({
        sprint: 'R28',
        status: 'INVALID_CONFIGURATION',
        deploymentStarted: false,
        authorizationVerified: false,
        code,
      }),
    );
    process.exitCode = 1;
  }
}

module.exports = { validatePlan, planFingerprint, main, readJsonFile };
