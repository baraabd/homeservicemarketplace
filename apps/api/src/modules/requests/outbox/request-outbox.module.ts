import { Module } from '@nestjs/common';

import { ProviderCapabilityModule } from '../../provider/capability/provider-capability.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import {
  RequestAvailableAudience,
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
// from the @Global OutboxModule. R17-E closure: the audience decides
// recipients with ProviderCapabilityService, the same decision point as the
// provider routes, so that module is imported too.
@Module({
  imports: [RealtimeModule, ProviderCapabilityModule],
  providers: [
    RequestAvailableAudience,
    RequestAvailableDispatchHandler,
    RequestAvailableBatchHandler,
  ],
  // OutboxModule.forRoot re-provides the handlers in its own scope, so what they
  // inject must be exported from here.
  exports: [
    RequestAvailableAudience,
    RequestAvailableDispatchHandler,
    RequestAvailableBatchHandler,
    ProviderCapabilityModule,
  ],
})
export class RequestOutboxModule {}
