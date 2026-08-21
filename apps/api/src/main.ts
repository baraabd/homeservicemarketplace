import 'reflect-metadata';

import { Logger as NestLogger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { RedisService } from './infrastructure/redis/redis.service';
import { RealtimeSocketAdapter } from './modules/realtime/realtime-socket.adapter';

async function bootstrap(): Promise<void> {
  const bootstrapLogger = new NestLogger('Bootstrap');
  try {
    // bodyParser: false disables Nest's default JSON body parser so
    // we can wire raw + JSON parsers independently below — the raw
    // parser MUST win for /v1/media/uploads/* so the upload Buffer
    // doesn't get mis-decoded as JSON.
    // Typed as NestExpressApplication so `app.set('trust proxy', …)` — the
    // Express-only knob the rate limiter depends on — is available.
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      bufferLogs: true,
      bodyParser: false,
    });
    app.useLogger(app.get(Logger));
    app.enableShutdownHooks();

    const config = app.get(AppConfigService);
    const port = config.get('PORT');
    const frontendUrl = config.get('FRONTEND_URL');
    const extraOrigins = config.get('CORS_ORIGINS');
    const origins = Array.from(
      new Set([...(frontendUrl ? [frontendUrl] : []), ...extraOrigins].filter(Boolean)),
    );

    // D-1 — trusted reverse proxies. Express only derives `req.ip` from
    // X-Forwarded-For when `trust proxy` is set, and setting it to `true`
    // trusts the ENTIRE chain, which lets any client prepend a forged address
    // and mint a fresh rate-limit bucket per request. Setting it to a NUMBER
    // means "skip exactly N proxies from the right", so the resolved IP is the
    // one written by the hop we actually control. TRUST_PROXY_HOPS=0 (default)
    // leaves trust proxy off entirely and `req.ip` is the socket peer.
    const trustProxyHops = config.get('TRUST_PROXY_HOPS');
    if (trustProxyHops > 0) {
      app.set('trust proxy', trustProxyHops);
    } else {
      app.set('trust proxy', false);
    }
    bootstrapLogger.log(
      `Trust proxy: ${trustProxyHops > 0 ? `${trustProxyHops} hop(s)` : 'disabled (X-Forwarded-For ignored)'}`,
    );

    app.use(helmet());
    app.use(cookieParser());
    // Sprint 7.x — media-upload PUT route. The body is the binary
    // file, not JSON, so the default body-parser would reject it.
    // express.raw() captures it as a Buffer for the LocalDiskStorage
    // adapter. Cap matches MAX_BYTES_PER_FILE in
    // apps/api/src/infrastructure/storage/content-type.ts so the
    // signed-URL contract and the body parser stay in sync.
    app.use('/v1/media/uploads', express.raw({ type: '*/*', limit: '10mb' }));
    // JSON parser for everything else. Mounted AFTER the raw parser
    // so the raw mount wins for upload paths.
    app.use(express.json({ limit: '1mb' }));

    // Production with no explicit allowlist → block all cross-origin requests.
    // Dev with no allowlist → reflect the request origin (local convenience).
    // `credentials: true` is required for the HttpOnly cookie flow; never
    // combine it with origin: '*'.
    const corsOrigin = origins.length > 0 ? origins : config.isProduction ? false : true;
    app.enableCors({ origin: corsOrigin, credentials: true });
    bootstrapLogger.log(
      `CORS: ${origins.length > 0 ? `allowlist=[${origins.join(', ')}]` : corsOrigin === false ? 'blocked (production, no allowlist)' : 'reflect-any (dev fallback)'}`,
    );
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );

    // Sprint 7.0 (refined) — Socket.IO gateway. The adapter is wired
    // before listen() so the WS upgrade path is ready by the time the
    // first client connects. Redis adapter wiring is best-effort:
    // when Redis is not ready (or REALTIME_SOCKET_IO=off) the gateway
    // still serves the local instance.
    if (config.get('REALTIME_SOCKET_IO')) {
      const wsAdapter = new RealtimeSocketAdapter(app, config, app.get(RedisService));
      await wsAdapter.connectToRedis();
      app.useWebSocketAdapter(wsAdapter);
    }

    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      process.on(sig, () => bootstrapLogger.log(`Received ${sig}, shutting down gracefully`));
    }

    await app.listen(port);
    bootstrapLogger.log(`API listening on :${port} (env=${config.get('NODE_ENV')})`);
  } catch (err) {
    bootstrapLogger.error(`Fatal bootstrap error: ${(err as Error).message}`, (err as Error).stack);
    process.exit(1);
  }
}

void bootstrap();
