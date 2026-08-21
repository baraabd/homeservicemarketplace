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
      // PascalCase and DOUBLE-QUOTED. Migration
      // 20260501003603_rename_tables_to_pascal_case renamed every table, and
      // unquoted identifiers are folded to lower case by PostgreSQL, so
      // `TRUNCATE TABLE User` would look for a table called "user". This
      // statement had been failing since that rename — invisibly, because the
      // RUN_DB_INTEGRATION gate skips this spec unless CI turns it on.
      `TRUNCATE TABLE "AuditEvent", "Session", "VerificationToken", "UserRole", "User" RESTART IDENTITY CASCADE`,
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
    const { OtpService } = require('../../src/modules/iam/authentication/services/otp.service');
    const { SecurityEventsBus } = require('../../src/shared/security-events/security-events.bus');
    // Typed via `typeof import(...)`, which erases at runtime. Without it the
    // required class is `any` and a constructor change silently shifts these
    // positional arguments instead of failing typecheck.
    const { AuthenticationService } =
      require('../../src/modules/iam/authentication/services/authentication.service') as {
        AuthenticationService: typeof import('../../src/modules/iam/authentication/services/authentication.service').AuthenticationService;
      };
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
          // Exercise the REAL production path: registration issues an OTP
          // challenge and the account is only activated once the emailed code
          // is verified. Omitting this key left it undefined (falsy), so
          // register() took the dev auto-verify shortcut and sent no mail at
          // all — which is why these tests could not find their token.
          AUTH_REQUIRE_EMAIL_VERIFICATION: true,
          // No timing floor in tests; the anti-enumeration padding is covered
          // by the unit suite.
          AUTH_ANTI_ENUM_DELAY_MS: 0,
        };
        return v[k];
      },
      get isProduction() {
        return false;
      },
      // Structural double: only the members these services actually read. The
      // cast is needed now that the AuthenticationService constructor is
      // type-checked (see the `typeof import(...)` require below) — before
      // that it was `any` and nothing verified this shape at all.
    } as unknown as import('../../src/config/app-config.service').AppConfigService;

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
    const otp = new OtpService(verifRepo, config);
    const mail = new InMemoryMailAdapter();
    // Real bus with no subscribers: publishing is fire-and-forget, and the
    // realtime gateway is not part of this graph.
    const securityEvents = new SecurityEventsBus();

    const auth = new AuthenticationService(
      users,
      roles,
      passwords,
      verification,
      otp,
      sessionSvc,
      attempts,
      tx,
      audit,
      config,
      securityEvents,
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

  const PASSWORD = 'a-reasonable-passphrase';

  // Pull the six-digit OTP the service just emailed. The code is never
  // persisted in plaintext, so the outbox is the only place to read it — which
  // is exactly how a real client gets it.
  function otpFromMail(email: string): string {
    const msg = services.mail.lastSentTo(email);
    expect(msg).toBeDefined();
    const code = msg!.text.match(/\b(\d{6})\b/)?.[1];
    expect(code).toBeDefined();
    return code!;
  }

  function resetTokenFromMail(email: string): string {
    const msg = services.mail.lastSentTo(email);
    expect(msg).toBeDefined();
    const token = msg!.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeDefined();
    return token!;
  }

  // register → emailed REGISTRATION_OTP → verifyOtp. Since the email-OTP
  // phase, verifyOtp is what activates the account AND issues the first
  // session; register() alone returns only an opaque challenge.
  async function signUp(email: string) {
    const challenge = await services.auth.register(
      { email, password: PASSWORD, firstName: 'Int', lastName: 'Est' },
      ctx,
    );
    return services.auth.verifyOtp(challenge.challengeId, otpFromMail(email), ctx);
  }

  // login → emailed LOGIN_OTP → verifyOtp. login() no longer returns a
  // session; it returns a challenge.
  async function signIn(email: string) {
    const challenge = await services.auth.login({ email, password: PASSWORD }, ctx);
    return services.auth.verifyOtp(challenge.challengeId, otpFromMail(email), ctx);
  }

  it('register → OTP verify → sign in → refresh round-trip succeeds', async () => {
    const registered = await signUp('integration@example.com');
    expect(registered.roles).toContain('customer');
    expect(registered.issued.refresh.raw).toBeDefined();

    const loggedIn = await signIn('integration@example.com');
    expect(loggedIn.user.id).toBe(registered.user.id);

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
    await signUp('replay@example.com');
    const loggedIn = await signIn('replay@example.com');
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
    await signUp('reset@example.com');
    // Two more "device" sessions on top of the one signUp issued.
    await signIn('reset@example.com');
    await signIn('reset@example.com');

    const user = await services.users.findByEmail('reset@example.com');
    expect(await services.sessionsRepo.listActiveByUser(user!.id)).not.toHaveLength(0);

    services.mail.clear();
    await services.auth.forgotPassword('reset@example.com', ctx);
    await services.auth.resetPassword(
      resetTokenFromMail('reset@example.com'),
      'a-completely-new-passphrase',
      ctx,
    );

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
