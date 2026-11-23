import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';
import {
  OutboxPermanentError,
  OutboxTransientError,
} from '../../../infrastructure/outbox/outbox.errors';
import { OutboxEventType } from '../../../infrastructure/outbox/outbox.tokens';
import { AppError } from '../../../shared/errors/app-error';
import type { SubscriptionLifecycleService } from './subscription-lifecycle.service';
import { SubscriptionOutboxHandler } from './subscription-outbox.handler';

function fixture() {
  const lifecycle = {
    expirePeriod: jest.fn().mockResolvedValue(true),
    remindPeriod: jest.fn().mockResolvedValue(true),
  };
  const tx = {
    subscriptionPeriod: {
      findUnique: jest.fn().mockResolvedValue({
        subscriptionId: 'subscription',
        paymentConfirmationId: 'confirmation',
      }),
    },
  };
  const event = {
    eventType: OutboxEventType.MONEY_SUBSCRIPTION_EXPIRY_DUE,
    aggregateType: 'ProviderSubscription',
    aggregateId: 'subscription',
    dedupeKey: `${OutboxEventType.MONEY_SUBSCRIPTION_EXPIRY_DUE}:period`,
    payload: {
      contractVersion: 'hsm.money.v1',
      subscriptionId: 'subscription',
      subscriptionPeriodId: 'period',
      paymentConfirmationId: 'confirmation',
    },
  } as unknown as OutboxEvent;
  return {
    event,
    tx,
    lifecycle,
    handler: new SubscriptionOutboxHandler(lifecycle as unknown as SubscriptionLifecycleService),
  };
}

describe('R31 durable lifecycle event validation', () => {
  it('uses the transaction supplied by the worker', async () => {
    const h = fixture();
    await h.handler.handle(h.event, h.tx as unknown as PrismaTx);
    expect(h.lifecycle.expirePeriod).toHaveBeenCalledWith('subscription', 'period', h.tx);
  });

  it('rejects payload extensions, wrong aggregate and mismatched persisted reference', async () => {
    const h = fixture();
    await expect(
      h.handler.handle(
        { ...h.event, payload: { ...(h.event.payload as object), grantsWorkAccess: true } },
        h.tx as unknown as PrismaTx,
      ),
    ).rejects.toBeInstanceOf(OutboxPermanentError);
    await expect(
      h.handler.handle({ ...h.event, aggregateId: 'other' }, h.tx as unknown as PrismaTx),
    ).rejects.toBeInstanceOf(OutboxPermanentError);
    h.tx.subscriptionPeriod.findUnique.mockResolvedValue({
      subscriptionId: 'other',
      paymentConfirmationId: 'confirmation',
    });
    await expect(h.handler.handle(h.event, h.tx as unknown as PrismaTx)).rejects.toBeInstanceOf(
      OutboxPermanentError,
    );
    expect(h.lifecycle.expirePeriod).not.toHaveBeenCalled();
  });

  it('retries premature expiry while stopping policy-unapproved reminders', async () => {
    const h = fixture();
    h.lifecycle.expirePeriod.mockRejectedValue(
      new AppError('CONFLICT', 'Subscription expiry is not due.', 409),
    );
    await expect(h.handler.handle(h.event, h.tx as unknown as PrismaTx)).rejects.toBeInstanceOf(
      OutboxTransientError,
    );
    h.lifecycle.remindPeriod.mockRejectedValue(
      new AppError('DEPENDENCY_UNAVAILABLE', 'Blocked', 503),
    );
    await expect(
      h.handler.handle(
        {
          ...h.event,
          eventType: OutboxEventType.MONEY_SUBSCRIPTION_REMINDER_DUE,
          dedupeKey: `${OutboxEventType.MONEY_SUBSCRIPTION_REMINDER_DUE}:period`,
        },
        h.tx as unknown as PrismaTx,
      ),
    ).rejects.toBeInstanceOf(OutboxPermanentError);
  });
});
