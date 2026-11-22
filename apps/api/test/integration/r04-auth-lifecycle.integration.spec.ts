/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
// Real PostgreSQL transactions, locks, expiry, password hashes and session rows.
// Faults are injected only at named boundaries to prove rollback. This suite's
// mail adapter is in-memory; the separate browser workflow proves real SMTP.
export {};
import { randomInt, randomUUID } from 'node:crypto';
import type { OtpDeliveryInput } from '../../src/infrastructure/auth-channel/otp-delivery.service';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { withAdvisoryLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';
import { currentLegalAcceptance, legalAcceptanceServiceFor } from '../support/legal-acceptance';
import { emailAuthenticationServices } from '../support/auth-channel';
const suite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(60000);
suite('R04 account lifecycle invariants (real Postgres)', () => {
  let prisma: any;
  let s: any;
  const createdUserIds = new Set<string>();
  const ctx = {
    device: {
      ipAddress: '127.0.0.1',
      userAgent: 'r04-isolated-fixture',
      clientKind: 'WEB' as const,
    },
    requestId: 'r04-db-acceptance',
  };
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
    const challenge = await s.auth.register(
      {
        email: address,
        password,
        firstName: 'Synthetic',
        lastName: 'R04',
        legalAcceptance: currentLegalAcceptance(),
      },
      ctx,
    );
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
    const [channels, delivery] = emailAuthenticationServices(config, mail);
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
      legalAcceptanceServiceFor(config),
      channels,
      delivery,
    );

    s = {
      auth,
      channels,
      delivery,
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
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('registration has no session or administrator privilege; invalid OTP attempts survive transaction rejection', async () => {
    const f = await register();
    expect(f.user.status).toBe('PENDING_VERIFICATION');
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
    const roles = await s.users.listRoles(f.user.id);
    expect(roles.map((value: any) => value.role.name)).toEqual(['customer']);
    const wrong = f.code === '000000' ? '111111' : '000000';
    for (let count = 1; count <= 5; count += 1) {
      await expect(s.auth.verifyOtp(f.challenge.challengeId, wrong, ctx)).rejects.toBeDefined();
      const row = await prisma.verificationToken.findUniqueOrThrow({
        where: { challengeId: f.challenge.challengeId },
      });
      expect(row.attemptCount).toBe(count);
      expect(row.usedAt).toBeNull();
    }
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toBeDefined();
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
  });

  it('wrong-password counters and login audit persist, lock valid credentials, and recover only after password reset', async () => {
    const f = await verified();
    for (let count = 1; count <= 5; count += 1) {
      await expect(
        s.auth.login({ email: f.address, password: 'incorrect-synthetic-password' }, ctx),
      ).rejects.toBeDefined();
      const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
      expect(user.failedLoginCount).toBe(count);
    }
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(locked.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    expect(
      await prisma.auditEvent.count({ where: { userId: f.user.id, type: 'LOGIN_LOCKED' } }),
    ).toBe(1);
    await expect(s.auth.login({ email: f.address, password }, ctx)).rejects.toBeDefined();
    const reset = await tokenForReset(f.address);
    await s.auth.resetPassword(reset, replacement, ctx);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(updated.failedLoginCount).toBe(0);
    expect(updated.lockedUntil).toBeNull();
    await expect(
      s.auth.login({ email: f.address, password: replacement }, ctx),
    ).resolves.toHaveProperty('challengeId');
  });

  it('session creation and success audit failure both leave a registration OTP usable with no partially activated account', async () => {
    const f = await register();
    const original = s.audit.record.bind(s.audit);
    jest.spyOn(s.audit, 'record').mockImplementation(async (input: any, tx: any) => {
      if (input.type === 'LOGIN_SUCCESS') throw new Error('Injected fixture audit failure');
      return original(input, tx);
    });
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toThrow(
      'Injected fixture audit failure',
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(user.status).toBe('PENDING_VERIFICATION');
    expect(user.emailVerifiedAt).toBeNull();
    expect(
      (
        await prisma.verificationToken.findUniqueOrThrow({
          where: { challengeId: f.challenge.challengeId },
        })
      ).usedAt,
    ).toBeNull();
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
    jest.restoreAllMocks();
    const failure = jest
      .spyOn(s.sessionSvc, 'createForLogin')
      .mockRejectedValueOnce(new Error('Injected fixture session failure'));
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toThrow(
      'Injected fixture session failure',
    );
    failure.mockRestore();
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).resolves.toHaveProperty(
      'issued.session.id',
    );
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

  it.each(['SUSPENDED', 'INACTIVE', 'DELETED'])(
    'a pending registration cannot reactivate %s',
    async (state) => {
      const f = await register();
      const patch =
        state === 'DELETED'
          ? { deletedAt: new Date() }
          : state === 'INACTIVE'
            ? { isActive: false }
            : { status: 'SUSPENDED' };
      await prisma.user.update({ where: { id: f.user.id }, data: patch });
      await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toBeDefined();
      expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
      if (state === 'SUSPENDED') expect(after.status).toBe('SUSPENDED');
      if (state === 'INACTIVE') expect(after.isActive).toBe(false);
      if (state === 'DELETED') expect(after.deletedAt).not.toBeNull();
    },
  );

  it('resend changes the live code but retains durable attempts and enforces the resend ceiling', async () => {
    const f = await register();
    await s.auth.resendOtp(f.challenge.challengeId, ctx);
    const rotated = mailCode(f.address);
    expect(rotated).not.toBe(f.code);
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toBeDefined();
    expect(
      (
        await prisma.verificationToken.findUniqueOrThrow({
          where: { challengeId: f.challenge.challengeId },
        })
      ).attemptCount,
    ).toBe(1);
    await s.auth.resendOtp(f.challenge.challengeId, ctx);
    await s.auth.resendOtp(f.challenge.challengeId, ctx);
    await expect(s.auth.resendOtp(f.challenge.challengeId, ctx)).rejects.toBeDefined();
    expect(
      (
        await prisma.verificationToken.findUniqueOrThrow({
          where: { challengeId: f.challenge.challengeId },
        })
      ).resendCount,
    ).toBe(3);
    await s.auth.verifyOtp(f.challenge.challengeId, mailCode(f.address), ctx);
  });

  it('expiry and purpose are checked by the consuming database operation', async () => {
    const f = await register();
    const row = await prisma.verificationToken.findUniqueOrThrow({
      where: { challengeId: f.challenge.challengeId },
    });
    await prisma.verificationToken.update({
      where: { id: row.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toBeDefined();
    expect(
      await s.verifRepo.consumeByChallenge(f.challenge.challengeId, row.tokenHash, undefined, 5),
    ).toBeNull();
    await prisma.verificationToken.update({
      where: { id: row.id },
      data: { expiresAt: new Date(Date.now() + 60000), purpose: 'PASSWORD_RESET' },
    });
    expect(
      await s.verifRepo.consumeByChallenge(f.challenge.challengeId, row.tokenHash, undefined, 5),
    ).toBeNull();
    await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toBeDefined();
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
  });

  it.each(['a'.repeat(64), `otp-v2:${'b'.repeat(64)}`, `otp-v3:${'c'.repeat(64)}`])(
    'upgrades a live pre-v4 OTP through resend without changing ownership or clearing limits',
    async (legacyHash) => {
      const f = await register();
      const before = await prisma.verificationToken.update({
        where: { challengeId: f.challenge.challengeId },
        data: {
          tokenHash: legacyHash,
          attemptCount: 1,
          deliveryChannel: null,
          deliveryTarget: null,
        },
      });
      await expect(s.auth.verifyOtp(f.challenge.challengeId, f.code, ctx)).rejects.toMatchObject({
        response: { code: 'AUTH_OTP_EXPIRED' },
      });
      expect(
        await prisma.verificationToken.findUniqueOrThrow({ where: { id: before.id } }),
      ).toEqual(before);
      expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);

      await s.auth.resendOtp(f.challenge.challengeId, ctx);
      const after = await prisma.verificationToken.findUniqueOrThrow({ where: { id: before.id } });
      expect(after).toMatchObject({
        userId: f.user.id,
        challengeId: f.challenge.challengeId,
        purpose: 'REGISTRATION_OTP',
        attemptCount: 1,
        resendCount: 1,
        deliveryChannel: null,
        deliveryTarget: null,
        usedAt: null,
      });
      expect(after.tokenHash).toMatch(/^otp-v4:\$argon2id\$/);
      await expect(
        s.auth.verifyOtp(f.challenge.challengeId, mailCode(f.address), ctx),
      ).resolves.toHaveProperty('issued.session.id');
    },
  );

  // PostgreSQL casts a timestamp-without-time-zone to the session timezone
  // when comparing it with timestamptz. Prisma stores these token fields in
  // UTC. Exercise the actual repository under both offset directions; keep
  // timezone changes inside each test's transaction, never at DB/role scope.
  const timeZones = ['UTC', 'Asia/Riyadh', 'America/New_York'] as const;
  async function inTimeZone(
    zone: (typeof timeZones)[number],
    run: (tx: PrismaTx) => Promise<void>,
  ): Promise<void> {
    await prisma.$transaction(async (tx: PrismaTx) => {
      if (zone === 'UTC') await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      else if (zone === 'Asia/Riyadh') await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Riyadh'`;
      else await tx.$executeRaw`SET LOCAL TIME ZONE 'America/New_York'`;
      await run(tx);
    });
  }
  async function utcClock(tx: PrismaTx): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ utc: Date }>>`
      SELECT clock_timestamp() AT TIME ZONE 'UTC' AS utc`;
    return rows[0].utc.getTime();
  }
  function expectUtcUsedAt(value: Date, before: number, after: number): void {
    // The column's millisecond precision may round the database clock by 1 ms.
    expect(value.getTime()).toBeGreaterThanOrEqual(before - 1);
    expect(value.getTime()).toBeLessThanOrEqual(after + 1);
  }

  it.each(timeZones)(
    'fresh OTP/link tokens use UTC expiry and single-use timestamps in %s',
    async (zone) => {
      const f = await register();
      await inTimeZone(zone, async (tx) => {
        for (const purpose of ['REGISTRATION_OTP', 'LOGIN_OTP'] as const) {
          const challenge =
            purpose === 'REGISTRATION_OTP'
              ? { challengeId: f.challenge.challengeId, rawCode: f.code }
              : await s.otp.issue(f.user.id, purpose, tx);
          const before = await utcClock(tx);
          const verdict = await s.otp.verifyForLogin(challenge.challengeId, challenge.rawCode, tx);
          expect(verdict).toEqual({
            consumed: {
              userId: f.user.id,
              purpose,
              ...(purpose === 'REGISTRATION_OTP'
                ? { channel: 'email', destination: f.address }
                : {}),
            },
          });
          const row = await tx.verificationToken.findUniqueOrThrow({
            where: { challengeId: challenge.challengeId },
          });
          expect(row.usedAt).not.toBeNull();
          expectUtcUsedAt(row.usedAt!, before, await utcClock(tx));
          await expect(
            s.otp.verifyForLogin(challenge.challengeId, challenge.rawCode, tx),
          ).resolves.toHaveProperty('rejection');
        }
        for (const purpose of ['PASSWORD_RESET', 'EMAIL_VERIFICATION'] as const) {
          const tokenHash = randomUUID();
          const row = await s.verifRepo.create(
            { userId: f.user.id, tokenHash, purpose, expiresAt: new Date(Date.now() + 60_000) },
            tx,
          );
          const before = await utcClock(tx);
          const consumed = await s.verifRepo.consume(tokenHash, purpose, tx);
          expect(consumed?.id).toBe(row.id);
          expectUtcUsedAt(consumed.usedAt, before, await utcClock(tx));
          expect(await s.verifRepo.consume(tokenHash, purpose, tx)).toBeNull();
        }
      });
    },
  );

  it.each(timeZones)(
    'expired tokens cannot consume, increment attempts or rotate in %s',
    async (zone) => {
      const f = await register();
      await inTimeZone(zone, async (tx) => {
        for (const purpose of [
          'REGISTRATION_OTP',
          'LOGIN_OTP',
          'PASSWORD_RESET',
          'EMAIL_VERIFICATION',
        ] as const) {
          const row = await s.verifRepo.create(
            {
              userId: f.user.id,
              tokenHash: randomUUID(),
              purpose,
              expiresAt: new Date(Date.now() - 60_000),
              challengeId: randomUUID(),
            },
            tx,
          );
          if (purpose === 'REGISTRATION_OTP' || purpose === 'LOGIN_OTP') {
            expect(
              await s.verifRepo.consumeByChallenge(row.challengeId, row.tokenHash, tx, 5),
            ).toBeNull();
            expect(
              await s.verifRepo.recordFailedAttempt(row.challengeId, row.tokenHash, 5, tx),
            ).toBeNull();
            expect(
              await s.verifRepo.rotateLiveChallenge(
                row.challengeId,
                row.tokenHash,
                { tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
                { attempts: 5, resends: 3 },
                tx,
              ),
            ).toBe(false);
          } else expect(await s.verifRepo.consume(row.tokenHash, purpose, tx)).toBeNull();
          expect(
            await tx.verificationToken.findUniqueOrThrow({ where: { id: row.id } }),
          ).toMatchObject({
            tokenHash: row.tokenHash,
            attemptCount: 0,
            resendCount: 0,
            usedAt: null,
          });
        }
      });
    },
  );

  it.each(timeZones)(
    'valid challenges retain attempts and rotate exactly once before consuming in %s',
    async (zone) => {
      const f = await register();
      await inTimeZone(zone, async (tx) => {
        const wrong = f.code === '000000' ? '111111' : '000000';
        await expect(
          s.otp.verifyForLogin(f.challenge.challengeId, wrong, tx),
        ).resolves.toHaveProperty('rejection');
        const before = await tx.verificationToken.findUniqueOrThrow({
          where: { challengeId: f.challenge.challengeId },
        });
        expect(before).toMatchObject({ attemptCount: 1, resendCount: 0, usedAt: null });
        const resendStartedAt = Date.now();
        const rotated = await s.otp.resend(f.challenge.challengeId, tx);
        const resendFinishedAt = Date.now();
        expect(rotated.rawCode).not.toBe(f.code);
        const after = await tx.verificationToken.findUniqueOrThrow({ where: { id: before.id } });
        expect(after).toMatchObject({ attemptCount: 1, resendCount: 1, usedAt: null });
        expect(after.tokenHash).not.toBe(before.tokenHash);
        const ttlMs = rotated.expiresInSeconds * 1000;
        expect(after.expiresAt.getTime()).toBeGreaterThanOrEqual(resendStartedAt + ttlMs);
        expect(after.expiresAt.getTime()).toBeLessThanOrEqual(resendFinishedAt + ttlMs);
        expect(
          await s.verifRepo.rotateLiveChallenge(
            before.challengeId,
            before.tokenHash,
            { tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
            { attempts: 5, resends: 3 },
            tx,
          ),
        ).toBe(false);
        expect(await s.otp.verifyForLogin(f.challenge.challengeId, rotated.rawCode, tx)).toEqual({
          consumed: {
            userId: f.user.id,
            purpose: 'REGISTRATION_OTP',
            channel: 'email',
            destination: f.address,
          },
        });
        expect(
          await s.verifRepo.recordFailedAttempt(after.challengeId, after.tokenHash, 5, tx),
        ).toBeNull();
      });
    },
  );

  it('reset revokes pre-reset OTPs and every device; a reset token is single-use', async () => {
    const f = await verified();
    const challenge = await s.auth.login({ email: f.address, password }, ctx);
    const oldCode = mailCode(f.address);
    const reset = await tokenForReset(f.address);
    await s.auth.resetPassword(reset, replacement, ctx);
    await expect(s.auth.verifyOtp(challenge.challengeId, oldCode, ctx)).rejects.toBeDefined();
    await expect(
      s.auth.refresh({
        refreshTokenRaw: f.login.issued.refresh.raw,
        device: ctx.device,
        requestId: ctx.requestId,
      }),
    ).rejects.toBeDefined();
    await expect(s.auth.resetPassword(reset, password, ctx)).rejects.toBeDefined();
    expect(await prisma.session.count({ where: { userId: f.user.id, revokedAt: null } })).toBe(0);
    expect(
      await prisma.verificationToken.count({ where: { userId: f.user.id, usedAt: null } }),
    ).toBe(0);
  });

  it('logout ends a rotated device lineage but leaves an independent device usable', async () => {
    const f = await verified();
    const challenge = await s.auth.login({ email: f.address, password }, ctx);
    const second = await s.auth.verifyOtp(challenge.challengeId, mailCode(f.address), ctx);
    const rotated = await s.auth.refresh({
      refreshTokenRaw: f.login.issued.refresh.raw,
      device: ctx.device,
      requestId: ctx.requestId,
    });
    await s.auth.logout(f.user.id, f.login.issued.session.id, ctx);
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: rotated.issued.session.id } }))
        .revokedAt,
    ).not.toBeNull();
    expect(
      (await prisma.session.findUniqueOrThrow({ where: { id: second.issued.session.id } }))
        .revokedAt,
    ).toBeNull();
    await expect(
      s.auth.refresh({
        refreshTokenRaw: second.issued.refresh.raw,
        device: ctx.device,
        requestId: ctx.requestId,
      }),
    ).resolves.toHaveProperty('issued');
  });

  it('a link verification and an unfinished-registration login never create a session', async () => {
    const f = await register();
    const pending = await s.auth.login({ email: f.address, password }, ctx);
    expect(pending).toHaveProperty('challengeId');
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
    await s.auth.resendVerification(f.address, ctx);
    const link = /token=([A-Za-z0-9_-]+)/u.exec(s.mail.lastSentTo(f.address)?.text ?? '')?.[1];
    expect(link).toBeDefined();
    await s.auth.verifyEmail(link, ctx);
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
    await expect(s.auth.verifyEmail(link, ctx)).rejects.toBeDefined();
    await expect(s.auth.login({ email: f.address, password }, ctx)).resolves.toHaveProperty(
      'challengeId',
    );
  });
  /** The Meta transport is a stand-in here. Database identity, tokens,
   * consumption, locks, password hashes and sessions are real. */
  function captureWhatsAppCodes() {
    const captured: OtpDeliveryInput[] = [];
    const enqueue = s.delivery.enqueue.bind(s.delivery);
    const channel = jest.spyOn(s.channels, 'getChannel').mockResolvedValue('whatsapp');
    jest.spyOn(s.channels, 'getPublicConfig').mockImplementation(async () => ({
      otpChannel: await s.channels.getChannel(),
      whatsappAvailable: true,
    }));
    jest.spyOn(s.channels, 'assertWhatsAppReady').mockImplementation(() => undefined);
    jest.spyOn(s.delivery, 'enqueue').mockImplementation(async (input: unknown, tx: unknown) => {
      captured.push(input as OtpDeliveryInput);
      return enqueue(input, tx);
    });
    jest.spyOn(s.delivery, 'dispatch').mockResolvedValue(undefined);
    return {
      channel,
      captured,
      code: () => {
        const latest = captured.at(-1);
        if (!latest) throw new Error('Expected a captured authentication delivery');
        return latest.rawCode;
      },
    };
  }
  const uniquePhone = () => `+9665${randomInt(10_000_000, 100_000_000)}`;
  async function registerPhone(phoneNumber: string) {
    const challenge = await s.auth.register(
      {
        phoneNumber,
        password,
        firstName: 'Synthetic',
        lastName: 'WhatsApp',
        legalAcceptance: currentLegalAcceptance(),
      },
      ctx,
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { phoneNumber } });
    createdUserIds.add(user.id);
    return { challenge, user };
  }

  it('phone-only signup and login persist verified identity; a policy switch never reroutes an outstanding code', async () => {
    const capture = captureWhatsAppCodes();
    const phoneNumber = uniquePhone();
    const f = await registerPhone(phoneNumber);
    expect(f.user).toMatchObject({
      email: null,
      emailVerifiedAt: null,
      phoneNumber,
      phoneVerifiedAt: null,
      status: 'PENDING_VERIFICATION',
    });
    expect(await prisma.session.count({ where: { userId: f.user.id } })).toBe(0);
    const initialCode = capture.code();
    capture.channel.mockResolvedValue('email');
    await s.auth.resendOtp(f.challenge.challengeId, ctx);
    expect(capture.captured.at(-1)).toMatchObject({
      channel: 'whatsapp',
      destination: phoneNumber,
    });
    expect(capture.code()).not.toBe(initialCode);
    await expect(s.auth.verifyOtp(f.challenge.challengeId, initialCode, ctx)).rejects.toBeDefined();
    const activated = await s.auth.verifyOtp(f.challenge.challengeId, capture.code(), ctx);
    expect(activated.user).toMatchObject({
      email: null,
      emailVerifiedAt: null,
      phoneNumber,
      status: 'ACTIVE',
    });
    expect(activated.user.phoneVerifiedAt).toBeInstanceOf(Date);
    await expect(s.auth.login({ phoneNumber }, ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_CHANNEL_CHANGED' },
    });
    capture.channel.mockResolvedValue('whatsapp');
    const login = await s.auth.login({ phoneNumber }, ctx);
    expect(login.channel).toBe('whatsapp');
    await s.auth.verifyOtp(login.challengeId, capture.code(), ctx);
    expect(await prisma.session.count({ where: { userId: f.user.id, revokedAt: null } })).toBe(2);
  });

  it('WhatsApp recovery cannot log in and atomically replaces the password, revokes sessions and expires other challenges', async () => {
    const capture = captureWhatsAppCodes();
    const phoneNumber = uniquePhone();
    const f = await registerPhone(phoneNumber);
    await s.auth.verifyOtp(f.challenge.challengeId, capture.code(), ctx);
    const staleLogin = await s.auth.login({ phoneNumber }, ctx);
    const staleCode = capture.code();
    const recovery = await s.auth.forgotPasswordOtp(phoneNumber, ctx);
    const recoveryCode = capture.code();
    await expect(s.auth.verifyOtp(recovery.challengeId, recoveryCode, ctx)).rejects.toBeDefined();
    expect(
      (
        await prisma.verificationToken.findUniqueOrThrow({
          where: { challengeId: recovery.challengeId },
        })
      ).usedAt,
    ).toBeNull();
    const wrong = recoveryCode === '000000' ? '111111' : '000000';
    await expect(
      s.auth.resetPasswordOtp(recovery.challengeId, wrong, replacement, ctx),
    ).rejects.toBeDefined();
    expect(
      (
        await prisma.verificationToken.findUniqueOrThrow({
          where: { challengeId: recovery.challengeId },
        })
      ).attemptCount,
    ).toBe(1);
    await s.auth.resetPasswordOtp(recovery.challengeId, recoveryCode, replacement, ctx);
    expect(await prisma.session.count({ where: { userId: f.user.id, revokedAt: null } })).toBe(0);
    expect(
      await prisma.verificationToken.count({ where: { userId: f.user.id, usedAt: null } }),
    ).toBe(0);
    await expect(s.auth.verifyOtp(staleLogin.challengeId, staleCode, ctx)).rejects.toBeDefined();
    await expect(
      s.auth.resetPasswordOtp(recovery.challengeId, recoveryCode, password, ctx),
    ).rejects.toBeDefined();
    // Password reset still changes the password used by contact enrollment,
    // while a WhatsApp sign-in proves possession through its new OTP alone.
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    await expect(s.passwords.verify(updated.passwordHash, password)).resolves.toBe(false);
    await expect(s.passwords.verify(updated.passwordHash, replacement)).resolves.toBe(true);
    const nextLogin = await s.auth.login({ phoneNumber }, ctx);
    expect(await prisma.session.count({ where: { userId: f.user.id, revokedAt: null } })).toBe(0);
    await expect(
      s.auth.verifyOtp(nextLogin.challengeId, capture.code(), ctx),
    ).resolves.toHaveProperty('issued.session.id');
  });

  it('enrolls a verified phone on an existing email account only after password and phone proof', async () => {
    const existing = await verified();
    const capture = captureWhatsAppCodes();
    const phoneNumber = uniquePhone();
    const enrollment = await s.auth.requestPhoneEnrollment(
      existing.user.id,
      phoneNumber,
      password,
      ctx,
    );
    const code = capture.code();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: existing.user.id } })).phoneNumber,
    ).toBeNull();
    await expect(s.auth.verifyOtp(enrollment.challengeId, code, ctx)).rejects.toBeDefined();
    await s.auth.verifyPhoneEnrollment(existing.user.id, enrollment.challengeId, code, ctx);
    const linked = await prisma.user.findUniqueOrThrow({ where: { id: existing.user.id } });
    expect(linked).toMatchObject({ email: existing.address, phoneNumber, status: 'ACTIVE' });
    expect(linked.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(linked.emailVerifiedAt).toBeInstanceOf(Date);
    const challenge = await s.auth.login({ phoneNumber }, ctx);
    await expect(
      s.auth.verifyOtp(challenge.challengeId, capture.code(), ctx),
    ).resolves.toHaveProperty('issued.session.id');
  });
  it.each([
    { deliveryChannel: null, deliveryTarget: '+966501234567' },
    { deliveryChannel: 'whatsapp', deliveryTarget: null },
    { deliveryChannel: 'invalid', deliveryTarget: '+966501234567' },
    { deliveryChannel: 'email', deliveryTarget: '' },
  ])('database rejects an incomplete or invalid delivery binding: %p', async (binding) => {
    const f = await register();
    await expect(
      prisma.verificationToken.create({
        data: {
          userId: f.user.id,
          purpose: 'LOGIN_OTP',
          tokenHash: randomUUID(),
          challengeId: randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
          ...binding,
        },
      }),
    ).rejects.toBeDefined();
    expect(await prisma.verificationToken.count({ where: { userId: f.user.id } })).toBe(1);
  });

  it('recipient suppression rolls back recovery issuance without invalidating the previous usable challenge', async () => {
    const capture = captureWhatsAppCodes();
    const phoneNumber = uniquePhone();
    const f = await registerPhone(phoneNumber);
    await s.auth.verifyOtp(f.challenge.challengeId, capture.code(), ctx);
    const existing = await s.auth.forgotPasswordOtp(phoneNumber, ctx);
    const existingCode = capture.code();
    const wrong = existingCode === '000000' ? '111111' : '000000';
    await expect(
      s.auth.resetPasswordOtp(existing.challengeId, wrong, replacement, ctx),
    ).rejects.toBeDefined();
    const before = await prisma.verificationToken.findUniqueOrThrow({
      where: { challengeId: existing.challengeId },
    });
    expect(before.attemptCount).toBe(1);
    const countBefore = await prisma.verificationToken.count({ where: { userId: f.user.id } });
    const dispatchCount = s.delivery.dispatch.mock.calls.length;
    jest.spyOn(s.delivery, 'enqueue').mockResolvedValueOnce({ deliveryId: null, intent: null });

    const neutral = await s.auth.forgotPasswordOtp(phoneNumber, ctx);

    expect(neutral.challengeId).not.toBe(existing.challengeId);
    expect(await prisma.verificationToken.count({ where: { userId: f.user.id } })).toBe(
      countBefore,
    );
    expect(
      await prisma.verificationToken.findUniqueOrThrow({
        where: { challengeId: existing.challengeId },
      }),
    ).toEqual(before);
    expect(s.delivery.dispatch.mock.calls.length).toBe(dispatchCount);
    await expect(
      s.auth.resetPasswordOtp(existing.challengeId, existingCode, replacement, ctx),
    ).resolves.toBeUndefined();
  });

  it('recipient suppression rolls back resend rotation and retains the previous code and limits', async () => {
    const capture = captureWhatsAppCodes();
    const phoneNumber = uniquePhone();
    const f = await registerPhone(phoneNumber);
    const originalCode = capture.code();
    const wrong = originalCode === '000000' ? '111111' : '000000';
    await expect(s.auth.verifyOtp(f.challenge.challengeId, wrong, ctx)).rejects.toBeDefined();
    const before = await prisma.verificationToken.findUniqueOrThrow({
      where: { challengeId: f.challenge.challengeId },
    });
    const dispatchCount = s.delivery.dispatch.mock.calls.length;
    jest.spyOn(s.delivery, 'enqueue').mockResolvedValueOnce({ deliveryId: null, intent: null });

    await expect(s.auth.resendOtp(f.challenge.challengeId, ctx)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });

    expect(
      await prisma.verificationToken.findUniqueOrThrow({
        where: { challengeId: f.challenge.challengeId },
      }),
    ).toEqual(before);
    expect(s.delivery.dispatch.mock.calls.length).toBe(dispatchCount);
    await expect(
      s.auth.verifyOtp(f.challenge.challengeId, originalCode, ctx),
    ).resolves.toHaveProperty('issued.session.id');
  });

  it('links verified email to a phone-only account without using the enrollment OTP as a session', async () => {
    const capture = captureWhatsAppCodes();
    const f = await registerPhone(uniquePhone());
    await s.auth.verifyOtp(f.challenge.challengeId, capture.code(), ctx);
    const destination = email();
    const pending = await s.auth.requestEmailEnrollment(f.user.id, destination, password, ctx);
    const code = capture.code();
    expect(capture.captured.at(-1)).toMatchObject({
      channel: 'email',
      destination,
      purpose: 'EMAIL_CONTACT_OTP',
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).email).toBeNull();
    await expect(s.auth.verifyOtp(pending.challengeId, code, ctx)).rejects.toBeDefined();
    await s.auth.verifyEmailEnrollment(f.user.id, pending.challengeId, code, ctx);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    expect(updated.email).toBe(destination);
    expect(updated.emailVerifiedAt).toBeInstanceOf(Date);
    expect(updated.phoneVerifiedAt).toBeInstanceOf(Date);
    capture.channel.mockResolvedValue('email');
    await expect(s.auth.login({ phoneNumber: updated.phoneNumber! }, ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_CHANNEL_CHANGED' },
    });
    const login = await s.auth.login({ email: destination, password }, ctx);
    expect(login.channel).toBe('email');
    expect(capture.captured.at(-1)).toMatchObject({
      channel: 'email',
      destination,
      purpose: 'LOGIN_OTP',
    });
    await s.auth.verifyOtp(login.challengeId, capture.code(), ctx);
  });

  it.each(['forgotPassword', 'resendVerification'] as const)(
    '%s cannot issue a link to an email changed while it waits for the account lock',
    async (requestMethod) => {
      const f = await verified();
      if (requestMethod === 'resendVerification') {
        // A verified WhatsApp account can still have a pending, unverified email.
        await prisma.user.update({
          where: { id: f.user.id },
          data: {
            emailVerifiedAt: null,
            phoneNumber: uniquePhone(),
            phoneVerifiedAt: new Date(),
          },
        });
      }
      const destination = email();
      const pending = await s.auth.requestEmailEnrollment(f.user.id, destination, password, ctx);
      const code = mailCode(destination);
      const oldMessage = s.mail.lastSentTo(f.address);
      let releaseEnrollment!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseEnrollment = resolve;
      });
      let enrollmentWritten!: () => void;
      const written = new Promise<void>((resolve) => {
        enrollmentWritten = resolve;
      });
      let oldAddressRead!: () => void;
      const read = new Promise<void>((resolve) => {
        oldAddressRead = resolve;
      });
      const record = s.audit.record.bind(s.audit);
      jest.spyOn(s.audit, 'record').mockImplementation(async (...args: any[]) => {
        await record(...args);
        if (args[0].type === 'EMAIL_VERIFIED' && args[0].metadata?.reason === 'contact-linked') {
          enrollmentWritten();
          await gate;
        }
      });
      const findByEmail = s.users.findByEmail.bind(s.users);
      jest.spyOn(s.users, 'findByEmail').mockImplementation(async (...args: any[]) => {
        const user = await findByEmail(...args);
        if (args[0] === f.address) oldAddressRead();
        return user;
      });
      async function atBarrier(barrier: Promise<void>): Promise<void> {
        let timer!: ReturnType<typeof setTimeout>;
        try {
          await Promise.race([
            barrier,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Account race barrier timed out')), 2000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      const enrollment = s.auth.verifyEmailEnrollment(f.user.id, pending.challengeId, code, ctx);
      let request: Promise<void> | undefined;
      try {
        await atBarrier(written);
        request = s.auth[requestMethod](f.address, ctx);
        await atBarrier(read);
      } finally {
        releaseEnrollment();
        await Promise.all([enrollment, request]);
      }

      expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).email).toBe(
        destination,
      );
      expect(s.mail.lastSentTo(f.address)).toEqual(oldMessage);
      expect(
        await prisma.verificationToken.count({
          where: {
            userId: f.user.id,
            purpose: requestMethod === 'forgotPassword' ? 'PASSWORD_RESET' : 'EMAIL_VERIFICATION',
            usedAt: null,
          },
        }),
      ).toBe(0);
    },
  );
});
