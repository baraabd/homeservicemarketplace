import { toMoneyWire } from '@homeservicemarketplace/contracts';
import { ApprovedRefundParticipant } from './approved-refund.participant';
import type { MoneyConfirmedRefund } from '../ports/refund.port';
import type { PrismaTx } from '@homeservicemarketplace/database';
type Args = ConstructorParameters<typeof ApprovedRefundParticipant>;
const input: MoneyConfirmedRefund = {
  refundId: 'refund',
  refundRequestId: 'request',
  paymentConfirmationId: 'confirmation',
  policyVersion: 'synthetic-v1',
  amount: toMoneyWire({ amountMinor: 100n, currency: 'XTS' }),
  compensatingLedgerTransactionId: 'compensation',
};
function setup() {
  const source = {
    byVersion: jest.fn().mockResolvedValue({
      policy: {
        version: 'synthetic-v1',
        planVersionId: 'plan',
        method: 'STRIPE',
        currency: 'XTS',
      },
      effect: 'SUSPEND_SUBSCRIPTION',
    }),
  };
  const lifecycle = { applyConfirmedRefund: jest.fn().mockResolvedValue({}) };
  const tx = {
    moneyPaymentConfirmation: {
      findUnique: jest.fn().mockResolvedValue({
        currency: 'XTS',
        paymentIntent: { planVersionId: 'plan', method: 'STRIPE', binding: { mode: 'SANDBOX' } },
      }),
    },
  };
  return {
    source,
    lifecycle,
    tx,
    prisma: tx as unknown as PrismaTx,
    participant: new ApprovedRefundParticipant(
      source as unknown as Args[0],
      lifecycle as unknown as Args[1],
    ),
  };
}
describe('G3 approved refund participant', () => {
  it('enlists the existing lifecycle authority in the same caller transaction', async () => {
    const h = setup();
    await h.participant.applyConfirmedRefund(input, h.prisma);
    expect(h.lifecycle.applyConfirmedRefund).toHaveBeenCalledWith(
      input,
      h.prisma,
      expect.objectContaining({
        version: 'synthetic-v1',
        refundEffect: 'SUSPEND_SUBSCRIPTION',
        cancellation: 'BLOCKED',
      }),
    );
  });
  it('rejects missing policy without applying effects', async () => {
    const h = setup();
    h.source.byVersion.mockResolvedValue(null);
    await expect(h.participant.applyConfirmedRefund(input, h.prisma)).rejects.toThrow();
    expect(h.lifecycle.applyConfirmedRefund).not.toHaveBeenCalled();
  });
  it('rejects live or mismatched original obligations', async () => {
    const h = setup();
    h.tx.moneyPaymentConfirmation.findUnique.mockResolvedValue({
      currency: 'XXX',
      paymentIntent: { planVersionId: 'plan', method: 'STRIPE', binding: { mode: 'LIVE' } },
    });
    await expect(h.participant.applyConfirmedRefund(input, h.prisma)).rejects.toThrow();
    expect(h.lifecycle.applyConfirmedRefund).not.toHaveBeenCalled();
  });
  it('propagates lifecycle failure so the caller rolls back confirmation and compensation', async () => {
    const h = setup();
    h.lifecycle.applyConfirmedRefund.mockRejectedValue(new Error('transaction invariant'));
    await expect(h.participant.applyConfirmedRefund(input, h.prisma)).rejects.toThrow(
      'transaction invariant',
    );
  });
});
