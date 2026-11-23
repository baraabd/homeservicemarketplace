'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { main, parseArgs, readCredentials, run } = require('./inspect.cjs');

const REFUND = 'refund-r32-cli';
const PAYMENT = 'confirmation-r32-cli';
const REVISION = 'a'.repeat(64);
const KEY = 'r32_cli_command_0001';
const TOKEN = 'r32-cli-contract-token';

function fixture(t, credential = { bearerToken: TOKEN }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'r32-cli-test-'));
  const file = path.join(directory, 'credential.json');
  fs.writeFileSync(file, JSON.stringify(credential), { mode: 0o600 });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const args = [
    '--api-url',
    'https://api.example.test/v1',
    '--credential-file',
    file,
    '--refund-id',
    REFUND,
    '--payment-confirmation-id',
    PAYMENT,
    '--operation',
    'DISPATCH',
  ];
  return { directory, file, args };
}

function inspection(extra = {}) {
  return {
    contractVersion: 'hsm.money.v1',
    refundId: REFUND,
    paymentConfirmationId: PAYMENT,
    stateRevision: REVISION,
    state: 'RESERVED',
    amount: { amountMinor: '250', currency: 'XTS' },
    refundStatus: 'RESERVED',
    dispatchStatus: 'NOT_DISPATCHED',
    allowedOperations: ['DISPATCH', 'QUERY'],
    diagnosticCode: 'READY_FOR_DISPATCH',
    reservationHeld: true,
    expiryPolicy: 'POLICY_BLOCKED',
    automaticReservationRelease: false,
    ...extra,
  };
}

function response(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function result(extra = {}) {
  return {
    contractVersion: 'hsm.money.v1',
    dryRun: true,
    operation: 'DISPATCH',
    outcome: 'DRY_RUN',
    inspection: inspection(),
    diagnosticCode: 'READY_FOR_DISPATCH',
    ...extra,
  };
}

function transport(replies = [response(inspection()), response(result())]) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), ...init });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'Unexpected extra HTTP request');
    return next;
  };
  return { requests, fetchImpl };
}

function execution(args) {
  return [
    ...args,
    '--execute',
    '--revision',
    REVISION,
    '--approval-reference',
    'ops-case-32',
    '--idempotency-key',
    KEY,
  ];
}

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    stdout: {
      write: (value) => {
        stdout += value;
      },
    },
    stderr: {
      write: (value) => {
        stderr += value;
      },
    },
    output: () => ({ stdout, stderr }),
  };
}

test('default CLI sends authenticated bounded inspection and an audited dry-run', async (t) => {
  const f = fixture(t);
  const api = transport();
  assert.equal((await run(f.args, api)).outcome, 'DRY_RUN');
  assert.equal(api.requests.length, 2);
  assert.equal(
    api.requests[0].url,
    `https://api.example.test/v1/money/review/refunds/${REFUND}/recovery?paymentConfirmationId=${PAYMENT}`,
  );
  assert.equal(api.requests[0].method, 'GET');
  assert.equal(api.requests[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(api.requests[1].body), {
    contractVersion: 'hsm.money.v1',
    paymentConfirmationId: PAYMENT,
    expectedStateRevision: REVISION,
    operation: 'DISPATCH',
    dryRun: true,
  });
  assert.match(api.requests[1].headers['idempotency-key'], /^r32_dry_[A-Za-z0-9-]+$/u);
  for (const request of api.requests) {
    assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'omit');
    assert.ok(request.signal instanceof AbortSignal);
  }
});

test('inspection-only makes no replay request and emits only public recovery fields', async (t) => {
  const f = fixture(t);
  const api = transport([
    response(
      inspection({
        providerIdempotencyKey: 'private-provider-key',
        rawError: 'private-account',
        accountReference: 'private-account',
      }),
    ),
  ]);
  const output = await run([...f.args, '--inspect-only'], api);
  assert.equal(output.outcome, 'INSPECTED');
  assert.equal(api.requests.length, 1);
  assert.doesNotMatch(
    JSON.stringify(output),
    /private-|accountReference|providerIdempotencyKey|rawError/u,
  );
});

test('execute binds the explicit scope, original revision, approval and idempotency identity', async (t) => {
  const f = fixture(t);
  const api = transport([
    response(inspection()),
    response(result({ dryRun: false, outcome: 'ACCEPTED' })),
  ]);
  const output = await run(execution(f.args), api);
  assert.equal(output.outcome, 'ACCEPTED');
  assert.deepEqual(JSON.parse(api.requests[1].body), {
    contractVersion: 'hsm.money.v1',
    paymentConfirmationId: PAYMENT,
    expectedStateRevision: REVISION,
    operation: 'DISPATCH',
    dryRun: false,
    approvalReference: 'ops-case-32',
  });
  assert.equal(api.requests[1].headers['idempotency-key'], KEY);
  assert.doesNotMatch(
    JSON.stringify(output),
    /ops-case-32|r32_cli_command|r32-cli-contract-token/u,
  );
});

test('an exact execution retry preserves its original approval even after state advanced', async (t) => {
  const f = fixture(t);
  const terminal = inspection({
    stateRevision: 'b'.repeat(64),
    state: 'CONFIRMED_SUCCEEDED',
    refundStatus: 'SUCCEEDED',
    dispatchStatus: 'SUCCEEDED',
    allowedOperations: [],
    reservationHeld: false,
    diagnosticCode: 'TERMINAL',
  });
  const api = transport([
    response(terminal),
    response(
      result({
        dryRun: false,
        outcome: 'CONFIRMED_SUCCEEDED',
        inspection: terminal,
        diagnosticCode: 'TERMINAL',
      }),
    ),
  ]);
  assert.equal((await run(execution(f.args), api)).outcome, 'CONFIRMED_SUCCEEDED');
  assert.equal(JSON.parse(api.requests[1].body).expectedStateRevision, REVISION);
  assert.equal(api.requests[1].headers['idempotency-key'], KEY);
});

for (const missing of ['--revision', '--approval-reference', '--idempotency-key']) {
  test(`execute refuses missing ${missing} before loading credentials or connecting`, async (t) => {
    const f = fixture(t);
    const args = execution(f.args);
    const index = args.indexOf(missing);
    args.splice(index, 2);
    const api = transport([]);
    await assert.rejects(run(args, api), { code: 'EXECUTION_APPROVAL_REQUIRED' });
    assert.equal(api.requests.length, 0);
  });
}

for (const extra of [
  ['--execute', '--dry-run'],
  ['--execute', '--inspect-only'],
  ['--token', 'private-secret'],
  ['--operation', 'CANCEL'],
  ['--revision', 'old'],
  ['--approval-reference', 'case\nsecret'],
  ['--idempotency-key', 'short'],
  ['--dry-run', '--dry-run'],
]) {
  test(`rejects unsafe or contradictory arguments ${JSON.stringify(extra.slice(0, 1))}`, (t) => {
    const f = fixture(t);
    assert.throws(() => parseArgs([...f.args, ...extra]));
  });
}

for (const url of [
  'http://api.example.test/v1',
  'file:///private/token',
  'https://user:password@api.example.test/v1',
  'https://api.example.test/v1?token=private-secret',
  'https://api.example.test/v1#private-secret',
  'http://localhost/v1',
]) {
  test(`rejects an unsafe API URL ${new URL(url).protocol}`, (t) => {
    const f = fixture(t);
    f.args[1] = url;
    assert.throws(() => parseArgs(f.args), { code: 'INVALID_API_URL' });
  });
}

test('a double-slash path cannot change the credential destination origin', (t) => {
  const f = fixture(t);
  f.args[1] = 'https://api.example.test//attacker.invalid/v1';
  const options = parseArgs(f.args);
  assert.equal(options.endpoint.origin, 'https://api.example.test');
});

test('refuses disabled TLS verification before any request', async (t) => {
  const f = fixture(t);
  const api = transport([]);
  await assert.rejects(run(f.args, { ...api, env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' } }), {
    code: 'TLS_VERIFICATION_REQUIRED',
  });
  assert.equal(api.requests.length, 0);
});

test('protected bearer and cookie credentials produce mutually exclusive auth transports', (t) => {
  const bearer = fixture(t);
  assert.deepEqual(readCredentials(bearer.file), { authorization: `Bearer ${TOKEN}` });
  const cookie = fixture(t, {
    cookie: 'access_token=contract-cookie; csrf_token=contract-csrf',
    csrfToken: 'contract-csrf',
  });
  assert.deepEqual(readCredentials(cookie.file), {
    cookie: 'access_token=contract-cookie; csrf_token=contract-csrf',
    'x-csrf-token': 'contract-csrf',
  });
});

test('cookie requests include the CSRF header on the authenticated POST', async (t) => {
  const f = fixture(t, {
    cookie: 'access_token=contract-cookie; csrf_token=contract-csrf',
    csrfToken: 'contract-csrf',
  });
  const api = transport();
  await run(f.args, api);
  assert.equal(api.requests[1].headers['x-csrf-token'], 'contract-csrf');
  assert.equal(api.requests[1].headers.authorization, undefined);
});

for (const credential of [
  { bearerToken: TOKEN, csrfToken: 'extra' },
  { cookie: 'contract-cookie' },
  { bearerToken: `${TOKEN}\r\nInjected: value` },
  { cookie: 'contract-cookie', csrfToken: 'unsafe\nvalue' },
  { bearerToken: '' },
  { token: TOKEN },
  [],
]) {
  test('rejects malformed, mixed or injectable credential fields', (t) => {
    const f = fixture(t, credential);
    assert.throws(() => readCredentials(f.file), { code: 'CREDENTIAL_FILE_INVALID' });
  });
}

test('rejects readable-by-group credentials, symlinks, directories and oversized files', (t) => {
  const f = fixture(t);
  fs.chmodSync(f.file, 0o640);
  assert.throws(() => readCredentials(f.file), { code: 'CREDENTIAL_FILE_UNSAFE' });
  fs.chmodSync(f.file, 0o600);
  const link = path.join(f.directory, 'link.json');
  fs.symlinkSync(f.file, link);
  assert.throws(() => readCredentials(link), { code: 'CREDENTIAL_FILE_UNAVAILABLE' });
  assert.throws(() => readCredentials(f.directory), { code: 'CREDENTIAL_FILE_UNSAFE' });
  fs.writeFileSync(f.file, 'x'.repeat(16_385));
  assert.throws(() => readCredentials(f.file), { code: 'CREDENTIAL_FILE_UNSAFE' });
});

test('stale dry-run and unavailable operations stop before POST', async (t) => {
  const f = fixture(t);
  const stale = transport([response(inspection({ stateRevision: 'b'.repeat(64) }))]);
  await assert.rejects(run([...f.args, '--revision', REVISION], stale), { code: 'STALE_REVISION' });
  assert.equal(stale.requests.length, 1);
  const unavailable = transport([
    response(
      inspection({ allowedOperations: ['QUERY'], state: 'AMBIGUOUS', dispatchStatus: 'UNKNOWN' }),
    ),
  ]);
  await assert.rejects(run(f.args, unavailable), { code: 'OPERATION_UNAVAILABLE' });
  assert.equal(unavailable.requests.length, 1);
});

for (const extra of [
  { refundId: 'other-refund' },
  { paymentConfirmationId: 'other-confirmation' },
  { stateRevision: ['a'.repeat(64)] },
  { state: 'private-error' },
  { amount: { amountMinor: '1.5', currency: 'XTS' } },
  { amount: { amountMinor: '9223372036854775808', currency: 'XTS' } },
  { automaticReservationRelease: true },
  { allowedOperations: ['CANCEL'] },
  { diagnosticCode: 'private-account' },
]) {
  test('rejects malformed or misbound inspection without copying private response fields', async (t) => {
    const f = fixture(t);
    const api = transport([response(inspection(extra))]);
    const io = capture();
    assert.equal(await main(f.args, { ...api, ...io }), 2);
    assert.equal(api.requests.length, 1);
    assert.doesNotMatch(JSON.stringify(io.output()), /private-|other-refund|other-confirmation/u);
  });
}

test('redacts response additions, headers, approval, credentials and command keys from stdout', async (t) => {
  const f = fixture(t);
  const api = transport([
    response(inspection()),
    response(
      result({
        privateRawError: 'private-account',
        request: { approvalReference: 'private-case', idempotencyKey: KEY },
        inspection: inspection({ providerIdempotencyKey: 'private-key' }),
      }),
    ),
  ]);
  const io = capture();
  assert.equal(await main(f.args, { ...api, ...io }), 0);
  assert.equal(io.output().stderr, '');
  assert.doesNotMatch(io.output().stdout, /private-|r32_cli_command|r32-cli-contract-token/u);
});

test('does not read or echo server error bodies', async (t) => {
  const f = fixture(t);
  const api = transport([
    response({ error: 'private-account private-error', credential: TOKEN }, 403),
  ]);
  const io = capture();
  assert.equal(await main(f.args, { ...api, ...io }), 2);
  assert.equal(JSON.parse(io.output().stderr).diagnosticCode, 'HTTP_403');
  assert.doesNotMatch(JSON.stringify(io.output()), /private-|r32-cli-contract-token/u);
});

test('oversized and non-JSON responses fail before a replay', async (t) => {
  const f = fixture(t);
  for (const reply of [
    response({ oversized: 'x'.repeat(65_537) }),
    new Response('private-error', { headers: { 'content-type': 'text/html' } }),
    response(inspection(), 200, { 'content-length': '999999' }),
  ]) {
    const api = transport([reply]);
    await assert.rejects(run(f.args, api), { code: 'INVALID_RESPONSE' });
    assert.equal(api.requests.length, 1);
  }
});

test('a lost execution response is ambiguous and never triggers an automatic retry', async (t) => {
  const f = fixture(t);
  const api = transport([response(inspection()), new Error(`private-account ${TOKEN}`)]);
  const io = capture();
  assert.equal(await main(execution(f.args), { ...api, ...io }), 2);
  assert.equal(api.requests.length, 2);
  assert.deepEqual(JSON.parse(io.output().stderr), {
    contractVersion: 'hsm.money.v1',
    outcome: 'AMBIGUOUS',
    diagnosticCode: 'RECOVERY_RESPONSE_UNKNOWN',
  });
  assert.doesNotMatch(JSON.stringify(io.output()), /private-|r32-cli-contract-token/u);
});

test('malformed or failing execution responses do not claim the command was rejected', async (t) => {
  const f = fixture(t);
  for (const reply of [
    response({ error: 'private-account' }, 503),
    response(result({ dryRun: false, operation: 'QUERY', outcome: 'ACCEPTED' })),
  ]) {
    const api = transport([response(inspection()), reply]);
    await assert.rejects(run(execution(f.args), api), {
      code: 'RECOVERY_RESPONSE_UNKNOWN',
      uncertain: true,
    });
    assert.equal(api.requests.length, 2);
  }
});

test('reports typed policy and external blockers without claiming returned funds', async (t) => {
  const f = fixture(t);
  for (const [outcome, diagnosticCode] of [
    ['POLICY_BLOCKED', 'MONEY_REFUND_POLICY_UNAVAILABLE'],
    ['EXTERNAL_BLOCKED', 'MONEY_REFUND_ADAPTER_UNAVAILABLE'],
  ]) {
    const api = transport([
      response(inspection()),
      response(result({ dryRun: false, outcome, diagnosticCode })),
    ]);
    const io = capture();
    assert.equal(await main(execution(f.args), { ...api, ...io }), 2);
    assert.equal(JSON.parse(io.output().stdout).outcome, outcome);
  }
});

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test('real HTTP transport reaches the authenticated endpoint with dry-run default', async (t) => {
  const f = fixture(t);
  const seen = [];
  const base = await listen(t, async (request, res) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(request.method === 'GET' ? inspection() : result()));
  });
  f.args[1] = `${base}/v1`;
  assert.equal((await run(f.args)).outcome, 'DRY_RUN');
  assert.deepEqual(
    seen.map((item) => item.method),
    ['GET', 'POST'],
  );
  assert.equal(seen[1].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(JSON.parse(seen[1].body).dryRun, true);
});

test('a real cross-origin redirect never forwards credentials to its destination', async (t) => {
  const f = fixture(t);
  let leakedRequests = 0;
  const destination = await listen(t, (_request, res) => {
    leakedRequests += 1;
    res.end('unexpected');
  });
  const origin = await listen(t, (_request, res) => {
    res.writeHead(307, { location: `${destination}/capture` });
    res.end();
  });
  f.args[1] = `${origin}/v1`;
  await assert.rejects(run(f.args), { code: 'INSPECTION_UNAVAILABLE' });
  assert.equal(leakedRequests, 0);
});

test('help needs no credentials and refuses credential-bearing extra arguments', async () => {
  assert.match((await run(['--help'])).help, /Default: audited dry-run/u);
  assert.throws(() => parseArgs(['--help', '--token', 'private-token']));
});
