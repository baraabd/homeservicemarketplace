import 'reflect-metadata';

import { Logger as NestLogger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import type {
  NextFunction as ExpressNext,
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { PERMISSIONS_POLICY, buildHelmetOptions } from './infrastructure/http/security-headers';
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

    // ── Sprint 3: response headers ─────────────────────────────────────────
    //
    // The policy itself lives in infrastructure/http/security-headers.ts so it
    // can be asserted on by tests. Header policy is the kind of configuration
    // that breaks nothing visible when a directive silently disappears, so it
    // needs a test rather than a code review.
    const cspMode = config.get('CSP_MODE');
    const hstsMaxAge = config.get('HSTS_MAX_AGE_SECONDS');

    app.use(
      helmet(
        buildHelmetOptions({
          cspMode,
          hstsMaxAgeSeconds: hstsMaxAge,
          hstsIncludeSubDomains: config.get('HSTS_INCLUDE_SUBDOMAINS'),
          hstsPreload: config.get('HSTS_PRELOAD'),
        }),
      ),
    );

    // helmet does not ship Permissions-Policy, so it is set directly.
    app.use((_req: ExpressRequest, res: ExpressResponse, next: ExpressNext) => {
      res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
      next();
    });

    bootstrapLogger.log(
      `Security headers: CSP=${cspMode}, HSTS max-age=${hstsMaxAge}s` +
        `${config.get('HSTS_INCLUDE_SUBDOMAINS') ? ' +includeSubDomains' : ''}` +
        `${config.get('HSTS_PRELOAD') ? ' +preload' : ''}, Permissions-Policy=deny-all`,
    );

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
      // The adapter owns its own pub/sub connections rather than borrowing the
      // shared RedisService: this runs BEFORE app.listen() triggers Nest's
      // onModuleInit, so RedisService has not connected yet and any readiness
      // check against it would always be false here.
      const wsAdapter = new RealtimeSocketAdapter(app, config);
      await wsAdapter.connectToRedis();
      app.useWebSocketAdapter(wsAdapter);
      // Close the pub/sub pair on a graceful shutdown so SIGTERM does not
      // leave two open connections behind.
      app.enableShutdownHooks();
      process.once('SIGTERM', () => {
        void wsAdapter.close();
      });
    }

    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      process.on(sig, () => bootstrapLogger.log(`Received ${sig}, shutting down gracefully`));
    }

    await app.listen(port);
    bootstrapLogger.log(`API listening on :${port} (env=${config.get('NODE_ENV')})`);
  } catch (err) {
    // Write to stderr DIRECTLY, not through the Nest logger.
    //
    // NestFactory.create is called with `bufferLogs: true`, which holds every
    // log line until `app.useLogger()` runs. If the failure happens before
    // that — a rejected env schema, an unreachable database, a failed
    // Socket.IO Redis adapter — the buffer is never flushed and `process.exit`
    // discards it, so the container died with an EXIT CODE AND NO MESSAGE.
    // A fatal boot error is the one log that must never be buffered.
    const error = err as Error;
    process.stderr.write(`[Bootstrap] Fatal bootstrap error: ${error?.message ?? String(err)}
`);
    if (error?.stack)
      process.stderr.write(`${error.stack}
`);
    bootstrapLogger.error(`Fatal bootstrap error: ${error?.message}`, error?.stack);
    process.exit(1);
  }
}

void bootstrap();
