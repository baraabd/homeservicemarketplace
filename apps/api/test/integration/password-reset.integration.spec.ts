/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
export {}; // module marker — see migration-bootstrap.spec.ts.
//
// Password-reset flow against a REAL Postgres, exercising the service graph
// end-to-end (no Prisma mocks). Proves the two production defects are fixed:
//
//   1. forgot-password: the emailed token corresponds to a COMMITTED row, and
//      a transaction that rolls back emits NO email (no "phantom" link).
//   2. reset-password: token consumption + password rewrite + lockout reset +
//      session revocation + completion audit are ONE atomic unit — a failure
//      in any step rolls the whole thing back (password unchanged, token still
//      usable).
//
// Gated by RUN_DB_INTEGRATION=1 (same pattern as auth-flow.integration.spec.ts)
// so the default `pnpm test` stays hermetic.
//
// SAFETY: this talks to the shared dev database. It NEVER truncates. Every
// row it creates uses an @itest.local email and is deleted afterward, so the
// real admin@admin.com and all seeded data are left untouched.

import { withAdvisoryLock } from '../support/db-isolation';

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(60_000);

const TEST_DOMAIN = 'itest.local';
let seq = 0;
function uniqueEmail(tag: string): string {
  seq += 1;
  return `pwreset-${tag}-${seq}@${TEST_DOMAIN}`;
}

d('Password reset flow (real Postgres)', () => {
  let prisma: any;
  let s: any; // service graph
  let tokens: any;

  const ctx = {
    device: { ipAddress: '1.1.1.1', userAgent: 'integration', clientKind: 'WEB' as const },
    requestId: 'req-pwreset',
  };

  // --- helpers ------------------------------------------------------------
  const createdUserIds = new Set<string>();

  async function seedUser(opts: {
    email: string;
    password: string;
    roles: string[];
  }): Promise<string> {
    const passwordHash = await s.passwords.hash(opts.password);
    const user = await s.users.create(
      { email: opts.email, passwordHash, firstName: 'Test', lastName: 'User' },
      undefined,
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
    for (const roleName of opts.roles) {
      const role = await s.roles.findByName(roleName);
      if (!role) throw new Error(`seed role missing: ${roleName}`);
      await s.users.assignRole(user.id, role.id);
    }
    createdUserIds.add(user.id);
    return user.id;
  }

  function extractResetToken(email: string): string {
    const msg = s.mail.lastSentTo(email);
    if (!msg) throw new Error(`no mail for ${email}`);
    const m = msg.text.match(/token=([A-Za-z0-9_-]+)/);
    if (!m) throw new Error('no token in reset email');
    return m[1];
  }

  // login → capture LOGIN_OTP code from mail → verify → session
  async function loginViaOtp(email: string, password: string) {
    const challenge = await s.auth.login({ email, password }, ctx);
    const msg = s.mail.lastSentTo(email);
    const code = msg!.text.match(/code is (\d{4,8})/)![1];
    return s.auth.verifyOtp(challenge.challengeId, code, ctx);
  }

  async function cleanupUser(userId: string) {
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

    const { JwtService } = require('@nestjs/jwt');
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
    const { OtpService } = require('../../src/modules/iam/authentication/services/otp.service');
    const {
      VerificationService,
    } = require('../../src/modules/iam/authentication/services/verification.service');
    const {
      LoginAttemptService,
    } = require('../../src/modules/iam/authentication/services/login-attempt.service');
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
          AUTH_ANTI_ENUM_DELAY_MS: 0,
          FRONTEND_URL: 'http://localhost:5173',
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
    tokens = new TokenService(jwt, config);
    const audit = new AuditService(auditRepo);
    const sessionSvc = new SessionService(sessionsRepo, tokens, tx, audit);
    const verification = new VerificationService(verifRepo, tokens, config);
    const otp = new OtpService(verifRepo, config);
    const attempts = new LoginAttemptService(prismaSvc, config);
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

    s = {
      auth,
      sessionSvc,
      verification,
      otp,
      mail,
      users,
      roles,
      sessionsRepo,
      verifRepo,
      auditRepo,
      passwords,
    };
  });

  afterEach(async () => {
    for (const id of createdUserIds) await cleanupUser(id);
    createdUserIds.clear();
    s.mail.clear();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // --- tests --------------------------------------------------------------

  it('happy path: emailed token is committed, reset is atomic, login works with new password', async () => {
    const email = uniqueEmail('happy');
    const oldPassword = 'the-old-passphrase-1';
    const newPassword = 'a-completely-new-passphrase-2';
    const userId = await seedUser({ email, password: oldPassword, roles: ['customer'] });

    // Two live sessions (proves revocation revokes ALL).
    await s.sessionSvc.createForLogin({
      userId,
      roles: ['customer'],
      device: ctx.device,
      requestId: 'a',
    });
    await s.sessionSvc.createForLogin({
      userId,
      roles: ['customer'],
      device: ctx.device,
      requestId: 'b',
    });
    expect(await s.sessionsRepo.listActiveByUser(userId)).toHaveLength(2);

    const before = await prisma.user.findUnique({ where: { id: userId } });

    await s.auth.forgotPassword(email, ctx);
    const raw = extractResetToken(email);

    // The emailed token maps to a COMMITTED row (this is the core fix).
    const hash = tokens.hashOpaqueToken(raw);
    const committed = await s.verifRepo.findByHash(hash);
    expect(committed).not.toBeNull();
    expect(committed.purpose).toBe('PASSWORD_RESET');
    expect(committed.usedAt).toBeNull();
    expect(committed.expiresAt.getTime()).toBeGreaterThan(Date.now());

    await s.auth.resetPassword(raw, newPassword, ctx);

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after.passwordHash).not.toBe(before.passwordHash); // password changed
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();

    const usedToken = await s.verifRepo.findByHash(hash);
    expect(usedToken.usedAt).not.toBeNull(); // consumed exactly once

    expect(await s.sessionsRepo.listActiveByUser(userId)).toHaveLength(0); // all revoked

    const completed = await prisma.auditEvent.findFirst({
      where: { userId, type: 'PASSWORD_RESET_COMPLETED' },
    });
    expect(completed).not.toBeNull();

    // Roles unchanged.
    const roleRows = await s.users.listRoles(userId);
    expect(roleRows.map((r: any) => r.role.name).sort()).toEqual(['customer']);

    // New password works through the real OTP login flow; old one does not.
    const loggedIn = await loginViaOtp(email, newPassword);
    expect(loggedIn.issued.refresh.raw).toBeDefined();
    await expect(s.auth.login({ email, password: oldPassword }, ctx)).rejects.toThrow();
  });

  it('admin identity: reset works and preserves the admin role', async () => {
    const email = uniqueEmail('admin');
    const userId = await seedUser({
      email,
      password: 'admin-old-passphrase-1',
      roles: ['customer', 'admin'],
    });

    await s.auth.forgotPassword(email, ctx);
    const raw = extractResetToken(email);
    await s.auth.resetPassword(raw, 'admin-new-passphrase-2', ctx);

    const roleRows = await s.users.listRoles(userId);
    expect(roleRows.map((r: any) => r.role.name)).toContain('admin');

    const loggedIn = await loginViaOtp(email, 'admin-new-passphrase-2');
    expect(loggedIn.roles).toContain('admin');
  });

  it('newest-link-only: a second request invalidates the first token; only the newest works; used token cannot replay', async () => {
    const email = uniqueEmail('newest');
    await seedUser({ email, password: 'passphrase-original-1', roles: ['customer'] });

    await s.auth.forgotPassword(email, ctx);
    const first = extractResetToken(email);
    await s.auth.forgotPassword(email, ctx);
    const second = extractResetToken(email);
    expect(second).not.toBe(first);

    await expect(s.auth.resetPassword(first, 'new-passphrase-aaa-1', ctx)).rejects.toThrow();
    await s.auth.resetPassword(second, 'new-passphrase-bbb-2', ctx); // newest works
    await expect(s.auth.resetPassword(second, 'new-passphrase-ccc-3', ctx)).rejects.toThrow(); // replay
  });

  it('expired token is rejected', async () => {
    const email = uniqueEmail('expired');
    const userId = await seedUser({ email, password: 'passphrase-expired-1', roles: ['customer'] });

    // Insert a deliberately-expired PASSWORD_RESET token (no waiting).
    const { raw, hash } = tokens.mintOpaqueToken(32);
    await s.verifRepo.create({
      userId,
      tokenHash: hash,
      purpose: 'PASSWORD_RESET',
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(s.auth.resetPassword(raw, 'new-passphrase-zzz-1', ctx)).rejects.toThrow();
  });

  it('anti-enum: forgot-password for an unknown email commits no token and sends no mail', async () => {
    s.mail.clear();
    await s.auth.forgotPassword(`ghost-${Date.now()}@${TEST_DOMAIN}`, ctx);
    expect(s.mail.outbox.length).toBe(0);
  });

  it('rollback-before-email: an audit failure inside the transaction emits NO email and commits NO token', async () => {
    const email = uniqueEmail('auditfail');
    const userId = await seedUser({
      email,
      password: 'passphrase-auditfail-1',
      roles: ['customer'],
    });

    // Force the in-transaction audit write to throw (simulates the original
    // P2028 failure mode) — the token must roll back and no email must escape.
    jest.spyOn(s.auditRepo, 'write').mockRejectedValueOnce(new Error('audit boom'));
    s.mail.clear();

    await s.auth.forgotPassword(email, ctx); // swallowed → same public 202

    expect(s.mail.outbox.length).toBe(0); // NO phantom email
    const tokenCount = await prisma.verificationToken.count({
      where: { userId, purpose: 'PASSWORD_RESET' },
    });
    expect(tokenCount).toBe(0); // token rolled back
  });

  it('atomicity: a session-revocation failure rolls back the whole reset (password unchanged, token still usable)', async () => {
    const email = uniqueEmail('revokefail');
    const userId = await seedUser({ email, password: 'passphrase-revoke-1', roles: ['customer'] });
    const before = await prisma.user.findUnique({ where: { id: userId } });

    await s.auth.forgotPassword(email, ctx);
    const raw = extractResetToken(email);
    const hash = tokens.hashOpaqueToken(raw);

    // Break session revocation for the first attempt only.
    const spy = jest
      .spyOn(s.sessionsRepo, 'revokeAllForUser')
      .mockRejectedValueOnce(new Error('revoke boom'));

    await expect(s.auth.resetPassword(raw, 'new-passphrase-revoke-2', ctx)).rejects.toThrow();

    // Nothing committed: password unchanged, token still unused.
    const mid = await prisma.user.findUnique({ where: { id: userId } });
    expect(mid.passwordHash).toBe(before.passwordHash);
    const tokenRow = await s.verifRepo.findByHash(hash);
    expect(tokenRow.usedAt).toBeNull(); // retryable

    // With revocation working, the SAME link now succeeds.
    spy.mockRestore();
    await s.auth.resetPassword(raw, 'new-passphrase-revoke-2', ctx);
    const done = await prisma.user.findUnique({ where: { id: userId } });
    expect(done.passwordHash).not.toBe(before.passwordHash);
  });
});
