import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../config/config.module';
import { RateLimitStore } from './rate-limit.store';
import { RegistrationThrottleService } from './registration-throttle.service';

// D-1 — one shared Redis-backed rate-limit store, used by BOTH the global
// @nestjs/throttler guard (via ThrottlerModule.forRootAsync in app.module)
// and the explicit registration limiter. Single keyspace, single failure
// policy, aggregate budget across replicas.
//
// @Global so the auth controller can inject the registration limiter without
// the IAM module importing infrastructure wiring it otherwise has no interest
// in. RedisService is already global.
@Global()
@Module({
  imports: [ConfigModule],
  providers: [RateLimitStore, RegistrationThrottleService],
  exports: [RateLimitStore, RegistrationThrottleService],
})
export class RateLimitModule {}
