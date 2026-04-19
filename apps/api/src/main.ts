import 'reflect-metadata';

import { Logger as NestLogger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const bootstrapLogger = new NestLogger('Bootstrap');
  try {
    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.enableShutdownHooks();

    const config = app.get(AppConfigService);
    const port = config.get('PORT');
    const frontendUrl = config.get('FRONTEND_URL');
    const extraOrigins = config.get('CORS_ORIGINS');
    const origins = Array.from(
      new Set([...(frontendUrl ? [frontendUrl] : []), ...extraOrigins].filter(Boolean)),
    );

    app.use(helmet());
    app.use(cookieParser());

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
