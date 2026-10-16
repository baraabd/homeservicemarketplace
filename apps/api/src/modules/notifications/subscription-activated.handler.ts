import { Injectable } from '@nestjs/common';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';
import { MONEY_CONTRACT_VERSION } from '@homeservicemarketplace/contracts';
import { z } from 'zod';
import type { OutboxHandler } from '../../infrastructure/outbox/outbox.handler';
import { OutboxEventType } from '../../infrastructure/outbox/outbox.tokens';
import { NotificationsService } from './notifications.service';

const payloadSchema = z
  .object({
    contractVersion: z.literal(MONEY_CONTRACT_VERSION),
    paymentConfirmationId: z.string().min(1).max(64),
    subscriptionId: z.string().min(1).max(64),
    subscriptionPeriodId: z.string().min(1).max(64),
  })
  .strict();

/** Existing R17 inbox delivery only: creates no entitlement, verification or work access. */
@Injectable()
export class SubscriptionActivatedHandler implements OutboxHandler {
  readonly name = 'money.subscription.activated.notification.v1';
  readonly eventTypes = [OutboxEventType.MONEY_SUBSCRIPTION_ACTIVATED];
  constructor(private readonly notifications: NotificationsService) {}

  async handle(event: OutboxEvent, tx: PrismaTx): Promise<void> {
    const payload = payloadSchema.parse(event.payload);
    if (
      event.aggregateType !== 'ProviderSubscription' ||
      event.aggregateId !== payload.subscriptionId
    )
      throw new Error('Invalid subscription activation aggregate');
    const period = await tx.subscriptionPeriod.findUnique({
      where: { id: payload.subscriptionPeriodId },
      include: { subscription: { include: { providerProfile: { include: { user: true } } } } },
    });
    if (
      !period ||
      period.subscriptionId !== payload.subscriptionId ||
      period.paymentConfirmationId !== payload.paymentConfirmationId
    )
      throw new Error('Subscription activation reference mismatch');
    const user = period.subscription.providerProfile.user;
    if (!user || user.deletedAt) return;
    await this.notifications.createForUser(
      {
        userId: user.id,
        type: 'SYSTEM',
        dedupeKey: `money.subscription.activated.v1:${payload.paymentConfirmationId}`,
        deepLink: '/provider/profile',
        title: 'Subscription activated / تم تفعيل الاشتراك',
        body: 'Your subscription period has been activated. Verification and work eligibility are assessed separately. / تم تفعيل فترة اشتراكك. يتم تقييم التحقق وأهلية العمل بشكل مستقل.',
      },
      tx,
    );
  }
}
