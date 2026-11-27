import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { CURRENT_LEGAL_DOCUMENTS } from '@homeservicemarketplace/contracts';
import type { PrismaClient, User } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../src/config/app-config.service';
import { envSchema, type AppEnv } from '../../src/config/env.schema';
import { AuthChannelService } from '../../src/infrastructure/auth-channel/auth-channel.service';
import { OtpDeliveryService } from '../../src/infrastructure/auth-channel/otp-delivery.service';
import { WhatsAppAuthAdapter } from '../../src/infrastructure/auth-channel/whatsapp-auth.adapter';
import {
  AUTH_THROTTLE,
  DurableMailService,
} from '../../src/infrastructure/mail/durable-mail.service';
import { EmailDeliveryRepository } from '../../src/infrastructure/mail/email-delivery.repository';
import { InMemoryMailAdapter } from '../../src/infrastructure/mail/in-memory-mail.adapter';
import { MailEnvelopeCipher } from '../../src/infrastructure/mail/mail-envelope.cipher';
import { MailMetrics } from '../../src/infrastructure/mail/mail.metrics';
import {
  MAIL_PORT,
  MAIL_TRANSPORT,
  type MailTicket,
} from '../../src/infrastructure/mail/mail.port';
import { MAIL_ENVELOPE_CIPHER } from '../../src/infrastructure/mail/mail.tokens';
import { AuditEventRepository } from '../../src/infrastructure/persistence/iam/audit-event.repository';
import { RoleRepository } from '../../src/infrastructure/persistence/iam/role.repository';
import { SessionRepository } from '../../src/infrastructure/persistence/iam/session.repository';
import { UserRepository } from '../../src/infrastructure/persistence/iam/user.repository';
import { VerificationTokenRepository } from '../../src/infrastructure/persistence/iam/verification-token.repository';
import { PlatformSettingHistoryRepository } from '../../src/infrastructure/persistence/settings/platform-setting-history.repository';
import { PlatformSettingRepository } from '../../src/infrastructure/persistence/settings/platform-setting.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../src/infrastructure/prisma/transaction.runner';
import { MetricsService } from '../../src/infrastructure/telemetry/metrics.service';
import { AdminAuditService } from '../../src/modules/admin/admin-audit.service';
import { AdminSettingsService } from '../../src/modules/admin/settings/admin-settings.service';
import { AuditService } from '../../src/modules/iam/audit/audit.service';
import { OTP_HASH_PREFIX } from '../../src/modules/iam/authentication/helpers/otp-codec';
import {
  AuthenticationService,
  type OtpChallengeIssuance,
} from '../../src/modules/iam/authentication/services/authentication.service';
import { LoginAttemptService } from '../../src/modules/iam/authentication/services/login-attempt.service';
import { OtpService } from '../../src/modules/iam/authentication/services/otp.service';
import { PasswordService } from '../../src/modules/iam/authentication/services/password.service';
import { SessionService } from '../../src/modules/iam/authentication/services/session.service';
import { TokenService } from '../../src/modules/iam/authentication/services/token.service';
import { VerificationService } from '../../src/modules/iam/authentication/services/verification.service';
import { LegalAcceptanceService } from '../../src/modules/iam/legal/legal-acceptance.service';
import { SecurityEventsBus } from '../../src/shared/security-events/security-events.bus';
import { createIsolatedDatabase, type IsolatedDatabase } from '../support/isolated-database';
import { makeTestSecret } from '../support/test-secrets';

const suite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120_000);

// Real PostgreSQL, authentication policy, password/OTP services, role lookup,
// session signing, encrypted durable delivery and the GREEN-API transport.
// Only external HTTP delivery is replaced. Spies below observe real methods;
// they do not stub policy, transactions, counters, issuance or consumption.
suite('Passwordless WhatsApp login (isolated real PostgreSQL)', () => {
  let isolated: IsolatedDatabase | undefined;
  let module: TestingModule | undefined;
  let prisma: PrismaClient;
  let auth: AuthenticationService;
  let settings: AdminSettingsService;
  let channels: AuthChannelService;
  let tokens: TokenService;
  let passwordHash: string;
  let sequence = 0;
  let sent: Array<{ phone: string; code: string }>;
  let fetcher: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;
  let dispatched: jest.SpyInstance<Promise<void>, [MailTicket]>;
  let passwordChecks: jest.SpyInstance<Promise<boolean>, Parameters<PasswordService['verify']>>;
  const secret = makeTestSecret('passwordless-whatsapp-login-session');
  const providerToken = makeTestSecret('passwordless-whatsapp-login-provider');
  const password = 'synthetic-passwordless-compatibility-passphrase';
  const ctx = {
    device: {
      ipAddress: '127.0.0.1',
      userAgent: 'passwordless-whatsapp-integration',
      clientKind: 'WEB' as const,
    },
    requestId: 'passwordless-whatsapp-integration',
  };

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
      throw new Error('Passwordless integration requires local disposable PostgreSQL.');
    isolated = await createIsolatedDatabase('passwordless_wa');
    prisma = isolated.prisma;
    const values = envSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_ACCESS_SECRET: secret,
      JWT_ISSUER: 'hsm-api',
      JWT_AUDIENCE: 'hsm-clients',
      AUTH_REQUIRE_EMAIL_VERIFICATION: true,
      AUTH_ANTI_ENUM_DELAY_MS: 0,
      WHATSAPP_PROVIDER: 'greenapi',
      GREEN_API_URL: 'https://7107.api.greenapi.com',
      GREEN_API_ID_INSTANCE: '1234567890',
      GREEN_API_TOKEN: providerToken,
      WHATSAPP_REQUEST_TIMEOUT_MS: 1000,
    });
    const config = new AppConfigService(new ConfigService<AppEnv, true>(values));
    module = await Test.createTestingModule({
      providers: [
        { provide: AppConfigService, useValue: config },
        { provide: PrismaService, useValue: { client: prisma } },
        {
          provide: JwtService,
          useValue: new JwtService({
            secret,
            signOptions: { algorithm: 'HS256' },
            verifyOptions: { algorithms: ['HS256'] },
          }),
        },
        { provide: MAIL_TRANSPORT, useClass: InMemoryMailAdapter },
        { provide: MAIL_ENVELOPE_CIPHER, useValue: MailEnvelopeCipher.ephemeral() },
        { provide: MAIL_PORT, useExisting: DurableMailService },
        AuthenticationService,
        AdminSettingsService,
        AdminAuditService,
        AuthChannelService,
        WhatsAppAuthAdapter,
        OtpDeliveryService,
        DurableMailService,
        EmailDeliveryRepository,
        MailMetrics,
        MetricsService,
        UserRepository,
        RoleRepository,
        SessionRepository,
        VerificationTokenRepository,
        AuditEventRepository,
        PlatformSettingRepository,
        PlatformSettingHistoryRepository,
        TransactionRunner,
        PasswordService,
        TokenService,
        SessionService,
        VerificationService,
        OtpService,
        LoginAttemptService,
        AuditService,
        LegalAcceptanceService,
        SecurityEventsBus,
      ],
    }).compile();
    await module.init();
    auth = module.get(AuthenticationService);
    settings = module.get(AdminSettingsService);
    channels = module.get(AuthChannelService);
    tokens = module.get(TokenService);
    passwordHash = await module.get(PasswordService).hash(password);
    await prisma.role.createMany({
      data: ['customer', 'provider', 'admin'].map((name) => ({ name, isSystem: true })),
      skipDuplicates: true,
    });
  });

  beforeEach(async () => {
    await selectPolicy('whatsapp');
    sent = [];
    fetcher = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://7107.api.greenapi.com');
      expect(init?.redirect).toBe('error');
      if (url.pathname === `/waInstance1234567890/getStateInstance/${providerToken}`)
        return Response.json({ stateInstance: 'authorized' });
      if (url.pathname === `/waInstance1234567890/sendMessage/${providerToken}`) {
        const body = JSON.parse(String(init?.body)) as { chatId: string; message: string };
        const code = /Verification code: ([0-9]{6})/.exec(body.message)?.[1];
        if (!code || !/^[1-9][0-9]{6,14}@c\.us$/.test(body.chatId))
          throw new Error('Unexpected synthetic WhatsApp payload.');
        sent.push({ phone: `+${body.chatId.slice(0, -5)}`, code });
        return Response.json({ idMessage: `synthetic-accepted-${sent.length}` });
      }
      throw new Error('Unexpected external request in passwordless integration.');
    });
    dispatched = jest.spyOn(module!.get(OtpDeliveryService), 'dispatch');
    passwordChecks = jest.spyOn(module!.get(PasswordService), 'verify');
  });

  afterEach(async () => {
    await drainDispatches();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await module?.close();
    await isolated?.dispose();
  });

  function phoneNumber(): string {
    sequence += 1;
    return `+1555${String(sequence).padStart(7, '0')}`;
  }

  function registrationInput(phone: string) {
    return {
      phoneNumber: phone,
      password,
      firstName: 'Original',
      lastName: 'Registration profile',
      legalAcceptance: {
        termsVersion: CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version,
        privacyVersion: CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version,
        locale: 'en' as const,
      },
    };
  }

  async function account(
    changes: Partial<
      Pick<
        User,
        | 'email'
        | 'emailVerifiedAt'
        | 'phoneNumber'
        | 'phoneVerifiedAt'
        | 'status'
        | 'isActive'
        | 'deletedAt'
        | 'failedLoginCount'
        | 'lockedUntil'
      >
    > = {},
    role = 'customer',
  ): Promise<User> {
    return prisma.user.create({
      data: {
        id: `passwordless-${randomUUID()}`,
        email: `passwordless-${randomUUID()}@example.test`,
        emailVerifiedAt: new Date(),
        phoneNumber: phoneNumber(),
        phoneVerifiedAt: new Date(),
        firstName: 'Synthetic',
        lastName: 'Passwordless integration',
        status: 'ACTIVE',
        passwordHash,
        ...changes,
        userRoles: { create: { role: { connect: { name: role } } } },
      },
    });
  }

  async function selectPolicy(channel: 'email' | 'whatsapp'): Promise<void> {
    await prisma.platformSetting.upsert({
      where: { key: 'auth.otpChannel' },
      create: { key: 'auth.otpChannel', value: channel },
      update: { value: channel },
    });
  }

  // Issuance intentionally does not await delivery. Await its real promises
  // before reading the capture or restoring spies; no arbitrary sleeps.
  async function drainDispatches(): Promise<void> {
    if (!dispatched) return;
    await Promise.all(
      dispatched.mock.results
        .filter((result) => result.type === 'return')
        .map((result) => result.value as Promise<void>),
    );
  }

  async function deliveredCode(phone: string): Promise<string> {
    await drainDispatches();
    const code = sent.filter((message) => message.phone === phone).at(-1)?.code;
    if (!code) throw new Error('Expected captured synthetic WhatsApp code.');
    return code;
  }

  function assertEnvelope(result: OtpChallengeIssuance): void {
    expect(Object.keys(result).sort()).toEqual(
      ['challengeId', 'channel', 'codeLength', 'expiresInSeconds', 'maskedDestination'].sort(),
    );
    expect(result).toMatchObject({ channel: 'whatsapp', codeLength: 6, expiresInSeconds: 300 });
    expect(result.challengeId).toMatch(/^wa_login_[A-Za-z0-9_-]{32}$/);
  }

  describe('pending WhatsApp registration recovery', () => {
    it('restarts expired verification for the existing account and preserves identity until the fresh OTP is proven', async () => {
      const input = registrationInput(phoneNumber());
      const original = await auth.register(input, ctx);
      const originalCode = await deliveredCode(input.phoneNumber);
      const before = await prisma.user.findFirstOrThrow({
        where: { phoneNumber: input.phoneNumber },
      });
      const originalRoles = await prisma.userRole.findMany({ where: { userId: before.id } });
      const originalAcceptance = await prisma.userLegalAcceptance.findMany({
        where: { userId: before.id },
        orderBy: { documentKind: 'asc' },
      });
      await prisma.verificationToken.update({
        where: { challengeId: original.challengeId },
        data: { expiresAt: new Date(Date.now() - 1000), attemptCount: 2, resendCount: 1 },
      });
      await expect(auth.resendOtp(original.challengeId, ctx)).rejects.toMatchObject({
        response: { code: 'AUTH_OTP_EXPIRED' },
      });

      const recovered = await auth.register(
        { ...input, firstName: 'Replacement', lastName: 'Must not overwrite' },
        ctx,
      );
      const code = await deliveredCode(input.phoneNumber);

      expect(recovered.challengeId).not.toBe(original.challengeId);
      expect(recovered).toMatchObject({
        channel: 'whatsapp',
        codeLength: 6,
        expiresInSeconds: 300,
      });
      await expect(prisma.user.count({ where: { phoneNumber: input.phoneNumber } })).resolves.toBe(
        1,
      );
      await expect(prisma.user.findUniqueOrThrow({ where: { id: before.id } })).resolves.toEqual(
        before,
      );
      await expect(prisma.userRole.findMany({ where: { userId: before.id } })).resolves.toEqual(
        originalRoles,
      );
      await expect(
        prisma.userLegalAcceptance.findMany({
          where: { userId: before.id },
          orderBy: { documentKind: 'asc' },
        }),
      ).resolves.toEqual(originalAcceptance);
      await expect(prisma.session.count({ where: { userId: before.id } })).resolves.toBe(0);
      await expect(
        prisma.verificationToken.findUniqueOrThrow({
          where: { challengeId: recovered.challengeId },
        }),
      ).resolves.toMatchObject({
        userId: before.id,
        purpose: 'REGISTRATION_OTP',
        deliveryChannel: 'whatsapp',
        deliveryTarget: input.phoneNumber,
        usedAt: null,
        attemptCount: 0,
        resendCount: 0,
      });
      await expect(
        prisma.emailDelivery.count({ where: { userId: before.id, status: 'ACCEPTED' } }),
      ).resolves.toBe(2);
      await expect(
        prisma.auditEvent.findMany({ where: { userId: before.id, type: 'USER_REGISTERED' } }),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ metadata: { outcome: 'created' } }),
          expect.objectContaining({ metadata: { outcome: 'verification-restarted' } }),
        ]),
      );
      await expect(auth.verifyOtp(original.challengeId, originalCode, ctx)).rejects.toMatchObject({
        response: { code: 'AUTH_OTP_INVALID' },
      });
      const login = await auth.verifyOtp(recovered.challengeId, code, ctx);
      expect(login.roles).toEqual(['customer']);
      expect(login.issued.session.userId).toBe(before.id);
      await expect(
        prisma.user.findUniqueOrThrow({ where: { id: before.id } }),
      ).resolves.toMatchObject({
        status: 'ACTIVE',
        phoneVerifiedAt: expect.any(Date),
      });
      await expect(prisma.session.count({ where: { userId: before.id } })).resolves.toBe(1);
    });

    it('keeps wrong-password and already verified duplicate signups neutral without touching the existing challenge', async () => {
      const input = registrationInput(phoneNumber());
      const original = await auth.register(input, ctx);
      const originalCode = await deliveredCode(input.phoneNumber);
      const before = await prisma.user.findFirstOrThrow({
        where: { phoneNumber: input.phoneNumber },
      });
      const originalToken = await prisma.verificationToken.findUniqueOrThrow({
        where: { challengeId: original.challengeId },
      });

      const neutral = await auth.register(
        { ...input, password: 'incorrect-synthetic-password' },
        ctx,
      );

      await expect(
        prisma.verificationToken.findUnique({ where: { challengeId: neutral.challengeId } }),
      ).resolves.toBeNull();
      await expect(
        prisma.verificationToken.findUniqueOrThrow({ where: { id: originalToken.id } }),
      ).resolves.toEqual(originalToken);
      await expect(prisma.user.findUniqueOrThrow({ where: { id: before.id } })).resolves.toEqual(
        before,
      );
      await expect(prisma.emailDelivery.count({ where: { userId: before.id } })).resolves.toBe(1);
      expect(sent.filter((message) => message.phone === input.phoneNumber)).toHaveLength(1);

      await auth.verifyOtp(original.challengeId, originalCode, ctx);
      const activeDuplicate = await auth.register(input, ctx);

      await expect(
        prisma.verificationToken.findUnique({
          where: { challengeId: activeDuplicate.challengeId },
        }),
      ).resolves.toBeNull();
      await expect(prisma.verificationToken.count({ where: { userId: before.id } })).resolves.toBe(
        1,
      );
      await expect(prisma.emailDelivery.count({ where: { userId: before.id } })).resolves.toBe(1);
      await expect(prisma.session.count({ where: { userId: before.id } })).resolves.toBe(1);
    });

    it('rolls challenge replacement and recovery audit back when durable delivery fails', async () => {
      const input = registrationInput(phoneNumber());
      const original = await auth.register(input, ctx);
      await deliveredCode(input.phoneNumber);
      const before = await prisma.user.findFirstOrThrow({
        where: { phoneNumber: input.phoneNumber },
      });
      const originalToken = await prisma.verificationToken.update({
        where: { challengeId: original.challengeId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const auditCount = await prisma.auditEvent.count({ where: { userId: before.id } });
      jest
        .spyOn(module!.get(OtpDeliveryService), 'enqueue')
        .mockRejectedValueOnce(new Error('Synthetic outbox failure'));

      await expect(auth.register(input, ctx)).rejects.toThrow('Synthetic outbox failure');

      await expect(
        prisma.verificationToken.findUniqueOrThrow({ where: { id: originalToken.id } }),
      ).resolves.toEqual(originalToken);
      await expect(prisma.verificationToken.count({ where: { userId: before.id } })).resolves.toBe(
        1,
      );
      await expect(prisma.emailDelivery.count({ where: { userId: before.id } })).resolves.toBe(1);
      await expect(prisma.auditEvent.count({ where: { userId: before.id } })).resolves.toBe(
        auditCount,
      );
      await expect(prisma.user.findUniqueOrThrow({ where: { id: before.id } })).resolves.toEqual(
        before,
      );
      expect(dispatched).toHaveBeenCalledTimes(1);
    });

    it('rechecks account activation committed while recovery waits for its account lock', async () => {
      const input = registrationInput(phoneNumber());
      const original = await auth.register(input, ctx);
      await deliveredCode(input.phoneNumber);
      const before = await prisma.user.findFirstOrThrow({
        where: { phoneNumber: input.phoneNumber },
      });
      let releaseActivation!: () => void;
      let activationLocked!: () => void;
      let accountRead!: () => void;
      const release = new Promise<void>((resolve) => {
        releaseActivation = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        activationLocked = resolve;
      });
      const read = new Promise<void>((resolve) => {
        accountRead = resolve;
      });
      const users = module!.get(UserRepository);
      const findByPhoneNumber = users.findByPhoneNumber.bind(users);
      jest.spyOn(users, 'findByPhoneNumber').mockImplementationOnce(async (...args) => {
        const result = await findByPhoneNumber(...args);
        accountRead();
        return result;
      });
      const activation = prisma.$transaction(async (trx) => {
        await trx.user.update({
          where: { id: before.id },
          data: { status: 'ACTIVE', phoneVerifiedAt: new Date() },
        });
        activationLocked();
        await release;
      });
      let recovery: Promise<OtpChallengeIssuance> | undefined;
      try {
        await locked;
        recovery = auth.register(input, ctx);
        await read;
      } finally {
        releaseActivation();
      }
      await activation;
      const neutral = await recovery!;

      await expect(
        prisma.verificationToken.findUnique({ where: { challengeId: neutral.challengeId } }),
      ).resolves.toBeNull();
      await expect(
        prisma.verificationToken.findUniqueOrThrow({
          where: { challengeId: original.challengeId },
        }),
      ).resolves.toMatchObject({ usedAt: null });
      await expect(prisma.verificationToken.count({ where: { userId: before.id } })).resolves.toBe(
        1,
      );
      await expect(prisma.emailDelivery.count({ where: { userId: before.id } })).resolves.toBe(1);
      await expect(prisma.session.count({ where: { userId: before.id } })).resolves.toBe(0);
    });
  });

  it.each(['customer', 'provider', 'admin'])(
    'issues no session or password check before phone proof, then one session with the existing %s role',
    async (role) => {
      const expiredLock = new Date(Date.now() - 1000);
      const user = await account({ failedLoginCount: 2, lockedUntil: expiredLock }, role);
      const challenge = await auth.login({ phoneNumber: user.phoneNumber! }, ctx);
      assertEnvelope(challenge);
      expect(passwordChecks).not.toHaveBeenCalled();
      expect(challenge.maskedDestination).not.toBe(user.phoneNumber);
      await expect(prisma.session.count({ where: { userId: user.id } })).resolves.toBe(0);
      await expect(
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      ).resolves.toMatchObject({
        failedLoginCount: 2,
        lockedUntil: expiredLock,
      });
      const row = await prisma.verificationToken.findUniqueOrThrow({
        where: { challengeId: challenge.challengeId },
      });
      expect(row).toMatchObject({
        userId: user.id,
        purpose: 'LOGIN_OTP',
        deliveryChannel: 'whatsapp',
        deliveryTarget: user.phoneNumber,
        usedAt: null,
      });
      expect(row.tokenHash.startsWith(OTP_HASH_PREFIX)).toBe(true);
      const code = await deliveredCode(user.phoneNumber!);
      const results = await Promise.allSettled([
        auth.verifyOtp(challenge.challengeId, code, ctx),
        auth.verifyOtp(challenge.challengeId, code, ctx),
      ]);
      const winner = results.find((result) => result.status === 'fulfilled');
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      if (winner?.status !== 'fulfilled') throw new Error('Expected exactly one session winner.');
      expect(winner.value.roles).toEqual([role]);
      expect(tokens.verifyAccessToken(winner.value.issued.access.token)).toMatchObject({
        sub: user.id,
        roles: [role],
        sid: winner.value.issued.session.id,
      });
      await expect(prisma.session.count({ where: { userId: user.id } })).resolves.toBe(1);
      await expect(
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      ).resolves.toMatchObject({
        failedLoginCount: 0,
        lockedUntil: null,
      });
      await expect(auth.verifyOtp(challenge.challengeId, code, ctx)).rejects.toMatchObject({
        response: { code: 'AUTH_OTP_INVALID' },
      });
    },
  );

  it.each([
    'unknown',
    'unverified',
    'pending',
    'suspended',
    'locked-status',
    'locked-until',
    'inactive',
    'deleted',
  ] as const)(
    'returns a neutral marked challenge for an %s phone without sending or creating a session',
    async (state) => {
      const phone = phoneNumber();
      const user =
        state === 'unknown'
          ? null
          : await account({
              phoneNumber: phone,
              ...(state === 'unverified' ? { phoneVerifiedAt: null } : {}),
              ...(state === 'pending'
                ? { status: 'PENDING_VERIFICATION', phoneVerifiedAt: null }
                : {}),
              ...(state === 'suspended' ? { status: 'SUSPENDED' } : {}),
              ...(state === 'locked-status' ? { status: 'LOCKED' } : {}),
              ...(state === 'locked-until' ? { lockedUntil: new Date(Date.now() + 60_000) } : {}),
              ...(state === 'inactive' ? { isActive: false } : {}),
              ...(state === 'deleted' ? { deletedAt: new Date() } : {}),
            });
      const challenge = await auth.login({ phoneNumber: phone }, ctx);
      assertEnvelope(challenge);
      expect(passwordChecks).not.toHaveBeenCalled();
      await expect(
        prisma.verificationToken.findUnique({ where: { challengeId: challenge.challengeId } }),
      ).resolves.toBeNull();
      expect(dispatched).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
      if (user) {
        await expect(prisma.session.count({ where: { userId: user.id } })).resolves.toBe(0);
        await expect(prisma.emailDelivery.count({ where: { userId: user.id } })).resolves.toBe(0);
      } else {
        await expect(prisma.user.findUnique({ where: { phoneNumber: phone } })).resolves.toBeNull();
      }
    },
  );

  it('never treats an editable profile phone as a verified account identity', async () => {
    const phone = phoneNumber();
    const user = await account({ phoneNumber: null, phoneVerifiedAt: null });
    await prisma.userProfile.create({ data: { userId: user.id, phoneNumber: phone } });
    const challenge = await auth.login({ phoneNumber: phone }, ctx);
    assertEnvelope(challenge);
    expect(passwordChecks).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(prisma.verificationToken.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.session.count({ where: { userId: user.id } })).resolves.toBe(0);
  });

  it('rejects off-policy identities before password checks or challenge creation', async () => {
    const user = await account();
    await expect(auth.login({ email: user.email!, password }, ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_CHANNEL_CHANGED' },
    });
    await selectPolicy('email');
    await expect(auth.login({ phoneNumber: user.phoneNumber! }, ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_CHANNEL_CHANGED' },
    });
    expect(passwordChecks).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(prisma.verificationToken.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.session.count({ where: { userId: user.id } })).resolves.toBe(0);
  });

  it('keeps expired verification and resend strict, then issues a fresh phone-only challenge', async () => {
    const user = await account();
    const expired = await auth.login({ phoneNumber: user.phoneNumber! }, ctx);
    const expiredCode = await deliveredCode(user.phoneNumber!);
    await prisma.verificationToken.update({
      where: { challengeId: expired.challengeId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(auth.verifyOtp(expired.challengeId, expiredCode, ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_OTP_EXPIRED' },
    });
    await expect(auth.resendOtp(expired.challengeId, ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_OTP_EXPIRED' },
    });
    await expect(prisma.session.count({ where: { userId: user.id } })).resolves.toBe(0);

    const fresh = await auth.login({ phoneNumber: user.phoneNumber! }, ctx);
    expect(fresh.challengeId).not.toBe(expired.challengeId);
    assertEnvelope(fresh);
    const freshCode = await deliveredCode(user.phoneNumber!);
    await expect(auth.verifyOtp(expired.challengeId, expiredCode, ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_OTP_INVALID' },
    });
    await expect(auth.verifyOtp(fresh.challengeId, freshCode, ctx)).resolves.toHaveProperty(
      'issued.session.id',
    );
    expect(passwordChecks).not.toHaveBeenCalled();
  });

  it('resends a live challenge without clearing its attempt count and rejects the replaced code', async () => {
    const user = await account();
    const challenge = await auth.login({ phoneNumber: user.phoneNumber! }, ctx);
    const originalCode = await deliveredCode(user.phoneNumber!);
    const wrong = originalCode === '000000' ? '111111' : '000000';
    await expect(auth.verifyOtp(challenge.challengeId, wrong, ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_OTP_INVALID' },
    });
    await expect(auth.resendOtp(challenge.challengeId, ctx)).resolves.toEqual({
      expiresInSeconds: 300,
    });
    const latestCode = await deliveredCode(user.phoneNumber!);
    expect(latestCode).not.toBe(originalCode);
    await expect(
      prisma.verificationToken.findUniqueOrThrow({ where: { challengeId: challenge.challengeId } }),
    ).resolves.toMatchObject({ attemptCount: 1, resendCount: 1, usedAt: null });
    await expect(auth.verifyOtp(challenge.challengeId, originalCode, ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_OTP_INVALID' },
    });
    await expect(auth.verifyOtp(challenge.challengeId, latestCode, ctx)).resolves.toHaveProperty(
      'issued.session.id',
    );
  });

  it('preserves an issued challenge through an audited admin switch without rerouting its resend', async () => {
    const user = await account();
    const admin = await account({}, 'admin');
    const challenge = await auth.login({ phoneNumber: user.phoneNumber! }, ctx);
    await deliveredCode(user.phoneNumber!);
    await settings.updateBulk(admin.id, { 'auth.otpChannel': 'email' });
    await expect(channels.getPublicConfig()).resolves.toMatchObject({ otpChannel: 'email' });
    await expect(auth.login({ phoneNumber: user.phoneNumber! }, ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_CHANNEL_CHANGED' },
    });
    await auth.resendOtp(challenge.challengeId, ctx);
    const code = await deliveredCode(user.phoneNumber!);
    await expect(
      prisma.verificationToken.findUniqueOrThrow({ where: { challengeId: challenge.challengeId } }),
    ).resolves.toMatchObject({ deliveryChannel: 'whatsapp', deliveryTarget: user.phoneNumber });
    expect(module!.get<InMemoryMailAdapter>(MAIL_TRANSPORT).outbox).toHaveLength(0);
    await expect(auth.verifyOtp(challenge.challengeId, code, ctx)).resolves.toHaveProperty(
      'issued.session.id',
    );
    await expect(
      prisma.platformSettingHistory.count({
        where: { key: 'auth.otpChannel', changedBy: admin.id },
      }),
    ).resolves.toBe(1);
  });

  it('serializes the recipient budget and rolls suppressed issuance back without destroying the usable code', async () => {
    const user = await account({ failedLoginCount: 2 });
    for (let index = 0; index < AUTH_THROTTLE.limit - 1; index += 1) {
      await auth.login({ phoneNumber: user.phoneNumber! }, ctx);
      await drainDispatches();
    }
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => auth.login({ phoneNumber: user.phoneNumber! }, ctx)),
    );
    concurrent.forEach(assertEnvelope);
    await drainDispatches();
    const rows = await prisma.verificationToken.findMany({
      where: { userId: user.id, purpose: 'LOGIN_OTP' },
    });
    expect(rows).toHaveLength(AUTH_THROTTLE.limit);
    const ids = new Set(rows.map((row) => row.challengeId));
    expect(concurrent.filter((result) => ids.has(result.challengeId))).toHaveLength(1);
    expect(concurrent.filter((result) => !ids.has(result.challengeId))).toHaveLength(4);
    expect(rows.filter((row) => row.usedAt === null)).toHaveLength(1);
    const current = rows.find((row) => row.usedAt === null)!;
    const code = await deliveredCode(user.phoneNumber!);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(auth.verifyOtp(current.challengeId!, wrong, ctx)).rejects.toMatchObject({
      response: { code: 'AUTH_OTP_INVALID' },
    });
    const before = await prisma.verificationToken.findUniqueOrThrow({ where: { id: current.id } });
    const neutral = await auth.login({ phoneNumber: user.phoneNumber! }, ctx);
    assertEnvelope(neutral);
    expect(ids.has(neutral.challengeId)).toBe(false);
    await expect(
      prisma.verificationToken.findUniqueOrThrow({ where: { id: current.id } }),
    ).resolves.toEqual(before);
    await expect(prisma.emailDelivery.count({ where: { userId: user.id } })).resolves.toBe(
      AUTH_THROTTLE.limit,
    );
    expect(sent.filter((message) => message.phone === user.phoneNumber)).toHaveLength(
      AUTH_THROTTLE.limit,
    );
    await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({
      failedLoginCount: 2,
    });
    await expect(auth.verifyOtp(current.challengeId!, code, ctx)).resolves.toHaveProperty(
      'issued.session.id',
    );
    expect(passwordChecks).not.toHaveBeenCalled();
  });
});
