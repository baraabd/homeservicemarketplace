#!/usr/bin/env node
'use strict';

// Explicit external test-account execution. This never accepts G3, enables a
// live rail, supplies a commercial approval or writes to an existing app DB.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SCENARIOS = Object.freeze([
  'real-provider-account',
  'registered-concrete-money-ports',
  'owner-and-price-authority',
  'stable-collection-retry',
  'real-provider-payment',
  'authentic-webhook-before-confirmation',
  'raw-body-tamper-and-concurrent-replay',
  'activation-transaction-rollback',
  'durable-inbox-recovery-and-atomic-activation',
  'fresh-login-and-paid-entitlement',
  'approved-refund-reservation-and-outbox',
  'remote-refund-local-failure-atomicity',
  'query-recovery-without-second-refund',
  'refund-entitlement-and-postcommit-outbox',
]);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 200) =>
  typeof value === 'string' && value === value.trim() && value.length > 0 && value.length <= max;
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(value);
const amount = (value) => typeof value === 'string' && /^[1-9][0-9]{0,7}$/u.test(value);
const instant = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) &&
  Number.isFinite(Date.parse(value));
function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}
function exact(value, keys, code) {
  requireCondition(
    object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','),
    code,
  );
}

function validateInputs(input, env, now = Date.now()) {
  exact(
    input,
    [
      'schemaVersion',
      'approvalReference',
      'expiresAt',
      'authorizeSandboxOperations',
      'authorizeDisposableFixtures',
      'maxSandboxAmountMinor',
      'webhookForwardPort',
      'webhookTimeoutSeconds',
      'testPaymentMethod',
      'plan',
      'refundPolicy',
    ],
    'G3_INPUT_SHAPE',
  );
  requireCondition(
    input.schemaVersion === 1 && text(input.approvalReference),
    'G3_APPROVAL_MISSING',
  );
  requireCondition(
    input.authorizeSandboxOperations === true && input.authorizeDisposableFixtures === true,
    'G3_SCOPE_NOT_AUTHORIZED',
  );
  requireCondition(
    instant(input.expiresAt) &&
      Date.parse(input.expiresAt) > now &&
      Date.parse(input.expiresAt) - now <= 86_400_000,
    'G3_APPROVAL_EXPIRED',
  );
  requireCondition(
    Number.isInteger(input.webhookForwardPort) &&
      input.webhookForwardPort >= 1024 &&
      input.webhookForwardPort <= 65535,
    'G3_FORWARD_PORT',
  );
  requireCondition(
    Number.isInteger(input.webhookTimeoutSeconds) &&
      input.webhookTimeoutSeconds >= 10 &&
      input.webhookTimeoutSeconds <= 180,
    'G3_WEBHOOK_TIMEOUT',
  );
  requireCondition(input.testPaymentMethod === 'pm_card_visa', 'G3_TEST_PAYMENT_METHOD');
  exact(
    input.plan,
    [
      'id',
      'planKey',
      'version',
      'billingInterval',
      'priceMinor',
      'currency',
      'entitlements',
      'publishedAt',
      'approvalReference',
    ],
    'G3_PLAN_SHAPE',
  );
  const plan = input.plan;
  requireCondition(
    id(plan.id) &&
      /^[a-z0-9][a-z0-9-]{1,63}$/u.test(plan.planKey) &&
      Number.isSafeInteger(plan.version) &&
      plan.version > 0 &&
      ['MONTHLY', 'ANNUAL'].includes(plan.billingInterval) &&
      amount(plan.priceMinor) &&
      amount(input.maxSandboxAmountMinor) &&
      BigInt(plan.priceMinor) <= BigInt(input.maxSandboxAmountMinor) &&
      /^[A-Z]{3}$/u.test(plan.currency) &&
      instant(plan.publishedAt) &&
      Date.parse(plan.publishedAt) <= now &&
      text(plan.approvalReference) &&
      Array.isArray(plan.entitlements) &&
      plan.entitlements.length > 0 &&
      plan.entitlements.length <= 100,
    'G3_PLAN_APPROVAL_INVALID',
  );
  exact(
    input.refundPolicy,
    ['rules', 'approvedAt', 'validFrom', 'validUntil', 'entitlementEffect'],
    'G3_REFUND_POLICY_SHAPE',
  );
  const policy = input.refundPolicy;
  requireCondition(
    object(policy.rules) &&
      text(policy.rules.approvalReference) &&
      policy.rules.planVersionId === plan.id &&
      policy.rules.method === 'STRIPE' &&
      policy.rules.mode === 'SANDBOX' &&
      policy.rules.currency === plan.currency &&
      ['SUSPEND_SUBSCRIPTION', 'CANCEL_SUBSCRIPTION'].includes(policy.entitlementEffect) &&
      [policy.approvedAt, policy.validFrom, policy.validUntil].every(instant) &&
      Date.parse(policy.approvedAt) <= Date.parse(policy.validFrom) &&
      Date.parse(policy.validFrom) <= now &&
      Date.parse(policy.validUntil) > now,
    'G3_REFUND_POLICY_APPROVAL_INVALID',
  );
  requireCondition(env.MONEY_REFUND_AUTHORIZATION_ENABLED === 'true', 'G3_REFUNDS_DISABLED');
  requireCondition(
    typeof env.MONEY_STRIPE_PUBLISHABLE_KEY === 'string' &&
      /^pk_test_[A-Za-z0-9]{16,200}$/u.test(env.MONEY_STRIPE_PUBLISHABLE_KEY),
    'G3_TEST_PUBLISHABLE_KEY_MISSING',
  );
  let stripe;
  try {
    stripe = JSON.parse(env.MONEY_STRIPE_SANDBOX_JSON);
  } catch {
    throw new Error('G3_STRIPE_CONFIGURATION_MISSING');
  }
  exact(
    stripe,
    [
      'enabled',
      'secretKey',
      'webhookSecret',
      'accountReference',
      'expiresAt',
      'signatureToleranceSeconds',
      'bindings',
    ],
    'G3_STRIPE_CONFIGURATION_SHAPE',
  );
  requireCondition(
    stripe.enabled === true &&
      /^(?:sk|rk)_test_[A-Za-z0-9]{16,200}$/u.test(stripe.secretKey) &&
      /^whsec_[A-Za-z0-9]{16,200}$/u.test(stripe.webhookSecret) &&
      /^acct_[A-Za-z0-9]{1,180}$/u.test(stripe.accountReference),
    'G3_TEST_CREDENTIALS_REQUIRED',
  );
  requireCondition(
    instant(stripe.expiresAt) &&
      Date.parse(stripe.expiresAt) > now &&
      Date.parse(stripe.expiresAt) - now <= 86_400_000 &&
      Number.isInteger(stripe.signatureToleranceSeconds) &&
      stripe.signatureToleranceSeconds >= 30 &&
      stripe.signatureToleranceSeconds <= 300,
    'G3_STRIPE_CONFIGURATION_EXPIRED',
  );
  requireCondition(
    Array.isArray(stripe.bindings) && stripe.bindings.length === 1,
    'G3_SINGLE_APPROVED_BINDING_REQUIRED',
  );
  const binding = stripe.bindings[0];
  exact(
    binding,
    [
      'planVersionId',
      'method',
      'currency',
      'adapterId',
      'mode',
      'accountReference',
      'debitAccountId',
      'creditAccountId',
      'configVersion',
      'quoteTtlSeconds',
    ],
    'G3_BINDING_SHAPE',
  );
  requireCondition(
    binding.planVersionId === plan.id &&
      binding.method === 'STRIPE' &&
      binding.mode === 'SANDBOX' &&
      binding.adapterId === 'hsm.stripe.v1' &&
      binding.currency === plan.currency &&
      binding.accountReference === stripe.accountReference &&
      id(binding.debitAccountId) &&
      id(binding.creditAccountId) &&
      binding.debitAccountId !== binding.creditAccountId &&
      /^[A-Za-z0-9_.:-]{1,100}$/u.test(binding.configVersion) &&
      Number.isInteger(binding.quoteTtlSeconds) &&
      binding.quoteTtlSeconds >= 60 &&
      binding.quoteTtlSeconds <= 3600,
    'G3_BINDING_SCOPE_MISMATCH',
  );
  return { input, stripe };
}

function guardEnvironment(env) {
  requireCondition(
    env.NODE_ENV === 'test' && env.APP_ENV === 'test' && env.RUN_DB_INTEGRATION === '1',
    'G3_DISPOSABLE_TEST_ENVIRONMENT_REQUIRED',
  );
  const loopback = (value, protocol) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === protocol && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      );
    } catch {
      return false;
    }
  };
  requireCondition(loopback(env.DATABASE_URL, 'postgresql:'), 'G3_LOOPBACK_DATABASE_REQUIRED');
  requireCondition(
    env.REDIS_URL
      ? loopback(env.REDIS_URL, 'redis:')
      : ['127.0.0.1', 'localhost', '::1'].includes(env.REDIS_HOST) &&
          /^[1-9][0-9]{0,4}$/u.test(env.REDIS_PORT ?? '') &&
          Number(env.REDIS_PORT) <= 65535,
    'G3_LOOPBACK_REDIS_REQUIRED',
  );
}

function validateObservation(value) {
  requireCondition(
    object(value) &&
      value.realProviderAccount === true &&
      value.authenticForwardedWebhook === true &&
      value.moneyPortOverrides === 0 &&
      Number.isSafeInteger(value.independentProviderRequests) &&
      value.independentProviderRequests >= 5 &&
      JSON.stringify(value.passedScenarios) === JSON.stringify(SCENARIOS) &&
      ['providerPaymentDigest', 'providerRefundDigest', 'webhookDigest'].every((key) =>
        /^[a-f0-9]{64}$/u.test(value[key]),
      ),
    'G3_INCOMPLETE_EXTERNAL_OBSERVATION',
  );
  // An allowlisted projection prevents response bodies, client secrets, account
  // IDs, cookies or credentials from reaching even successful evidence.
  return {
    realProviderAccount: true,
    authenticForwardedWebhook: true,
    moneyPortOverrides: 0,
    independentProviderRequests: value.independentProviderRequests,
    passedScenarios: [...SCENARIOS],
    providerPaymentDigest: value.providerPaymentDigest,
    providerRefundDigest: value.providerRefundDigest,
    webhookDigest: value.webhookDigest,
  };
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function sourceIdentity() {
  requireCondition(
    git('status', '--porcelain=v1', '--untracked-files=all') === '',
    'G3_CLEAN_COMMITTED_SOURCE_REQUIRED',
  );
  return { sourceSha: git('rev-parse', 'HEAD'), treeSha: git('rev-parse', 'HEAD^{tree}') };
}
function installLoader() {
  const ts = require(path.join(ROOT, 'node_modules/typescript'));
  const original = require.extensions['.ts'];
  require.extensions['.ts'] = (module, filename) => {
    requireCondition(
      filename.startsWith(path.join(ROOT, 'apps/api') + path.sep),
      'G3_TEST_LOADER_BOUNDARY',
    );
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
      },
    });
    module._compile(result.outputText, filename);
  };
  require(require.resolve('reflect-metadata', { paths: [path.join(ROOT, 'apps/api')] }));
  return () => {
    if (original) require.extensions['.ts'] = original;
    else delete require.extensions['.ts'];
  };
}

async function main(args = process.argv.slice(2)) {
  requireCondition(
    args.length === 4 &&
      args[0] === '--input' &&
      args[2] === '--output' &&
      path.isAbsolute(args[1]) &&
      path.isAbsolute(args[3]),
    'G3_USAGE_INPUT_OUTPUT_ABSOLUTE',
  );
  const output = path.resolve(args[3]);
  requireCondition(
    output !== ROOT && !output.startsWith(ROOT + path.sep),
    'G3_EVIDENCE_MUST_BE_OUTSIDE_SOURCE',
  );
  requireCondition(!fs.existsSync(output), 'G3_OUTPUT_ALREADY_EXISTS');
  const report = {
    schemaVersion: 1,
    scope: 'G3_EXTERNAL_STRIPE_HTTP_DATABASE_LIFECYCLE',
    status: 'BLOCKED',
    startedAt: new Date().toISOString(),
    sandboxAccepted: false,
    g3Accepted: false,
    exclusions: ['manual-rail', 'browser-payment-element', 'hosted', 'process-kill-crash'],
    passed: 0,
    failed: 0,
    notRun: SCENARIOS.length,
    skipped: 0,
  };
  let restoreLoader;
  let restoreOutput;
  try {
    const bytes = await fsp.readFile(args[1]);
    requireCondition(bytes.length <= 65536, 'G3_INPUT_TOO_LARGE');
    const { input, stripe } = validateInputs(JSON.parse(bytes.toString('utf8')), process.env);
    guardEnvironment(process.env);
    requireCondition(
      process.versions.node === '24.21.0' &&
        execFileSync('pnpm', ['--version'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim() === '10.32.1',
      'G3_PINNED_TOOLCHAIN_REQUIRED',
    );
    for (const directory of [ROOT, 'apps/api', 'apps/web', 'packages/database'].map((entry) =>
      path.resolve(ROOT, entry),
    )) {
      requireCondition(
        !fs
          .readdirSync(directory)
          .some((name) =>
            /^\.env(?:\.(?:local|development|production|test)(?:\.local)?)?$/u.test(name),
          ),
        'G3_ENVIRONMENT_FILE_FORBIDDEN',
      );
    }
    report.source = sourceIdentity();
    report.inputSha256 = hash(bytes);
    report.configurationSha256 = hash(
      JSON.stringify({
        ...stripe,
        secretKey: '[SECRET]',
        webhookSecret: '[SECRET]',
      }),
    );
    const stdout = process.stdout.write;
    const stderr = process.stderr.write;
    // Third-party exceptions may include raw SQL, client secrets or provider
    // objects. Discard diagnostic streams; report only fixed error identifiers.
    process.stdout.write = process.stderr.write = (_chunk, encoding, callback) => {
      if (typeof encoding === 'function') encoding();
      else if (typeof callback === 'function') callback();
      return true;
    };
    restoreOutput = () => {
      process.stdout.write = stdout;
      process.stderr.write = stderr;
    };
    restoreLoader = installLoader();
    const { runExternalStripeEvidence } = require(
      path.join(ROOT, 'apps/api/test/support/g3-stripe-external.fixture.ts'),
    );
    report.status = 'FAILED';
    const observation = validateObservation(
      await runExternalStripeEvidence(input, (name) => {
        requireCondition(name === SCENARIOS[report.passed], 'G3_SCENARIO_ORDER_INVALID');
        report.passed += 1;
        report.notRun = SCENARIOS.length - report.passed;
      }),
    );
    requireCondition(
      JSON.stringify(sourceIdentity()) === JSON.stringify(report.source),
      'G3_SOURCE_CHANGED_DURING_EXECUTION',
    );
    Object.assign(report, observation, {
      status: 'EXTERNAL_STRIPE_SCENARIOS_PASSED',
      passed: SCENARIOS.length,
      failed: 0,
      notRun: 0,
    });
  } catch (error) {
    report.reason =
      error instanceof Error && /^G3_[A-Z_]+$/u.test(error.message)
        ? error.message
        : 'G3_EXTERNAL_EXECUTION_BLOCKED_OR_FAILED';
    report.failed = report.status === 'FAILED' && report.passed < SCENARIOS.length ? 1 : 0;
    report.notRun = SCENARIOS.length - report.passed - report.failed;
    if (error && /^hsm_it_r24_money_[a-f0-9]{32}$/u.test(error.retainedDatabase ?? '')) {
      report.retainedDatabase = error.retainedDatabase;
      report.recoveryRequiredBeforeCleanup = true;
    }
  } finally {
    restoreLoader?.();
    restoreOutput?.();
    report.finishedAt = new Date().toISOString();
    await fsp.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    const parent = await fsp.realpath(path.dirname(output));
    requireCondition(
      parent !== ROOT && !parent.startsWith(ROOT + path.sep),
      'G3_EVIDENCE_MUST_BE_OUTSIDE_SOURCE',
    );
    await fsp.writeFile(output, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  }
  process.stdout.write(JSON.stringify(report) + '\n');
  return report.status === 'EXTERNAL_STRIPE_SCENARIOS_PASSED' ? 0 : 2;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write(
        'BLOCKED: G3 requires explicit approved sandbox inputs and safe evidence output.\n',
      );
      process.exitCode = 2;
    });
}
module.exports = { SCENARIOS, validateInputs, guardEnvironment, validateObservation, main };
