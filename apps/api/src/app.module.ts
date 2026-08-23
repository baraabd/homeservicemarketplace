import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { ConfigModule } from './config/config.module';
import { HealthModule } from './infrastructure/health/health.module';
import { AllExceptionsFilter } from './infrastructure/http/all-exceptions.filter';
import { DeprecatedRouteMiddleware } from './infrastructure/http/deprecated-route.middleware';
import { RequestIdMiddleware } from './infrastructure/http/request-id.middleware';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { MailModule } from './infrastructure/mail/mail.module';
import { MongoModule } from './infrastructure/mongo/mongo.module';
import { OutboxModule } from './infrastructure/outbox/outbox.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { MetricsModule } from './infrastructure/telemetry/metrics.module';
import { PersistenceModule } from './infrastructure/persistence/persistence.module';
import { AppThrottlerGuard } from './infrastructure/throttle/app-throttler.guard';
import { RateLimitModule } from './infrastructure/throttle/rate-limit.module';
import { RateLimitStore } from './infrastructure/throttle/rate-limit.store';
import { SecurityEventsModule } from './shared/security-events/security-events.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { AdminModule } from './modules/admin/admin.module';
import { BidsModule } from './modules/bids/bids.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { IamModule } from './modules/iam/iam.module';
import { MediaModule } from './modules/media/media.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ProviderModule } from './modules/provider/provider.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RequestsModule } from './modules/requests/requests.module';
import { RequestOutboxModule } from './modules/requests/outbox/request-outbox.module';
import {
  RequestAvailableBatchHandler,
  RequestAvailableDispatchHandler,
} from './modules/requests/outbox/request-available.handler';
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
    StorageModule,
    MetricsModule,
    // Sprint 6 — transactional outbox. AppModule is the ONLY place allowed to
    // know both the worker and the domain handlers it runs; wiring them here
    // keeps infrastructure from importing the domain modules that depend on
    // it. See docs/adr/0004-transactional-outbox.md.
    OutboxModule.forRoot({
      imports: [RequestOutboxModule],
      handlers: [RequestAvailableDispatchHandler, RequestAvailableBatchHandler],
    }),
    // Global, transport-agnostic post-commit security notifications
    // (D-2/D-4). Publishers: IAM / admin / provider. Subscriber: the
    // Socket.IO gateway.
    SecurityEventsModule,
    RateLimitModule,
    // D-1: the throttler's counters are backed by the shared Redis store, so
    // the budget is aggregate across API replicas instead of per-replica.
    // The coarse 100/60s default is the global backstop; the sensitive auth
    // routes tighten it with route-level @Throttle decorators, and
    // registration has its own two-dimensional limiter (see
    // RegistrationThrottleService).
    ThrottlerModule.forRootAsync({
      imports: [RateLimitModule],
      inject: [RateLimitStore],
      useFactory: (storage: RateLimitStore) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        storage,
      }),
    }),
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
    ProviderModule,
    AdminModule,
    RealtimeModule,
    MediaModule,
  ],
  providers: [
    // AppThrottlerGuard replaces the stock ThrottlerGuard so a 429 carries the
    // stable RATE_LIMITED envelope instead of the "ThrottlerException: Too
    // Many Requests" framework string.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
    // Sprint 6 — Deprecation / Sunset / Link headers plus usage telemetry on
    // the legacy provider route families. Bound to '*' and gated internally by
    // the DEPRECATED_ROUTES registry, so adding or retiring a route is a
    // one-line edit there rather than a change to module wiring.
    //
    // Middleware rather than an interceptor on purpose: guards run first, so
    // an interceptor would skip every 401/403 — exactly the responses a client
    // stuck on an old route tends to get.
    consumer.apply(DeprecatedRouteMiddleware).forRoutes('*');
  }
}
