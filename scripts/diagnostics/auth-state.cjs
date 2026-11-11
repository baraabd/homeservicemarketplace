#!/usr/bin/env node
'use strict';

// Operator-only, read-only inspection of the SAME database used by the API.
// This is deliberately not an HTTP route, password checker, or account repair.
const { createHash } = require('node:crypto');
const path = require('node:path');

const HELP = `Read-only authentication diagnostics. No login attempts or account changes.

Set HSM_AUTH_DIAGNOSTIC_EMAIL and/or HSM_AUTH_DIAGNOSTIC_REQUEST_ID, then run:
  node --env-file=.env scripts/diagnostics/auth-state.cjs

DATABASE_URL must target the affected API's database. Existing process variables
take precedence over .env. In a configured server environment omit --env-file.
Build the database package first: pnpm --filter @homeservicemarketplace/database build

The JSON report excludes emails, user IDs, password hashes, tokens, IP addresses,
connection strings and arbitrary audit metadata. A matching request is inspected
only within the last 24 hours. An empty audit result does not prove no request ran.
Credentials are never tested; normal login still requires the real password and OTP.
`;

class DiagnosticError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function readInput(env, argv = []) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  if (argv.length !== 0) throw new DiagnosticError('INVALID_ARGUMENTS');
  const email = (env.HSM_AUTH_DIAGNOSTIC_EMAIL ?? '').trim().toLowerCase();
  const requestId = (env.HSM_AUTH_DIAGNOSTIC_REQUEST_ID ?? '').trim();
  if (!email && !requestId) throw new DiagnosticError('ACCOUNT_OR_REQUEST_REQUIRED');
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)))
    throw new DiagnosticError('INVALID_EMAIL');
  if (requestId && !/^[A-Za-z0-9._-]{1,128}$/u.test(requestId))
    throw new DiagnosticError('INVALID_REQUEST_ID');

  let target;
  try {
    target = new URL(env.DATABASE_URL);
  } catch {
    throw new DiagnosticError('DATABASE_URL_REQUIRED');
  }
  if (!['postgresql:', 'postgres:'].includes(target.protocol) || !target.hostname)
    throw new DiagnosticError('INVALID_DATABASE_URL');
  // Allows two operator reports to be compared without printing database hosts,
  // usernames, passwords, or URL parameters. It is not proof of API routing.
  const targetFingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        target.hostname,
        target.port || '5432',
        target.pathname,
        target.searchParams.get('schema') || 'public',
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  return { email, requestId, databaseUrl: env.DATABASE_URL, targetFingerprint };
}

function accountProjection(row) {
  if (!row) return { found: false };
  return {
    found: true,
    status: ['ACTIVE', 'PENDING_VERIFICATION', 'LOCKED', 'SUSPENDED', 'DELETED'].includes(
      row.status,
    )
      ? row.status
      : 'OTHER',
    active: row.active === true,
    deleted: row.deleted === true,
    emailVerified: row.emailVerified === true,
    passwordConfigured: row.passwordConfigured === true,
    temporarilyLocked: row.temporarilyLocked === true,
    lockedUntil: row.lockedUntil ? new Date(row.lockedUntil).toISOString() : null,
    failedLoginCount: Number.isSafeInteger(row.failedLoginCount) ? row.failedLoginCount : null,
    activeRoleDefinitions: Array.isArray(row.roles)
      ? row.roles.filter((role) => ['customer', 'provider', 'admin'].includes(role))
      : [],
  };
}

async function inspectAuthState(client, input) {
  return client.$transaction(
    async (tx) => {
      // PostgreSQL enforces this for every subsequent statement, even when the
      // operator's connection normally has write access. Do not move below reads.
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '3000ms'`;
      let account = null;
      if (input.email) {
        const rows = await tx.$queryRaw`
          SELECT u.status::text AS status, u."isActive" AS active,
            (u."deletedAt" IS NOT NULL) AS deleted,
            (u."emailVerifiedAt" IS NOT NULL) AS "emailVerified",
            (COALESCE(length(u."passwordHash"), 0) > 0) AS "passwordConfigured",
            (u."lockedUntil" IS NOT NULL AND u."lockedUntil" > CURRENT_TIMESTAMP) AS "temporarilyLocked",
            u."lockedUntil", u."failedLoginCount",
            ARRAY(
              SELECT r.name FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
              WHERE ur."userId" = u.id AND r."deletedAt" IS NULL
                AND r.name IN ('customer', 'provider', 'admin')
              ORDER BY r.name
            ) AS roles
          FROM "User" u WHERE u.email = ${input.email} LIMIT 1
        `;
        account = accountProjection(rows[0]);
      }
      let requestAudit = [];
      if (input.requestId) {
        const rows = await tx.$queryRaw`
          SELECT a.type::text AS type, a."createdAt",
            CASE WHEN metadata->>'reason' IN ('unknown_user', 'otp_challenge_issued')
              THEN metadata->>'reason' ELSE 'not_recorded' END AS reason,
            (a."userId" IS NOT NULL) AS "associatedWithAccount",
            CASE WHEN ${input.email} = '' OR a."userId" IS NULL THEN NULL
              ELSE EXISTS (SELECT 1 FROM "User" u
                WHERE u.id = a."userId" AND u.email = ${input.email})
              END AS "matchesInspectedAccount"
          FROM "AuditEvent" a
          WHERE a."requestId" = ${input.requestId}
            AND a."createdAt" >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
            AND a.type IN ('LOGIN_FAILED', 'LOGIN_LOCKED', 'LOGIN_SUCCESS')
          ORDER BY a."createdAt" DESC LIMIT 10
        `;
        requestAudit = rows.map((row) => ({
          type: ['LOGIN_FAILED', 'LOGIN_LOCKED', 'LOGIN_SUCCESS'].includes(row.type)
            ? row.type
            : 'OTHER',
          at: new Date(row.createdAt).toISOString(),
          reason: ['unknown_user', 'otp_challenge_issued'].includes(row.reason)
            ? row.reason
            : 'not_recorded',
          associatedWithAccount: row.associatedWithAccount === true,
          matchesInspectedAccount:
            typeof row.matchesInspectedAccount === 'boolean' ? row.matchesInspectedAccount : null,
        }));
      }
      return {
        schemaVersion: 1,
        readOnly: true,
        credentialsChecked: false,
        databaseTargetFingerprint: input.targetFingerprint,
        account,
        requestAudit,
      };
    },
    { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 5000 },
  );
}

function createClient(databaseUrl) {
  // Import the package's public barrel, never its generated client directly.
  const { PrismaClient } = require(path.resolve(__dirname, '../../packages/database/dist'));
  return new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
}

async function run({
  env = process.env,
  argv = process.argv.slice(2),
  clientFactory = createClient,
} = {}) {
  let client;
  try {
    const input = readInput(env, argv);
    if (input.help) return { exitCode: 0, output: HELP };
    client = clientFactory(input.databaseUrl);
    const report = await inspectAuthState(client, input);
    return { exitCode: 0, output: JSON.stringify(report, null, 2) + '\n' };
  } catch (error) {
    // Driver messages can contain DSNs, SQL parameters and internal paths.
    const code = error instanceof DiagnosticError ? error.code : 'AUTH_DIAGNOSTIC_READ_FAILED';
    return {
      exitCode: 1,
      output: JSON.stringify({ error: code, credentialsChecked: false }) + '\n',
    };
  } finally {
    if (client) await client.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  void run().then(({ exitCode, output }) => {
    (exitCode === 0 ? process.stdout : process.stderr).write(output);
    process.exitCode = exitCode;
  });
}

module.exports = { readInput, inspectAuthState, accountProjection, run };
