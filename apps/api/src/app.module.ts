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
import { BidsModule } from './modules/bids/bids.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { IamModule } from './modules/iam/iam.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProfileModule } from './modules/profile/profile.module';
import { RequestsModule } from './modules/requests/requests.module';
import { ServicesModule } from './modules/services/services.module';

// Infrastructure & data-foundation bootstrap. Seeker domain modules
// are wired in incrementally — Sprint 1 shipped Services / Addresses /
// Requests; Sprint 2 added BidsModule (read), accept-bid + booking
// persistence, and BookingsModule. Sprint 3 slice 3.1 adds
// NotificationsModule (REST feed + internal createForUser fan-out
// from BidsService.accept and BookingsService.cancel).
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
    RequestsModule,
    BidsModule,
    BookingsModule,
    NotificationsModule,
    ConversationsModule,
    ProfileModule,
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
