import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ConfigModule } from './config/config.module';
import { HealthModule } from './infrastructure/health/health.module';
import { AllExceptionsFilter } from './infrastructure/http/all-exceptions.filter';
import { RequestIdMiddleware } from './infrastructure/http/request-id.middleware';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { MailModule } from './infrastructure/mail/mail.module';
import { MongoModule } from './infrastructure/mongo/mongo.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { MetricsModule } from './infrastructure/telemetry/metrics.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { IamModule } from './modules/iam/iam.module';
import { ServicesModule } from './modules/services/services.module';

// Infrastructure & data-foundation bootstrap. Seeker domain modules are
// wired in incrementally — slice 1 introduced ServicesModule (read-only
// catalog at GET /v1/services); slice 2 adds AddressesModule (CRUD at
// /v1/me/addresses, all endpoints session-scoped).
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    MongoModule,
    RedisModule,
    PersistenceModule,
    MailModule,
    MetricsModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    HealthModule,
    IamModule,
    ServicesModule,
    AddressesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
