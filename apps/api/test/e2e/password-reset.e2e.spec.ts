/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
export {}; // module marker.
//
// REAL HTTP round trip for the password-reset flow. Unlike auth.e2e.spec.ts
// (which replaces AuthenticationService with a mock), this boots a Nest app
// with the REAL controller + service + verification/token/session/audit
// services + Prisma repositories + transaction runner. Only the mail
// transport is swapped for a deterministic in-memory adapter.
//
//   POST /v1/auth/forgot-password  → 202
//   → capture email → extract token → assert token committed
//   POST /v1/auth/reset-password   → 200
//   → login (real OTP) with the new password succeeds
//   → replaying the used link → 400 (generic)
//
// Gated by RUN_DB_INTEGRATION=1. Talks to the shared dev DB but NEVER
// truncates: it uses @itest.local emails and deletes only its own rows.

import { INestApplication, Module, ValidationPipe, VersioningType } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(60_000);

const TEST_DOMAIN = 'itest.local';

d('Password reset — real HTTP round trip', () => {
  let app: INestApplication;
  let prisma: any;
  let mail: any;
  let http: any;
  let passwords: any;
  const createdEmails: string[] = [];

  async function cleanupByEmail(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return;
    await prisma.auditEvent.deleteMany({ where: { userId: user.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.verificationToken.deleteMany({ where: { userId: user.id } });
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }

  beforeAll(async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    await db.seed();

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
    const {
      RegistrationThrottleService,
    } = require('../../src/infrastructure/throttle/registration-throttle.service');
    // Typed via `typeof import(...)`, which erases at runtime. Without it the
    // required class is `any` and a constructor change silently shifts these
    // positional arguments instead of failing typecheck.
    const { AuthenticationService } =
      require('../../src/modules/iam/authentication/services/authentication.service') as {
        AuthenticationService: typeof import('../../src/modules/iam/authentication/services/authentication.service').AuthenticationService;
      };
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const { InMemoryMailAdapter } = require('../../src/infrastructure/mail/in-memory-mail.adapter');
    const { MAIL_PORT } = require('../../src/infrastructure/mail/mail.port');
    const {
      AuthenticationController,
    } = require('../../src/modules/iam/authentication/controllers/authentication.controller');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');

    const SECRET = 'e2e_secret_at_least_32_chars_1234567890';
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
          COOKIE_SECURE: false,
          COOKIE_DOMAIN: undefined,
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
    passwords = new PasswordService();
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
    const otp = new OtpService(verifRepo, config);
    const attempts = new LoginAttemptService(prismaSvc, config);
    mail = new InMemoryMailAdapter();
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

    @Module({
      controllers: [AuthenticationController],
      providers: [
        { provide: AuthenticationService, useValue: auth },
        { provide: UserRepository, useValue: users },
        { provide: AppConfigService, useValue: config },
        { provide: MAIL_PORT, useValue: mail },
        // D-1: the controller charges the registration abuse budget before it
        // does anything else. This spec exercises the password-reset flow, not
        // the limiter, so the double always admits; the limiter itself is
        // covered by its own unit, integration, and runtime suites.
        {
          provide: RegistrationThrottleService,
          useValue: { assertWithinBudget: async () => undefined },
        },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    })
    class TestAuthModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestAuthModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    for (const email of createdEmails) await cleanupByEmail(email);
    await app?.close();
    await prisma.$disconnect();
  });

  it('forgot(202) → committed token → reset(200) → OTP login with new password → replay(400)', async () => {
    const email = `pwreset-e2e-${Date.now()}@${TEST_DOMAIN}`;
    createdEmails.push(email);
    const oldPassword = 'e2e-old-passphrase-1';
    const newPassword = 'e2e-new-passphrase-2';

    // Seed an ACTIVE, verified user directly.
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await passwords.hash(oldPassword),
        firstName: 'E2E',
        lastName: 'User',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    const customer = await prisma.role.findFirst({ where: { name: 'customer' } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: customer.id } });

    // 1. forgot-password → 202
    await request(http).post('/v1/auth/forgot-password').send({ email }).expect(202);

    // 2. token committed & emailed
    const msg = mail.lastSentTo(email);
    expect(msg).toBeDefined();
    const raw = msg.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    const { createHash } = require('node:crypto');
    const hash = createHash('sha256').update(raw).digest('hex');
    const committed = await prisma.verificationToken.findUnique({ where: { tokenHash: hash } });
    expect(committed).not.toBeNull();
    expect(committed.usedAt).toBeNull();

    // 3. reset-password → 200
    await request(http)
      .post('/v1/auth/reset-password')
      .send({ token: raw, newPassword })
      .expect(200);

    // token consumed
    const used = await prisma.verificationToken.findUnique({ where: { tokenHash: hash } });
    expect(used.usedAt).not.toBeNull();

    // 4. OTP login with the NEW password works end to end over HTTP
    const loginRes = await request(http)
      .post('/v1/auth/login')
      .send({ email, password: newPassword })
      .expect(200);
    const challengeId = loginRes.body.challengeId;
    expect(challengeId).toBeTruthy();
    const otpMsg = mail.lastSentTo(email);
    const code = otpMsg.text.match(/code is (\d{4,8})/)![1];
    const verifyRes = await request(http)
      .post('/v1/auth/verify-otp')
      .send({ challengeId, code })
      .expect(200);
    expect(verifyRes.body.userId).toBe(user.id);

    // 5. old password no longer works
    await request(http).post('/v1/auth/login').send({ email, password: oldPassword }).expect(401);

    // 6. replaying the used reset link → generic 400
    const replay = await request(http)
      .post('/v1/auth/reset-password')
      .send({ token: raw, newPassword: 'e2e-third-passphrase-3' })
      .expect(400);
    expect(replay.body?.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('forgot-password for an unknown email still returns 202 (anti-enumeration)', async () => {
    await request(http)
      .post('/v1/auth/forgot-password')
      .send({ email: `ghost-${Date.now()}@${TEST_DOMAIN}` })
      .expect(202);
  });
});
