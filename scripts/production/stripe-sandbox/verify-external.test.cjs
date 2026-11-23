'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const { mkdtemp, readFile, writeFile, rm, symlink, readlink, rename } = fsp;
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  SCENARIOS,
  validateInputs,
  guardEnvironment,
  validateObservation,
  reserveEvidenceFile,
  main,
} = require('./verify-external.cjs');

const NOW = Date.parse('2026-10-24T12:00:00Z');
function approvedFixture() {
  // Synthetic values only test preflight; they cannot produce external evidence.
  const input = {
    schemaVersion: 1,
    approvalReference: 'synthetic-input-validation-only',
    expiresAt: '2026-10-24T13:00:00Z',
    authorizeSandboxOperations: true,
    authorizeDisposableFixtures: true,
    maxSandboxAmountMinor: '500',
    webhookForwardPort: 4938,
    webhookTimeoutSeconds: 30,
    testPaymentMethod: 'pm_card_visa',
    plan: {
      id: 'input-plan',
      planKey: 'input-plan',
      version: 1,
      billingInterval: 'MONTHLY',
      priceMinor: '500',
      currency: 'USD',
      publishedAt: '2026-10-24T11:00:00Z',
      approvalReference: 'synthetic-plan-input-only',
      entitlements: [{ key: 'test.access', value: { kind: 'BOOLEAN', enabled: true } }],
    },
    refundPolicy: {
      approvedAt: '2026-10-24T10:00:00Z',
      validFrom: '2026-10-24T11:00:00Z',
      validUntil: '2026-10-24T13:00:00Z',
      entitlementEffect: 'SUSPEND_SUBSCRIPTION',
      rules: {
        version: 'synthetic-v1',
        approvalReference: 'synthetic-policy-input-only',
        mode: 'SANDBOX',
        planVersionId: 'input-plan',
        method: 'STRIPE',
        currency: 'USD',
        reasonCodes: ['TEST_REFUND'],
        refundWindowSeconds: 3600,
        allowPartial: false,
        requireRequesterReviewerSeparation: true,
        requireOriginalReviewerSeparation: true,
        feeTreatment: 'NO_DEDUCTION',
        taxTreatment: 'NO_ADJUSTMENT',
        proRataTreatment: 'NONE',
        entitlementPolicyVersion: 'synthetic-v1',
      },
    },
  };
  const stripe = {
    enabled: true,
    secretKey: ['sk', 'test', 'a'.repeat(24)].join('_'),
    webhookSecret: ['whsec', 'b'.repeat(24)].join('_'),
    accountReference: 'acct_fixture',
    expiresAt: '2026-10-24T13:00:00Z',
    signatureToleranceSeconds: 300,
    bindings: [
      {
        planVersionId: 'input-plan',
        method: 'STRIPE',
        currency: 'USD',
        adapterId: 'hsm.stripe.v1',
        mode: 'SANDBOX',
        accountReference: 'acct_fixture',
        debitAccountId: 'clearing',
        creditAccountId: 'revenue',
        configVersion: 'approved-v1',
        quoteTtlSeconds: 300,
      },
    ],
  };
  const env = {
    MONEY_REFUND_AUTHORIZATION_ENABLED: 'true',
    MONEY_STRIPE_PUBLISHABLE_KEY: ['pk', 'test', 'c'.repeat(24)].join('_'),
    MONEY_STRIPE_SANDBOX_JSON: JSON.stringify(stripe),
  };
  return { input, stripe, env };
}

test('requires explicit bounded approval and matching test-account bindings without supplying defaults', () => {
  const { input, env } = approvedFixture();
  assert.deepEqual(validateInputs(input, env, NOW).input, input);
  assert.equal(input.refundPolicy.entitlementEffect, 'SUSPEND_SUBSCRIPTION');
});

for (const [name, change, code] of [
  [
    'absent operation approval',
    (f) => {
      f.input.authorizeSandboxOperations = false;
    },
    'G3_SCOPE_NOT_AUTHORIZED',
  ],
  [
    'absent fixture approval',
    (f) => {
      f.input.authorizeDisposableFixtures = false;
    },
    'G3_SCOPE_NOT_AUTHORIZED',
  ],
  [
    'expired approval',
    (f) => {
      f.input.expiresAt = '2026-10-24T12:00:00Z';
    },
    'G3_APPROVAL_EXPIRED',
  ],
  [
    'overlong approval',
    (f) => {
      f.input.expiresAt = '2026-10-26T12:00:00Z';
    },
    'G3_APPROVAL_EXPIRED',
  ],
  [
    'unapproved amount',
    (f) => {
      f.input.plan.priceMinor = '501';
    },
    'G3_PLAN_APPROVAL_INVALID',
  ],
  [
    'zero amount',
    (f) => {
      f.input.plan.priceMinor = '0';
    },
    'G3_PLAN_APPROVAL_INVALID',
  ],
  [
    'lossy amount',
    (f) => {
      f.input.plan.priceMinor = '9007199254740993';
    },
    'G3_PLAN_APPROVAL_INVALID',
  ],
  [
    'unspecified refund effect',
    (f) => {
      delete f.input.refundPolicy.entitlementEffect;
    },
    'G3_REFUND_POLICY_SHAPE',
  ],
  [
    'inferred keep-access policy',
    (f) => {
      f.input.refundPolicy.entitlementEffect = 'KEEP_ACCESS';
    },
    'G3_REFUND_POLICY_APPROVAL_INVALID',
  ],
  [
    'mismatched refund currency',
    (f) => {
      f.input.refundPolicy.rules.currency = 'EUR';
    },
    'G3_REFUND_POLICY_APPROVAL_INVALID',
  ],
  [
    'future policy approval',
    (f) => {
      f.input.refundPolicy.approvedAt = '2026-10-25T10:00:00Z';
    },
    'G3_REFUND_POLICY_APPROVAL_INVALID',
  ],
  [
    'disabled refund reservations',
    (f) => {
      f.env.MONEY_REFUND_AUTHORIZATION_ENABLED = 'false';
    },
    'G3_REFUNDS_DISABLED',
  ],
  [
    'unbounded webhook wait',
    (f) => {
      f.input.webhookTimeoutSeconds = 181;
    },
    'G3_WEBHOOK_TIMEOUT',
  ],
  [
    'privileged forwarding port',
    (f) => {
      f.input.webhookForwardPort = 443;
    },
    'G3_FORWARD_PORT',
  ],
  [
    'arbitrary payment method',
    (f) => {
      f.input.testPaymentMethod = 'pm_unapproved';
    },
    'G3_TEST_PAYMENT_METHOD',
  ],
  [
    'unexpected input authority',
    (f) => {
      f.input.overrideApproval = true;
    },
    'G3_INPUT_SHAPE',
  ],
]) {
  test('blocks ' + name, () => {
    const f = approvedFixture();
    change(f);
    assert.throws(() => validateInputs(f.input, f.env, NOW), { message: code });
  });
}

for (const [name, change, code] of [
  [
    'live secret',
    (s) => {
      s.secretKey = ['sk', 'live', 'a'.repeat(24)].join('_');
    },
    'G3_TEST_CREDENTIALS_REQUIRED',
  ],
  [
    'expired credentials',
    (s) => {
      s.expiresAt = '2026-10-24T11:00:00Z';
    },
    'G3_STRIPE_CONFIGURATION_EXPIRED',
  ],
  [
    'unbounded credentials',
    (s) => {
      s.expiresAt = '2026-10-26T11:00:00Z';
    },
    'G3_STRIPE_CONFIGURATION_EXPIRED',
  ],
  [
    'multiple scopes',
    (s) => {
      s.bindings.push({ ...s.bindings[0] });
    },
    'G3_SINGLE_APPROVED_BINDING_REQUIRED',
  ],
  [
    'another account',
    (s) => {
      s.bindings[0].accountReference = 'acct_other';
    },
    'G3_BINDING_SCOPE_MISMATCH',
  ],
  [
    'another plan',
    (s) => {
      s.bindings[0].planVersionId = 'other-plan';
    },
    'G3_BINDING_SCOPE_MISMATCH',
  ],
  [
    'live binding',
    (s) => {
      s.bindings[0].mode = 'LIVE';
    },
    'G3_BINDING_SCOPE_MISMATCH',
  ],
  [
    'same ledger account',
    (s) => {
      s.bindings[0].creditAccountId = 'clearing';
    },
    'G3_BINDING_SCOPE_MISMATCH',
  ],
]) {
  test('blocks ' + name + ' before an external request', () => {
    const f = approvedFixture();
    change(f.stripe);
    f.env.MONEY_STRIPE_SANDBOX_JSON = JSON.stringify(f.stripe);
    assert.throws(() => validateInputs(f.input, f.env, NOW), { message: code });
  });
}

const services = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  RUN_DB_INTEGRATION: '1',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5548/g3_bootstrap',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6448',
};
test('accepts explicit local disposable service addresses', () => {
  assert.doesNotThrow(() => guardEnvironment(services));
});
for (const [name, values] of [
  ['production mode', { NODE_ENV: 'production' }],
  ['remote database', { DATABASE_URL: 'postgresql://test:test@example.invalid:5432/app' }],
  ['remote Redis', { REDIS_URL: 'redis://example.invalid:6379' }],
  ['hidden Redis URL precedence', { REDIS_URL: 'rediss://127.0.0.1:6379' }],
  ['missing database', { DATABASE_URL: undefined }],
]) {
  test('refuses ' + name, () => {
    assert.throws(() => guardEnvironment({ ...services, ...values }));
  });
}

function observation() {
  return {
    realProviderAccount: true,
    authenticForwardedWebhook: true,
    moneyPortOverrides: 0,
    independentProviderRequests: 6,
    passedScenarios: [...SCENARIOS],
    providerPaymentDigest: 'a'.repeat(64),
    providerRefundDigest: 'b'.repeat(64),
    webhookDigest: 'c'.repeat(64),
  };
}
test('evidence exposes only the fixed schema, never provider responses or credential fields', () => {
  const result = validateObservation({
    ...observation(),
    clientSecret: 'private-sentinel',
    response: { password: 'private-sentinel' },
  });
  assert.equal(JSON.stringify(result).includes('private-sentinel'), false);
  assert.equal(Object.hasOwn(result, 'sandboxAccepted'), false);
});
for (const [name, change] of [
  [
    'offline run',
    (o) => {
      o.independentProviderRequests = 0;
    },
  ],
  [
    'synthesized webhook',
    (o) => {
      o.authenticForwardedWebhook = false;
    },
  ],
  [
    'mock money port',
    (o) => {
      o.moneyPortOverrides = 1;
    },
  ],
  [
    'missing account verification',
    (o) => {
      o.realProviderAccount = false;
    },
  ],
  [
    'missing required scenario',
    (o) => {
      o.passedScenarios.pop();
    },
  ],
  [
    'duplicated scenario',
    (o) => {
      o.passedScenarios[1] = o.passedScenarios[0];
    },
  ],
  [
    'unbound event',
    (o) => {
      o.webhookDigest = '';
    },
  ],
]) {
  test('does not accept evidence from ' + name, () => {
    const result = observation();
    change(result);
    assert.throws(() => validateObservation(result), {
      message: 'G3_INCOMPLETE_EXTERNAL_OBSERVATION',
    });
  });
}
test('CLI missing authority is BLOCKED with zero network scenarios and no raw-input disclosure', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g3-input-negative-'));
  try {
    const input = path.join(directory, 'input.json');
    const output = path.join(directory, 'evidence.json');
    await writeFile(input, JSON.stringify({ privateValue: 'untrusted-private-sentinel' }), {
      mode: 0o600,
    });
    const run = spawnSync(
      process.execPath,
      [path.join(__dirname, 'verify-external.cjs'), '--input', input, '--output', output],
      { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10_000 },
    );
    assert.equal(run.status, 2);
    const saved = await readFile(output, 'utf8');
    const report = JSON.parse(saved);
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.reason, 'G3_INPUT_SHAPE');
    assert.equal(report.passed, 0);
    assert.equal(report.notRun, SCENARIOS.length);
    assert.equal(report.g3Accepted, false);
    assert.equal(report.sandboxAccepted, false);
    assert.equal((saved + run.stdout + run.stderr).includes('untrusted-private-sentinel'), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reserves a new private evidence file before writing any report', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g3-output-private-'));
  let handle;
  try {
    const output = path.join(directory, 'new', 'evidence.json');
    handle = await reserveEvidenceFile(output);
    const info = await handle.stat();
    assert.equal(info.isFile(), true);
    assert.equal(info.mode & 0o777, 0o600);
    assert.equal(await readFile(output, 'utf8'), '');
    await handle.writeFile('synthetic-evidence-only\n');
    assert.equal(await readFile(output, 'utf8'), 'synthetic-evidence-only\n');
  } finally {
    await handle?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('simultaneous evidence reservations have exactly one winner', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g3-output-concurrent-'));
  const attempts = [];
  try {
    const output = path.join(directory, 'evidence.json');
    attempts.push(
      ...(await Promise.allSettled([reserveEvidenceFile(output), reserveEvidenceFile(output)])),
    );
    const winners = attempts.filter((entry) => entry.status === 'fulfilled');
    const losers = attempts.filter((entry) => entry.status === 'rejected');
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].reason.message, 'G3_OUTPUT_ALREADY_EXISTS');
    await winners[0].value.writeFile('single-owner\n');
    assert.equal(await readFile(output, 'utf8'), 'single-owner\n');
  } finally {
    for (const attempt of attempts) if (attempt.status === 'fulfilled') await attempt.value.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects an existing evidence file before processing input and preserves its bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g3-output-existing-'));
  try {
    const output = path.join(directory, 'evidence.json');
    await writeFile(output, 'existing-private-evidence\n', { mode: 0o600 });
    await assert.rejects(
      main(['--input', path.join(directory, 'absent.json'), '--output', output]),
      { message: 'G3_OUTPUT_ALREADY_EXISTS' },
    );
    assert.equal(await readFile(output, 'utf8'), 'existing-private-evidence\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

for (const dangling of [false, true]) {
  test(`rejects a ${dangling ? 'dangling' : 'regular'} evidence symlink before processing input`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'g3-output-symlink-'));
    try {
      const target = path.join(directory, 'target.json');
      const output = path.join(directory, 'evidence.json');
      if (!dangling) await writeFile(target, 'untouched-target\n', { mode: 0o600 });
      await symlink(target, output);
      await assert.rejects(
        main(['--input', path.join(directory, 'absent.json'), '--output', output]),
        { message: 'G3_OUTPUT_ALREADY_EXISTS' },
      );
      assert.equal(await readlink(output), target);
      if (dangling) await assert.rejects(readFile(target), { code: 'ENOENT' });
      else assert.equal(await readFile(target, 'utf8'), 'untouched-target\n');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('refuses an outside pathname whose parent resolves inside the source', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g3-output-source-alias-'));
  try {
    const alias = path.join(directory, 'source');
    await symlink(path.resolve(__dirname, '../../..'), alias, 'dir');
    await assert.rejects(reserveEvidenceFile(path.join(alias, 'evidence.json')), {
      message: 'G3_EVIDENCE_MUST_BE_OUTSIDE_SOURCE',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('writes through the reserved descriptor when its pathname is replaced by a symlink', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'g3-output-replaced-'));
  let handle;
  try {
    const output = path.join(directory, 'evidence.json');
    const retained = path.join(directory, 'reserved-inode.json');
    const target = path.join(directory, 'untouched-target.json');
    await writeFile(target, 'untouched-target\n', { mode: 0o600 });
    handle = await reserveEvidenceFile(output);
    await rename(output, retained);
    await symlink(target, output);
    await handle.writeFile('reserved-report\n');
    assert.equal(await readFile(retained, 'utf8'), 'reserved-report\n');
    assert.equal(await readFile(target, 'utf8'), 'untouched-target\n');
    assert.equal(await readlink(output), target);
  } finally {
    await handle?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

for (const writeFails of [false, true]) {
  test(`closes the reserved descriptor after ${writeFails ? 'a report write failure' : 'blocked preflight'}`, async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'g3-output-close-'));
    const open = fsp.open;
    let handle;
    try {
      // Real exclusive creation and descriptor; only the write failure is injected.
      t.mock.method(fsp, 'open', async (...args) => {
        handle = await open(...args);
        if (writeFails)
          t.mock.method(handle, 'writeFile', async () => {
            throw new Error('synthetic-output-write-failure');
          });
        return handle;
      });
      t.mock.method(process.stdout, 'write', () => true);
      const output = path.join(directory, 'evidence.json');
      const execution = main(['--input', path.join(directory, 'absent.json'), '--output', output]);
      if (writeFails)
        await assert.rejects(execution, { message: 'synthetic-output-write-failure' });
      else {
        assert.equal(await execution, 2);
        const report = JSON.parse(await readFile(output, 'utf8'));
        assert.equal(report.status, 'BLOCKED');
        assert.equal(report.passed, 0);
      }
      assert.equal(handle.fd, -1);
    } finally {
      t.mock.restoreAll();
      await handle?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
