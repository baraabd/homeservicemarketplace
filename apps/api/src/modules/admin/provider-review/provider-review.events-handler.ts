import { Injectable } from '@nestjs/common';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';
import type {
  OutboxHandler,
  OutboxHandlerResult,
} from '../../../infrastructure/outbox/outbox.handler';
import { RealtimeEventsPublisher } from '../../realtime/realtime-events.publisher';
import { PROVIDER_REVIEW_DECIDED_EVENT } from './provider-review.service';

/** The durable notification is committed with the decision; realtime only accelerates its delivery. */
@Injectable()
export class AdminProviderReviewEventsHandler implements OutboxHandler {
  readonly name = 'provider-review.notification';
  readonly eventTypes = [PROVIDER_REVIEW_DECIDED_EVENT];

  constructor(private readonly realtime: RealtimeEventsPublisher) {}

  async handle(event: OutboxEvent, tx: PrismaTx): Promise<OutboxHandlerResult | void> {
    const payload = event.payload as { notificationId?: unknown; actorUserId?: unknown } | null;
    if (typeof payload?.notificationId !== 'string')
      throw new Error('Invalid provider review event');
    const row = await tx.notification.findFirst({
      where: { id: payload.notificationId, deletedAt: null },
    });
    if (!row) return;
    return {
      afterCommit: async () => {
        this.realtime.publishFor(
          row.userId,
          'notification.created',
          {
            id: row.id,
            type: row.type,
            title: row.title,
            body: row.body,
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            deepLink: row.deepLink,
            metadata: row.metadata,
            readAt: row.readAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
          },
          { actorUserId: typeof payload.actorUserId === 'string' ? payload.actorUserId : null },
        );
        await Promise.resolve();
      },
    };
  }
}
