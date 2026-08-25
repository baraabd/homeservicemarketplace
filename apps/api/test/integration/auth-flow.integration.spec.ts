/* eslint-disable @typescript-eslint/no-require-imports */
export {}; // module marker — see migration-bootstrap.spec.ts.
// Full register → verify → login → refresh → rotate → replay → logout-all
// loop against a real Postgres. Gated by RUN_DB_INTEGRATION=1 (same pattern
// as migration-bootstrap.spec.ts) so the default `pnpm test` stays hermetic.
//
// Setup/teardown contract:
//   - beforeAll: Prisma connect, seed the baseline roles/permissions via the
//     shared seed() function.
//   - afterEach: delete the accounts this suite registered (scoped by its own
//     email domain, in FK order); keep seeded roles/perms.
//   - afterAll: $disconnect.
// This avoids transaction-based isolation (tests issue their own
// transactions via the service layer, which would conflict with a test-
// wrapping transaction).

import { fixtureEmailDomain, withAdvisoryLock } from '../support/db-isolation';

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(60_000);

d('IAM end-to-end flow (real Postgres)', () => {
  // This suite's fixture namespace. Accounts under this domain belong to this
  // spec and to nothing else, which is what makes the scoped cleanup below
  // safe to run while other suites are mid-flight.
  const EMAIL_DOMAIN = fixtureEmailDomain('auth-flow');
  const addr = (local: string): string => `${local}@${EMAIL_DOMAIN}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let services: any;

  // Remove only the accounts THIS suite created.
  //
  // This used to be a table-wide TRUNCATE of the whole IAM graph. That is a
  // correct reset only while nothing else is running: under parallel workers
  // it deleted the users password-reset and sprint02-constraints were still
  // asserting on, and those suites failed for a defect that was never theirs.
  //
  // Every account here is registered under this suite's own email domain, so
  // ownership is unambiguous and cleanup is a scoped delete. Children go
  // first — the IAM foreign keys are RESTRICT, not CASCADE.
  async function truncateUserData() {
    const mine = await prisma.user.findMany({
      where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
      select: { id: true },
    });
    if (mine.length === 0) return;
    const userId = { in: mine.map((u: { id: string }) => u.id) };

    await prisma.auditEvent.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.verificationToken.deleteMany({ where: { userId } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }

  beforeAll(async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    // Serialised against the other seeders and against the idempotency spec:
    // seed() upserts a fixed set of shared rows, and two concurrent upserts of
    // the same row race. The hold is only as long as the seed itself.
    await withAdvisoryLock('seed', 'exclusive', () => db.seed());

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
    const registered = await signUp(addr('integration'));
    expect(registered.roles).toContain('customer');
    expect(registered.issued.refresh.raw).toBeDefined();

    const loggedIn = await signIn(addr('integration'));
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
    await signUp(addr('replay'));
    const loggedIn = await signIn(addr('replay'));
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
    await signUp(addr('reset'));
    // Two more "device" sessions on top of the one signUp issued.
    await signIn(addr('reset'));
    await signIn(addr('reset'));

    const user = await services.users.findByEmail(addr('reset'));
    expect(await services.sessionsRepo.listActiveByUser(user!.id)).not.toHaveLength(0);

    services.mail.clear();
    await services.auth.forgotPassword(addr('reset'), ctx);
    await services.auth.resetPassword(
      resetTokenFromMail(addr('reset')),
      'a-completely-new-passphrase',
      ctx,
    );

    const active = await services.sessionsRepo.listActiveByUser(user!.id);
    expect(active).toHaveLength(0);
  });

  it('anti-enumeration: forgot-password on an unknown email is silent (no DB row, no mail)', async () => {
    services.mail.clear();
    await services.auth.forgotPassword(addr('ghost'), ctx);
    expect(services.mail.outbox.length).toBe(0);
    // No verification-token row created.
    //
    // Scoped to the ghost address on purpose. A bare count() is a global read:
    // it saw the tokens password-reset had legitimately created and failed a
    // test about an account that does not exist. Counting the rows that WOULD
    // belong to this email is both parallel-safe and a sharper statement of
    // the property under test.
    const rows = await prisma.verificationToken.count({
      where: { user: { email: addr('ghost') } },
    });
    expect(rows).toBe(0);
  });
});
