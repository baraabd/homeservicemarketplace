import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';
import { SubscriptionActivatedHandler } from './subscription-activated.handler';
import type { NotificationsService } from './notifications.service';

function fixture() {
  const createForUser = jest.fn().mockResolvedValue({ id: 'notice' });
  const period = {
    subscriptionId: 'subscription',
    paymentConfirmationId: 'confirmation',
    subscription: { providerProfile: { user: { id: 'owner', deletedAt: null } } },
  };
  const findUnique = jest.fn().mockResolvedValue(period);
  const tx = { subscriptionPeriod: { findUnique } } as unknown as PrismaTx;
  const event = {
    aggregateType: 'ProviderSubscription',
    aggregateId: 'subscription',
    payload: {
      contractVersion: 'hsm.money.v1',
      subscriptionId: 'subscription',
      paymentConfirmationId: 'confirmation',
      subscriptionPeriodId: 'period',
    },
  } as unknown as OutboxEvent;
  return {
    createForUser,
    findUnique,
    tx,
    event,
    period,
    handler: new SubscriptionActivatedHandler({ createForUser } as unknown as NotificationsService),
  };
}
it('uses the persisted recipient and the worker transaction, without granting access', async () => {
  const f = fixture();
  await f.handler.handle(f.event, f.tx);
  expect(f.createForUser).toHaveBeenCalledWith(
    expect.objectContaining({ userId: 'owner', type: 'SYSTEM' }),
    f.tx,
  );
  expect(f.createForUser).toHaveBeenCalledTimes(1);
});
it.each(['aggregate', 'period', 'confirmation', 'extraPayload'])(
  'refuses a mismatched %s without notifying',
  async (variant) => {
    const f = fixture();
    if (variant === 'aggregate') f.event.aggregateId = 'foreign';
    if (variant === 'period') f.period.subscriptionId = 'foreign';
    if (variant === 'confirmation') f.period.paymentConfirmationId = 'foreign';
    if (variant === 'extraPayload')
      f.event.payload = { ...(f.event.payload as object), userId: 'foreign' };
    await expect(f.handler.handle(f.event, f.tx)).rejects.toThrow();
    expect(f.createForUser).not.toHaveBeenCalled();
  },
);
it('does not notify a deleted recipient', async () => {
  const f = fixture();
  f.findUnique.mockResolvedValue({
    ...f.period,
    subscription: { providerProfile: { user: { id: 'owner', deletedAt: new Date() } } },
  });
  await f.handler.handle(f.event, f.tx);
  expect(f.createForUser).not.toHaveBeenCalled();
});
it('propagates notification failure so the worker transaction and marker roll back', async () => {
  const f = fixture();
  const failure = new Error('notification unavailable');
  f.createForUser.mockRejectedValue(failure);
  await expect(f.handler.handle(f.event, f.tx)).rejects.toBe(failure);
});
