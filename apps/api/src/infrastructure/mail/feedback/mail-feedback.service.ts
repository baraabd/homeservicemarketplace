import { Injectable, Logger } from '@nestjs/common';
import type { EmailFeedbackKind } from '@homeservicemarketplace/database';
import { z } from 'zod';

import { PrismaService } from '../../prisma/prisma.service';
import { deliveryIdFromMessageId } from '../durable-mail.service';
import { MailMetrics } from '../mail.metrics';
import { FEEDBACK_SOURCE } from './feedback-signature';

const event = z
  .object({
    id: z.string().min(1).max(200),
    type: z.enum(['delivered', 'bounce', 'complaint']),
    bounceType: z.enum(['permanent', 'transient']).optional(),
    messageId: z.string().min(3).max(300),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .refine((e) => e.type !== 'bounce' || e.bounceType !== undefined, 'bounceType required');

export const feedbackBody = z.object({ events: z.array(event).min(1).max(100) }).strict();
export type FeedbackBody = z.infer<typeof feedbackBody>;
export type FeedbackResult = 'applied' | 'duplicate' | 'unmatched';

/**
 * R21 — applies VERIFIED delivery feedback.
 *
 * Safety properties, each pinned by r21-mail-feedback.integration.spec.ts:
 *
 *  - Feedback can only affect a message WE minted and the provider ACCEPTED:
 *    the Message-ID must decode to an EmailDelivery id whose status is
 *    ACCEPTED or later. Anything else is "unmatched" and changes nothing.
 *  - The suppressed address is taken from OUR row (recipientHash), never from
 *    the payload, so even a holder of the signing secret cannot suppress an
 *    address we never mailed.
 *  - Replays are absorbed by (source, externalId) uniqueness.
 *  - Suppression is a mail-channel fact. It never touches User, sessions,
 *    roles or account standing, and it never blocks AUTH mail.
 *  - Status only moves forward: ACCEPTED → DELIVERED → COMPLAINED, ACCEPTED |
 *    DELIVERED → BOUNCED. A late "delivered" cannot undo a bounce.
 */
@Injectable()
export class MailFeedbackService {
  private readonly log = new Logger(MailFeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MailMetrics,
  ) {}

  async apply(body: FeedbackBody): Promise<Record<FeedbackResult, number>> {
    const totals: Record<FeedbackResult, number> = { applied: 0, duplicate: 0, unmatched: 0 };
    for (const e of body.events) {
      const kind: EmailFeedbackKind =
        e.type === 'delivered'
          ? 'DELIVERED'
          : e.type === 'complaint'
            ? 'COMPLAINT'
            : e.bounceType === 'permanent'
              ? 'BOUNCE_PERMANENT'
              : 'BOUNCE_TRANSIENT';
      const result = await this.applyOne(e.id, kind, e.messageId, new Date(e.occurredAt));
      totals[result] += 1;
      this.metrics.feedbackTotal.inc({ kind: kind.toLowerCase(), result });
    }
    return totals;
  }

  private async applyOne(
    externalId: string,
    kind: EmailFeedbackKind,
    messageId: string,
    occurredAt: Date,
  ): Promise<FeedbackResult> {
    const deliveryId = deliveryIdFromMessageId(messageId);
    if (!deliveryId) return 'unmatched';

    return this.prisma.client.$transaction(async (tx) => {
      // Row lock: two feedback events for one message serialise here, so the
      // forward-only transition below reads the latest status.
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; recipientHash: string }>>`
        SELECT "id", "status"::text AS "status", "recipientHash"
        FROM "EmailDelivery" WHERE "id" = ${deliveryId} FOR UPDATE
      `;
      const delivery = rows[0];
      if (
        !delivery ||
        !['ACCEPTED', 'DELIVERED', 'BOUNCED', 'COMPLAINED'].includes(delivery.status)
      ) {
        return 'unmatched';
      }

      const inserted = await tx.emailFeedbackEvent.createMany({
        data: [{ source: FEEDBACK_SOURCE, externalId, kind, deliveryId, occurredAt }],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return 'duplicate';
      const feedback = await tx.emailFeedbackEvent.findUniqueOrThrow({
        where: { source_externalId: { source: FEEDBACK_SOURCE, externalId } },
        select: { id: true },
      });

      const next = nextStatus(delivery.status, kind);
      if (next) {
        await tx.emailDelivery.update({
          where: { id: deliveryId },
          data: { status: next, outcomeAt: occurredAt, envelope: null },
        });
      }
      const reason =
        kind === 'BOUNCE_PERMANENT' ? 'HARD_BOUNCE' : kind === 'COMPLAINT' ? 'COMPLAINT' : null;
      if (reason) {
        await tx.emailSuppression.upsert({
          where: { recipientHash_reason: { recipientHash: delivery.recipientHash, reason } },
          create: { recipientHash: delivery.recipientHash, reason, feedbackId: feedback.id },
          // An operator-lifted suppression is re-armed by fresh evidence.
          update: { liftedAt: null, feedbackId: feedback.id },
        });
        this.log.warn({ msg: 'mail.suppression.recorded', deliveryId, reason });
      }
      return 'applied';
    });
  }
}

function nextStatus(
  current: string,
  kind: EmailFeedbackKind,
): 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | null {
  switch (kind) {
    case 'DELIVERED':
      return current === 'ACCEPTED' ? 'DELIVERED' : null;
    case 'BOUNCE_PERMANENT':
      return current === 'ACCEPTED' || current === 'DELIVERED' ? 'BOUNCED' : null;
    case 'COMPLAINT':
      return current === 'ACCEPTED' || current === 'DELIVERED' ? 'COMPLAINED' : null;
    case 'BOUNCE_TRANSIENT':
      return null;
  }
}
