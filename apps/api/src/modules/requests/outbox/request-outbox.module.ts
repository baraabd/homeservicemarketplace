import { Module } from '@nestjs/common';

import { RealtimeModule } from '../../realtime/realtime.module';
import {
  RequestAvailableBatchHandler,
  RequestAvailableDispatchHandler,
} from './request-available.handler';

// Sprint 6 — outbox handlers owned by the requests domain.
//
// A separate module from RequestsModule on purpose: handlers are consumed by
// the worker (infrastructure), while RequestsModule exists to serve HTTP. If
// the handlers lived there, wiring the worker would drag the controllers and
// their guards into every context that needs delivery — including a
// worker-only process, which should not mount an HTTP surface at all.
//
// Repositories come from the @Global PersistenceModule and OutboxRepository
// from the @Global OutboxModule, so only RealtimeModule needs importing.
@Module({
  imports: [RealtimeModule],
  providers: [RequestAvailableDispatchHandler, RequestAvailableBatchHandler],
  exports: [RequestAvailableDispatchHandler, RequestAvailableBatchHandler],
})
export class RequestOutboxModule {}
