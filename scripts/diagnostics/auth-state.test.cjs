'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readInput, accountProjection, inspectAuthState, run } = require('./auth-state.cjs');

const DATABASE_URL =
  'postgresql://fixture:private-password@db.example.test:5432/auth_fixture?schema=public';
const EMAIL = 'operator-fixture@example.test';
const REQUEST_ID = '_operator-request-1';
const NOW = '2026-11-11T00:00:00.000Z';
const env = (overrides = {}) => ({
  DATABASE_URL,
  HSM_AUTH_DIAGNOSTIC_EMAIL: EMAIL,
  ...overrides,
});

function clientFixture({ accountRows = [], auditRows = [], queryError, disconnectError } = {}) {
  const calls = [];
  let disconnected = 0;
  const tx = {
    async $executeRaw(strings, ...values) {
      calls.push({ operation: 'execute', sql: strings.join('$parameter'), values });
      return 0;
    },
    async $queryRaw(strings, ...values) {
      const sql = strings.join('$parameter');
      calls.push({ operation: 'query', sql, values });
      if (queryError) throw queryError;
      return sql.includes('FROM "AuditEvent"') ? auditRows : accountRows;
    },
  };
  const client = {
    async $transaction(callback, options) {
      calls.push({ operation: 'transaction', options });
      return callback(tx);
    },
    async $disconnect() {
      disconnected += 1;
      if (disconnectError) throw disconnectError;
    },
  };
  return { client, calls, disconnected: () => disconnected };
}

function activeRow(overrides = {}) {
  return {
    status: 'ACTIVE',
    active: true,
    deleted: false,
    emailVerified: true,
    passwordConfigured: true,
    temporarilyLocked: false,
    lockedUntil: null,
    failedLoginCount: 0,
    roles: ['admin', 'customer', 'provider'],
    ...overrides,
  };
}

test('email normalization matches login and request IDs retain their case', () => {
  const input = readInput(
    env({
      HSM_AUTH_DIAGNOSTIC_EMAIL: "  O'Hara@Example.Test  ",
      HSM_AUTH_DIAGNOSTIC_REQUEST_ID: '  _Operator.Request-1  ',
    }),
  );
  assert.equal(input.email, "o'hara@example.test");
  assert.equal(input.requestId, '_Operator.Request-1');
});

test('request-only inspection is supported without inventing an account identity', () => {
  const input = readInput(
    env({ HSM_AUTH_DIAGNOSTIC_EMAIL: '', HSM_AUTH_DIAGNOSTIC_REQUEST_ID: REQUEST_ID }),
  );
  assert.equal(input.email, '');
  assert.equal(input.requestId, REQUEST_ID);
});

for (const requestId of ['.request', '_request', '-request', 'A'.repeat(128)]) {
  test(`accepts API-compatible request ID ${requestId.slice(0, 12)}`, () => {
    assert.equal(
      readInput(env({ HSM_AUTH_DIAGNOSTIC_REQUEST_ID: requestId })).requestId,
      requestId,
    );
  });
}

for (const requestId of ['request:1', 'a b', 'a\nb', 'A'.repeat(129), "x';SELECT(1)"]) {
  test(`rejects an unsafe request ID without printing its value (${requestId.length})`, async () => {
    let created = false;
    const result = await run({
      env: env({ HSM_AUTH_DIAGNOSTIC_REQUEST_ID: requestId }),
      argv: [],
      clientFactory: () => {
        created = true;
      },
    });
    assert.deepEqual(JSON.parse(result.output), {
      error: 'INVALID_REQUEST_ID',
      credentialsChecked: false,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(created, false);
  });
}

for (const [changes, expected] of [
  [{ HSM_AUTH_DIAGNOSTIC_EMAIL: '' }, 'ACCOUNT_OR_REQUEST_REQUIRED'],
  [{ HSM_AUTH_DIAGNOSTIC_EMAIL: 'not-an-email' }, 'INVALID_EMAIL'],
  [{ HSM_AUTH_DIAGNOSTIC_EMAIL: 'user name@example.test' }, 'INVALID_EMAIL'],
  [{ HSM_AUTH_DIAGNOSTIC_EMAIL: `${'a'.repeat(250)}@example.test` }, 'INVALID_EMAIL'],
  [{ DATABASE_URL: undefined }, 'DATABASE_URL_REQUIRED'],
  [{ DATABASE_URL: 'https://private-token@db.example.test/private' }, 'INVALID_DATABASE_URL'],
]) {
  test(`input error ${expected} never constructs a database client`, async () => {
    let created = false;
    const result = await run({
      env: env(changes),
      argv: [],
      clientFactory: () => {
        created = true;
      },
    });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(JSON.parse(result.output), { error: expected, credentialsChecked: false });
    assert.equal(created, false);
    assert.ok(!result.output.includes('private-token'));
    assert.ok(!result.output.includes(EMAIL));
  });
}

test('help is usable with no environment or database dependency', async () => {
  const result = await run({
    env: {},
    argv: ['--help'],
    clientFactory: () => {
      throw new Error('must not load');
    },
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /Read-only authentication diagnostics/u);
});

test('arguments are rejected instead of echoing possible command-line secrets', async () => {
  const result = await run({
    env: env(),
    argv: ['--password', 'private-password'],
    clientFactory: () => {
      throw new Error('must not load');
    },
  });
  assert.deepEqual(JSON.parse(result.output), {
    error: 'INVALID_ARGUMENTS',
    credentialsChecked: false,
  });
  assert.ok(!result.output.includes('private-password'));
});

test('database fingerprint ignores credential rotation and unrelated connection options', () => {
  const a = readInput(env()).targetFingerprint;
  const b = readInput(
    env({
      DATABASE_URL:
        'postgres://different:another-secret@db.example.test/auth_fixture?sslmode=require&schema=public&connection_limit=2',
    }),
  ).targetFingerprint;
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{16}$/u);
  for (const target of [
    'postgresql://fixture:private-password@other.example.test/auth_fixture',
    'postgresql://fixture:private-password@db.example.test:5433/auth_fixture',
    'postgresql://fixture:private-password@db.example.test/another_database',
    'postgresql://fixture:private-password@db.example.test/auth_fixture?schema=another_schema',
  ])
    assert.notEqual(readInput(env({ DATABASE_URL: target })).targetFingerprint, a);
});

test('unknown account is distinct from a supplied account with no usable password', async () => {
  const fixture = clientFixture();
  const report = await inspectAuthState(fixture.client, readInput(env()));
  assert.deepEqual(report.account, { found: false });
  assert.deepEqual(report.requestAudit, []);
  assert.equal(report.credentialsChecked, false);
  assert.equal(report.readOnly, true);
  assert.equal(fixture.calls.filter((call) => call.operation === 'query').length, 1);
});

test('account projection keeps independent facts and only active recognized role definitions', () => {
  const projection = accountProjection(
    activeRow({
      status: 'PENDING_VERIFICATION',
      active: false,
      deleted: true,
      emailVerified: false,
      passwordConfigured: false,
      temporarilyLocked: true,
      lockedUntil: NOW,
      failedLoginCount: 5,
      roles: ['admin', 'customer', 'provider', 'private-role-name'],
      email: EMAIL,
      userId: 'private-user-id',
      passwordHash: 'private-hash',
      token: 'private-token',
    }),
  );
  assert.deepEqual(projection, {
    found: true,
    status: 'PENDING_VERIFICATION',
    active: false,
    deleted: true,
    emailVerified: false,
    passwordConfigured: false,
    temporarilyLocked: true,
    lockedUntil: NOW,
    failedLoginCount: 5,
    activeRoleDefinitions: ['admin', 'customer', 'provider'],
  });
});

test('unknown database fields and enum values cannot escape through the report', async () => {
  const privateValues = [
    EMAIL,
    'private-user-id',
    'private-hash',
    'private-token',
    'private-ip',
    'private-role-name',
    DATABASE_URL,
  ];
  const fixture = clientFixture({
    accountRows: [
      activeRow({
        status: 'private-status',
        email: EMAIL,
        userId: privateValues[1],
        passwordHash: privateValues[2],
        roles: ['customer', privateValues[5]],
      }),
    ],
    auditRows: [
      {
        type: 'private-event',
        createdAt: new Date(NOW),
        reason: 'private-reason',
        associatedWithAccount: true,
        matchesInspectedAccount: 'private-value',
        metadata: { email: EMAIL, token: privateValues[3], dsn: DATABASE_URL },
        ipAddress: privateValues[4],
        userId: privateValues[1],
      },
    ],
  });
  const result = await run({
    env: env({ HSM_AUTH_DIAGNOSTIC_REQUEST_ID: REQUEST_ID }),
    argv: [],
    clientFactory: () => fixture.client,
  });
  assert.equal(result.exitCode, 0);
  for (const value of privateValues) assert.ok(!result.output.includes(value));
  const report = JSON.parse(result.output);
  assert.equal(report.account.status, 'OTHER');
  assert.deepEqual(report.account.activeRoleDefinitions, ['customer']);
  assert.deepEqual(report.requestAudit, [
    {
      type: 'OTHER',
      at: NOW,
      reason: 'not_recorded',
      associatedWithAccount: true,
      matchesInspectedAccount: null,
    },
  ]);
  assert.equal(fixture.disconnected(), 1);
});

test('read-only and statement-timeout settings precede every parameterized read', async () => {
  const email = "x'/**/or/**/1=1--@example.test";
  const fixture = clientFixture();
  await inspectAuthState(
    fixture.client,
    readInput(
      env({ HSM_AUTH_DIAGNOSTIC_EMAIL: email, HSM_AUTH_DIAGNOSTIC_REQUEST_ID: REQUEST_ID }),
    ),
  );
  assert.deepEqual(fixture.calls.slice(0, 3), [
    {
      operation: 'transaction',
      options: { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 5000 },
    },
    { operation: 'execute', sql: 'SET TRANSACTION READ ONLY', values: [] },
    { operation: 'execute', sql: "SET LOCAL statement_timeout = '3000ms'", values: [] },
  ]);
  const queries = fixture.calls.filter((call) => call.operation === 'query');
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].values, [email]);
  assert.deepEqual(queries[1].values, [email, email, REQUEST_ID]);
  for (const query of queries) {
    assert.ok(!query.sql.includes(email));
    assert.ok(!query.sql.includes(REQUEST_ID));
    assert.doesNotMatch(query.sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP)\b/iu);
  }
  assert.match(queries[0].sql, /LIMIT 1/u);
  assert.match(queries[1].sql, /INTERVAL '24 hours'/u);
  assert.match(queries[1].sql, /LIMIT 10/u);
});

test('request-only mode performs one audit read and retains unknown-account correlation', async () => {
  const fixture = clientFixture({
    auditRows: [
      {
        type: 'LOGIN_FAILED',
        createdAt: NOW,
        reason: 'unknown_user',
        associatedWithAccount: false,
        matchesInspectedAccount: null,
      },
    ],
  });
  const report = await inspectAuthState(
    fixture.client,
    readInput(env({ HSM_AUTH_DIAGNOSTIC_EMAIL: '', HSM_AUTH_DIAGNOSTIC_REQUEST_ID: REQUEST_ID })),
  );
  assert.equal(report.account, null);
  assert.deepEqual(report.requestAudit, [
    {
      type: 'LOGIN_FAILED',
      at: NOW,
      reason: 'unknown_user',
      associatedWithAccount: false,
      matchesInspectedAccount: null,
    },
  ]);
  assert.equal(fixture.calls.filter((call) => call.operation === 'query').length, 1);
});

for (const matchesInspectedAccount of [true, false, null]) {
  test(`audit correlation preserves ${matchesInspectedAccount} without an account identifier`, async () => {
    const fixture = clientFixture({
      auditRows: [
        {
          type: 'LOGIN_SUCCESS',
          createdAt: NOW,
          reason: 'otp_challenge_issued',
          associatedWithAccount: matchesInspectedAccount !== null,
          matchesInspectedAccount,
        },
      ],
    });
    const report = await inspectAuthState(
      fixture.client,
      readInput(env({ HSM_AUTH_DIAGNOSTIC_REQUEST_ID: REQUEST_ID })),
    );
    assert.equal(report.requestAudit[0].matchesInspectedAccount, matchesInspectedAccount);
    assert.ok(!JSON.stringify(report).includes(EMAIL));
    assert.ok(!JSON.stringify(report).includes(REQUEST_ID));
  });
}

test('query failure is redacted and disconnect still runs exactly once', async () => {
  const privateMessage = `driver error ${DATABASE_URL} ${EMAIL} private-password-hash private-token`;
  const fixture = clientFixture({ queryError: new Error(privateMessage) });
  const result = await run({ env: env(), argv: [], clientFactory: () => fixture.client });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(JSON.parse(result.output), {
    error: 'AUTH_DIAGNOSTIC_READ_FAILED',
    credentialsChecked: false,
  });
  assert.equal(fixture.disconnected(), 1);
});

test('client construction and disconnect failures cannot disclose driver details', async () => {
  const failedConstruction = await run({
    env: env(),
    argv: [],
    clientFactory: () => {
      throw new Error(DATABASE_URL);
    },
  });
  assert.deepEqual(JSON.parse(failedConstruction.output), {
    error: 'AUTH_DIAGNOSTIC_READ_FAILED',
    credentialsChecked: false,
  });
  const fixture = clientFixture({ disconnectError: new Error(DATABASE_URL) });
  const result = await run({ env: env(), argv: [], clientFactory: () => fixture.client });
  assert.equal(result.exitCode, 0);
  assert.ok(!result.output.includes(DATABASE_URL));
  assert.equal(fixture.disconnected(), 1);
});
