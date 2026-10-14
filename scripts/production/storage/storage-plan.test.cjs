'use strict';
// node --test scripts/production/storage/storage-plan.test.cjs

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DEFAULT_PLAN_DIR, loadPlan, validatePlan, renderPolicy } = require('./storage-plan.cjs');

/** A disposable copy of the real plan, mutated by `edit(relPath, fn)`. */
function mutated(edits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-r20-plan-'));
  fs.cpSync(DEFAULT_PLAN_DIR, dir, { recursive: true });
  for (const [rel, fn] of Object.entries(edits)) {
    const file = path.join(dir, rel);
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify(fn(value) ?? value));
  }
  try {
    return validatePlan(loadPlan(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const has = (findings, re) => findings.some((f) => re.test(f));

test('the committed plan satisfies every invariant', () => {
  assert.deepEqual(validatePlan(loadPlan()), []);
});

test('a generic expiration rule on the restricted bucket is refused', () => {
  const findings = mutated({
    'aws/lifecycle.restricted.json': (l) => {
      l.Rules.push({
        ID: 'tidy',
        Status: 'Enabled',
        Filter: { Prefix: '' },
        Expiration: { Days: 365 },
      });
    },
  });
  assert.ok(has(findings, /restricted: lifecycle rule tidy expires current objects/));
  assert.ok(has(findings, /restricted: lifecycle rule tidy may only abort/));
});

test('noncurrent-version expiry on restricted is refused (it would bypass app holds)', () => {
  const findings = mutated({
    'aws/lifecycle.restricted.json': (l) => {
      l.Rules.push({
        ID: 'old',
        Status: 'Enabled',
        Filter: { Prefix: '' },
        NoncurrentVersionExpiration: { NoncurrentDays: 30 },
      });
    },
  });
  assert.ok(has(findings, /restricted: lifecycle rule old may only abort/));
});

test('current-object expiry is refused on the public bucket too', () => {
  const findings = mutated({
    'aws/lifecycle.public.json': (l) => {
      l.Rules.push({
        ID: 'ttl',
        Status: 'Enabled',
        Filter: { Prefix: 'requests/' },
        Expiration: { Days: 90 },
      });
    },
  });
  assert.ok(has(findings, /public: lifecycle rule ttl expires current objects/));
});

test('portfolio/ can never become a public-read prefix (moderation is API-mediated)', () => {
  const findings = mutated({
    'aws/bucket-policy.public.json': (p) => {
      p.Statement[1].Resource.push('arn:aws:s3:::${BUCKET}/portfolio/*');
    },
  });
  assert.ok(has(findings, /public Allow reaches arn:aws:s3:::\$\{BUCKET\}\/portfolio\/\*/));
});

test('an anonymous public-read principal is refused', () => {
  const findings = mutated({
    'aws/bucket-policy.public.json': (p) => {
      p.Statement[1].Principal = '*';
    },
  });
  assert.ok(has(findings, /anonymous Allow/));
});

test('any Allow in a private bucket policy is refused', () => {
  const findings = mutated({
    'aws/bucket-policy.private.json': (p) => {
      p.Statement.push({
        Sid: 'oops',
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: 'arn:aws:s3:::${BUCKET}/*',
      });
    },
  });
  assert.ok(has(findings, /restricted: private bucket policy contains an Allow \(oops\)/));
  assert.ok(has(findings, /portfolio-staging: private bucket policy contains an Allow/));
});

test('the API role may not delete versions or list the restricted bucket', () => {
  const findings = mutated({
    'aws/iam-api.json': (p) => {
      p.Statement[3].Action.push('s3:DeleteObjectVersion');
    },
  });
  assert.ok(has(findings, /api: s3:DeleteObjectVersion belongs to the worker/));
});

test('version deletion outside restricted evidence is refused for the worker', () => {
  const findings = mutated({
    'aws/iam-worker.json': (p) => {
      p.Statement[0].Resource.push('arn:aws:s3:::${PUBLIC_BUCKET}/requests/*');
    },
  });
  assert.ok(has(findings, /worker: version deletion outside restricted evidence/));
});

test('legal-hold bypass and bucket reconfiguration are forbidden for every role', () => {
  const findings = mutated({
    'aws/iam-worker.json': (p) => {
      p.Statement[0].Action.push('s3:BypassGovernanceRetention', 's3:PutBucketPolicy');
    },
  });
  assert.ok(has(findings, /worker: forbidden action s3:BypassGovernanceRetention/));
  assert.ok(has(findings, /worker: forbidden action s3:PutBucketPolicy/));
});

test('the inventory role stays read-only', () => {
  const findings = mutated({
    'aws/iam-inventory.json': (p) => {
      p.Statement[1].Action.push('s3:DeleteObject');
    },
  });
  assert.ok(has(findings, /inventory: non-read action s3:DeleteObject/));
});

test('CORS on the restricted bucket and wildcard origins are refused', () => {
  const findings = mutated({
    'storage-plan.json': (plan) => {
      plan.namespaces.restricted.cors = 'aws/cors.upload.json';
    },
    'aws/cors.upload.json': (c) => {
      c.CORSRules[0].AllowedOrigins = ['*'];
    },
  });
  assert.ok(has(findings, /restricted: CORS must be absent/));
  assert.ok(has(findings, /CORS origins must be exactly/));
});

test('a private namespace with SSE-S3 instead of KMS is refused', () => {
  const findings = mutated({
    'aws/encryption.private.json': (e) => {
      e.Rules[0].ApplyServerSideEncryptionByDefault = { SSEAlgorithm: 'AES256' };
    },
  });
  assert.ok(has(findings, /restricted: private bucket needs SSE-KMS/));
});

test('renderPolicy fills placeholders, refuses gaps and unsafe values, strips KMS on request', () => {
  const { files } = loadPlan();
  const values = {
    PUBLIC_BUCKET: 'pub',
    PORTFOLIO_STAGING_BUCKET: 'stage',
    RESTRICTED_BUCKET: 'restr',
    PRIVATE_KMS_KEY_ARN: 'arn:aws:kms:region:000000000000:key/test',
  };
  const out = renderPolicy(files['aws/iam-api.json'], values, { stripKms: true });
  assert.ok(!JSON.stringify(out).includes('${'));
  assert.ok(!JSON.stringify(out).includes('kms:'));
  assert.ok(JSON.stringify(out).includes('arn:aws:s3:::restr/verification/*'));
  assert.throws(() => renderPolicy(files['aws/iam-api.json'], { PUBLIC_BUCKET: 'x' }), /no value/);
  assert.throws(
    () => renderPolicy(files['aws/iam-api.json'], { ...values, PUBLIC_BUCKET: '*' }),
    /unsafe/,
  );
});
