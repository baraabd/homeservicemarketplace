import { Injectable } from '@nestjs/common';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';
import { z } from 'zod';
import type {
  OutboxHandler,
  OutboxHandlerResult,
} from '../../../infrastructure/outbox/outbox.handler';
import { RealtimeEventsPublisher } from '../../realtime/realtime-events.publisher';
import { PRIVATE_RETENTION_EVENT } from './workspace-events.service';
import { WORKSPACE_EVENT } from './workspace.policy';
const payload = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string(),
    disputeId: z.string(),
    notificationIds: z.array(z.string()).max(2),
  })
  .strict();
@Injectable()
export class WorkspaceEventsHandler implements OutboxHandler {
  readonly name = 'dispute-workspace.notification.v1';
  readonly eventTypes = [WORKSPACE_EVENT, PRIVATE_RETENTION_EVENT];
  constructor(private readonly realtime: RealtimeEventsPublisher) {}
  async handle(event: OutboxEvent, tx: PrismaTx): Promise<OutboxHandlerResult | void> {
    if (event.eventType === PRIVATE_RETENTION_EVENT) {
      const p = z
        .object({ schemaVersion: z.literal(1), auditId: z.string() })
        .strict()
        .safeParse(event.payload);
      if (
        !p.success ||
        !(await tx.auditEvent.findFirst({
          where: { id: p.data.auditId, type: 'DISPUTE_PRIVATE_RETENTION' },
        }))
      )
        throw new Error('Invalid private-retention receipt');
      return;
    }
    const p = payload.safeParse(event.payload);
    if (!p.success) throw new Error('Invalid dispute workspace event');
    const rows = await tx.notification.findMany({
      where: { id: { in: p.data.notificationIds }, deletedAt: null },
    });
    return {
      afterCommit: async () => {
        for (const row of rows)
          this.realtime.publishFor(row.userId, 'notification.created', {
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
          });
        await Promise.resolve();
      },
    };
  }
}
