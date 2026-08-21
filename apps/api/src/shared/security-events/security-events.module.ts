import { Global, Module } from '@nestjs/common';

import { SecurityEventsBus } from './security-events.bus';

// @Global: publishers live in IAM / admin / provider and the single subscriber
// lives in the realtime gateway. Making the bus global keeps those modules from
// importing each other (which would be a cycle — see security-events.bus.ts).
@Global()
@Module({
  providers: [SecurityEventsBus],
  exports: [SecurityEventsBus],
})
export class SecurityEventsModule {}
