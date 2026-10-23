import { MONEY_CONTRACT_VERSION } from '@homeservicemarketplace/contracts';
import type { PrismaClient } from '@homeservicemarketplace/database';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { buildRequestBodyParser } from '../../src/infrastructure/http/request-body';
import { InMemoryMailAdapter } from '../../src/infrastructure/mail/in-memory-mail.adapter';
import {
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
  type MoneyBindingConfiguration,
  type MoneyCollectionAdapterPort,
  type MoneyCollectionCommand,
  type MoneyConfigurationPort,
  type MoneyExternalEventInput,
  type NormalizedMoneyExternalEvent,
} from '../../src/modules/money/ports/collection.port';
import { createIsolatedDatabase, type IsolatedDatabase } from './isolated-database';

const ACCOUNT_NAMES = [
  'active',
  'pending',
  'failed',
  'expired',
  'cancelled',
  'actionRequired',
  'ungranted',
] as const;
type AccountName = (typeof ACCOUNT_NAMES)[number];

interface BrowserAccount {
  email: string;
  password: string;
  userId: string;
  providerProfileId: string;
  subscriptionId: string | null;
  otpFile: string;
}

/** A previous-wave collection CONTRACT component. This neither contacts a rail
 * nor validates a real provider signature. Only R31's participant is genuine. */
class BrowserCollectionComponent implements MoneyCollectionAdapterPort {
  readonly events = new Map<string, NormalizedMoneyExternalEvent>();
  readonly proof = randomBytes(32).toString('base64url');
  readonly failures = new Set<string>();
  calls = 0;

  isConfigured(): boolean {
    return true;
  }

  async createOrResume(command: MoneyCollectionCommand) {
    this.calls++;
    return {
      status: this.failures.has(command.paymentIntentId)
        ? ('FAILED' as const)
        : ('PENDING' as const),
      externalOperationId:
        command.externalOperationId ?? `r31-component-${command.paymentAttemptId}`,
    };
  }

  async validateAndNormalizeExternalEvent(input: MoneyExternalEventInput) {
    const id = (input.payload as { fixtureEventId?: unknown }).fixtureEventId;
    const event = typeof id === 'string' ? this.events.get(id) : undefined;
    if (input.headers['x-r31-component-proof'] !== this.proof || !event) {
      throw new Error('R31 synthetic collection component rejected its private event proof.');
    }
    return { ...event };
  }
}

class BrowserConfigurationComponent implements MoneyConfigurationPort {
  readonly bindings = new Map<string, MoneyBindingConfiguration>();
  async resolve(input: { planVersionId: string; method: string }) {
    return this.bindings.get(`${input.planVersionId}:${input.method}`) ?? null;
  }
}

function requireLoopback(value: string | undefined, protocol: string): URL {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error('R31 requires an explicit loopback service URL.');
  }
  if (url.protocol !== protocol || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('R31 services must use nonproduction loopback targets.');
  }
  return url;
}

export interface R31BrowserFixture {
  app: NestExpressApplication;
  prisma: PrismaClient;
  url: string;
  credentialsFile: string;
  /** No identity, credential, connection string or token appears in evidence. */
  evidence: {
    application: 'REAL_APPMODULE';
    database: 'NEW_MIGRATED_DATABASE';
    redis: 'REAL_LOOPBACK_REDIS';
    authentication: 'REAL_COOKIE_LOGIN_AND_DELIVERED_OTP';
    configurationAndCollection: 'SYNTHETIC_CONTRACT_COMPONENTS';
    activationParticipant: 'REAL_R31_PARTICIPANT';
    paymentConfirmations: number;
    subscriptionPeriods: number;
    ledgerPostings: number;
    usageEvents: number;
    workAccessGrants: number;
    collectionComponentCalls: number;
  };
  dispose(): Promise<void>;
}

/** Real AppModule/guards/OTP/cookies/DB/Redis. No HTTP debug route is created.
 * Credentials and captured test-mail codes exist only in a caller-owned 0700
 * directory and 0600 files. All financial writes target a newly migrated DB. */
export async function r31BrowserFixture(options: {
  webOrigin: string;
  apiPort: number;
  privateDir: string;
}): Promise<R31BrowserFixture> {
  if (
    process.env.RUN_DB_INTEGRATION !== '1' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.APP_ENV !== 'test'
  )
    throw new Error('R31 requires RUN_DB_INTEGRATION=1 and both test environments.');
  requireLoopback(process.env.DATABASE_URL, 'postgresql:');
  const web = requireLoopback(options.webOrigin, 'http:');
  if (
    web.origin !== options.webOrigin ||
    !Number.isInteger(options.apiPort) ||
    options.apiPort < 1024 ||
    options.apiPort > 65535
  )
    throw new Error('Invalid R31 browser endpoints.');
  const redisUrl = process.env.REDIS_URL
    ? requireLoopback(process.env.REDIS_URL, 'redis:')
    : undefined;
  const redisHost = redisUrl?.hostname ?? process.env.REDIS_HOST;
  if (!['127.0.0.1', 'localhost', '::1'].includes(redisHost ?? '')) {
    throw new Error('R31 requires an explicit loopback Redis instance.');
  }
  const redisPort = Number(redisUrl?.port || process.env.REDIS_PORT);
  if (!Number.isInteger(redisPort) || redisPort < 1024 || redisPort > 65535) {
    throw new Error('R31 requires an explicit disposable Redis port.');
  }
  const directory = await lstat(options.privateDir);
  if (
    !isAbsolute(options.privateDir) ||
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o077) !== 0 ||
    (process.getuid && directory.uid !== process.getuid())
  ) {
    throw new Error('R31 private fixture directory must be caller-owned and mode 0700.');
  }

  const previous = { ...process.env };
  const prefix = `r31-browser-${randomBytes(5).toString('hex')}`;
  const accounts = {} as Record<AccountName, BrowserAccount>;
  const configuration = new BrowserConfigurationComponent();
  const collection = new BrowserCollectionComponent();
  const storageRoot = join(options.privateDir, 'storage');
  let database: IsolatedDatabase | undefined;
  let app: NestExpressApplication | undefined;
  let disposed = false;

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    const errors: unknown[] = [];
    try {
      await app?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await database?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await rm(storageRoot, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    if (errors.length) throw new AggregateError(errors, 'R31 owned fixture cleanup failed.');
  }

  try {
    database = await createIsolatedDatabase('r31_browser');
    const prisma = database.prisma;
    const [identity] = await prisma.$queryRaw<
      Array<{ database: string }>
    >`SELECT current_database() AS database`;
    if (!/^hsm_it_r31_browser_[a-f0-9]{32}$/u.test(identity?.database ?? '')) {
      throw new Error('R31 refused a database outside its newly created isolation boundary.');
    }
    await mkdir(storageRoot, { mode: 0o700 });
    for (const child of ['public', 'restricted', 'staging'])
      await mkdir(join(storageRoot, child), { mode: 0o700 });
    Object.assign(process.env, {
      JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
      REDIS_HOST: redisHost,
      REDIS_PORT: String(redisPort),
      REDIS_DB: '11',
      COOKIE_SECURE: 'false',
      COOKIE_SAMESITE: 'lax',
      FRONTEND_URL: web.origin,
      CORS_ORIGINS: '',
      OUTBOX_WORKER_ENABLED: 'false',
      EVIDENCE_SCAN_WORKER_ENABLED: 'false',
      VERIFICATION_EXPIRY_WORKER_ENABLED: 'false',
      PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED: 'false',
      MONGODB_ENABLED: 'false',
      REALTIME_SOCKET_IO: 'false',
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: join(storageRoot, 'public'),
      RESTRICTED_STORAGE_DIR: join(storageRoot, 'restricted'),
      EVIDENCE_SCANNER_DRIVER: 'test',
      DISPUTE_PRIVATE_ACTIVE_KEY: 'r31',
      DISPUTE_PRIVATE_KEYS_JSON: JSON.stringify({ r31: randomBytes(32).toString('base64') }),
      LOG_LEVEL: 'error',
    });
    if (redisUrl?.password) process.env.REDIS_PASSWORD = decodeURIComponent(redisUrl.password);
    for (const key of ['SMTP_HOST', 'COOKIE_DOMAIN', 'METRICS_PORT']) delete process.env[key];

    const { AppModule } = await import('../../src/app.module');
    const { AppConfigService } = await import('../../src/config/app-config.service');
    const { PrismaService } = await import('../../src/infrastructure/prisma/prisma.service');
    const { RedisService } = await import('../../src/infrastructure/redis/redis.service');
    const { PasswordService } =
      await import('../../src/modules/iam/authentication/services/password.service');
    const { MoneyCommandService } =
      await import('../../src/modules/money/application/money-command.service');
    const { LedgerService } = await import('../../src/modules/money/ledger/ledger.service');
    const { SubscriptionLifecycleService } =
      await import('../../src/modules/money/subscriptions/subscription-lifecycle.service');
    const { SubscriptionActivationParticipant } =
      await import('../../src/modules/money/subscriptions/subscription-activation.participant');
    const { EntitlementUsageService } =
      await import('../../src/modules/money/entitlements/entitlement-usage.service');
    const { MONEY_ACTIVATION_PARTICIPANT } =
      await import('../../src/modules/money/ports/activation.port');

    class IsolatedPrismaService extends PrismaService {
      override readonly client = prisma;
    }
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useFactory({
        inject: [AppConfigService],
        factory: (config: InstanceType<typeof AppConfigService>) =>
          new IsolatedPrismaService(config),
      })
      .overrideProvider(MONEY_CONFIGURATION)
      .useValue(configuration)
      .overrideProvider(MONEY_COLLECTION_ADAPTER)
      .useValue(collection)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    app.set('trust proxy', false);
    app.use(helmet());
    app.use(cookieParser());
    app.use(buildRequestBodyParser());
    app.enableCors({
      origin: [web.origin],
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(options.apiPort, '127.0.0.1');
    if (!(await app.get(PrismaService).ping()) || !(await app.get(RedisService).ping())) {
      throw new Error('R31 requires successful real PostgreSQL and Redis round trips.');
    }
    if (app.get(MONEY_ACTIVATION_PARTICIPANT) !== app.get(SubscriptionActivationParticipant)) {
      throw new Error('R31 browser fixture requires the genuine composed activation participant.');
    }
    if (
      await prisma.rolePermission.count({
        where: { permission: { key: { startsWith: 'money:' } } },
      })
    ) {
      throw new Error('R31 isolated migrations must not automatically grant money permissions.');
    }
    const providerRole = await prisma.role.upsert({
      where: { name: 'provider' },
      create: { name: 'provider', isSystem: true },
      update: {},
    });
    const permissions = await prisma.permission.findMany({
      where: { key: { in: ['money:read:self', 'money:purchase:self'] } },
    });
    if (permissions.length !== 2)
      throw new Error('R31 requires the existing migrated money permissions.');
    for (const name of ACCOUNT_NAMES) {
      const userId = `${prefix}-${name}`;
      const password = `R31!${randomBytes(24).toString('base64url')}a7`;
      const role = await prisma.role.create({ data: { name: `${userId}-capabilities` } });
      await prisma.user.create({
        data: {
          id: userId,
          email: `${userId}@example.test`.toLowerCase(),
          firstName: 'Synthetic',
          lastName: 'Provider',
          status: 'ACTIVE',
          isActive: true,
          emailVerifiedAt: new Date(),
          passwordHash: await app.get(PasswordService).hash(password),
          userRoles: { create: [{ roleId: providerRole.id }, { roleId: role.id }] },
        },
      });
      const providerProfileId = `${userId}-profile`;
      await prisma.providerProfile.create({
        data: {
          id: providerProfileId,
          userId,
          displayName: 'Synthetic provider',
          initials: 'SP',
          status: 'ACTIVE',
        },
      });
      if (name !== 'ungranted')
        await prisma.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })),
        });
      accounts[name] = {
        email: `${userId}@example.test`.toLowerCase(),
        password,
        userId,
        providerProfileId,
        subscriptionId: null,
        otpFile: join(options.privateDir, `otp-${name}.json`),
      };
      await writeFile(
        accounts[name].otpFile,
        JSON.stringify({ id: '', code: '', createdAt: null }),
        { flag: 'wx', mode: 0o600 },
      );
    }

    // Observe only mail which the genuine auth flow has actually delivered.
    const mailbox = app.get(InMemoryMailAdapter);
    const deliver = mailbox.send.bind(mailbox);
    mailbox.send = async (message) => {
      await deliver(message);
      const account = Object.values(accounts).find(
        (actor) => actor.email === message.to.toLowerCase(),
      );
      const code = message.text?.match(/\b\d{6}\b/u)?.[0];
      if (!account || !code) return;
      const temporary = `${account.otpFile}.${randomUUID()}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({ id: randomUUID(), code, createdAt: new Date().toISOString() }),
        { flag: 'wx', mode: 0o600 },
      );
      await rename(temporary, account.otpFile);
    };

    const ledger = app.get(LedgerService);
    const actor = { kind: 'SYSTEM' as const, system: 'r31.browser-component' };
    const debit = await ledger.openAccount(actor, {
      key: `${prefix}:clearing`,
      ownerType: 'PLATFORM',
      currency: 'XTS',
    });
    const credit = await ledger.openAccount(actor, {
      key: `${prefix}:revenue`,
      ownerType: 'PLATFORM',
      currency: 'XTS',
    });
    const plan = await prisma.subscriptionPlanVersion.create({
      data: {
        planKey: 'r31-test-plan',
        version: 1,
        billingInterval: 'MONTHLY',
        priceMinor: 1000n,
        currency: 'XTS',
        publishedAt: new Date(Date.now() - 365 * 86_400_000),
        entitlements: [
          { key: 'synthetic.requests', value: { kind: 'LIMIT', limit: 5 } },
          { key: 'synthetic.feature', value: { kind: 'BOOLEAN', enabled: true } },
          { key: 'synthetic.excluded', value: { kind: 'BOOLEAN', enabled: false } },
        ],
      },
    });
    configuration.bindings.set(`${plan.id}:STRIPE`, {
      planVersionId: plan.id,
      method: 'STRIPE',
      currency: 'XTS',
      adapterId: 'r31-contract-component',
      mode: 'SANDBOX',
      accountReference: `${prefix}-synthetic-account`,
      debitAccountId: debit.account.id,
      creditAccountId: credit.account.id,
      configVersion: 'r31-synthetic-component-v1',
      quoteTtlSeconds: 3600,
    });
    const commands = app.get(MoneyCommandService);
    const key = () => `browser-${randomUUID()}`;
    for (const name of ACCOUNT_NAMES.filter((item) => item !== 'ungranted')) {
      const account = accounts[name];
      const intent = await commands.createIntent(account.userId, key(), {
        contractVersion: MONEY_CONTRACT_VERSION,
        planVersionId: plan.id,
        method: 'STRIPE',
      });
      if (name === 'actionRequired') continue;
      if (name === 'cancelled') {
        await commands.cancelIntent(account.userId, key(), intent.id);
        continue;
      }
      if (name === 'failed') collection.failures.add(intent.id);
      const started = await commands.startCollection(account.userId, key(), intent.id);
      if (name === 'pending') continue;
      if (name === 'failed') continue;
      const binding = await prisma.moneyIntentBinding.findUniqueOrThrow({
        where: { paymentIntentId: intent.id },
      });
      const event: NormalizedMoneyExternalEvent = {
        contractVersion: MONEY_CONTRACT_VERSION,
        adapterId: binding.adapterId,
        mode: binding.mode,
        accountReference: binding.accountReference,
        externalEventId: randomUUID(),
        externalConfirmationId: randomUUID(),
        externalOperationId: `r31-component-${started.resourceId}`,
        paymentIntentId: intent.id,
        paymentAttemptId: started.resourceId,
        source: 'PROVIDER_WEBHOOK',
        amount: intent.total,
        confirmedAt: new Date(
          Date.now() - (name === 'expired' ? 90 : 1) * 86_400_000,
        ).toISOString(),
        receiptMediaAssetId: null,
        reviewerUserId: null,
      };
      collection.events.set(event.externalEventId, event);
      const accepted = await commands.acceptExternalEvent({
        adapterId: event.adapterId,
        mode: event.mode,
        accountReference: event.accountReference,
        payload: { fixtureEventId: event.externalEventId },
        headers: { 'x-r31-component-proof': collection.proof },
      });
      const result = await commands.processExternalEvent(accepted.eventId);
      account.subscriptionId = result.subscriptionId;
      if (name === 'expired')
        await prisma.$transaction((tx) =>
          app!
            .get(SubscriptionLifecycleService)
            .expirePeriod(result.subscriptionId, result.subscriptionPeriodId, tx),
        );
      if (name === 'active')
        for (let index = 0; index < 2; index++) {
          await app.get(EntitlementUsageService).consume(account.userId, {
            subscriptionId: result.subscriptionId,
            entitlementKey: 'synthetic.requests',
            usageKey: key(),
          });
        }
    }

    const credentialsFile = join(options.privateDir, 'credentials.json');
    await writeFile(credentialsFile, JSON.stringify({ accounts }), { flag: 'wx', mode: 0o600 });
    await chmod(credentialsFile, 0o600);
    const counts = await Promise.all([
      prisma.moneyPaymentConfirmation.count(),
      prisma.subscriptionPeriod.count(),
      prisma.ledgerTransaction.count(),
      prisma.moneyEntitlementUsage.count(),
      prisma.providerWorkAccessGrant.count(),
    ]);
    if (counts.join(',') !== '2,2,2,2,0')
      throw new Error('R31 genuine activation/usage fixture invariants failed.');
    return {
      app,
      prisma,
      url: await app.getUrl(),
      credentialsFile,
      evidence: {
        application: 'REAL_APPMODULE',
        database: 'NEW_MIGRATED_DATABASE',
        redis: 'REAL_LOOPBACK_REDIS',
        authentication: 'REAL_COOKIE_LOGIN_AND_DELIVERED_OTP',
        configurationAndCollection: 'SYNTHETIC_CONTRACT_COMPONENTS',
        activationParticipant: 'REAL_R31_PARTICIPANT',
        paymentConfirmations: counts[0],
        subscriptionPeriods: counts[1],
        ledgerPostings: counts[2],
        usageEvents: counts[3],
        workAccessGrants: counts[4],
        collectionComponentCalls: collection.calls,
      },
      dispose,
    };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'R31 browser fixture setup and cleanup failed.',
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
