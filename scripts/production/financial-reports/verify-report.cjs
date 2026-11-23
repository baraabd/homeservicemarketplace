// Read-only, dependency-free verifier for captured R33 endpoint JSON.
// Usage: node scripts/production/financial-reports/verify-report.cjs report.json
// Accepts one direct summary/page/detail/reconciliation response, or { data: response }.
// This checks wire consistency only. It cannot authenticate a capture, confirm a
// ledger posting, replace API authorization tests, or establish hosted acceptance.
// CSV is deliberately not accepted: use the export service's dedicated tests.
const { open } = require('node:fs/promises');

const MONEY_VERSION = 'hsm.money.v1';
const REPORT_VERSION = 'hsm.finance-operations.v1';
const MAX_MINOR = 9223372036854775807n;
const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_ROWS = 50;
const KINDS = ['PAYMENT', 'ATTEMPT', 'REFUND_REQUEST', 'REFUND', 'SUBSCRIPTION', 'SETTLEMENT'];
const CONFIRMATIONS = ['NOT_APPLICABLE', 'UNCONFIRMED', 'CONFIRMED', 'INCONSISTENT'];
const DISPATCHES = ['NOT_DISPATCHED', 'PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED'];
const MEANINGS = {
  PAYMENT: ['INTENT_TOTAL', 'CONFIRMED_COLLECTION'],
  ATTEMPT: ['ATTEMPT_TOTAL'],
  REFUND_REQUEST: ['REFUND_REQUESTED'],
  REFUND: ['REFUND_RESERVED', 'CONFIRMED_REFUND'],
  SUBSCRIPTION: ['UNAVAILABLE', 'CONFIRMED_SUBSCRIPTION_PERIOD'],
};
const EXCEPTIONS = [
  'CONFIRMATION_WITHOUT_POSTING',
  'POSTING_WITHOUT_CONFIRMATION',
  'AMOUNT_MISMATCH',
  'CURRENCY_MISMATCH',
  'DUPLICATE_EXTERNAL_CONFIRMATION',
  'REFUND_WITHOUT_COMPENSATION',
  'PERIOD_WITHOUT_CONFIRMATION',
];
const VERSIONS = ['contractVersion', 'reportVersion'];
const RECORD_KEYS = [
  'id',
  'kind',
  'status',
  'amount',
  'amountMeaning',
  'createdAt',
  'providerProfileId',
  'paymentIntentId',
  'paymentConfirmationId',
  'ledgerTransactionId',
  'confirmationState',
  'dispatchStatus',
  'period',
  'publicReasonCode',
];

class InvalidReport extends Error {
  constructor(code = 'INVALID_REPORT') {
    super(code);
    this.code = code;
  }
}
function check(condition, code = 'INVALID_REPORT') {
  if (!condition) throw new InvalidReport(code);
}
function object(value) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
}
function keys(value, expected) {
  object(value);
  // Closed projections reject receipt/identity URLs, private notes and arbitrary
  // payloads at every level without printing the offending key or value.
  check(
    Object.keys(value).sort().join('\0') === [...expected].sort().join('\0'),
    'UNEXPECTED_FIELDS',
  );
}
function string(value, maximum = 256) {
  check(
    typeof value === 'string' &&
      value.length > 0 &&
      value.length <= maximum &&
      [...value].every((character) => {
        const point = character.codePointAt(0);
        return point > 31 && (point < 127 || point > 159);
      }),
  );
}
function nullable(value, verify) {
  if (value !== null) verify(value);
}
function date(value) {
  check(
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value),
    'INVALID_TIMESTAMP',
  );
  const parsed = new Date(value);
  check(Number.isFinite(parsed.getTime()) && parsed.toISOString() === value, 'INVALID_TIMESTAMP');
}
function code(value) {
  check(typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,95}$/u.test(value), 'INVALID_REASON_CODE');
}
function currency(value) {
  check(typeof value === 'string' && /^[A-Z]{3}$/u.test(value), 'INVALID_CURRENCY');
}
function money(value, expectedCurrency) {
  keys(value, ['amountMinor', 'currency']);
  check(
    typeof value.amountMinor === 'string' && /^(0|[1-9][0-9]{0,18})$/u.test(value.amountMinor),
    'INVALID_AMOUNT',
  );
  check(BigInt(value.amountMinor) <= MAX_MINOR, 'AMOUNT_OUT_OF_RANGE');
  currency(value.currency);
  if (expectedCurrency !== undefined)
    check(value.currency === expectedCurrency, 'MIXED_CURRENCY_TOTAL');
}
function versions(value) {
  check(
    value.contractVersion === MONEY_VERSION && value.reportVersion === REPORT_VERSION,
    'UNSUPPORTED_VERSION',
  );
}
function provenance(value) {
  keys(value, ['readAt', 'source', 'cache']);
  date(value.readAt);
  check(
    value.source === 'AUTHORITATIVE_PERSISTENCE' && value.cache === 'NO_STORE',
    'INVALID_PROVENANCE',
  );
}
function capabilities(value) {
  const names = ['refund', 'receiptReview', 'myPlan', 'reconciliationActions'];
  keys(value, names);
  for (const name of names) {
    const capability = value[name];
    keys(capability, ['available', 'reason', 'href']);
    check(typeof capability.available === 'boolean');
    nullable(capability.reason, code);
    nullable(capability.href, (href) => {
      string(href, 512);
      check(
        /^\/[A-Za-z0-9/_-]*$/u.test(href) && !href.startsWith('//'),
        'UNSAFE_INTEGRATION_ROUTE',
      );
    });
    if (!capability.available)
      check(capability.reason !== null && capability.href === null, 'INCONSISTENT_AVAILABILITY');
    else check(capability.reason === null, 'INCONSISTENT_AVAILABILITY');
  }
}
function cursor(value) {
  if (value === null) return;
  check(
    typeof value === 'string' && value.length <= 2048 && /^[A-Za-z0-9_-]+$/u.test(value),
    'INVALID_CURSOR',
  );
}
function boundedRows(value) {
  check(Array.isArray(value) && value.length <= MAX_ROWS, 'ROW_LIMIT_EXCEEDED');
  check(new Set(value.map((row) => row?.id)).size === value.length, 'DUPLICATE_RECORD');
}
function reconciliationStatus(value) {
  keys(value, ['state', 'lastSuccessAt', 'runId', 'reason']);
  check(
    ['NOT_RUN', 'AVAILABLE', 'UNAVAILABLE', 'FAILED'].includes(value.state),
    'INVALID_RECONCILIATION_STATUS',
  );
  nullable(value.lastSuccessAt, date);
  nullable(value.runId, string);
  nullable(value.reason, code);
  if (value.state === 'AVAILABLE')
    check(
      value.lastSuccessAt !== null && value.runId !== null && value.reason === null,
      'MISSING_RECONCILIATION_EVIDENCE',
    );
  if (value.state === 'NOT_RUN')
    check(value.lastSuccessAt === null && value.runId === null, 'INVENTED_RECONCILIATION_RUN');
  if (['UNAVAILABLE', 'FAILED'].includes(value.state))
    check(value.reason !== null, 'MISSING_RECONCILIATION_REASON');
}
function record(value) {
  keys(value, RECORD_KEYS);
  check(
    Object.hasOwn(MEANINGS, value.kind) && MEANINGS[value.kind].includes(value.amountMeaning),
    'INVALID_AMOUNT_MEANING',
  );
  string(value.id);
  string(value.providerProfileId);
  string(value.status, 64);
  date(value.createdAt);
  for (const field of ['paymentIntentId', 'paymentConfirmationId', 'ledgerTransactionId'])
    nullable(value[field], string);
  check(CONFIRMATIONS.includes(value.confirmationState));
  check(value.dispatchStatus === null || DISPATCHES.includes(value.dispatchStatus));
  nullable(value.amount, money);
  nullable(value.publicReasonCode, (reason) =>
    check(
      typeof reason === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(reason),
      'INVALID_REASON_CODE',
    ),
  );
  nullable(value.period, (period) => {
    keys(period, ['startsAt', 'endsAt']);
    date(period.startsAt);
    date(period.endsAt);
    check(period.startsAt < period.endsAt, 'INVALID_PERIOD');
  });
  const confirmed = value.amountMeaning.startsWith('CONFIRMED_');
  check(confirmed === (value.confirmationState === 'CONFIRMED'), 'UNPROVEN_CONFIRMATION');
  if (confirmed)
    check(
      value.amount !== null &&
        value.paymentIntentId !== null &&
        value.paymentConfirmationId !== null &&
        value.ledgerTransactionId !== null,
      'UNPROVEN_CONFIRMATION',
    );
  else check(value.ledgerTransactionId === null, 'UNPROVEN_CONFIRMATION');
  check((value.amount === null) === (value.amountMeaning === 'UNAVAILABLE'), 'INCONSISTENT_AMOUNT');
  if (value.kind === 'PAYMENT') check(value.paymentIntentId === value.id, 'WRONG_PAYMENT_TARGET');
  if (value.kind === 'ATTEMPT')
    check(
      value.confirmationState === 'NOT_APPLICABLE' &&
        value.paymentIntentId !== null &&
        value.paymentConfirmationId === null,
      'ATTEMPT_IS_NOT_CONFIRMATION',
    );
  if (value.kind === 'REFUND_REQUEST')
    check(
      value.confirmationState === 'NOT_APPLICABLE' &&
        value.paymentIntentId !== null &&
        value.paymentConfirmationId !== null,
      'REQUEST_IS_NOT_REFUND',
    );
  if (value.kind === 'REFUND')
    check(
      value.paymentIntentId !== null && value.paymentConfirmationId !== null,
      'MISSING_REFUND_TARGET',
    );
  if (value.kind === 'SUBSCRIPTION')
    check((value.period !== null) === confirmed, 'UNPROVEN_PERIOD');
  else check(value.period === null, 'INVALID_PERIOD');
  if (value.kind !== 'REFUND_REQUEST')
    check(value.publicReasonCode === null, 'PRIVATE_REASON_EXPOSED');
}
function exception(value) {
  keys(value, [
    'contractVersion',
    'id',
    'kind',
    'subjectType',
    'subjectId',
    'detectedAt',
    'resolvedAt',
  ]);
  check(value.contractVersion === MONEY_VERSION, 'UNSUPPORTED_VERSION');
  check(EXCEPTIONS.includes(value.kind));
  check(
    ['PaymentConfirmation', 'LedgerTransaction', 'Refund', 'SubscriptionPeriod'].includes(
      value.subjectType,
    ),
  );
  string(value.id);
  string(value.subjectId);
  date(value.detectedAt);
  nullable(value.resolvedAt, date);
  check(value.resolvedAt === null || value.resolvedAt >= value.detectedAt, 'INVALID_TIMESTAMP');
}
function totals(value, amountKeys) {
  check(Array.isArray(value) && value.length <= 26 ** 3, 'INVALID_TOTALS');
  const seen = new Set();
  for (const entry of value) {
    keys(entry, ['currency', ...amountKeys]);
    currency(entry.currency);
    check(!seen.has(entry.currency), 'DUPLICATE_CURRENCY_TOTAL');
    seen.add(entry.currency);
    for (const field of amountKeys) money(entry[field], entry.currency);
  }
  return seen;
}

function verifyReport(document) {
  object(document);
  if (Object.hasOwn(document, 'data')) {
    keys(document, ['data']);
    document = document.data;
    object(document);
  }
  versions(document);
  provenance(document.provenance);
  const result = { verificationScope: 'WIRE_CONSISTENCY_ONLY', reportVersion: REPORT_VERSION };
  if (Object.hasOwn(document, 'ledger')) {
    keys(document, [
      ...VERSIONS,
      'ledger',
      'pendingTotals',
      'pendingAsOf',
      'provenance',
      'reconciliation',
      'capabilities',
    ]);
    keys(document.ledger, ['contractVersion', 'source', 'totals', 'asOf']);
    check(
      document.ledger.contractVersion === MONEY_VERSION && document.ledger.source === 'LEDGER',
      'INVALID_LEDGER_SOURCE',
    );
    date(document.ledger.asOf);
    date(document.pendingAsOf);
    const ledgerCurrencies = totals(document.ledger.totals, ['captured', 'refunded']);
    const pendingCurrencies = totals(document.pendingTotals, [
      'pending',
      'unknown',
      'refundsRequested',
    ]);
    reconciliationStatus(document.reconciliation);
    capabilities(document.capabilities);
    return {
      ...result,
      type: 'SUMMARY',
      currencyCount: new Set([...ledgerCurrencies, ...pendingCurrencies]).size,
      reconciliationState: document.reconciliation.state,
    };
  }
  if (Object.hasOwn(document, 'record')) {
    keys(document, [...VERSIONS, 'record', 'provenance', 'capabilities']);
    record(document.record);
    capabilities(document.capabilities);
    return {
      ...result,
      type: 'DETAIL',
      rows: 1,
      kind: document.record.kind,
      confirmationState: document.record.confirmationState,
    };
  }
  if (Object.hasOwn(document, 'exception')) {
    keys(document, [...VERSIONS, 'exception', 'allowedActions', 'provenance']);
    exception(document.exception);
    check(
      Array.isArray(document.allowedActions) &&
        document.allowedActions.length <= 2 &&
        new Set(document.allowedActions).size === document.allowedActions.length &&
        document.allowedActions.every((action) =>
          ['ACKNOWLEDGE', 'REQUEST_RECHECK'].includes(action),
        ),
      'INVALID_RECONCILIATION_ACTION',
    );
    return {
      ...result,
      type: 'EXCEPTION_DETAIL',
      rows: 1,
      actionCount: document.allowedActions.length,
    };
  }
  boundedRows(document.items);
  cursor(document.nextCursor);
  if (document.nextCursor !== null) check(document.items.length > 0, 'EMPTY_CONTINUATION');
  if (Object.hasOwn(document, 'kind')) {
    keys(document, [...VERSIONS, 'kind', 'items', 'nextCursor', 'provenance', 'availability']);
    check(KINDS.includes(document.kind));
    keys(document.availability, ['state', 'reason']);
    check(['AVAILABLE', 'UNAVAILABLE'].includes(document.availability.state));
    if (document.availability.state === 'UNAVAILABLE') {
      code(document.availability.reason);
      check(
        document.items.length === 0 && document.nextCursor === null,
        'INCONSISTENT_AVAILABILITY',
      );
    } else
      check(
        document.availability.reason === null && document.kind !== 'SETTLEMENT',
        'INCONSISTENT_AVAILABILITY',
      );
    for (const item of document.items) {
      record(item);
      check(item.kind === document.kind, 'MIXED_RECORD_KINDS');
    }
    return {
      ...result,
      type: 'PAGE',
      rows: document.items.length,
      kind: document.kind,
      availability: document.availability.state,
      hasMore: document.nextCursor !== null,
    };
  }
  keys(document, [...VERSIONS, 'status', 'items', 'nextCursor', 'provenance', 'capabilities']);
  reconciliationStatus(document.status);
  capabilities(document.capabilities);
  for (const item of document.items) exception(item);
  // rows=0 is only the observed page size. Preserve NOT_RUN/UNAVAILABLE/FAILED;
  // never infer zero financial differences or successful reconciliation from it.
  return {
    ...result,
    type: 'RECONCILIATION_PAGE',
    rows: document.items.length,
    reconciliationState: document.status.state,
    hasMore: document.nextCursor !== null,
  };
}

async function readAndVerify(filename) {
  let file;
  try {
    file = await open(filename, 'r');
    const stat = await file.stat();
    check(stat.isFile() && stat.size <= MAX_REPORT_BYTES, 'INPUT_LIMIT_EXCEEDED');
    // Read at most the limit plus one byte even if the file grows after stat.
    const buffer = Buffer.alloc(MAX_REPORT_BYTES + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    check(used <= MAX_REPORT_BYTES, 'INPUT_LIMIT_EXCEEDED');
    let value;
    try {
      value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used)),
      );
    } catch {
      throw new InvalidReport('INVALID_JSON');
    }
    return verifyReport(value);
  } catch (error) {
    if (error instanceof InvalidReport) throw error;
    throw new InvalidReport('INPUT_UNREADABLE');
  } finally {
    await file?.close();
  }
}

async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/production/financial-reports/verify-report.cjs <report.json>');
    console.log(
      'One captured R33 JSON response or { data: response }; maximum 1 MiB. No network access. Wire consistency only.',
    );
    return;
  }
  check(args.length === 1 && !args[0].startsWith('-'), 'INVALID_ARGUMENTS');
  const result = await readAndVerify(args[0]);
  console.log(JSON.stringify(result));
}

module.exports = { verifyReport, readAndVerify, InvalidReport, MAX_REPORT_BYTES, MAX_ROWS };
if (require.main === module) {
  main().catch((error) => {
    // Never print a filename, record, amount, endpoint, internal note or raw error.
    console.error(
      `FINANCIAL_REPORT_REJECTED ${error instanceof InvalidReport ? error.code : 'INVALID_REPORT'}`,
    );
    process.exitCode = 1;
  });
}
