import { randomBytes } from 'node:crypto';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { InMemoryMailAdapter } from '../../src/infrastructure/mail/in-memory-mail.adapter';
import { workspaceFixture } from './dispute-workspace-fixture';

/** Real AppModule, guards, sessions, database, Redis, storage and HTTP.
 * Only documented NODE_ENV=test adapters are selected; no provider/guard override.
 * OTPs are obtained in-process from the real test mailbox, never a debug route. */
export async function disputeHttpApp() {
  const fixture = await workspaceFixture({ authentication: true });
  const redis = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0');
  const previous = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64url'),
    REDIS_HOST: redis.hostname,
    REDIS_PORT: redis.port || '6379',
    REDIS_DB: '13',
    COOKIE_SECURE: 'false',
    COOKIE_SAMESITE: 'lax',
    REALTIME_SOCKET_IO: 'false',
    OUTBOX_WORKER_ENABLED: 'false',
    EVIDENCE_SCAN_WORKER_ENABLED: 'false',
    VERIFICATION_EXPIRY_WORKER_ENABLED: 'false',
    PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED: 'false',
    MONGODB_ENABLED: 'false',
    STORAGE_DRIVER: 'local',
    RESTRICTED_STORAGE_DIR: fixture.root,
    EVIDENCE_SCANNER_DRIVER: process.env.DISPUTE_TEST_SCANNER === 'clamav' ? 'clamav' : 'test',
    DISPUTE_PRIVATE_ACTIVE_KEY: 'ci',
    DISPUTE_PRIVATE_KEYS_JSON: String(fixture.configValues.DISPUTE_PRIVATE_KEYS_JSON),
    LOG_LEVEL: 'error',
    // This isolated test follows many screen reads from one browser/IP. The
    // existing env validator still refuses an elevated ceiling in hardened envs.
    GLOBAL_THROTTLE_LIMIT: '1000',
  });
  delete process.env.SMTP_HOST;
  let app: NestExpressApplication | undefined;
  try {
    // ConfigModule validates at import time, after the synthetic environment exists.
    const { AppModule } = await import('../../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: ['error', 'warn'],
    });
    app.set('trust proxy', false);
    app.use(helmet());
    app.use(cookieParser());
    app.use('/v1/media/uploads', express.raw({ type: '*/*', limit: '10mb' }));
    app.use(express.json({ limit: '1mb' }));
    app.enableCors({
      origin: /^http:\/\/127\.0\.0\.1:\d+$/,
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const mailbox = app.get(InMemoryMailAdapter);
    return {
      app,
      url,
      fixture,
      otp(email: string) {
        if (!Object.values(fixture.users).some((id) => `${id}@example.test` === email))
          throw new Error('Unknown synthetic recipient');
        const code = mailbox.lastSentTo(email)?.text?.match(/\b\d{6}\b/)?.[0];
        if (!code) throw new Error('Real login did not deliver an OTP to the test mailbox');
        return code;
      },
      async dispose() {
        await app?.close();
        await fixture.dispose();
        for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
        Object.assign(process.env, previous);
      },
    };
  } catch (error) {
    await app?.close();
    await fixture.dispose();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    throw error;
  }
}
export type DisputeHttpApp = Awaited<ReturnType<typeof disputeHttpApp>>;

export function httpSession(h: DisputeHttpApp) {
  const cookies = new Map<string, string>();
  return {
    async request<T = Record<string, unknown>>(
      path: string,
      options: { method?: string; body?: unknown; csrf?: boolean; form?: FormData } = {},
    ) {
      const headers: Record<string, string> = { 'X-Client-Kind': 'web' };
      if (cookies.size) headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      if (options.csrf !== false && cookies.has('hsm_csrf'))
        headers['x-csrf-token'] = decodeURIComponent(cookies.get('hsm_csrf')!);
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const response = await fetch(h.url + path, {
        method: options.method ?? 'GET',
        headers,
        body:
          options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0]!;
        const split = pair.indexOf('=');
        cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      const text = await response.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { binary: text };
      }
      return { status: response.status, body: body as T, headers: response.headers };
    },
    async login(id: string) {
      const email = `${id}@example.test`;
      const start = await this.request<{ challengeId: string }>('/v1/auth/login', {
        method: 'POST',
        body: { email, password: h.fixture.password },
      });
      if (start.status !== 200) throw new Error(`Login HTTP ${start.status}`);
      const verified = await this.request('/v1/auth/verify-otp', {
        method: 'POST',
        body: { challengeId: start.body.challengeId, code: h.otp(email) },
      });
      if (verified.status !== 200) throw new Error(`OTP HTTP ${verified.status}`);
      return this;
    },
  };
}
