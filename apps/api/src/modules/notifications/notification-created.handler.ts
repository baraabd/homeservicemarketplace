import { Injectable } from '@nestjs/common';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';
import { z } from 'zod';

import type {
  OutboxHandler,
  OutboxHandlerResult,
} from '../../infrastructure/outbox/outbox.handler';
import { OutboxEventType } from '../../infrastructure/outbox/outbox.tokens';
import { RealtimeEventsPublisher } from '../realtime/realtime-events.publisher';
import { toNotificationSummary } from './notifications.service';

const payload = z
  .object({
    schemaVersion: z.literal(1),
    notificationId: z.string().min(1).max(64),
    actorUserId: z.string().min(1).max(64).nullable(),
  })
  .strict();

/**
 * R17-B — announces a committed notification to its recipient.
 *
 * NotificationsService.createForUser writes the row and this event in one
 * transaction, so the event exists exactly when the row does; a rolled-back
 * business change leaves neither. The live push runs in `afterCommit`, after
 * the worker's own transaction has committed its handler marker, so a
 * re-delivered event is skipped rather than announced twice. A crash between
 * that commit and the push loses only the push: the row is already in the
 * inbox, and polling shows it. The push is an accelerator, never the record.
 *
 * Only reads and publishes: it creates no notification and enqueues nothing,
 * so it cannot start a chain.
 */
@Injectable()
export class NotificationCreatedHandler implements OutboxHandler {
  readonly name = 'notification.created.publish.v1';
  readonly eventTypes = [OutboxEventType.NOTIFICATION_CREATED];

  constructor(private readonly realtime: RealtimeEventsPublisher) {}

  async handle(event: OutboxEvent, tx: PrismaTx): Promise<OutboxHandlerResult | void> {
    const parsed = payload.safeParse(event.payload);
    if (!parsed.success) throw new Error('Invalid notification.created event');
    const row = await tx.notification.findFirst({
      where: { id: parsed.data.notificationId, deletedAt: null },
    });
    // Deleted before it could be announced: there is nothing to show.
    if (!row) return;
    const summary = toNotificationSummary(row);
    return {
      afterCommit: async () => {
        this.realtime.publishFor(row.userId, 'notification.created', summary, {
          actorUserId: parsed.data.actorUserId,
        });
        await Promise.resolve();
      },
    };
  }
}
