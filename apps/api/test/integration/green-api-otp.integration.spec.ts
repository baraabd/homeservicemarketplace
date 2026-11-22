import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../src/config/app-config.service';
import { envSchema, type AppEnv } from '../../src/config/env.schema';
import { AuthChannelService } from '../../src/infrastructure/auth-channel/auth-channel.service';
import { OtpDeliveryService } from '../../src/infrastructure/auth-channel/otp-delivery.service';
import { WhatsAppAuthAdapter } from '../../src/infrastructure/auth-channel/whatsapp-auth.adapter';
import { DurableMailService } from '../../src/infrastructure/mail/durable-mail.service';
import { EmailDeliveryRepository } from '../../src/infrastructure/mail/email-delivery.repository';
import { InMemoryMailAdapter } from '../../src/infrastructure/mail/in-memory-mail.adapter';
import { MailEnvelopeCipher } from '../../src/infrastructure/mail/mail-envelope.cipher';
import { MailMetrics } from '../../src/infrastructure/mail/mail.metrics';
import { VerificationTokenRepository } from '../../src/infrastructure/persistence/iam/verification-token.repository';
import { PlatformSettingRepository } from '../../src/infrastructure/persistence/settings/platform-setting.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { MetricsService } from '../../src/infrastructure/telemetry/metrics.service';
import { OTP_HASH_PREFIX } from '../../src/modules/iam/authentication/helpers/otp-codec';
import { OtpService } from '../../src/modules/iam/authentication/services/otp.service';
import { createIsolatedDatabase, type IsolatedDatabase } from '../support/isolated-database';
import { makeTestSecret } from '../support/test-secrets';

const suite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120_000);

// PostgreSQL, validated configuration, challenge hashing/consumption, encrypted
// intents, queue claims, retries and the WhatsApp adapter are real. Only the
// external GREEN-API HTTP boundary is mocked; this suite never sends a message.
suite('GREEN-API OTP pipeline (isolated real PostgreSQL)', () => {
  let isolated: IsolatedDatabase | undefined;
  let prisma: PrismaClient;
  let channels: AuthChannelService;
  let otp: OtpService;
  let delivery: OtpDeliveryService;
  let email: InMemoryMailAdapter;
  let userId: string;
  let phone: string;
  let sequence = 0;
  let state: 'authorized' | 'notAuthorized';
  let fetcher: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;
  let sent: Array<{ chatId: string; message: string }>;
  const providerToken = makeTestSecret('green-api-pipeline-provider');

  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
      throw new Error('GREEN-API integration requires local disposable PostgreSQL.');
    isolated = await createIsolatedDatabase('green_api_otp');
    prisma = isolated.prisma;
  });

  beforeEach(async () => {
    const values = envSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      JWT_ACCESS_SECRET: makeTestSecret('green-api-pipeline-otp'),
      WHATSAPP_PROVIDER: 'greenapi',
      GREEN_API_URL: 'https://7107.api.greenapi.com',
      GREEN_API_ID_INSTANCE: '1234567890',
      GREEN_API_TOKEN: providerToken,
      WHATSAPP_REQUEST_TIMEOUT_MS: 1000,
    });
    const config = new AppConfigService(new ConfigService<AppEnv, true>(values));
    const database = { client: prisma } as PrismaService;
    const whatsapp = new WhatsAppAuthAdapter(config);
    channels = new AuthChannelService(new PlatformSettingRepository(database), whatsapp);
    otp = new OtpService(new VerificationTokenRepository(database), config);
    email = new InMemoryMailAdapter();
    const mail = new DurableMailService(
      email,
      MailEnvelopeCipher.ephemeral(),
      new EmailDeliveryRepository(database),
      database,
      config,
      new MailMetrics(new MetricsService()),
      whatsapp,
    );
    delivery = new OtpDeliveryService(mail, channels);
    sequence += 1;
    phone = `+9665${String(sequence).padStart(8, '0')}`;
    userId = `green-otp-${randomUUID()}`;
    await prisma.user.create({
      data: {
        id: userId,
        phoneNumber: phone,
        firstName: 'Synthetic',
        lastName: 'Green OTP integration',
      },
    });
    state = 'authorized';
    sent = [];
    fetcher = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://7107.api.greenapi.com');
      expect(init?.redirect).toBe('error');
      if (url.pathname === `/waInstance1234567890/getStateInstance/${providerToken}`) {
        expect(init?.method).toBe('GET');
        return Response.json({ stateInstance: state });
      }
      if (url.pathname === `/waInstance1234567890/sendMessage/${providerToken}`) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body)) as { chatId: string; message: string };
        expect(body.chatId).toBe(`${phone.slice(1)}@c.us`);
        expect(typeof body.message).toBe('string');
        sent.push(body);
        return Response.json({ idMessage: `synthetic-accepted-${sent.length}` });
      }
      throw new Error('Unexpected external request in GREEN-API integration fixture.');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await isolated?.dispose();
  });

  async function enqueue() {
    return prisma.$transaction(async (tx) => {
      const channel = await channels.getChannel(tx);
      const challenge = await otp.issue(userId, 'LOGIN_OTP', tx, {
        channel,
        destination: phone,
      });
      const ticket = await delivery.enqueue(
        {
          channel,
          destination: phone,
          userId,
          rawCode: challenge.rawCode,
          purpose: 'LOGIN_OTP',
          expiresAt: challenge.expiresAt,
        },
        tx,
      );
      return { challenge, ticket };
    });
  }

  it('advertises readiness, queues a sealed challenge, sends its code and consumes it only once', async () => {
    await expect(channels.getPublicConfig()).resolves.toEqual({
      otpChannel: 'whatsapp',
      whatsappAvailable: true,
    });
    expect(fetcher).not.toHaveBeenCalled();

    const { challenge, ticket } = await enqueue();
    const token = await prisma.verificationToken.findUniqueOrThrow({
      where: { challengeId: challenge.challengeId },
    });
    expect(token).toMatchObject({
      userId,
      purpose: 'LOGIN_OTP',
      deliveryChannel: 'whatsapp',
      deliveryTarget: phone,
      usedAt: null,
    });
    expect(token.tokenHash.startsWith(OTP_HASH_PREFIX)).toBe(true);
    expect(token.tokenHash).not.toBe(challenge.rawCode);
    const queued = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: ticket.deliveryId! },
    });
    expect(queued).toMatchObject({ status: 'QUEUED', attempts: 0, category: 'AUTH' });
    expect(queued.envelope).not.toBeNull();
    expect(Buffer.from(queued.envelope!).toString('utf8')).not.toContain(challenge.rawCode);
    expect(fetcher).not.toHaveBeenCalled();

    await delivery.dispatch(ticket);
    expect(sent).toHaveLength(1);
    const deliveredCode = /Verification code: ([0-9]{6})/.exec(sent[0]!.message)?.[1];
    expect(deliveredCode).toBe(challenge.rawCode);
    expect(email.outbox).toHaveLength(0);
    await expect(
      prisma.emailDelivery.findUniqueOrThrow({ where: { id: ticket.deliveryId! } }),
    ).resolves.toMatchObject({ status: 'ACCEPTED', attempts: 1, envelope: null });

    const verified = await prisma.$transaction((tx) =>
      otp.verifyForLogin(challenge.challengeId, deliveredCode!, tx),
    );
    expect(verified).toEqual({
      consumed: { userId, purpose: 'LOGIN_OTP', channel: 'whatsapp', destination: phone },
    });
    const replay = await prisma.$transaction((tx) =>
      otp.verifyForLogin(challenge.challengeId, deliveredCode!, tx),
    );
    expect('rejection' in replay && replay.rejection.getResponse()).toEqual({
      code: 'AUTH_OTP_INVALID',
    });
    await delivery.dispatch(ticket);
    expect(sent).toHaveLength(1);
  });

  it('retains a retryable intent while unauthorized and sends it after instance recovery', async () => {
    state = 'notAuthorized';
    const { challenge, ticket } = await enqueue();
    await delivery.dispatch(ticket);

    const pending = await prisma.emailDelivery.findUniqueOrThrow({
      where: { id: ticket.deliveryId! },
    });
    expect(pending).toMatchObject({
      status: 'QUEUED',
      attempts: 1,
      lastErrorClass: 'config',
      acceptedAt: null,
    });
    expect(pending.envelope).not.toBeNull();
    expect(pending.nextAttemptAt.getTime()).toBeLessThan(challenge.expiresAt.getTime());
    expect(sent).toHaveLength(0);
    expect(email.outbox).toHaveLength(0);

    state = 'authorized';
    await prisma.emailDelivery.update({
      where: { id: ticket.deliveryId! },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await delivery.dispatch(ticket);
    expect(sent).toHaveLength(1);
    await expect(
      prisma.emailDelivery.findUniqueOrThrow({ where: { id: ticket.deliveryId! } }),
    ).resolves.toMatchObject({
      status: 'ACCEPTED',
      attempts: 2,
      lastErrorClass: null,
      envelope: null,
    });
  });

  it('expires an unsent intent without calling the provider and rejects its expired challenge', async () => {
    const { challenge, ticket } = await enqueue();
    const expiredAt = new Date(Date.now() - 1000);
    await prisma.$transaction([
      prisma.verificationToken.update({
        where: { challengeId: challenge.challengeId },
        data: { expiresAt: expiredAt },
      }),
      prisma.emailDelivery.update({
        where: { id: ticket.deliveryId! },
        data: { expiresAt: expiredAt },
      }),
    ]);
    await delivery.dispatch(ticket);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      prisma.emailDelivery.findUniqueOrThrow({ where: { id: ticket.deliveryId! } }),
    ).resolves.toMatchObject({ status: 'EXPIRED', attempts: 0, envelope: null });
    const verified = await prisma.$transaction((tx) =>
      otp.verifyForLogin(challenge.challengeId, challenge.rawCode, tx),
    );
    expect('rejection' in verified && verified.rejection.getResponse()).toEqual({
      code: 'AUTH_OTP_EXPIRED',
    });
  });

  it('rolls back both challenge and outbound intent when the issuing transaction fails', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const challenge = await otp.issue(userId, 'LOGIN_OTP', tx, {
          channel: 'whatsapp',
          destination: phone,
        });
        await delivery.enqueue(
          {
            channel: 'whatsapp',
            destination: phone,
            userId,
            rawCode: challenge.rawCode,
            purpose: 'LOGIN_OTP',
            expiresAt: challenge.expiresAt,
          },
          tx,
        );
        throw new Error('Synthetic producer rollback');
      }),
    ).rejects.toThrow('Synthetic producer rollback');

    await expect(prisma.verificationToken.count({ where: { userId } })).resolves.toBe(0);
    await expect(prisma.emailDelivery.count({ where: { userId } })).resolves.toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    expect(email.outbox).toHaveLength(0);
  });
});
