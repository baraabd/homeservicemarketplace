import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../../config/config.module';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module';
import { AuthenticationModule } from '../iam/authentication/authentication.module';
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
  imports: [AuthenticationModule, ConfigModule, PersistenceModule],
  controllers: [RealtimeEventsController],
  providers: [
    RealtimeEventsPublisher,
    RealtimeGateway,
    ConversationParticipantGate,
    // D-4: resolves CURRENT roles + provider status at handshake so room
    // membership is never decided by a stale JWT claim.
    RealtimeIdentityResolver,
  ],
  exports: [RealtimeEventsPublisher, RealtimeGateway],
})
export class RealtimeModule {}
