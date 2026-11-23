const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  verifyReport,
  readAndVerify,
  InvalidReport,
  MAX_REPORT_BYTES,
} = require('./verify-report.cjs');

const timestamp = '2026-10-23T04:00:00.000Z';
const versions = { contractVersion: 'hsm.money.v1', reportVersion: 'hsm.finance-operations.v1' };
const provenance = () => ({
  readAt: timestamp,
  source: 'AUTHORITATIVE_PERSISTENCE',
  cache: 'NO_STORE',
});
const capabilities = () =>
  Object.fromEntries(
    ['refund', 'receiptReview', 'myPlan', 'reconciliationActions'].map((key) => [
      key,
      { available: false, reason: 'INTEGRATION_PENDING', href: null },
    ]),
  );
const amount = (amountMinor = '9223372036854775807', currency = 'SAR') => ({
  amountMinor,
  currency,
});
const status = (state = 'UNAVAILABLE') => ({
  state,
  lastSuccessAt: state === 'AVAILABLE' ? timestamp : null,
  runId: state === 'AVAILABLE' ? 'run-synthetic' : null,
  reason: state === 'AVAILABLE' ? null : 'INTEGRATION_PENDING',
});
const payment = () => ({
  id: 'payment-synthetic',
  kind: 'PAYMENT',
  status: 'SUCCEEDED',
  amount: amount(),
  amountMeaning: 'CONFIRMED_COLLECTION',
  createdAt: timestamp,
  providerProfileId: 'provider-synthetic',
  paymentIntentId: 'payment-synthetic',
  paymentConfirmationId: 'confirmation-synthetic',
  ledgerTransactionId: 'posting-synthetic',
  confirmationState: 'CONFIRMED',
  dispatchStatus: 'SUCCEEDED',
  period: null,
  publicReasonCode: null,
});
const page = () => ({
  ...versions,
  kind: 'PAYMENT',
  items: [payment()],
  nextCursor: null,
  provenance: provenance(),
  availability: { state: 'AVAILABLE', reason: null },
});
const detail = () => ({
  ...versions,
  record: payment(),
  provenance: provenance(),
  capabilities: capabilities(),
});
const summary = () => ({
  ...versions,
  ledger: {
    contractVersion: versions.contractVersion,
    source: 'LEDGER',
    totals: [
      { currency: 'SAR', captured: amount(), refunded: amount('1') },
      {
        currency: 'USD',
        captured: amount('9007199254740993', 'USD'),
        refunded: amount('0', 'USD'),
      },
    ],
    asOf: timestamp,
  },
  pendingTotals: [
    {
      currency: 'SAR',
      pending: amount('12'),
      unknown: amount('34'),
      refundsRequested: amount('5'),
    },
  ],
  pendingAsOf: timestamp,
  provenance: provenance(),
  reconciliation: status(),
  capabilities: capabilities(),
});
const exception = () => ({
  contractVersion: versions.contractVersion,
  id: 'exception-synthetic',
  kind: 'AMOUNT_MISMATCH',
  subjectType: 'PaymentConfirmation',
  subjectId: 'confirmation-synthetic',
  detectedAt: timestamp,
  resolvedAt: null,
});
const reconciliation = () => ({
  ...versions,
  status: status(),
  items: [],
  nextCursor: null,
  provenance: provenance(),
  capabilities: capabilities(),
});
const rejected = (value, expected) =>
  assert.throws(
    () => verifyReport(value),
    (error) => error instanceof InvalidReport && (!expected || error.code === expected),
  );

test('preserves maximum bigint precision and segregated per-currency totals without summing currencies', () => {
  const input = summary();
  const before = structuredClone(input);
  assert.deepEqual(verifyReport(input), {
    verificationScope: 'WIRE_CONSISTENCY_ONLY',
    reportVersion: versions.reportVersion,
    type: 'SUMMARY',
    currencyCount: 2,
    reconciliationState: 'UNAVAILABLE',
  });
  assert.deepEqual(input, before);
  assert.equal(verifyReport(detail()).confirmationState, 'CONFIRMED');
  assert.equal(verifyReport({ data: page() }).rows, 1);
});

for (const [name, value] of [
  ['number', Number.MAX_SAFE_INTEGER + 2],
  ['overflow', '9223372036854775808'],
  ['negative', '-1'],
  ['signed', '+1'],
  ['fraction', '1.0'],
  ['exponent', '1e5'],
  ['leading-zero', '01'],
  ['whitespace', ' 1'],
  ['empty', ''],
  ['too-long', '9'.repeat(1000)],
]) {
  test(`rejects ${name} amount without rounding or echoing the value`, () => {
    const input = page();
    input.items[0].amount.amountMinor = value;
    rejected(input);
  });
}
for (const [name, mutate, expected] of [
  [
    'mixed nested currencies',
    (x) => {
      x.ledger.totals[0].refunded.currency = 'USD';
    },
    'MIXED_CURRENCY_TOTAL',
  ],
  [
    'mixed pending currencies',
    (x) => {
      x.pendingTotals[0].unknown.currency = 'USD';
    },
    'MIXED_CURRENCY_TOTAL',
  ],
  [
    'duplicate currency bucket',
    (x) => {
      x.ledger.totals.push(structuredClone(x.ledger.totals[0]));
    },
    'DUPLICATE_CURRENCY_TOTAL',
  ],
  [
    'dominant-currency grand total',
    (x) => {
      x.total = amount();
    },
    'UNEXPECTED_FIELDS',
  ],
  [
    'booking-derived authority',
    (x) => {
      x.ledger.source = 'BOOKINGS';
    },
    'INVALID_LEDGER_SOURCE',
  ],
  [
    'wrong money version',
    (x) => {
      x.contractVersion = 'hsm.money.v2';
    },
    'UNSUPPORTED_VERSION',
  ],
  [
    'wrong report version',
    (x) => {
      x.reportVersion = 'hsm.finance-operations.v2';
    },
    'UNSUPPORTED_VERSION',
  ],
  [
    'invalid date normalized by JavaScript',
    (x) => {
      x.pendingAsOf = '2026-02-30T00:00:00.000Z';
    },
    'INVALID_TIMESTAMP',
  ],
  [
    'missing read provenance',
    (x) => {
      delete x.provenance.readAt;
    },
    'UNEXPECTED_FIELDS',
  ],
  [
    'cache pretending fresh read',
    (x) => {
      x.provenance.cache = 'PUBLIC';
    },
    'INVALID_PROVENANCE',
  ],
])
  test(`summary rejects ${name}`, () => {
    const input = summary();
    mutate(input);
    rejected(input, expected);
  });

for (const state of ['NOT_RUN', 'UNAVAILABLE', 'FAILED', 'AVAILABLE']) {
  test(`empty reconciliation preserves ${state} instead of inventing zero differences`, () => {
    const input = reconciliation();
    input.status = status(state);
    const output = verifyReport(input);
    assert.equal(output.rows, 0);
    assert.equal(output.reconciliationState, state);
    assert.equal(Object.hasOwn(output, 'differences'), false);
    assert.equal(Object.hasOwn(output, 'balance'), false);
  });
}
test('reconciliation requires run evidence for success and permits existing exceptions during unavailable state', () => {
  const input = reconciliation();
  input.status.state = 'AVAILABLE';
  rejected(input, 'MISSING_RECONCILIATION_EVIDENCE');
  input.status = status('NOT_RUN');
  input.status.lastSuccessAt = timestamp;
  rejected(input, 'INVENTED_RECONCILIATION_RUN');
  input.status = status();
  input.items = [exception()];
  assert.equal(verifyReport(input).rows, 1);
  input.status.state = 'COMPLETE';
  rejected(input, 'INVALID_RECONCILIATION_STATUS');
});
test('exception detail keeps finite read contracts and rejects balancing actions or private exception payloads', () => {
  const input = {
    ...versions,
    exception: exception(),
    allowedActions: [],
    provenance: provenance(),
  };
  assert.equal(verifyReport(input).type, 'EXCEPTION_DETAIL');
  input.allowedActions = ['ACKNOWLEDGE', 'REQUEST_RECHECK'];
  assert.equal(verifyReport(input).actionCount, 2);
  input.allowedActions = ['BALANCE_LEDGER'];
  rejected(input, 'INVALID_RECONCILIATION_ACTION');
  input.allowedActions = [];
  input.exception.internalNote = 'private-synthetic';
  rejected(input, 'UNEXPECTED_FIELDS');
});

for (const [name, mutate] of [
  [
    'missing posting',
    (x) => {
      x.ledgerTransactionId = null;
    },
  ],
  [
    'missing confirmation',
    (x) => {
      x.paymentConfirmationId = null;
    },
  ],
  [
    'unconfirmed state with captured wording',
    (x) => {
      x.confirmationState = 'UNCONFIRMED';
    },
  ],
  [
    'unconfirmed amount wording with confirmed state',
    (x) => {
      x.amountMeaning = 'INTENT_TOTAL';
    },
  ],
  [
    'missing money',
    (x) => {
      x.amount = null;
    },
  ],
  [
    'wrong payment target',
    (x) => {
      x.paymentIntentId = 'other-payment';
    },
  ],
  [
    'private receipt',
    (x) => {
      x.receiptUrl = 'private-synthetic';
    },
  ],
  [
    'identity data',
    (x) => {
      x.identity = { document: 'private-synthetic' };
    },
  ],
  [
    'internal note',
    (x) => {
      x.internalNote = 'private-synthetic';
    },
  ],
  [
    'private reason on payment',
    (x) => {
      x.publicReasonCode = 'PRIVATE_NOTE';
    },
  ],
])
  test(`record rejects ${name}`, () => {
    const input = page();
    mutate(input.items[0]);
    rejected(input);
  });
test('transport success remains an attempt and does not prove captured money', () => {
  const input = detail();
  Object.assign(input.record, {
    kind: 'ATTEMPT',
    id: 'attempt-synthetic',
    amountMeaning: 'ATTEMPT_TOTAL',
    confirmationState: 'NOT_APPLICABLE',
    paymentConfirmationId: null,
    ledgerTransactionId: null,
  });
  assert.equal(verifyReport(input).confirmationState, 'NOT_APPLICABLE');
  input.record.confirmationState = 'CONFIRMED';
  rejected(input, 'UNPROVEN_CONFIRMATION');
});
test('pending and unknown dispatches stay unconfirmed, even if a corrupt persisted status says SUCCEEDED', () => {
  for (const dispatchStatus of ['PENDING', 'UNKNOWN']) {
    const input = detail();
    Object.assign(input.record, {
      amountMeaning: 'INTENT_TOTAL',
      confirmationState: 'INCONSISTENT',
      ledgerTransactionId: null,
      paymentConfirmationId: null,
      dispatchStatus,
    });
    assert.equal(verifyReport(input).confirmationState, 'INCONSISTENT');
  }
});
test('refund request and refund confirmation remain distinct', () => {
  const input = detail();
  Object.assign(input.record, {
    kind: 'REFUND_REQUEST',
    id: 'request-synthetic',
    status: 'PENDING_POLICY',
    amountMeaning: 'REFUND_REQUESTED',
    confirmationState: 'NOT_APPLICABLE',
    ledgerTransactionId: null,
    publicReasonCode: 'PROVIDER_REQUESTED',
  });
  assert.equal(verifyReport(input).kind, 'REFUND_REQUEST');
  input.record.publicReasonCode = '=PRIVATE_NOTE';
  rejected(input, 'INVALID_REASON_CODE');
  Object.assign(input.record, {
    kind: 'REFUND',
    publicReasonCode: null,
    amountMeaning: 'REFUND_RESERVED',
    confirmationState: 'UNCONFIRMED',
  });
  assert.equal(verifyReport(input).confirmationState, 'UNCONFIRMED');
  Object.assign(input.record, {
    status: 'SUCCEEDED',
    amountMeaning: 'CONFIRMED_REFUND',
    confirmationState: 'CONFIRMED',
    ledgerTransactionId: 'refund-posting-synthetic',
  });
  assert.equal(verifyReport(input).confirmationState, 'CONFIRMED');
});
test('subscription absence has no fabricated amount or period', () => {
  const input = detail();
  Object.assign(input.record, {
    kind: 'SUBSCRIPTION',
    id: 'subscription-synthetic',
    status: 'PENDING_PAYMENT',
    amount: null,
    amountMeaning: 'UNAVAILABLE',
    confirmationState: 'UNCONFIRMED',
    paymentIntentId: null,
    paymentConfirmationId: null,
    ledgerTransactionId: null,
  });
  assert.equal(verifyReport(input).kind, 'SUBSCRIPTION');
  input.record.amount = amount('0');
  rejected(input, 'INCONSISTENT_AMOUNT');
  Object.assign(input.record, {
    amount: amount(),
    amountMeaning: 'CONFIRMED_SUBSCRIPTION_PERIOD',
    confirmationState: 'CONFIRMED',
    paymentIntentId: 'payment-synthetic',
    paymentConfirmationId: 'confirmation-synthetic',
    ledgerTransactionId: 'posting-synthetic',
    period: { startsAt: timestamp, endsAt: '2026-11-23T04:00:00.000Z' },
  });
  assert.equal(verifyReport(input).confirmationState, 'CONFIRMED');
  input.record.period.endsAt = timestamp;
  rejected(input, 'INVALID_PERIOD');
});
test('bounded pages enforce unique matching rows and bounded nonempty cursors', () => {
  const input = page();
  input.items = Array.from({ length: 50 }, (_, i) => ({
    ...payment(),
    id: `payment-${i}`,
    paymentIntentId: `payment-${i}`,
  }));
  input.nextCursor = 'YWJj';
  assert.equal(verifyReport(input).rows, 50);
  input.items.push({ ...payment(), id: 'other', paymentIntentId: 'other' });
  rejected(input, 'ROW_LIMIT_EXCEEDED');
  input.items = [payment(), payment()];
  rejected(input, 'DUPLICATE_RECORD');
  input.items = [payment()];
  input.nextCursor = 'a'.repeat(2049);
  rejected(input, 'INVALID_CURSOR');
  input.nextCursor = '';
  rejected(input, 'INVALID_CURSOR');
  input.nextCursor = 'YWJj';
  input.items = [];
  rejected(input, 'EMPTY_CONTINUATION');
  input.nextCursor = null;
  assert.equal(verifyReport(input).rows, 0);
});
test('unavailable settlements are explicit and never an available empty financial result', () => {
  const input = page();
  Object.assign(input, {
    kind: 'SETTLEMENT',
    items: [],
    availability: { state: 'UNAVAILABLE', reason: 'SETTLEMENT_SOURCE_UNAVAILABLE' },
  });
  assert.equal(verifyReport(input).availability, 'UNAVAILABLE');
  input.availability = { state: 'AVAILABLE', reason: null };
  rejected(input, 'INCONSISTENT_AVAILABILITY');
});
test('integration capabilities cannot expose external URLs or contradict unavailable state', () => {
  const input = detail();
  input.capabilities.refund.href = '/admin/refunds';
  rejected(input, 'INCONSISTENT_AVAILABILITY');
  Object.assign(input.capabilities.refund, {
    available: true,
    reason: null,
    href: '/admin/refunds',
  });
  assert.equal(verifyReport(input).type, 'DETAIL');
  for (const href of [
    'https://private.example.test',
    '//private.example.test',
    '/admin?token=private',
    '/admin\\private',
  ]) {
    input.capabilities.refund.href = href;
    rejected(input, 'UNSAFE_INTEGRATION_ROUTE');
  }
});
test('strict envelopes refuse error responses and injected metadata', () => {
  rejected({ error: { message: 'private-synthetic' } });
  rejected({ data: page(), receipt: 'private-synthetic' }, 'UNEXPECTED_FIELDS');
  rejected({ data: { data: page() } });
  for (const input of [null, [], '', 3, true]) rejected(input);
});
test('bounded file reader rejects malformed, invalid UTF-8, oversized and non-file input safely', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hsm-r33-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'report.json');
  await writeFile(filename, JSON.stringify(summary()));
  assert.equal((await readAndVerify(filename)).type, 'SUMMARY');
  for (const content of [
    '{private-synthetic',
    Buffer.from([255, 254]),
    Buffer.alloc(MAX_REPORT_BYTES + 1, ' '),
  ]) {
    await writeFile(filename, content);
    await assert.rejects(
      readAndVerify(filename),
      (error) => error instanceof InvalidReport && !error.message.includes('private-synthetic'),
    );
  }
  await assert.rejects(readAndVerify(directory), InvalidReport);
  await assert.rejects(
    readAndVerify(path.join(directory, 'private-missing')),
    (error) => error.code === 'INPUT_UNREADABLE' && !error.message.includes('private-missing'),
  );
});
test('CLI emits only sanitized counts and fixed status, with no captured identifiers or raw failures', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hsm-r33-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'private-filename.json');
  const script = path.join(__dirname, 'verify-report.cjs');
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.error, undefined);
    return result;
  };
  await writeFile(filename, JSON.stringify(page()));
  const good = run(filename);
  assert.equal(good.status, 0);
  assert.equal(JSON.parse(good.stdout).rows, 1);
  assert.doesNotMatch(good.stdout + good.stderr, /synthetic|9223372036854775807|private-filename/u);
  await writeFile(filename, '{private-synthetic');
  const bad = run(filename);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr.trim(), 'FINANCIAL_REPORT_REJECTED INVALID_JSON');
  assert.equal(run().status, 1);
  assert.equal(run('--help').status, 0);
});
