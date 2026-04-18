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
    const origins = [...(frontendUrl ? [frontendUrl] : []), ...extraOrigins];

    app.use(helmet());
    app.use(cookieParser());
    app.enableCors({
      origin: origins.length > 0 ? origins : config.isProduction ? false : true,
      credentials: true,
    });
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
