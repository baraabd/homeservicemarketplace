import type { PrismaTx } from '@homeservicemarketplace/database';
import type { MoneyPeriodActivation } from '../ports/activation.port';
import { SubscriptionActivationParticipant } from './subscription-activation.participant';
import type { SubscriptionLifecycleService } from './subscription-lifecycle.service';

const input: MoneyPeriodActivation = {
  providerProfileId: 'provider',
  planVersionId: 'plan',
  paymentConfirmationId: 'confirmation',
  subscriptionId: 'subscription',
  subscriptionPeriodId: 'period',
  periodStartsAt: '2030-01-01T00:00:00.000Z',
  periodEndsAt: '2030-02-01T00:00:00.000Z',
};
function fixture() {
  const period = {
    id: 'period',
    subscriptionId: 'subscription',
    paymentConfirmationId: 'confirmation',
    startsAt: new Date(input.periodStartsAt),
    endsAt: new Date(input.periodEndsAt),
    subscription: {
      status: 'ACTIVE',
      providerProfileId: 'provider',
      planVersionId: 'plan',
      planVersion: { entitlements: [] },
    },
    paymentConfirmation: {
      amountMinor: 123n,
      currency: 'XTS',
      paymentIntent: {
        providerProfileId: 'provider',
        planVersionId: 'plan',
        status: 'SUCCEEDED',
        totalMinor: 123n,
        currency: 'XTS',
      },
      ledgerTransaction: { status: 'POSTED', kind: 'STANDARD', currency: 'XTS' },
    },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'subscription' }]),
    subscriptionPeriod: { findUnique: jest.fn().mockResolvedValue(period) },
  };
  const schedulePeriod = jest.fn().mockResolvedValue(undefined);
  return {
    period,
    tx,
    schedulePeriod,
    service: new SubscriptionActivationParticipant({
      schedulePeriod,
    } as unknown as SubscriptionLifecycleService),
  };
}

describe('R31 existing-confirmation activation participant', () => {
  it('enlists scheduling in the same transaction after checking the existing period', async () => {
    const h = fixture();
    await h.service.activatePeriod(input, h.tx as unknown as PrismaTx);
    expect(h.service.isConfigured()).toBe(true);
    expect(h.schedulePeriod).toHaveBeenCalledWith(h.period, h.tx);
  });

  it.each([
    'providerProfileId',
    'planVersionId',
    'paymentConfirmationId',
    'subscriptionId',
    'periodStartsAt',
    'periodEndsAt',
  ] as const)('rejects mismatched %s without scheduling', async (key) => {
    const h = fixture();
    await expect(
      h.service.activatePeriod({ ...input, [key]: 'different' }, h.tx as unknown as PrismaTx),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.schedulePeriod).not.toHaveBeenCalled();
  });

  it('requires both a succeeded payment and posted standard ledger history', async () => {
    const h = fixture();
    h.period.paymentConfirmation.paymentIntent.status = 'PROCESSING';
    await expect(
      h.service.activatePeriod(input, h.tx as unknown as PrismaTx),
    ).rejects.toMatchObject({ status: 409 });
    h.period.paymentConfirmation.paymentIntent.status = 'SUCCEEDED';
    h.period.paymentConfirmation.ledgerTransaction.status = 'DRAFT';
    await expect(
      h.service.activatePeriod(input, h.tx as unknown as PrismaTx),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.schedulePeriod).not.toHaveBeenCalled();
  });

  it('propagates scheduling failure so the caller can roll back the complete money transaction', async () => {
    const h = fixture();
    h.schedulePeriod.mockRejectedValue(new Error('outbox unavailable'));
    await expect(h.service.activatePeriod(input, h.tx as unknown as PrismaTx)).rejects.toThrow(
      'outbox unavailable',
    );
  });
});
