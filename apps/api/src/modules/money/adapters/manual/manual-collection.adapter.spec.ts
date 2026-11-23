import { ManualCollectionAdapter } from './manual-collection.adapter';
import { toMoneyWire } from '@homeservicemarketplace/contracts';
import type { MoneyCollectionCommand } from '../../ports/collection.port';

describe('R30 collection instructions are not settlement evidence', () => {
  const command: MoneyCollectionCommand = {
    binding: {
      planVersionId: 'plan',
      method: 'SHAM_CASH',
      currency: 'XTS',
      mode: 'SANDBOX',
      adapterId: 'hsm.manual.v1',
      accountReference: 'test',
      configVersion: 'test-v1',
      debitAccountId: 'clearing',
      creditAccountId: 'revenue',
    },
    paymentIntentId: 'intent',
    paymentAttemptId: 'attempt',
    providerIdempotencyKey: 'provider-key',
    amount: toMoneyWire({ amountMinor: 1000n, currency: 'XTS' }),
    externalOperationId: null,
  };

  it('stays pending with no fabricated transfer identifier on repeated submissions', async () => {
    const adapter = new ManualCollectionAdapter();
    await expect(adapter.createOrResume(command)).resolves.toEqual({
      status: 'PENDING',
      externalOperationId: null,
    });
    await expect(adapter.createOrResume(command)).resolves.toEqual({
      status: 'PENDING',
      externalOperationId: null,
    });
  });

  it('refuses LIVE and arbitrary webhook confirmations', async () => {
    const adapter = new ManualCollectionAdapter();
    await expect(
      adapter.createOrResume({ ...command, binding: { ...command.binding, mode: 'LIVE' } }),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    await expect(adapter.validateAndNormalizeExternalEvent()).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
  });
});
