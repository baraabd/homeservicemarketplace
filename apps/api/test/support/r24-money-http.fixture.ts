import type { PrismaClient } from '@homeservicemarketplace/database';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildRequestBodyParser } from '../../src/infrastructure/http/request-body';
import { InMemoryMailAdapter } from '../../src/infrastructure/mail/in-memory-mail.adapter';
import { MONEY_ACTIVATION_PARTICIPANT } from '../../src/modules/money/ports/activation.port';
import {
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
  MONEY_RECEIPT_ACCEPTANCE,
} from '../../src/modules/money/ports/collection.port';
import {
  MONEY_REFUND_ADAPTER,
  MONEY_REFUND_POLICY,
} from '../../src/modules/money/ports/refund.port';
import { createIsolatedDatabase, type IsolatedDatabase } from './isolated-database';

/** Expected R24 capability names. Grants below exist only in the newly created DB. */
export const R24_PERMISSIONS = {
  purchase: 'money:purchase:self',
  read: 'money:read:self',
  requestRefund: 'money:refund:request:self',
  review: 'money:review:read',
  receiptReview: 'money:receipt:review',
  receiptView: 'money:receipt:view',
  receiptSettlement: 'money:receipt:settlement',
  refundReview: 'money:refund:review',
} as const;

export type R24Permission = (typeof R24_PERMISSIONS)[keyof typeof R24_PERMISSIONS];
export type R24ActorName = 'owner' | 'otherProvider' | 'noPermission' | 'reviewer' | 'seeker';

export interface R24Actor {
  userId: string;
  email: string;
  providerProfileId: string | null;
  permissionRoleId: string;
  roleNames: string[];
}

export interface R24HttpOptions {
  method?: string;
  body?: unknown;
  rawBody?: Uint8Array;
  responseType?: 'bytes';
  idempotencyKey?: string;
  csrf?: boolean;
  headers?: Record<string, string>;
}

/** Only cookies actually returned by the real login/OTP HTTP exchange. */
export interface R24BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface R24HttpResponse<T> {
  status: number;
  body: T;
  headers: Headers;
}

export interface R24HttpSession {
  request<T = Record<string, unknown>>(
    path: string,
    options?: R24HttpOptions,
  ): Promise<R24HttpResponse<T>>;
  login(actor: R24ActorName): Promise<R24HttpSession>;
  storageState(): { cookies: R24BrowserCookie[]; origins: [] };
}

export interface R24MoneyPortOverride {
  token: symbol;
  value: unknown;
}

export interface R24MoneyHttpFixture {
  app: NestExpressApplication;
  prisma: PrismaClient;
  url: string;
  prefix: string;
  storageRoot: string;
  actors: Record<R24ActorName, R24Actor>;
  initialMoneyPermissions: string[];
  initialMoneyGrants: number;
  key(label: string): string;
  session(): R24HttpSession;
  login(actor: R24ActorName): Promise<R24HttpSession>;
  grant(actor: R24ActorName, permission: R24Permission): Promise<void>;
  revoke(actor: R24ActorName, permission: R24Permission): Promise<void>;
  dispose(): Promise<void>;
}

const ALLOWED_PORTS = new Set([
  MONEY_CONFIGURATION,
  MONEY_COLLECTION_ADAPTER,
  MONEY_RECEIPT_ACCEPTANCE,
  MONEY_ACTIVATION_PARTICIPANT,
  MONEY_REFUND_POLICY,
  MONEY_REFUND_ADAPTER,
]);

/**
 * Real AppModule, HTTP, cookie/OTP authentication, guards, PostgreSQL and Redis.
 * PrismaService uses the newly migrated database and retains its genuine
 * startup/ping/teardown hooks. Optional limiter namespacing isolates fixture
 * traffic while preserving the real Redis Lua, identities, limits and TTLs.
 * Explicit money-port overrides are contract components, never rail acceptance.
 * Test mail and scanner adapters establish neither SMTP nor malware acceptance.
 *
 * R19's global history assertions and immutable money FKs require a database
 * boundary. No shared seed, global table cleanup or Redis flush is performed.
 */
export async function r24MoneyHttpFixture(
  options: {
    adapters?: readonly R24MoneyPortOverride[];
    /** R30 must exercise actual ClamAV; existing R24 contract tests keep their explicit double. */
    scannerDriver?: 'test' | 'clamav';
    isolateRateLimits?: boolean;
  } = {},
): Promise<R24MoneyHttpFixture> {
  if (process.env.RUN_DB_INTEGRATION !== '1') {
    throw new Error('R24 HTTP evidence requires RUN_DB_INTEGRATION=1.');
  }
  for (const override of options.adapters ?? []) {
    if (!ALLOWED_PORTS.has(override.token)) {
      throw new Error('R24 fixtures may replace only the six explicit money ports.');
    }
  }

  const previous = { ...process.env };
  const prefix = `it-r24-${randomUUID().slice(0, 12)}-`;
  const actors = {} as Record<R24ActorName, R24Actor>;
  let database: IsolatedDatabase | undefined;
  let storageRoot: string | undefined;
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
      if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
    if (errors.length) throw new AggregateError(errors, 'R24 fixture teardown failed.');
  }

  try {
    database = await createIsolatedDatabase('r24_money');
    const prisma = database.prisma;
    storageRoot = await mkdtemp(join(tmpdir(), 'hsm-r24-http-'));
    await chmod(storageRoot, 0o700);
    await mkdir(join(storageRoot, 'public'), { mode: 0o700 });
    await mkdir(join(storageRoot, 'restricted'), { mode: 0o700 });
    await mkdir(join(storageRoot, 'staging'), { mode: 0o700 });

    const redisUrl = process.env.REDIS_URL ? new URL(process.env.REDIS_URL) : undefined;
    Object.assign(process.env, {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
      REDIS_HOST: redisUrl?.hostname ?? process.env.REDIS_HOST ?? '127.0.0.1',
      REDIS_PORT: redisUrl?.port || process.env.REDIS_PORT || '6379',
      // Reserved for this R24 suite inside the disposable CI Redis service.
      // Local execution uses a separately launched R24 Redis instance as well.
      REDIS_DB: '12',
      COOKIE_SECURE: 'false',
      COOKIE_SAMESITE: 'lax',
      FRONTEND_URL: 'http://127.0.0.1:5324',
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
      EVIDENCE_SCANNER_DRIVER: options.scannerDriver ?? 'test',
      DISPUTE_PRIVATE_ACTIVE_KEY: 'r24',
      DISPUTE_PRIVATE_KEYS_JSON: JSON.stringify({ r24: randomBytes(32).toString('base64') }),
      LOG_LEVEL: 'error',
    });
    if (redisUrl?.password) process.env.REDIS_PASSWORD = decodeURIComponent(redisUrl.password);
    delete process.env.SMTP_HOST;
    delete process.env.COOKIE_DOMAIN;
    delete process.env.METRICS_PORT;

    const { AppModule } = await import('../../src/app.module');
    const { AppConfigService } = await import('../../src/config/app-config.service');
    const { PrismaService } = await import('../../src/infrastructure/prisma/prisma.service');
    const { RedisService } = await import('../../src/infrastructure/redis/redis.service');
    const { RateLimitStore } = await import('../../src/infrastructure/throttle/rate-limit.store');
    const { PasswordService } =
      await import('../../src/modules/iam/authentication/services/password.service');

    class IsolatedPrismaService extends PrismaService {
      override readonly client = prisma;
    }

    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useFactory({
        inject: [AppConfigService],
        factory: (config: InstanceType<typeof AppConfigService>) =>
          new IsolatedPrismaService(config),
      });
    for (const override of options.adapters ?? []) {
      builder.overrideProvider(override.token).useValue(override.value);
    }
    if (options.isolateRateLimits) {
      class IsolatedRateLimitStore extends RateLimitStore {
        override consume(params: Parameters<InstanceType<typeof RateLimitStore>['consume']>[0]) {
          return super.consume({ ...params, bucket: prefix + params.bucket });
        }
      }
      builder.overrideProvider(RateLimitStore).useFactory({
        inject: [RedisService, AppConfigService],
        factory: (
          redis: InstanceType<typeof RedisService>,
          config: InstanceType<typeof AppConfigService>,
        ) => new IsolatedRateLimitStore(redis, config),
      });
    }
    const module = await builder.compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    app.set('trust proxy', false);
    app.use(helmet());
    app.use(cookieParser());
    app.use(buildRequestBodyParser());
    app.enableCors({
      origin: ['http://127.0.0.1:5324'],
      credentials: true,
      exposedHeaders: ['Content-Disposition', 'X-Receipt-Inspection-Id'],
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    if (!(await app.get(PrismaService).ping()) || !(await app.get(RedisService).ping())) {
      throw new Error('R24 requires real PostgreSQL and Redis round trips.');
    }
    const url = await app.getUrl();
    const mailbox = app.get(InMemoryMailAdapter);
    const initialMoneyPermissions = (
      await prisma.permission.findMany({
        where: { key: { startsWith: 'money:' } },
        orderBy: { key: 'asc' },
        select: { key: true },
      })
    ).map((row) => row.key);
    const initialMoneyGrants = await prisma.rolePermission.count({
      where: { permission: { key: { startsWith: 'money:' } } },
    });
    const password = `R24!${randomBytes(24).toString('base64url')}a7`;
    const passwordHash = await app.get(PasswordService).hash(password);

    for (const name of ['owner', 'otherProvider', 'noPermission', 'reviewer', 'seeker'] as const) {
      const userId = prefix + name;
      const email = `${userId}@example.test`.toLowerCase();
      const provider = !['reviewer', 'seeker'].includes(name);
      const baseRole = name === 'reviewer' ? 'admin' : provider ? 'provider' : 'customer';
      const permissionRoleName = `${userId}-capabilities`;
      const role = await prisma.role.upsert({
        where: { name: baseRole },
        create: { name: baseRole, isSystem: true },
        update: {},
      });
      const permissionRole = await prisma.role.create({
        data: { id: `${userId}-role`, name: permissionRoleName },
      });
      await prisma.user.create({
        data: {
          id: userId,
          email,
          firstName: 'R24',
          lastName: 'Synthetic',
          passwordHash,
          status: 'ACTIVE',
          isActive: true,
          emailVerifiedAt: new Date(),
          userRoles: { create: [{ roleId: role.id }, { roleId: permissionRole.id }] },
        },
      });
      const providerProfileId = provider ? `${userId}-profile` : null;
      if (providerProfileId) {
        await prisma.providerProfile.create({
          data: {
            id: providerProfileId,
            userId,
            displayName: 'R24 synthetic provider',
            initials: 'R2',
            status: 'ACTIVE',
          },
        });
      }
      actors[name] = {
        userId,
        email,
        providerProfileId,
        permissionRoleId: permissionRole.id,
        roleNames: [baseRole, permissionRoleName],
      };
    }

    async function grant(actor: R24ActorName, key: R24Permission): Promise<void> {
      const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
      const roleId = actors[actor].permissionRoleId;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permission.id } },
        create: { roleId, permissionId: permission.id },
        update: {},
      });
    }
    for (const actor of ['owner', 'otherProvider'] as const) {
      for (const permission of [
        R24_PERMISSIONS.purchase,
        R24_PERMISSIONS.read,
        R24_PERMISSIONS.requestRefund,
      ]) {
        await grant(actor, permission);
      }
    }
    for (const permission of [
      R24_PERMISSIONS.review,
      R24_PERMISSIONS.receiptReview,
      R24_PERMISSIONS.refundReview,
    ]) {
      await grant('reviewer', permission);
    }

    function session(): R24HttpSession {
      const cookies = new Map<string, string>();
      const browserCookies = new Map<string, R24BrowserCookie>();
      const client: R24HttpSession = {
        async request<T = Record<string, unknown>>(
          path: string,
          input: R24HttpOptions = {},
        ): Promise<R24HttpResponse<T>> {
          if (input.body !== undefined && input.rawBody !== undefined) {
            throw new Error('Use one HTTP body representation per request.');
          }
          const headers: Record<string, string> = { 'X-Client-Kind': 'web', ...input.headers };
          if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
          if (input.csrf !== false && cookies.has('hsm_csrf')) {
            headers['x-csrf-token'] = decodeURIComponent(cookies.get('hsm_csrf')!);
          }
          if (input.idempotencyKey !== undefined) headers['Idempotency-Key'] = input.idempotencyKey;
          if (input.body !== undefined) headers['content-type'] = 'application/json';
          const response = await fetch(url + path, {
            method: input.method ?? 'GET',
            headers,
            body:
              input.rawBody !== undefined
                ? Buffer.from(input.rawBody)
                : input.body === undefined
                  ? undefined
                  : JSON.stringify(input.body),
            signal: AbortSignal.timeout(30_000),
          });
          for (const cookie of response.headers.getSetCookie()) {
            const [pair, ...attributes] = cookie.split(';');
            if (!pair) continue;
            const separator = pair.indexOf('=');
            const name = pair.slice(0, separator);
            const value = pair.slice(separator + 1);
            const options = new Map(
              attributes.map((attribute) => {
                const [key, ...rest] = attribute.trim().split('=');
                return [key!.toLowerCase(), rest.join('=')] as const;
              }),
            );
            const sameSite = options.get('samesite')?.toLowerCase();
            const maxAge = options.get('max-age');
            const expires =
              maxAge !== undefined
                ? Math.floor(Date.now() / 1000) + Number(maxAge)
                : options.has('expires')
                  ? Date.parse(options.get('expires')!) / 1000
                  : -1;
            if (value === '' || (expires !== -1 && expires <= Date.now() / 1000)) {
              cookies.delete(name);
              browserCookies.delete(name);
            } else {
              cookies.set(name, value);
              browserCookies.set(name, {
                name,
                value,
                domain: options.get('domain') ?? new URL(url).hostname,
                path: options.get('path') ?? '/',
                expires,
                httpOnly: options.has('httponly'),
                secure: options.has('secure'),
                sameSite: sameSite === 'strict' ? 'Strict' : sameSite === 'none' ? 'None' : 'Lax',
              });
            }
          }
          const body =
            input.responseType === 'bytes'
              ? new Uint8Array(await response.arrayBuffer())
              : await response.text().then((value) => (value ? JSON.parse(value) : {}));
          return {
            status: response.status,
            body: body as T,
            headers: response.headers,
          };
        },
        async login(actor: R24ActorName): Promise<R24HttpSession> {
          const email = actors[actor].email;
          let challenge = await client.request<{ challengeId: string }>('/v1/auth/login', {
            method: 'POST',
            body: { email, password },
          });
          // Keep the real login ceiling. A focused rerun can share the previous
          // run's short-lived IP bucket in this dedicated Redis DB.
          for (let attempt = 1; challenge.status === 429 && attempt < 3; attempt++) {
            const seconds = Math.min(Number(challenge.headers.get('retry-after')) || 60, 65);
            await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
            challenge = await client.request<{ challengeId: string }>('/v1/auth/login', {
              method: 'POST',
              body: { email, password },
            });
          }
          if (challenge.status !== 200)
            throw new Error(`R24 login failed: HTTP ${challenge.status}`);
          if (typeof challenge.body.challengeId !== 'string') {
            throw new Error('R24 login did not return the challenge contract.');
          }
          const code = mailbox.lastSentTo(email)?.text?.match(/\b\d{6}\b/u)?.[0];
          if (!code) throw new Error('R24 login did not deliver an OTP to its test mailbox.');
          const verified = await client.request('/v1/auth/verify-otp', {
            method: 'POST',
            body: { challengeId: challenge.body.challengeId, code },
          });
          if (verified.status !== 200) {
            const envelope = verified.body as { error?: { code?: string } };
            const code = envelope.error?.code;
            const safeCode =
              typeof code === 'string' && /^[A-Z0-9_]+$/u.test(code) ? code : 'UNKNOWN';
            throw new Error(`R24 OTP failed: HTTP ${verified.status} (${safeCode})`);
          }
          return client;
        },
        storageState: () => ({
          cookies: [...browserCookies.values()].map((cookie) => ({ ...cookie })),
          origins: [],
        }),
      };
      return client;
    }

    return {
      app,
      prisma,
      url,
      prefix,
      storageRoot,
      actors,
      initialMoneyPermissions,
      initialMoneyGrants,
      key: (label: string) => `${prefix}${label}-${randomUUID()}`,
      session,
      login: (actor) => session().login(actor),
      grant,
      async revoke(actor, key) {
        const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
        await prisma.rolePermission.delete({
          where: {
            roleId_permissionId: {
              roleId: actors[actor].permissionRoleId,
              permissionId: permission.id,
            },
          },
        });
      },
      dispose,
    };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'R24 setup and teardown failed.', {
        cause: cleanupError,
      });
    }
    throw error;
  }
}
