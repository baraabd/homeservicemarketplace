import { Injectable } from '@nestjs/common';
import { MONEY_CONTRACT_VERSION } from '@homeservicemarketplace/contracts';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';
import { z } from 'zod';

import {
  OutboxPermanentError,
  OutboxTransientError,
} from '../../../infrastructure/outbox/outbox.errors';
import type { OutboxHandler } from '../../../infrastructure/outbox/outbox.handler';
import { OutboxEventType } from '../../../infrastructure/outbox/outbox.tokens';
import { AppError } from '../../../shared/errors/app-error';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const payloadSchema = z
  .object({
    contractVersion: z.literal(MONEY_CONTRACT_VERSION),
    subscriptionId: id,
    subscriptionPeriodId: id,
    paymentConfirmationId: id,
  })
  .strict();

@Injectable()
export class SubscriptionOutboxHandler implements OutboxHandler {
  readonly name = 'money.subscription.lifecycle.v1';
  readonly eventTypes = [
    OutboxEventType.MONEY_SUBSCRIPTION_EXPIRY_DUE,
    OutboxEventType.MONEY_SUBSCRIPTION_REMINDER_DUE,
  ];
  constructor(private readonly lifecycle: SubscriptionLifecycleService) {}

  async handle(event: OutboxEvent, tx: PrismaTx): Promise<void> {
    const parsed = payloadSchema.safeParse(event.payload);
    if (
      !parsed.success ||
      !this.eventTypes.includes(event.eventType as (typeof this.eventTypes)[number])
    ) {
      throw new OutboxPermanentError('Invalid subscription lifecycle event.');
    }
    const payload = parsed.data;
    if (
      event.aggregateType !== 'ProviderSubscription' ||
      event.aggregateId !== payload.subscriptionId ||
      event.dedupeKey !== `${event.eventType}:${payload.subscriptionPeriodId}`
    ) {
      throw new OutboxPermanentError('Invalid subscription lifecycle identity.');
    }
    const period = await tx.subscriptionPeriod.findUnique({
      where: { id: payload.subscriptionPeriodId },
      select: { subscriptionId: true, paymentConfirmationId: true },
    });
    if (
      !period ||
      period.subscriptionId !== payload.subscriptionId ||
      period.paymentConfirmationId !== payload.paymentConfirmationId
    ) {
      throw new OutboxPermanentError('Subscription lifecycle references do not match.');
    }
    try {
      if (event.eventType === OutboxEventType.MONEY_SUBSCRIPTION_EXPIRY_DUE) {
        await this.lifecycle.expirePeriod(payload.subscriptionId, payload.subscriptionPeriodId, tx);
      } else {
        await this.lifecycle.remindPeriod(payload.subscriptionId, payload.subscriptionPeriodId, tx);
      }
    } catch (error) {
      if (error instanceof AppError && error.status === 503) {
        throw new OutboxPermanentError('Subscription lifecycle policy is unavailable.', {
          cause: error,
        });
      }
      if (
        error instanceof AppError &&
        (error.message === 'Subscription expiry is not due.' ||
          error.message === 'Subscription reminder is not due.')
      ) {
        throw new OutboxTransientError('Subscription lifecycle event is not due.');
      }
      throw error;
    }
  }
}
