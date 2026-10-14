import { Inject, Injectable } from '@nestjs/common';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';
import { z } from 'zod';

import type { OutboxHandler, OutboxHandlerResult } from '../outbox/outbox.handler';
import { OutboxEventType } from '../outbox/outbox.tokens';
import { MAIL_PORT, MailPort, type MailIntent } from './mail.port';

const payload = z
  .object({ caseId: z.string().min(1).max(64), providerProfileId: z.string().min(1).max(64) })
  .passthrough();

const NOTICE_VALIDITY_MS = 3 * 24 * 60 * 60_000;

/**
 * R21 — email channel for provider verification corrections and outcomes.
 *
 * Consumes the verification-case events the workflow already enqueues in the
 * SAME transaction as the case transition and the in-app notification, so
 * the email exists exactly when the transition does. `handle` records a
 * durable EmailDelivery intent inside the worker's transaction (covered by
 * the handler marker and by the stable message key); `afterCommit` makes the
 * first attempt, and MailDispatcher retries it if that attempt fails or the
 * process dies. Nothing is lost between the two.
 *
 * The message is generic and links to the authenticated /provider/verification
 * view, whose owner check is the server's. No reason code, reviewer note,
 * document, image or number enters the email.
 *
 * Registered through OutboxModule.forRoot in AppModule so verification-case
 * events create durable email delivery intents in the same worker pass.
 */
@Injectable()
export class ProviderStatusEmailHandler implements OutboxHandler {
  // Database value (OutboxHandlerRun.handler): never rename.
  readonly name = 'provider-status.email.v1';
  readonly eventTypes = [
    OutboxEventType.VERIFICATION_CASE_ACTION_REQUIRED,
    OutboxEventType.VERIFICATION_CASE_REJECTED,
    OutboxEventType.VERIFICATION_CASE_APPROVED,
  ];

  constructor(@Inject(MAIL_PORT) private readonly mail: MailPort) {}

  async handle(event: OutboxEvent, tx: PrismaTx): Promise<OutboxHandlerResult | void> {
    const parsed = payload.safeParse(event.payload);
    if (!parsed.success) throw new Error('Invalid verification case event payload');

    const profile = await tx.providerProfile.findUnique({
      where: { id: parsed.data.providerProfileId },
      select: {
        deletedAt: true,
        user: { select: { id: true, email: true, isActive: true, deletedAt: true } },
      },
    });
    const user = profile?.user;
    // A removed profile or account gets nothing; not an error to retry.
    if (!profile || profile.deletedAt || !user || user.deletedAt || !user.isActive) return;

    const intent = intentFor(event, user.email, user.id);
    const ticket = await this.mail.enqueue(intent, tx);
    return {
      afterCommit: () => this.mail.dispatch(ticket),
      stats: { emails: ticket.deliveryId ? 1 : 0 },
    };
  }
}

function intentFor(event: OutboxEvent, to: string, userId: string): MailIntent {
  const base = {
    to,
    userId,
    expiresAt: new Date(Date.now() + NOTICE_VALIDITY_MS),
    messageKey: `outbox:${event.id}:provider-status.email.v1`,
  };
  switch (event.eventType) {
    case OutboxEventType.VERIFICATION_CASE_ACTION_REQUIRED:
      return { ...base, template: 'provider.verification_action_required', vars: {} };
    case OutboxEventType.VERIFICATION_CASE_REJECTED:
      return { ...base, template: 'provider.verification_outcome', vars: { outcome: 'rejected' } };
    default:
      return { ...base, template: 'provider.verification_outcome', vars: { outcome: 'approved' } };
  }
}
