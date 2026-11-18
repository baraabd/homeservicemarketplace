/* eslint-disable @typescript-eslint/no-require-imports -- The diagnostic is an operator CJS entry point. */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, PrismaTx } from '@homeservicemarketplace/database';
import { createIsolatedDatabase, type IsolatedDatabase } from '../support/isolated-database';

interface DiagnosticInput {
  email: string;
  requestId: string;
  databaseUrl: string;
  targetFingerprint: string;
}

interface DiagnosticAccount {
  found: boolean;
  status?: string;
  active?: boolean;
  deleted?: boolean;
  emailVerified?: boolean;
  passwordConfigured?: boolean;
  temporarilyLocked?: boolean;
  lockedUntil?: string | null;
  failedLoginCount?: number;
  activeRoleDefinitions?: string[];
}

interface DiagnosticAudit {
  type: string;
  at: string;
  reason: string;
  associatedWithAccount: boolean;
  matchesInspectedAccount: boolean | null;
}

interface DiagnosticReport {
  readOnly: boolean;
  credentialsChecked: boolean;
  account: DiagnosticAccount | null;
  requestAudit: DiagnosticAudit[];
}

const { readInput, inspectAuthState, run } =
  require('../../../../scripts/diagnostics/auth-state.cjs') as {
    readInput(env: NodeJS.ProcessEnv): DiagnosticInput;
    inspectAuthState(client: unknown, input: DiagnosticInput): Promise<DiagnosticReport>;
    run(options: {
      env: NodeJS.ProcessEnv;
      argv: string[];
      clientFactory: () => unknown;
    }): Promise<{ exitCode: number; output: string }>;
  };

const suite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(60_000);

suite('read-only authentication diagnostic (isolated real PostgreSQL)', () => {
  let isolated: IsolatedDatabase | undefined;
  let prisma: PrismaClient;
  let databaseUrl: string;
  let databaseClock: Date;
  const roleIds = new Map<string, string>();
  const secretHash = randomUUID();
  const secretToken = randomUUID();
  const newEmail = () => `auth-state-${randomUUID()}@example.test`;
  const newRequestId = () => `auth-state-${randomUUID()}`;

  beforeAll(async () => {
    // No shared account or role is changed. The helper creates, migrates and
    // later drops only its uniquely generated database, never the configured DB.
    const target = new URL(process.env.DATABASE_URL!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
      throw new Error('Authentication diagnostic integration requires local disposable services.');
    isolated = await createIsolatedDatabase('auth_state');
    prisma = isolated.prisma;
    const [identity] = await prisma.$queryRaw<Array<{ name: string; now: Date }>>`
      SELECT current_database() AS name, CURRENT_TIMESTAMP AS now
    `;
    target.pathname = `/${identity.name}`;
    target.searchParams.set('schema', 'public');
    databaseUrl = target.toString();
    databaseClock = identity.now;
    for (const name of ['customer', 'provider', 'admin']) {
      const role = await prisma.role.create({ data: { name } });
      roleIds.set(name, role.id);
    }
  });

  afterAll(async () => {
    await isolated?.dispose();
  });

  function input(email = '', requestId = '') {
    return readInput({
      DATABASE_URL: databaseUrl,
      HSM_AUTH_DIAGNOSTIC_EMAIL: email,
      HSM_AUTH_DIAGNOSTIC_REQUEST_ID: requestId,
    });
  }

  async function account(overrides: Partial<Prisma.UserCreateInput> = {}, roles = ['customer']) {
    return prisma.user.create({
      data: {
        email: newEmail(),
        firstName: 'Synthetic',
        lastName: 'Diagnostic',
        status: 'ACTIVE',
        emailVerifiedAt: databaseClock,
        passwordHash: secretHash,
        ...overrides,
        userRoles: { create: roles.map((name) => ({ roleId: roleIds.get(name)! })) },
      },
    });
  }

  it('distinguishes an absent normalized email without exposing a known neighboring account', async () => {
    const existing = await account();
    const absent = await inspectAuthState(prisma, input(`  ${newEmail().toUpperCase()}  `));
    expect(absent.account).toEqual({ found: false });
    expect(JSON.stringify(absent)).not.toContain(existing.email);
    expect(JSON.stringify(absent)).not.toContain(existing.id);
    const known = await inspectAuthState(prisma, input(`  ${existing.email.toUpperCase()}  `));
    expect(known.account).toMatchObject({ found: true, active: true, emailVerified: true });
  });

  it.each([
    [
      'unverified',
      { status: 'PENDING_VERIFICATION', emailVerifiedAt: null },
      { status: 'PENDING_VERIFICATION', emailVerified: false },
    ],
    [
      'deleted',
      { status: 'DELETED', deletedAt: new Date(), isActive: false },
      { status: 'DELETED', deleted: true, active: false },
    ],
    ['inactive', { isActive: false }, { status: 'ACTIVE', active: false }],
    ['suspended', { status: 'SUSPENDED' }, { status: 'SUSPENDED' }],
    ['missing password', { passwordHash: null }, { passwordConfigured: false }],
    ['empty password', { passwordHash: '' }, { passwordConfigured: false }],
  ] as const)('reports %s standing without repairing it', async (_label, changes, expected) => {
    const user = await account(changes);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const report = await inspectAuthState(prisma, input(user.email));
    expect(report.account).toMatchObject({ found: true, ...expected });
    expect(report.credentialsChecked).toBe(false);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(before);
  });

  it('uses the database clock to distinguish current lockout from an expired lock', async () => {
    const future = new Date(databaseClock.getTime() + 60 * 60_000);
    const past = new Date(databaseClock.getTime() - 60 * 60_000);
    const locked = await account({ lockedUntil: future, failedLoginCount: 5 });
    const expired = await account({ lockedUntil: past, failedLoginCount: 5 });
    expect((await inspectAuthState(prisma, input(locked.email))).account).toMatchObject({
      temporarilyLocked: true,
      lockedUntil: future.toISOString(),
      failedLoginCount: 5,
    });
    expect((await inspectAuthState(prisma, input(expired.email))).account).toMatchObject({
      temporarilyLocked: false,
      lockedUntil: past.toISOString(),
      failedLoginCount: 5,
    });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: expired.id } })).failedLoginCount,
    ).toBe(5);
  });

  it('returns all active known role definitions without claims or sensitive account fields', async () => {
    const user = await account({}, ['provider', 'admin', 'customer']);
    const report = await inspectAuthState(prisma, input(user.email));
    expect(report.account?.activeRoleDefinitions).toEqual(['admin', 'customer', 'provider']);
    const output = JSON.stringify(report);
    for (const privateValue of [user.email, user.id, secretHash, databaseUrl])
      expect(output).not.toContain(privateValue);
    expect(report).toMatchObject({ readOnly: true, credentialsChecked: false });
  });

  it('excludes a deleted role definition without changing the stored membership', async () => {
    const adminRoleId = roleIds.get('admin')!;
    const user = await account({}, ['customer', 'admin']);
    await prisma.role.update({ where: { id: adminRoleId }, data: { deletedAt: databaseClock } });
    try {
      const report = await inspectAuthState(prisma, input(user.email));
      expect(report.account?.activeRoleDefinitions).toEqual(['customer']);
      expect(await prisma.userRole.count({ where: { userId: user.id } })).toBe(2);
    } finally {
      // This role belongs only to this uniquely generated database.
      await prisma.role.update({ where: { id: adminRoleId }, data: { deletedAt: null } });
    }
  });

  it('treats SQL-shaped email input as one value and cannot read other accounts', async () => {
    const user = await account();
    const report = await inspectAuthState(prisma, input("x'/**/OR/**/1=1--@example.test"));
    expect(report.account).toEqual({ found: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(
      user.email,
    );
  });

  it('bounds audit results by request, type, age and count and discards arbitrary metadata', async () => {
    const user = await account();
    const requestId = newRequestId();
    const now = new Date();
    await prisma.auditEvent.createMany({
      data: [
        ...Array.from({ length: 12 }, (_, index) => ({
          requestId,
          userId: user.id,
          type: index === 0 ? ('LOGIN_SUCCESS' as const) : ('LOGIN_FAILED' as const),
          createdAt: new Date(now.getTime() - (index + 1) * 1000),
          metadata: {
            reason: index === 0 ? 'otp_challenge_issued' : 'private-reason',
            email: user.email,
            passwordHash: secretHash,
            accessToken: secretToken,
            databaseUrl,
          },
          ipAddress: '192.0.2.9',
          userAgent: 'private-user-agent',
        })),
        {
          requestId,
          userId: user.id,
          type: 'LOGIN_SUCCESS',
          createdAt: new Date(now.getTime() - 25 * 60 * 60_000),
          metadata: { reason: 'otp_challenge_issued' },
        },
        {
          requestId,
          userId: user.id,
          type: 'PASSWORD_RESET_COMPLETED',
          createdAt: now,
          metadata: {},
        },
        {
          requestId: newRequestId(),
          userId: user.id,
          type: 'LOGIN_LOCKED',
          createdAt: now,
          metadata: {},
        },
      ],
    });
    const report = await inspectAuthState(prisma, input(user.email, requestId));
    expect(report.requestAudit).toHaveLength(10);
    expect(report.requestAudit[0].type).toBe('LOGIN_SUCCESS');
    expect(report.requestAudit.slice(1).every((event) => event.type === 'LOGIN_FAILED')).toBe(true);
    expect(report.requestAudit[0].at).toBe(new Date(now.getTime() - 1000).toISOString());
    expect(report.requestAudit[9].at).toBe(new Date(now.getTime() - 10_000).toISOString());
    expect(report.requestAudit[0].reason).toBe('otp_challenge_issued');
    expect(report.requestAudit.slice(1).every((event) => event.reason === 'not_recorded')).toBe(
      true,
    );
    expect(report.requestAudit.every((event) => event.matchesInspectedAccount === true)).toBe(true);
    for (const privateValue of [
      user.id,
      user.email,
      requestId,
      secretHash,
      secretToken,
      databaseUrl,
      '192.0.2.9',
      'private-user-agent',
      'private-reason',
    ])
      expect(JSON.stringify(report)).not.toContain(privateValue);
  });

  it('separates same-account, different-account and unknown-user request correlation', async () => {
    const known = await account();
    const other = await account();
    const requestId = newRequestId();
    await prisma.auditEvent.createMany({
      data: [
        {
          requestId,
          userId: known.id,
          type: 'LOGIN_SUCCESS',
          metadata: { reason: 'otp_challenge_issued' },
        },
        { requestId, userId: other.id, type: 'LOGIN_LOCKED', metadata: {} },
        { requestId, userId: null, type: 'LOGIN_FAILED', metadata: { reason: 'unknown_user' } },
      ],
    });
    const report = await inspectAuthState(prisma, input(known.email, requestId));
    expect(
      Object.fromEntries(
        report.requestAudit.map((event) => [event.type, event.matchesInspectedAccount]),
      ),
    ).toEqual({ LOGIN_SUCCESS: true, LOGIN_LOCKED: false, LOGIN_FAILED: null });
    const requestOnly = await inspectAuthState(prisma, input('', requestId));
    expect(requestOnly.account).toBeNull();
    expect(requestOnly.requestAudit.every((event) => event.matchesInspectedAccount === null)).toBe(
      true,
    );
  });

  it('PostgreSQL rejects an injected UPDATE after the diagnostic marks its transaction read-only', async () => {
    const user = await account();
    const client = {
      $transaction: (
        callback: (tx: unknown) => Promise<unknown>,
        options: { isolationLevel: 'RepeatableRead'; maxWait: number; timeout: number },
      ) =>
        prisma.$transaction(
          async (tx) =>
            callback({
              $executeRaw: tx.$executeRaw.bind(tx),
              $queryRaw: async () => {
                await tx.$executeRaw`UPDATE "User" SET "failedLoginCount" = 999 WHERE id = ${user.id}`;
                throw new Error('A write must never succeed inside a diagnostic transaction.');
              },
            }),
          options,
        ),
    };
    await expect(inspectAuthState(client, input(user.email))).rejects.toMatchObject({
      code: 'P2010',
      meta: { code: '25006' },
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(
      0,
    );
  });

  it('PostgreSQL enforces the statement timeout for a stalled diagnostic read', async () => {
    const user = await account();
    const client = {
      $transaction: (
        callback: (tx: unknown) => Promise<unknown>,
        options: { isolationLevel: 'RepeatableRead'; maxWait: number; timeout: number },
      ) =>
        prisma.$transaction(
          async (tx) =>
            callback({
              $executeRaw: tx.$executeRaw.bind(tx),
              $queryRaw: () => tx.$queryRaw`SELECT pg_sleep(4)`,
            }),
          options,
        ),
    };
    await expect(inspectAuthState(client, input(user.email))).rejects.toMatchObject({
      code: 'P2010',
      meta: { code: '57014' },
    });
  });

  it('the CLI wrapper disconnects after a successful real read and after a driver error', async () => {
    const user = await account();
    const diagnosticEnv = { DATABASE_URL: databaseUrl, HSM_AUTH_DIAGNOSTIC_EMAIL: user.email };
    const { PrismaClient } =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    const diagnosticClient = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
      log: [],
    });
    let disconnections = 0;
    const disconnect = async () => {
      await diagnosticClient.$disconnect();
      disconnections += 1;
    };
    try {
      const success = await run({
        env: diagnosticEnv,
        argv: [],
        clientFactory: () => ({
          $transaction: diagnosticClient.$transaction.bind(diagnosticClient),
          $disconnect: disconnect,
        }),
      });
      expect(success.exitCode).toBe(0);
      expect(disconnections).toBe(1);
      const failing = {
        $transaction: (
          callback: (tx: unknown) => Promise<unknown>,
          options: { isolationLevel: 'RepeatableRead'; maxWait: number; timeout: number },
        ) =>
          diagnosticClient.$transaction(
            async (tx: PrismaTx) =>
              callback({
                $executeRaw: tx.$executeRaw.bind(tx),
                $queryRaw: () => tx.$queryRaw`SELECT 1 / 0`,
              }),
            options,
          ),
        $disconnect: disconnect,
      };
      const failure = await run({ env: diagnosticEnv, argv: [], clientFactory: () => failing });
      expect(failure.exitCode).toBe(1);
      expect(JSON.parse(failure.output)).toEqual({
        error: 'AUTH_DIAGNOSTIC_READ_FAILED',
        credentialsChecked: false,
      });
      expect(disconnections).toBe(2);
    } finally {
      await diagnosticClient.$disconnect();
    }
  });
});
