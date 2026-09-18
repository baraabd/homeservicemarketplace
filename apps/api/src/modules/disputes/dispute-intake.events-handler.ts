import { Injectable } from '@nestjs/common';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';
import { z } from 'zod';
import type { OutboxHandler, OutboxHandlerResult } from '../../infrastructure/outbox/outbox.handler';
import { RealtimeEventsPublisher } from '../realtime/realtime-events.publisher';
import { DISPUTE_INTAKE_EVENT } from './dispute-intake.policy';

const payloadSchema = z.object({
  schemaVersion: z.literal(1), disputeId: z.string(), notificationId: z.string().nullable(), actorUserId: z.string(),
}).strict();

/** Durable notification creation happens in the domain transaction; realtime is an accelerator. */
@Injectable()
export class DisputeIntakeEventsHandler implements OutboxHandler {
  readonly name = 'dispute-intake.notification.v1';
  readonly eventTypes = [DISPUTE_INTAKE_EVENT];
  constructor(private readonly realtime: RealtimeEventsPublisher) {}

  async handle(event: OutboxEvent, tx: PrismaTx): Promise<OutboxHandlerResult | void> {
    const parsed = payloadSchema.safeParse(event.payload);
    if (!parsed.success) throw new Error('Invalid dispute intake event');
    if (!parsed.data.notificationId) return;
    const row = await tx.notification.findFirst({ where: { id: parsed.data.notificationId, deletedAt: null } });
    if (!row) return;
    return {
      afterCommit: async () => {
        this.realtime.publishFor(row.userId, 'notification.created', {
          id: row.id, type: row.type, title: row.title, body: row.body,
          resourceType: row.resourceType, resourceId: row.resourceId, deepLink: row.deepLink,
          metadata: row.metadata, readAt: row.readAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        }, { actorUserId: parsed.data.actorUserId });
        await Promise.resolve();
      },
    };
  }
}
