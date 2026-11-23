#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const path = require('node:path');

function parseArgs(argv) {
  if (
    argv.length !== 3 ||
    argv[0] !== '--offline-signatures' ||
    argv[1] !== '--sdk-root' ||
    !path.isAbsolute(argv[2])
  ) {
    throw new Error(
      'Usage: verify-sandbox.cjs --offline-signatures --sdk-root <absolute isolated installation root>',
    );
  }
  return { sdkRoot: argv[2] };
}

/** Actual official SDK signature verification; no provider requests or credentials.
 * This mode intentionally cannot return SANDBOX_ACCEPTED. Real external payment,
 * application DB, refund policy and full-route evidence remain a separate gate. */
async function verifyOffline(options) {
  const Stripe = require(path.join(options.sdkRoot, 'node_modules/stripe'));
  const sourceRoot = path.resolve(__dirname, '../../..');
  const compiled = path.join(sourceRoot, 'apps/api/dist/modules/money/adapters/stripe');
  const { StripeSdk } = require(path.join(compiled, 'stripe-sdk.js'));
  const { StripeSandboxConfiguration, STRIPE_API_VERSION, STRIPE_SDK_VERSION } = require(
    path.join(compiled, 'stripe-sandbox.config.js'),
  );
  assert.equal(Stripe.PACKAGE_VERSION, STRIPE_SDK_VERSION);
  const now = Date.now();
  const secret = ['whsec', randomBytes(24).toString('hex')].join('_');
  const config = new StripeSandboxConfiguration({
    enabled: true,
    secretKey: ['sk', 'test', randomBytes(24).toString('hex')].join('_'),
    webhookSecret: secret,
    accountReference: 'acct_offline',
    expiresAt: new Date(now + 3600_000).toISOString(),
    signatureToleranceSeconds: 300,
    bindings: [
      {
        planVersionId: 'offline',
        method: 'STRIPE',
        currency: 'XTS',
        adapterId: 'hsm.stripe.v1',
        mode: 'SANDBOX',
        accountReference: 'acct_offline',
        debitAccountId: 'clearing',
        creditAccountId: 'revenue',
        configVersion: 'offline-v1',
        quoteTtlSeconds: 300,
      },
    ],
  });
  // XTS and random keys are offline fixtures; no merchant, price or supported currency is selected.
  const sdk = new StripeSdk(config, Stripe);
  const event = {
    id: 'evt_offline',
    object: 'event',
    type: 'payment_intent.succeeded',
    livemode: false,
    api_version: STRIPE_API_VERSION,
    created: Math.floor(now / 1000),
    data: { object: { id: 'pi_offline' } },
  };
  const body = Buffer.from(JSON.stringify(event));
  const header = (payload = body, timestamp = Math.floor(now / 1000), signingSecret = secret) =>
    Stripe.webhooks.generateTestHeaderString({
      payload: payload.toString(),
      timestamp,
      secret: signingSecret,
    });
  let passed = 0;
  const check = (fn) => {
    fn();
    passed++;
  };
  check(() => assert.equal(sdk.verify(body, header()).id, event.id));
  check(() => assert.equal(sdk.verify(body, header()).id, event.id)); // replay delivery is valid; R24 dedupes it.
  check(() => assert.throws(() => sdk.verify(Buffer.from(`${body.toString()} `), header())));
  check(() => assert.throws(() => sdk.verify(body, header(body, Math.floor(now / 1000) - 301))));
  check(() => assert.throws(() => sdk.verify(body, header(body, Math.floor(now / 1000) + 301))));
  check(() =>
    assert.throws(() =>
      sdk.verify(body, header(body, Math.floor(now / 1000), randomBytes(24).toString('hex'))),
    ),
  );
  check(() => assert.throws(() => sdk.verify(body, '')));
  check(() => assert.throws(() => sdk.verify(body, undefined)));
  check(() => assert.throws(() => sdk.verify(JSON.parse(body.toString()), header())));
  check(() => assert.throws(() => sdk.verify(Buffer.alloc(65_537), header())));
  for (const patch of [
    { livemode: true },
    { account: 'acct_connected' },
    { context: 'org_context' },
    { api_version: 'unapproved' },
  ]) {
    const changed = Buffer.from(JSON.stringify({ ...event, ...patch }));
    check(() => assert.throws(() => sdk.verify(changed, header(changed))));
  }
  return {
    state: 'SOURCE_VERIFIED',
    mode: 'OFFLINE_OFFICIAL_SDK_SIGNATURES',
    sdkVersion: STRIPE_SDK_VERSION,
    apiVersion: STRIPE_API_VERSION,
    passed,
    failed: 0,
    skipped: 0,
    externalRequests: 0,
    sandboxAccepted: false,
  };
}
if (require.main === module) {
  Promise.resolve()
    .then(() => verifyOffline(parseArgs(process.argv.slice(2))))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch(() => {
      process.stderr.write(
        'BLOCKED: explicit offline mode, pinned SDK installation and built R29 source are required. No sandbox acceptance is inferred.\n',
      );
      process.exitCode = 2;
    });
}
module.exports = { parseArgs, verifyOffline };
