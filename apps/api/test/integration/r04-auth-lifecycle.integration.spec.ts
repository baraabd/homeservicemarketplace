/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
// Real PostgreSQL transactions, locks, expiry, password hashes and session rows.
// Faults are injected only at named boundaries to prove rollback. This suite's
// mail adapter is in-memory; the separate browser workflow proves real SMTP.
export {};
import { randomUUID } from 'node:crypto';
import { withAdvisoryLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';
const suite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(60000);
suite('R04 account lifecycle invariants (real Postgres)', () => {
  let prisma: any;
  let s: any;
  const createdUserIds = new Set<string>();
  const ctx = { device: { ipAddress: '127.0.0.1', userAgent: 'r04-isolated-fixture', clientKind: 'WEB' as const }, requestId: 'r04-db-acceptance' };
  const password = 'r04-synthetic-original-passphrase';
  const replacement = 'r04-synthetic-replacement-passphrase';
  const email = () => `r04-${randomUUID()}@itest.local`;
  const mailCode = (address: string): string => {
    const text = s.mail.lastSentTo(address)?.text ?? '';
    const code = /code is (\d{6})/u.exec(text)?.[1];
    if (!code) throw new Error('Expected fixture OTP mail');
    return code;
  };
  async function register() {
    const address = email();
    const challenge = await s.auth.register({ email: address, password, firstName: 'Synthetic', lastName: 'R04' }, ctx);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
    createdUserIds.add(user.id);
    return { address, challenge, user, code: mailCode(address) };
  }
  async function verified() {
    const fixture = await register();
    const login = await s.auth.verifyOtp(fixture.challenge.challengeId, fixture.code, ctx);
    return { ...fixture, login };
  }
  async function tokenForReset(address: string): Promise<string> {
    await s.auth.forgotPassword(address, ctx);
    const raw = /token=([A-Za-z0-9_-]+)/u.exec(s.mail.lastSentTo(address)?.text ?? '')?.[1];
    if (!raw) throw new Error('Expected fixture recovery link');
    return raw;
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

    const SECRET = makeTestSecret('r04-auth-lifecycle');
    const config = {
      get: (k: string) => {
        const v: Record<string, unknown> = {
          AUTH_REQUIRE_EMAIL_VERIFICATION: true,
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
    const tokens = new TokenService(jwt, config);
    const audit = new AuditService(auditRepo);
    const securityEvents = new SecurityEventsBus();
    const sessionSvc = new SessionService(sessionsRepo, tokens, tx, audit, securityEvents);
    const verification = new VerificationService(verifRepo, tokens, config);
    const otp = new OtpService(verifRepo, config);
    const attempts = new LoginAttemptService(prismaSvc, config);
    const mail = new InMemoryMailAdapter();
    // Real bus with no subscribers: publishing is fire-and-forget, and the
    // realtime gateway is not part of this graph.
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
      tx,
      audit,
      tokens,
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
    jest.restoreAllMocks();
    for (const userId of createdUserIds) {
      await prisma.auditEvent.deleteMany({ where: { userId } });
      await prisma.session.deleteMany({ where: { userId } });
      await prisma.verificationToken.deleteMany({ where: { userId } });
      await prisma.userRole.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    createdUserIds.clear();
    s.mail.clear();
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  it('registration has no session or administrator privilege; invalid OTP attempts survive transaction rejection', async () => {
    const f = await register();
    expect(f.user.status).toBe('PENDING_VERIFICATION');
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
    const roles = await s.users.listRoles(f.user.id);
    expect(roles.map((value: any) => value.role.name)).toEqual(['customer']);
    const wrong = f.code === '000000' ? '111111' : '000000';
    for (let count = 1; count <= 5; count += 1) {
      await expect(s.auth.verifyOtp(f.challenge.challengeId, wrong, ctx)).rejects.toBeDefined();
      const row = await prisma.verificationToken.findUniqueOrThrow({ where: { challengeId: f.challenge.challengeId } });
      expect(row.attemptCount).toBe(count);
      expect(row.usedAt).toBeNull();
    }
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toBeDefined();
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
  });

  it('wrong-password counters and login audit persist, lock valid credentials, and recover only after password reset', async () => {
    const f = await verified();
    for (let count = 1; count <= 5; count += 1) {
      await expect(s.auth.login({ email: f.address, password: 'incorrect-synthetic-password' }, ctx)).rejects.toBeDefined();
      const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
      expect(user.failedLoginCount).toBe(count);
    }
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(locked.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    expect(await prisma.auditEvent.count({ where: { userId: f.user.id, type: 'LOGIN_LOCKED' } })).toBe(1);
    await expect(s.auth.login({ email: f.address, password }, ctx)).rejects.toBeDefined();
    const reset = await tokenForReset(f.address);
    await s.auth.resetPassword(reset, replacement, ctx);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(updated.failedLoginCount).toBe(0);
    expect(updated.lockedUntil).toBeNull();
    await expect(s.auth.login({ email: f.address, password: replacement }, ctx)).resolves.toHaveProperty('challengeId');
  });

  it('session creation and success audit failure both leave a registration OTP usable with no partially activated account', async () => {
    const f = await register();
    const original = s.audit.record.bind(s.audit);
    jest.spyOn(s.audit, 'record').mockImplementation(async (input: any, tx: any) => {
      if (input.type === 'LOGIN_SUCCESS') throw new Error('Injected fixture audit failure');
      return original(input, tx);
    });
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toThrow('Injected fixture audit failure');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(user.status).toBe('PENDING_VERIFICATION');
    expect(user.emailVerifiedAt).toBeNull();
    expect((await prisma.verificationToken.findUniqueOrThrow({ where: { challengeId: f.challenge.challengeId } })).usedAt).toBeNull();
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
    jest.restoreAllMocks();
    const failure = jest.spyOn(s.sessionSvc, 'createForLogin').mockRejectedValueOnce(new Error('Injected fixture session failure'));
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toThrow('Injected fixture session failure');
    failure.mockRestore();
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).resolves.toHaveProperty('issued.session.id');
  });

  it('concurrent verification has exactly one session winner and replay is rejected', async () => {
    const f = await register();
    const results = await Promise.allSettled([
      s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx),
      s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx),
    ]);
    expect(results.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((value) => value.status === 'rejected')).toHaveLength(1);
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(1);
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toBeDefined();
  });

  it.each(['SUSPENDED', 'INACTIVE', 'DELETED'])('a pending registration cannot reactivate %s', async (state) => {
    const f = await register();
    const patch = state === 'DELETED' ? { deletedAt: new Date() } : state === 'INACTIVE' ? { isActive: false } : { status: 'SUSPENDED' };
    await prisma.user.update({ where: { id: f.user.id }, data: patch });
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toBeDefined();
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    if (state === 'SUSPENDED') expect(after.status).toBe('SUSPENDED');
    if (state === 'INACTIVE') expect(after.isActive).toBe(false);
    if (state === 'DELETED') expect(after.deletedAt).not.toBeNull();
  });

  it('resend changes the live code but retains durable attempts and enforces the resend ceiling', async () => {
    const f = await register();
    await s.auth.resendOtp(f.challenge.challengeId, ctx);
    const rotated = mailCode(f.address);
    expect(rotated).not.toBe(f.code);
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toBeDefined();
    expect((await prisma.verificationToken.findUniqueOrThrow({ where: { challengeId: f.challenge.challengeId } })).attemptCount).toBe(1);
    await s.auth.resendOtp(f.challenge.challengeId, ctx);
    await s.auth.resendOtp(f.challenge.challengeId, ctx);
    await expect(s.auth.resendOtp(f.challenge.challengeId, ctx)).rejects.toBeDefined();
    expect((await prisma.verificationToken.findUniqueOrThrow({ where: { challengeId: f.challenge.challengeId } })).resendCount).toBe(3);
    await s.auth.verifyOtp(f.challenge.challengeId, mailCode(f.address), ctx);
  });

  it('expiry and purpose are checked by the consuming database operation', async () => {
    const f = await register();
    const row = await prisma.verificationToken.findUniqueOrThrow({ where: { challengeId: f.challenge.challengeId } });
    await prisma.verificationToken.update({ where: { id: row.id }, data: { expiresAt: new Date(0) } });
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toBeDefined();
    expect(await s.verifRepo.consumeByChallenge(f.challenge.challengeId, row.tokenHash, undefined, 5)).toBeNull();
    await prisma.verificationToken.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + 60000), purpose: 'PASSWORD_RESET' } });
    expect(await s.verifRepo.consumeByChallenge(f.challenge.challengeId, row.tokenHash, undefined, 5)).toBeNull();
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toBeDefined();
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
  });

  it('reset revokes pre-reset OTPs and every device; a reset token is single-use', async () => {
    const f = await verified();
    const challenge = await s.auth.login({ email: f.address, password }, ctx);
    const oldCode = mailCode(f.address);
    const reset = await tokenForReset(f.address);
    await s.auth.resetPassword(reset, replacement, ctx);
    await expect(s.auth.verifyOtp(challenge.challengeId, oldCode, ctx)).rejects.toBeDefined();
    await expect(s.auth.refresh({ refreshTokenRaw: f.login.issued.refresh.raw, device: ctx.device, requestId: ctx.requestId })).rejects.toBeDefined();
    await expect(s.auth.resetPassword(reset, password, ctx)).rejects.toBeDefined();
    expect(await prisma.session.count({ where: { userId: f.user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.verificationToken.count({ where: { userId: f.user.id, usedAt: null } })).toBe(0);
  });

  it('logout ends a rotated device lineage but leaves an independent device usable', async () => {
    const f = await verified();
    const challenge = await s.auth.login({ email: f.address, password }, ctx);
    const second = await s.auth.verifyOtp(challenge.challengeId, mailCode(f.address), ctx);
    const rotated = await s.auth.refresh({ refreshTokenRaw: f.login.issued.refresh.raw, device: ctx.device, requestId: ctx.requestId });
    await s.auth.logout(f.user.id, f.login.issued.session.id, ctx);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: rotated.issued.session.id } })).revokedAt).not.toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: second.issued.session.id } })).revokedAt).toBeNull();
    await expect(s.auth.refresh({ refreshTokenRaw: second.issued.refresh.raw, device: ctx.device, requestId: ctx.requestId })).resolves.toHaveProperty('issued');
  });

  it('a link verification is not a session, and an unverified login remains forbidden', async () => {
    const f = await register();
    await expect(s.auth.login({ email: f.address, password }, ctx)).rejects.toBeDefined();
    await s.auth.resendVerification(f.address, ctx);
    const link = /token=([A-Za-z0-9_-]+)/u.exec(s.mail.lastSentTo(f.address)?.text ?? '')?.[1];
    expect(link).toBeDefined();
    await s.auth.verifyEmail(link, ctx);
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
    await expect(s.auth.verifyEmail(link, ctx)).rejects.toBeDefined();
    await expect(s.auth.login({ email: f.address, password }, ctx)).resolves.toHaveProperty('challengeId');
  });
});
