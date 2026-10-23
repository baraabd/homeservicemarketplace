#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const VERSION = 'hsm.money.v1';
const ID = /^[A-Za-z0-9_-]{1,64}$/u;
const REVISION = /^[a-f0-9]{64}$/u;
const COMMAND_KEY = /^[A-Za-z0-9_-]{16,128}$/u;
const APPROVAL = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/u;
const MAX_BYTES = 65_536;
const STATES = new Set([
  'RESERVED',
  'PENDING',
  'AMBIGUOUS',
  'CONFIRMED_SUCCEEDED',
  'CONFIRMED_FAILED',
  'CANCELLED',
]);
const REFUND_STATUSES = new Set(['RESERVED', 'DISPATCHED', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
const DISPATCH_STATUSES = new Set(['NOT_DISPATCHED', 'PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED']);
const DIAGNOSTICS = new Set([
  'READY_FOR_DISPATCH',
  'QUERY_REQUIRED',
  'LOCAL_COMPLETION_REQUIRED',
  'TERMINAL',
  'CONFIRMATION_INCONSISTENT',
  'MONEY_REFUND_POLICY_UNAVAILABLE',
  'MONEY_REFUND_ADAPTER_UNAVAILABLE',
  'MONEY_CONFIGURATION_UNAVAILABLE',
]);
const OUTCOMES = new Set([
  'DRY_RUN',
  'ACCEPTED',
  'AMBIGUOUS',
  'CONFIRMED_SUCCEEDED',
  'CONFIRMED_FAILED',
  'POLICY_BLOCKED',
  'EXTERNAL_BLOCKED',
]);
const HELP = `Authenticated R32 refund inspection and recovery. Default: audited dry-run.

node scripts/production/refund-recovery/inspect.cjs \
  --api-url https://api.example.test/v1 --credential-file /private/operator.json \
  --refund-id REFUND --payment-confirmation-id CONFIRMATION [--operation QUERY|DISPATCH]

--inspect-only                 Read and audit current state; no recovery command.
--dry-run                      Explicit default; never dispatches or queries a rail.
--execute                      Requires --revision, --approval-reference, --idempotency-key.
--revision HEX64               Observed state revision; mandatory for execution.
--approval-reference REFERENCE Bounded approval/case reference; not a permission grant.
--idempotency-key KEY           Retain and reuse the same key for the same approved request.

The credential file must be an owner-only regular file (0600 or 0400), containing
either {"bearerToken":"..."} or {"cookie":"...","csrfToken":"..."}.
Never pass credentials as arguments. HTTPS is required except literal loopback HTTP.
The client never follows redirects or automatically retries. After an ambiguous
execution result, inspect state before deciding whether to repeat the original request.
`;

class RecoveryCliError extends Error {
  constructor(code, uncertain = false) {
    super(code);
    this.code = code;
    this.uncertain = uncertain;
  }
}

function fail(code) {
  throw new RecoveryCliError(code);
}

function parseArgs(argv) {
  const values = new Map();
  const booleans = new Set(['--execute', '--inspect-only', '--dry-run', '--help']);
  const strings = new Set([
    '--api-url',
    '--credential-file',
    '--refund-id',
    '--payment-confirmation-id',
    '--operation',
    '--revision',
    '--approval-reference',
    '--idempotency-key',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (values.has(flag) || (!booleans.has(flag) && !strings.has(flag))) fail('INVALID_ARGUMENTS');
    if (booleans.has(flag)) values.set(flag, true);
    else {
      const value = argv[++index];
      if (typeof value !== 'string' || value.length === 0 || value.startsWith('--'))
        fail('INVALID_ARGUMENTS');
      values.set(flag, value);
    }
  }
  if (values.has('--help')) {
    if (values.size !== 1) fail('INVALID_ARGUMENTS');
    return { help: true };
  }
  const apiUrl = values.get('--api-url');
  const credentialFile = values.get('--credential-file');
  const refundId = values.get('--refund-id');
  const paymentConfirmationId = values.get('--payment-confirmation-id');
  if (
    !apiUrl ||
    !credentialFile ||
    !ID.test(refundId ?? '') ||
    !ID.test(paymentConfirmationId ?? '')
  )
    fail('INVALID_ARGUMENTS');
  let base;
  try {
    base = new URL(apiUrl);
  } catch {
    fail('INVALID_API_URL');
  }
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(base.hostname)))
  )
    fail('INVALID_API_URL');
  // The versioned API base is explicit, including any deployment path prefix.
  const endpoint = new URL(base);
  endpoint.pathname = `${base.pathname.replace(/\/+$/u, '')}/money/review/refunds/${encodeURIComponent(refundId)}/recovery`;
  const operation = values.get('--operation') ?? 'QUERY';
  const revision = values.get('--revision');
  const approvalReference = values.get('--approval-reference');
  const idempotencyKey = values.get('--idempotency-key');
  const execute = values.has('--execute');
  const inspectOnly = values.has('--inspect-only');
  if (
    !['QUERY', 'DISPATCH'].includes(operation) ||
    (execute && (inspectOnly || values.has('--dry-run')))
  )
    fail('INVALID_ARGUMENTS');
  if (revision !== undefined && !REVISION.test(revision)) fail('INVALID_REVISION');
  if (approvalReference !== undefined && !APPROVAL.test(approvalReference))
    fail('INVALID_APPROVAL_REFERENCE');
  if (idempotencyKey !== undefined && !COMMAND_KEY.test(idempotencyKey))
    fail('INVALID_IDEMPOTENCY_KEY');
  if (execute && (!revision || !approvalReference || !idempotencyKey))
    fail('EXECUTION_APPROVAL_REQUIRED');
  return {
    endpoint,
    credentialFile,
    refundId,
    paymentConfirmationId,
    operation,
    revision,
    approvalReference,
    idempotencyKey,
    execute,
    inspectOnly,
  };
}

function readCredentials(filename) {
  let descriptor;
  try {
    if (typeof process.getuid !== 'function' || !Number.isInteger(fs.constants.O_NOFOLLOW))
      fail('CREDENTIAL_FILE_UNSAFE');
    // NOFOLLOW excludes a symlink; NONBLOCK also prevents a FIFO from blocking
    // before fstat can reject it. Ownership/mode are checked on the opened file.
    descriptor = fs.openSync(
      filename,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    const info = fs.fstatSync(descriptor);
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid()) ||
      info.size > 16_384
    )
      fail('CREDENTIAL_FILE_UNSAFE');
    const buffer = Buffer.alloc(16_385);
    const count = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    if (count > 16_384) fail('CREDENTIAL_FILE_UNSAFE');
    const data = JSON.parse(buffer.subarray(0, count).toString('utf8'));
    if (!isRecord(data)) fail('CREDENTIAL_FILE_INVALID');
    const keys = Object.keys(data).sort().join(',');
    if (
      keys === 'bearerToken' &&
      validHeader(data.bearerToken) &&
      /^[A-Za-z0-9._~+/-]+=*$/u.test(data.bearerToken)
    )
      return { authorization: `Bearer ${data.bearerToken}` };
    if (keys === 'cookie,csrfToken' && validHeader(data.cookie) && validHeader(data.csrfToken))
      return { cookie: data.cookie, 'x-csrf-token': data.csrfToken };
    fail('CREDENTIAL_FILE_INVALID');
  } catch (error) {
    if (error instanceof RecoveryCliError) throw error;
    fail('CREDENTIAL_FILE_UNAVAILABLE');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function validHeader(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 8_192 &&
    /^[\x20-\x7e]+$/u.test(value)
  );
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(response) {
  if (!response.ok) {
    await response.body?.cancel();
    fail(`HTTP_${response.status}`);
  }
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? ''))
    fail('INVALID_RESPONSE');
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/u.test(length) || Number(length) > MAX_BYTES)) fail('INVALID_RESPONSE');
  if (!response.body) fail('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) fail('INVALID_RESPONSE');
      chunks.push(Buffer.from(value));
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      fail('INVALID_RESPONSE');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function projectInspection(input, scope) {
  if (
    !isRecord(input) ||
    input.contractVersion !== VERSION ||
    input.refundId !== scope.refundId ||
    input.paymentConfirmationId !== scope.paymentConfirmationId ||
    typeof input.stateRevision !== 'string' ||
    !REVISION.test(input.stateRevision) ||
    !STATES.has(input.state) ||
    !REFUND_STATUSES.has(input.refundStatus) ||
    !(input.dispatchStatus === null || DISPATCH_STATUSES.has(input.dispatchStatus)) ||
    !Array.isArray(input.allowedOperations) ||
    input.allowedOperations.length > 2 ||
    input.allowedOperations.some((operation) => !['QUERY', 'DISPATCH'].includes(operation)) ||
    !DIAGNOSTICS.has(input.diagnosticCode) ||
    typeof input.reservationHeld !== 'boolean' ||
    input.expiryPolicy !== 'POLICY_BLOCKED' ||
    input.automaticReservationRelease !== false ||
    !isRecord(input.amount) ||
    typeof input.amount.amountMinor !== 'string' ||
    !/^(?:0|[1-9]\d{0,18})$/u.test(input.amount.amountMinor) ||
    BigInt(input.amount.amountMinor) > 9223372036854775807n ||
    typeof input.amount.currency !== 'string' ||
    !/^[A-Z]{3}$/u.test(input.amount.currency)
  )
    fail('INVALID_RESPONSE');
  // Explicit allowlisting keeps unknown/private server fields out of diagnostics.
  return {
    contractVersion: VERSION,
    refundId: input.refundId,
    paymentConfirmationId: input.paymentConfirmationId,
    stateRevision: input.stateRevision,
    state: input.state,
    amount: { amountMinor: input.amount.amountMinor, currency: input.amount.currency },
    refundStatus: input.refundStatus,
    dispatchStatus: input.dispatchStatus,
    allowedOperations: [...input.allowedOperations],
    diagnosticCode: input.diagnosticCode,
    reservationHeld: input.reservationHeld,
    expiryPolicy: 'POLICY_BLOCKED',
    automaticReservationRelease: false,
  };
}

function projectResult(input, scope) {
  if (
    !isRecord(input) ||
    input.contractVersion !== VERSION ||
    input.dryRun !== !scope.execute ||
    input.operation !== scope.operation ||
    !OUTCOMES.has(input.outcome) ||
    !DIAGNOSTICS.has(input.diagnosticCode)
  )
    fail('INVALID_RESPONSE');
  if (
    (!scope.execute && input.outcome !== 'DRY_RUN') ||
    (scope.execute && input.outcome === 'DRY_RUN')
  )
    fail('INVALID_RESPONSE');
  return {
    contractVersion: VERSION,
    dryRun: input.dryRun,
    operation: input.operation,
    outcome: input.outcome,
    inspection: projectInspection(input.inspection, scope),
    diagnosticCode: input.diagnosticCode,
  };
}

async function run(argv, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const options = parseArgs(argv);
  if (options.help) return { help: HELP };
  if (options.endpoint.protocol === 'https:' && env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    fail('TLS_VERIFICATION_REQUIRED');
  const headers = { accept: 'application/json', ...readCredentials(options.credentialFile) };
  const send = async (url, init) =>
    readJson(
      await fetchImpl(url, {
        ...init,
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(15_000),
      }),
    );
  const inspectionUrl = new URL(options.endpoint);
  inspectionUrl.searchParams.set('paymentConfirmationId', options.paymentConfirmationId);
  let inspection;
  try {
    inspection = projectInspection(await send(inspectionUrl, { method: 'GET', headers }), options);
  } catch (error) {
    if (error instanceof RecoveryCliError) throw error;
    fail('INSPECTION_UNAVAILABLE');
  }
  if (options.inspectOnly) return { contractVersion: VERSION, outcome: 'INSPECTED', inspection };
  // New executions are fenced atomically on the server. Preserve the original
  // approval and revision on an exact idempotent retry after state has advanced.
  if (!options.execute && options.revision && options.revision !== inspection.stateRevision)
    fail('STALE_REVISION');
  if (!options.execute && !inspection.allowedOperations.includes(options.operation))
    fail('OPERATION_UNAVAILABLE');
  const payload = {
    contractVersion: VERSION,
    paymentConfirmationId: options.paymentConfirmationId,
    expectedStateRevision: options.revision ?? inspection.stateRevision,
    operation: options.operation,
    dryRun: !options.execute,
    ...(options.approvalReference ? { approvalReference: options.approvalReference } : {}),
  };
  try {
    return projectResult(
      await send(options.endpoint, {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          'idempotency-key': options.idempotencyKey ?? `r32_dry_${crypto.randomUUID()}`,
        },
        body: JSON.stringify(payload),
      }),
      options,
    );
  } catch (error) {
    // A failed response after an execution POST cannot establish whether the
    // durable command committed. Do not replay or describe it as a rejection.
    if (options.execute) throw new RecoveryCliError('RECOVERY_RESPONSE_UNKNOWN', true);
    if (error instanceof RecoveryCliError) throw error;
    fail('DRY_RUN_UNAVAILABLE');
  }
}

async function main(
  argv = process.argv.slice(2),
  { stdout = process.stdout, stderr = process.stderr, ...dependencies } = {},
) {
  try {
    const result = await run(argv, dependencies);
    if (result.help) stdout.write(result.help);
    else stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return ['AMBIGUOUS', 'POLICY_BLOCKED', 'EXTERNAL_BLOCKED'].includes(result.outcome) ? 2 : 0;
  } catch (error) {
    const known = error instanceof RecoveryCliError;
    stderr.write(
      `${JSON.stringify({ contractVersion: VERSION, outcome: known && error.uncertain ? 'AMBIGUOUS' : 'ERROR', diagnosticCode: known ? error.code : 'RECOVERY_CLIENT_UNAVAILABLE' })}\n`,
    );
    return 2;
  }
}

module.exports = { main, parseArgs, readCredentials, run };
if (require.main === module)
  void main().then((code) => {
    process.exitCode = code;
  });
