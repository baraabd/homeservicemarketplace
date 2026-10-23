import { toMoneyWire } from '@homeservicemarketplace/contracts';
import type { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import type { MoneyRefundTransportCommand } from '../../ports/refund.port';
import type { ManualRailConfiguration } from './manual-rail.config';
import { ManualRefundAdapter } from './manual-refund.adapter';

describe('R30 manual refund observation verifies immutable obligation', () => {
  function fixture() {
    const binding = {
      planVersionId: 'plan',
      method: 'CASH_OFFICE' as const,
      currency: 'XTS',
      adapterId: 'hsm.manual.v1',
      mode: 'SANDBOX' as const,
      accountReference: 'sandbox',
      configVersion: 'v1',
      debitAccountId: 'debit',
      creditAccountId: 'credit',
    };
    const command: MoneyRefundTransportCommand = {
      binding,
      refundId: 'refund',
      paymentConfirmationId: 'confirmation',
      providerIdempotencyKey: 'durable-provider-key',
      amount: toMoneyWire({ amountMinor: 1000n, currency: 'XTS' }),
      externalOperationId: 'operation',
    };
    const row = {
      refundId: 'refund',
      ...binding,
      amountMinor: 1000n,
      providerIdempotencyKey: command.providerIdempotencyKey,
      state: 'SUCCEEDED',
      externalOperationId: 'operation',
      reference: 'operator-confirmed-test',
      dispatchUserId: 'dispatcher',
      confirmationUserId: 'confirmer',
      refund: {
        paymentConfirmationId: 'confirmation',
        amountMinor: 1000n,
        currency: 'XTS',
        paymentConfirmation: { paymentIntent: { ...binding, binding } },
      },
    };
    const read = jest.fn().mockResolvedValue(row);
    const adapter = new ManualRefundAdapter(
      { client: { moneyManualRefundOperation: { findUnique: read } } } as unknown as PrismaService,
      {} as TransactionRunner,
      {} as ManualRailConfiguration,
    );
    return { command, adapter, read, row };
  }

  it('returns independently confirmed evidence using its original provider key', async () => {
    const f = fixture();
    await expect(f.adapter.query(f.command)).resolves.toMatchObject({
      status: 'SUCCEEDED',
      paymentConfirmationId: 'confirmation',
      externalOperationId: 'operation',
    });
  });

  it.each(['confirmation', 'plan', 'method', 'configuration', 'provider-key'])(
    'refuses a forged %s correlation',
    async (field) => {
      const f = fixture();
      const command = { ...f.command, binding: { ...f.command.binding } };
      if (field === 'confirmation') command.paymentConfirmationId = 'different-confirmation';
      if (field === 'plan') command.binding.planVersionId = 'different-plan';
      if (field === 'method') command.binding.method = 'SHAM_CASH';
      if (field === 'configuration') command.binding.configVersion = 'different-version';
      if (field === 'provider-key') command.providerIdempotencyKey = 'different-key';
      await expect(f.adapter.query(command)).rejects.toMatchObject({
        details: { reason: 'REFUND_BINDING_MISMATCH' },
      });
    },
  );

  it('preserves unknown and refuses terminal evidence from one actor', async () => {
    const f = fixture();
    f.read.mockResolvedValue(null);
    await expect(f.adapter.query(f.command)).resolves.toMatchObject({ status: 'UNKNOWN' });
    f.read.mockResolvedValue({ ...f.row, confirmationUserId: 'dispatcher' });
    await expect(f.adapter.query(f.command)).rejects.toMatchObject({
      details: { reason: 'REFUND_CONFIRMATION_INCOMPLETE' },
    });
  });
});
