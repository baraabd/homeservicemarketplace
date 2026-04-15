import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ConfigModule } from './config/config.module';
import { HealthModule } from './infrastructure/health/health.module';
import { AllExceptionsFilter } from './infrastructure/http/all-exceptions.filter';
import { RequestIdMiddleware } from './infrastructure/http/request-id.middleware';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { MongoModule } from './infrastructure/mongo/mongo.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { MetricsModule } from './infrastructure/telemetry/metrics.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';

// Infrastructure & data-foundation bootstrap. No business modules are wired
// at this stage; repositories/transaction helpers are exposed for later
// domain modules (still to be added under src/modules/<domain>/).
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    MongoModule,
    RedisModule,
    PersistenceModule,
    MetricsModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    HealthModule,
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
