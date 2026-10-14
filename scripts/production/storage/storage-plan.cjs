'use strict';
// R20 — validate and render the reviewable storage plan in
// infra/production/storage/.
//
// The plan is JSON with ${PLACEHOLDER}s and no account, region, bucket name or
// key chosen. This script makes its safety properties executable instead of
// prose a reviewer has to re-derive:
//
//   node scripts/production/storage/storage-plan.cjs --check
//
// exits 0 only when every invariant below holds. `renderPolicy` substitutes
// placeholders for a separately authorized target (the R20 MinIO suite uses it
// to apply the SAME role policies to emulator users). It never reads env
// files, credentials or the network.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PLAN_DIR = path.resolve(__dirname, '../../../infra/production/storage');
const PLACEHOLDER = /\$\{([A-Z_]+)\}/g;

/** Actions no application principal may hold: they rewrite bucket safety
 *  configuration, bypass holds or widen access. */
const FORBIDDEN_ACTIONS = [
  /^s3:\*$/,
  /^s3:PutBucket/,
  /^s3:DeleteBucket/,
  /^s3:PutLifecycleConfiguration$/,
  /^s3:PutEncryptionConfiguration$/,
  /^s3:PutBucketVersioning$/,
  /^s3:BypassGovernanceRetention$/,
  /^s3:PutObjectLegalHold$/,
  /^s3:PutObjectRetention$/,
  /^s3:PutObjectAcl$/,
  /^s3:PutObjectVersionAcl$/,
  /^kms:\*$/,
  /^\*$/,
];

const READ_ONLY_ACTION = /^(s3:(Get|List)[A-Za-z]*|kms:Decrypt)$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function loadPlan(planDir = DEFAULT_PLAN_DIR) {
  const plan = readJson(path.join(planDir, 'storage-plan.json'));
  const files = {};
  const refs = [];
  for (const ns of Object.values(plan.namespaces)) {
    for (const field of ['encryption', 'publicAccessBlock', 'bucketPolicy', 'cors', 'lifecycle']) {
      if (ns[field]) refs.push(ns[field]);
    }
  }
  for (const p of Object.values(plan.principals)) refs.push(p.policy);
  for (const ref of new Set(refs)) {
    const abs = path.resolve(planDir, ref);
    if (!abs.startsWith(planDir + path.sep)) throw new Error(`plan reference escapes: ${ref}`);
    files[ref] = readJson(abs);
  }
  return { plan, files };
}

function statementsOf(policy) {
  return asArray(policy.Statement);
}

/** Every finding is a short, stable string; an empty array means the plan holds. */
function validatePlan(loaded) {
  const { plan, files } = loaded;
  const findings = [];
  const fail = (msg) => findings.push(msg);
  const declared = new Set([...plan.placeholders, 'BUCKET']);

  if (plan.schema !== 'hsm.storage-plan/v1') fail('plan.schema-unknown');

  for (const [ref, body] of Object.entries(files)) {
    for (const m of JSON.stringify(body).matchAll(PLACEHOLDER)) {
      if (!declared.has(m[1])) fail(`${ref}: undeclared placeholder ${m[1]}`);
    }
  }

  const namespaceNames = Object.keys(plan.namespaces).sort().join(',');
  if (namespaceNames !== 'portfolio-staging,public,restricted') {
    fail('plan.namespaces must be exactly public, portfolio-staging, restricted');
  }

  const restrictedBucket = plan.namespaces.restricted?.bucket;
  for (const [name, ns] of Object.entries(plan.namespaces)) {
    if (ns.rootMarker !== name) fail(`${name}: rootMarker must equal the namespace`);
    if (ns.versioning !== 'Enabled') fail(`${name}: versioning must be Enabled`);

    const pab = files[ns.publicAccessBlock] ?? {};
    for (const k of [
      'BlockPublicAcls',
      'IgnorePublicAcls',
      'BlockPublicPolicy',
      'RestrictPublicBuckets',
    ]) {
      if (pab[k] !== true) fail(`${name}: public access block ${k} must be true`);
    }

    const isPrivate = asArray(ns.publicReadPrefixes).length === 0;
    const enc = files[ns.encryption]?.Rules?.[0]?.ApplyServerSideEncryptionByDefault;
    if (!enc) fail(`${name}: default encryption missing`);
    if (isPrivate && enc?.SSEAlgorithm !== 'aws:kms') fail(`${name}: private bucket needs SSE-KMS`);
    if (isPrivate && ns.cdn) fail(`${name}: a private namespace must not have a CDN`);

    for (const prefix of asArray(ns.publicReadPrefixes)) {
      if (!['requests/', 'avatars/'].includes(prefix)) {
        fail(`${name}: ${prefix} is not a publication-authorized public prefix`);
      }
    }

    // Bucket policy: a private bucket allows nothing; the public one allows
    // only GetObject, only to a CDN service principal, only on public prefixes.
    for (const st of statementsOf(files[ns.bucketPolicy] ?? {})) {
      if (st.Effect !== 'Allow') continue;
      if (isPrivate) {
        fail(`${name}: private bucket policy contains an Allow (${st.Sid})`);
        continue;
      }
      if (st.Principal === '*' || asArray(st.Principal?.AWS).includes('*')) {
        fail(`${name}: anonymous Allow (${st.Sid}); serve public media through the CDN`);
      }
      if (!st.Condition) fail(`${name}: public Allow without a source condition (${st.Sid})`);
      for (const action of asArray(st.Action)) {
        if (action !== 's3:GetObject') fail(`${name}: public Allow grants ${action}`);
      }
      for (const resource of asArray(st.Resource)) {
        const ok = asArray(ns.publicReadPrefixes).some(
          (p) => resource === `arn:aws:s3:::\${BUCKET}/${p}*`,
        );
        if (!ok) fail(`${name}: public Allow reaches ${resource}`);
      }
    }
    const denies = statementsOf(files[ns.bucketPolicy] ?? {}).filter(
      (st) => st.Effect === 'Deny' && st.Condition?.Bool?.['aws:SecureTransport'] === 'false',
    );
    if (denies.length === 0) fail(`${name}: bucket policy must deny insecure transport`);

    // CORS: browser-direct upload only, from the one web origin.
    const cors = ns.cors ? files[ns.cors] : null;
    if (name === 'restricted' && cors) fail('restricted: CORS must be absent (server-side only)');
    for (const rule of asArray(cors?.CORSRules)) {
      if (JSON.stringify(rule.AllowedOrigins) !== JSON.stringify(['${WEB_ORIGIN}'])) {
        fail(`${name}: CORS origins must be exactly \${WEB_ORIGIN}`);
      }
      if (JSON.stringify(rule.AllowedMethods) !== JSON.stringify(['PUT'])) {
        fail(`${name}: CORS methods must be exactly PUT`);
      }
      const headers = asArray(rule.AllowedHeaders).map((h) => h.toLowerCase());
      if (headers.includes('*')) fail(`${name}: CORS must not allow every header`);
      for (const h of ['content-type', 'if-none-match']) {
        if (!headers.includes(h)) fail(`${name}: CORS must allow ${h}`);
      }
    }

    // Lifecycle: storage never decides that an object is deletable. Retention
    // and holds are DATABASE facts (EvidenceRetentionJob.holdUntil, dispute
    // retention) that S3 cannot see, so no rule may expire a current object
    // anywhere, and the restricted bucket may only abort incomplete uploads.
    for (const rule of asArray(files[ns.lifecycle]?.Rules)) {
      const exp = rule.Expiration;
      if (exp && (exp.Days !== undefined || exp.Date !== undefined)) {
        fail(`${name}: lifecycle rule ${rule.ID} expires current objects`);
      }
      if (rule.Transitions || rule.NoncurrentVersionTransitions) {
        fail(`${name}: lifecycle rule ${rule.ID} transitions storage class (restore latency)`);
      }
      if (name === 'restricted') {
        const keys = Object.keys(rule).filter((k) => !['ID', 'Status', 'Filter'].includes(k));
        if (keys.join() !== 'AbortIncompleteMultipartUpload') {
          fail(`restricted: lifecycle rule ${rule.ID} may only abort incomplete uploads`);
        }
      }
    }
  }

  // Principals.
  for (const [role, p] of Object.entries(plan.principals)) {
    const policy = files[p.policy];
    for (const st of statementsOf(policy)) {
      if (st.Effect !== 'Allow') continue;
      for (const action of asArray(st.Action)) {
        if (FORBIDDEN_ACTIONS.some((re) => re.test(action))) {
          fail(`${role}: forbidden action ${action}`);
        }
        if (role === 'inventory' && !READ_ONLY_ACTION.test(action)) {
          fail(`inventory: non-read action ${action}`);
        }
        if (
          role === 'api' &&
          /^s3:(DeleteObjectVersion|ListBucket|ListBucketVersions)$/.test(action)
        ) {
          fail(`api: ${action} belongs to the worker or inventory role`);
        }
        if (action === 's3:DeleteObjectVersion') {
          for (const r of asArray(st.Resource)) {
            if (r !== `arn:aws:s3:::${restrictedBucket}/verification/*`) {
              fail(`${role}: version deletion outside restricted evidence (${r})`);
            }
          }
        }
      }
      for (const r of asArray(st.Resource)) {
        if (r === '*' || r === 'arn:aws:s3:::*') fail(`${role}: wildcard resource`);
      }
    }
  }
  return findings;
}

/**
 * Substitute placeholders in one plan document. Every placeholder present must
 * have a value; values may not themselves contain placeholders or wildcards.
 * `stripKms` drops KMS statements for an emulator that has no KMS IAM.
 */
function renderPolicy(document, values, options = {}) {
  for (const [k, v] of Object.entries(values)) {
    if (typeof v !== 'string' || v.length === 0 || /[*${}]/.test(v)) {
      throw new Error(`render: unsafe value for ${k}`);
    }
  }
  // Strip BEFORE substituting, so an emulator render needs no KMS value.
  // `omitActions` removes actions an emulator's IAM does not implement; the
  // caller must record each omission as hosted-only evidence.
  const source = JSON.parse(JSON.stringify(document));
  const omit = new Set(options.omitActions ?? []);
  if (Array.isArray(source.Statement)) {
    source.Statement = source.Statement.map((st) => ({
      ...st,
      Action: asArray(st.Action).filter(
        (a) => !omit.has(a) && !(options.stripKms && String(a).startsWith('kms:')),
      ),
    })).filter((st) => st.Action.length > 0);
  }
  const text = JSON.stringify(source).replace(PLACEHOLDER, (_, name) => {
    if (!(name in values)) throw new Error(`render: no value for ${name}`);
    return values[name];
  });
  return JSON.parse(text);
}

module.exports = { DEFAULT_PLAN_DIR, loadPlan, validatePlan, renderPolicy };

if (require.main === module) {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--plan-dir');
  const planDir = dirIndex >= 0 ? path.resolve(args[dirIndex + 1]) : DEFAULT_PLAN_DIR;
  if (!args.includes('--check')) {
    process.stderr.write('usage: storage-plan.cjs --check [--plan-dir DIR]\n');
    process.exit(2);
  }
  const findings = validatePlan(loadPlan(planDir));
  for (const f of findings) process.stdout.write(`FINDING ${f}\n`);
  process.stdout.write(
    findings.length === 0 ? 'STORAGE_PLAN_OK\n' : `STORAGE_PLAN_INVALID ${findings.length}\n`,
  );
  process.exit(findings.length === 0 ? 0 : 1);
}
