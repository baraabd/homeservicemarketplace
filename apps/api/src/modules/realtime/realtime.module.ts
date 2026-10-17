import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../config/config.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { ProviderCapabilityModule } from '../provider/capability/provider-capability.module';
import { ConversationParticipantGate } from './conversation-participant.gate';
import { RealtimeIdentityResolver } from './realtime-identity.resolver';
import { RealtimeEventsController } from './realtime-events.controller';
import { RealtimeEventsPublisher } from './realtime-events.publisher';
import { RealtimeGateway } from './realtime.gateway';

// @Global so service-layer modules (NotificationsService etc.)
// can inject `RealtimeEventsPublisher` without each module importing
// RealtimeModule explicitly. The realtime layer is additive — service
// code only needs to call `.publishFor()` post-commit.
//
// Sprint 7.0 (refined): the module now exports the Socket.IO gateway
// alongside the SSE controller. SSE is kept as a backwards-compatible
// dev fallback; the gateway is the production channel.
@Global()
@Module({
  imports: [AuthenticationModule, ConfigModule, PersistenceModule, ProviderCapabilityModule],
  controllers: [RealtimeEventsController],
  providers: [
    RealtimeEventsPublisher,
    RealtimeGateway,
    ConversationParticipantGate,
    // Current roles, grants and provider capabilities are resolved again at
    // sensitive delivery/subscription and periodic connection rechecks.
    RealtimeIdentityResolver,
  ],
  exports: [RealtimeEventsPublisher, RealtimeGateway],
})
export class RealtimeModule {}
