/* eslint-disable @typescript-eslint/no-require-imports */
export {}; // module marker — see migration-bootstrap.spec.ts.
// Full register → verify → login → refresh → rotate → replay → logout-all
// loop against a real Postgres. Gated by RUN_DB_INTEGRATION=1 (same pattern
// as migration-bootstrap.spec.ts) so the default `pnpm test` stays hermetic.
//
// Setup/teardown contract:
//   - beforeAll: Prisma connect, truncate every IAM table in the correct
//     order (respecting FKs), seed the baseline roles/permissions via the
//     shared seed() function.
//   - afterEach: truncate user-generated IAM rows; keep seeded roles/perms.
//   - afterAll: $disconnect.
// This avoids transaction-based isolation (tests issue their own
// transactions via the service layer, which would conflict with a test-
// wrapping transaction).

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(60_000);

d('IAM end-to-end flow (real Postgres)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let services: any;

  async function truncateUserData() {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE audit_events, sessions, verification_tokens, user_roles, users RESTART IDENTITY CASCADE`,
    );
  }

  beforeAll(async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    await db.seed(); // ensures roles + permissions present

    // Wire the service graph manually — avoids booting the full AppModule
    // (which would require Mongo + Redis). We only need Prisma + IAM.
    const { JwtService } = require('@nestjs/jwt');
    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { UserRepository } = require('../../src/infrastructure/persistence/iam/user.repository');
    const { RoleRepository } = require('../../src/infrastructure/persistence/iam/role.repository');
    const {
      SessionRepository,
    } = require('../../src/infrastructure/persistence/iam/session.repository');
    const {
      VerificationTokenRepository,
    } = require('../../src/infrastructure/persistence/iam/verification-token.repository');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const {
      PasswordService,
    } = require('../../src/modules/iam/authentication/services/password.service');
    const { TokenService } = require('../../src/modules/iam/authentication/services/token.service');
    const {
      SessionService,
    } = require('../../src/modules/iam/authentication/services/session.service');
    const {
      VerificationService,
    } = require('../../src/modules/iam/authentication/services/verification.service');
    const {
      LoginAttemptService,
    } = require('../../src/modules/iam/authentication/services/login-attempt.service');
    const {
      AuthenticationService,
    } = require('../../src/modules/iam/authentication/services/authentication.service');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const { InMemoryMailAdapter } = require('../../src/infrastructure/mail/in-memory-mail.adapter');

    const SECRET = 'integration_secret_at_least_32_chars_123456';
    const config = {
      get: (k: string) => {
        const v: Record<string, unknown> = {
          JWT_ACCESS_SECRET: SECRET,
          JWT_ISSUER: 'hsm-api',
          JWT_AUDIENCE: 'hsm-clients',
          JWT_ACCESS_TTL_SECONDS: 600,
          JWT_REFRESH_TTL_DAYS: 30,
          EMAIL_VERIFICATION_TTL_HOURS: 24,
          PASSWORD_RESET_TTL_MINUTES: 15,
          AUTH_LOCKOUT_THRESHOLD: 5,
          AUTH_LOCKOUT_MINUTES: 15,
          STARTUP_MAX_RETRIES: 1,
          STARTUP_RETRY_BASE_MS: 1,
          STARTUP_RETRY_CAP_MS: 2,
          DATABASE_CONNECT_TIMEOUT_MS: 5_000,
          FRONTEND_URL: 'http://localhost:5173',
        };
        return v[k];
      },
      get isProduction() {
        return false;
      },
    };

    // PrismaService wants a config; we substitute a compact no-retry client.
    const prismaSvc = { client: prisma, isReady: () => true, ping: async () => true };
    const tx = new TransactionRunner(prismaSvc);
    const users = new UserRepository(prismaSvc);
    const roles = new RoleRepository(prismaSvc);
    const sessionsRepo = new SessionRepository(prismaSvc);
    const verifRepo = new VerificationTokenRepository(prismaSvc);
    const auditRepo = new AuditEventRepository(prismaSvc);

    const passwords = new PasswordService();
    await passwords.onModuleInit();

    const jwt = new JwtService({
      secret: SECRET,
      signOptions: { algorithm: 'HS256', issuer: 'hsm-api', audience: 'hsm-clients' },
      verifyOptions: { algorithms: ['HS256'], issuer: 'hsm-api', audience: 'hsm-clients' },
    });
    const tokens = new TokenService(jwt, config);
    const audit = new AuditService(auditRepo);
    const sessionSvc = new SessionService(sessionsRepo, tokens, tx, audit);
    const verification = new VerificationService(verifRepo, tokens, config);
    const attempts = new LoginAttemptService(prismaSvc, config);
    const mail = new InMemoryMailAdapter();

    const auth = new AuthenticationService(
      users,
      roles,
      passwords,
      verification,
      sessionSvc,
      attempts,
      tx,
      audit,
      config,
      mail,
    );

    services = {
      auth,
      sessionSvc,
      tokens,
      verification,
      mail,
      users,
      sessionsRepo,
      verifRepo,
      PrismaService,
    };
    void PrismaService;
  });

  afterEach(async () => {
    await truncateUserData();
    services.mail.clear();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const ctx = {
    device: { ipAddress: '1.1.1.1', userAgent: 'integration', clientKind: 'WEB' as const },
    requestId: 'req-int',
  };

  it('register → verify → login → refresh round-trip succeeds', async () => {
    await services.auth.register(
      {
        email: 'integration@example.com',
        password: 'a-reasonable-passphrase',
        firstName: 'Int',
        lastName: 'Est',
      },
      ctx,
    );

    // Extract the raw token from the mail outbox (plaintext never persisted).
    const msg = services.mail.lastSentTo('integration@example.com');
    expect(msg).toBeDefined();
    const rawToken = msg!.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    expect(rawToken).toBeDefined();

    await services.auth.verifyEmail(rawToken!, ctx);

    const loggedIn = await services.auth.login(
      { email: 'integration@example.com', password: 'a-reasonable-passphrase' },
      ctx,
    );
    expect(loggedIn.roles).toContain('customer');
    expect(loggedIn.issued.refresh.raw).toBeDefined();

    const rotated = await services.auth.refresh({
      refreshTokenRaw: loggedIn.issued.refresh.raw,
      device: ctx.device,
      requestId: 'req-rot',
    });
    expect(rotated.userId).toBe(loggedIn.user.id);
    expect(rotated.issued.session.familyId).toBe(loggedIn.issued.session.familyId);
    expect(rotated.issued.refresh.raw).not.toBe(loggedIn.issued.refresh.raw);
  });

  it('refresh replay: presenting the old refresh token after rotation revokes the entire family', async () => {
    await services.auth.register(
      {
        email: 'replay@example.com',
        password: 'a-reasonable-passphrase',
        firstName: 'R',
        lastName: 'E',
      },
      ctx,
    );
    const raw = services.mail
      .lastSentTo('replay@example.com')!
      .text.match(/token=([A-Za-z0-9_-]+)/)![1];
    await services.auth.verifyEmail(raw, ctx);
    const loggedIn = await services.auth.login(
      { email: 'replay@example.com', password: 'a-reasonable-passphrase' },
      ctx,
    );
    const oldRefresh = loggedIn.issued.refresh.raw;

    // Rotate once (legit client).
    const rotated = await services.auth.refresh({
      refreshTokenRaw: oldRefresh,
      device: ctx.device,
      requestId: 'r1',
    });

    // Replay the old refresh token (attacker).
    await expect(
      services.auth.refresh({ refreshTokenRaw: oldRefresh, device: ctx.device, requestId: 'r2' }),
    ).rejects.toThrow();

    // The newly-rotated refresh token should now also be unusable — family revoked.
    await expect(
      services.auth.refresh({
        refreshTokenRaw: rotated.issued.refresh.raw,
        device: ctx.device,
        requestId: 'r3',
      }),
    ).rejects.toThrow();
  });

  it('reset-password revokes every active session for the user', async () => {
    await services.auth.register(
      {
        email: 'reset@example.com',
        password: 'a-reasonable-passphrase',
        firstName: 'R',
        lastName: 'S',
      },
      ctx,
    );
    const verifyToken = services.mail
      .lastSentTo('reset@example.com')!
      .text.match(/token=([A-Za-z0-9_-]+)/)![1];
    await services.auth.verifyEmail(verifyToken, ctx);

    // Two "device" sessions.
    await services.auth.login(
      { email: 'reset@example.com', password: 'a-reasonable-passphrase' },
      ctx,
    );
    await services.auth.login(
      { email: 'reset@example.com', password: 'a-reasonable-passphrase' },
      ctx,
    );

    services.mail.clear();
    await services.auth.forgotPassword('reset@example.com', ctx);
    const resetRaw = services.mail
      .lastSentTo('reset@example.com')!
      .text.match(/token=([A-Za-z0-9_-]+)/)![1];

    await services.auth.resetPassword(resetRaw, 'a-completely-new-passphrase', ctx);

    const user = await services.users.findByEmail('reset@example.com');
    const active = await services.sessionsRepo.listActiveByUser(user!.id);
    expect(active).toHaveLength(0);
  });

  it('anti-enumeration: forgot-password on an unknown email is silent (no DB row, no mail)', async () => {
    services.mail.clear();
    await services.auth.forgotPassword('ghost@example.com', ctx);
    expect(services.mail.outbox.length).toBe(0);
    // No verification-token row created.
    const rows = await prisma.verificationToken.count();
    expect(rows).toBe(0);
  });
});
