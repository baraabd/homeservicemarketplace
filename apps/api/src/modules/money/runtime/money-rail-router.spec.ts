import {
  MoneyCollectionRouter,
  MoneyRailConfiguration,
  MoneyRefundRouter,
} from './money-rail-router';
import { fixture } from '../../../../test/support/r29-stripe.fixture';
import type { ManualCollectionAdapter } from '../adapters/manual/manual-collection.adapter';
import type { ManualRefundAdapter } from '../adapters/manual/manual-refund.adapter';
import type { StripeCollectionAdapter } from '../adapters/stripe/stripe-collection.adapter';
import type { StripeRefundAdapter } from '../adapters/stripe/stripe-refund.adapter';
import type { ManualRailConfiguration } from '../adapters/manual/manual-rail.config';
import type { PrismaTx } from '@homeservicemarketplace/database';

// Transport doubles isolate routing, never provider settlement evidence.
function setup() {
  const adapter = () => ({
    isConfigured: jest.fn(() => true),
    createOrResume: jest.fn(),
    validateAndNormalizeExternalEvent: jest.fn(),
    submit: jest.fn(),
    query: jest.fn(),
  });
  const manual = adapter(),
    stripe = adapter();
  return {
    manual,
    stripe,
    collection: new MoneyCollectionRouter(
      manual as unknown as ManualCollectionAdapter,
      stripe as unknown as StripeCollectionAdapter,
    ),
    refund: new MoneyRefundRouter(
      manual as unknown as ManualRefundAdapter,
      stripe as unknown as StripeRefundAdapter,
    ),
  };
}
describe('G3 exact rail routing', () => {
  it.each(['LIVE', 'WRONG_ADAPTER', 'WRONG_METHOD'] as const)('fails closed for %s', (variant) => {
    const { collection, refund, manual, stripe } = setup();
    const binding = { ...fixture().command.binding };
    if (variant === 'LIVE') binding.mode = 'LIVE';
    if (variant === 'WRONG_ADAPTER') binding.adapterId = 'other';
    if (variant === 'WRONG_METHOD') binding.method = 'CASH_OFFICE';
    expect(collection.isConfigured(binding)).toBe(false);
    expect(refund.isConfigured(binding)).toBe(false);
    expect(manual.isConfigured).not.toHaveBeenCalled();
    expect(stripe.isConfigured).not.toHaveBeenCalled();
  });
  it('routes configured Stripe and manual without replacing their command identities', async () => {
    const { collection, refund, manual, stripe } = setup();
    const f = fixture();
    await collection.createOrResume(f.command);
    await refund.submit(f.refundCommand);
    await refund.query(f.refundCommand);
    expect(stripe.createOrResume).toHaveBeenCalledWith(f.command);
    expect(stripe.submit).toHaveBeenCalledWith(f.refundCommand);
    expect(stripe.query).toHaveBeenCalledWith(f.refundCommand);
    const command = {
      ...f.command,
      binding: { ...f.command.binding, adapterId: 'hsm.manual.v1', method: 'CASH_OFFICE' as const },
    };
    await collection.createOrResume(command);
    expect(manual.createOrResume).toHaveBeenCalledWith(command);
  });
  it('never retries on a different rail after an uncertain network failure', async () => {
    const { collection, manual, stripe } = setup();
    stripe.createOrResume.mockRejectedValue(new Error('timeout'));
    await expect(collection.createOrResume(fixture().command)).rejects.toThrow('timeout');
    expect(manual.createOrResume).not.toHaveBeenCalled();
  });
  it('refuses unknown webhook and live sources before invoking either transport', () => {
    const { collection, manual, stripe } = setup();
    for (const input of [
      { adapterId: 'other', mode: 'SANDBOX' as const },
      { adapterId: 'hsm.stripe.v1', mode: 'LIVE' as const },
    ])
      expect(() =>
        collection.validateAndNormalizeExternalEvent({
          ...input,
          accountReference: 'account',
          payload: {},
          headers: {},
        }),
      ).toThrow();
    expect(manual.validateAndNormalizeExternalEvent).not.toHaveBeenCalled();
    expect(stripe.validateAndNormalizeExternalEvent).not.toHaveBeenCalled();
  });
  it('resolves frozen Stripe binding and does not ask manual configuration for it', async () => {
    const manual = { resolve: jest.fn(), resolveBinding: jest.fn() };
    const f = fixture();
    const config = new MoneyRailConfiguration(
      manual as unknown as ManualRailConfiguration,
      f.config,
    );
    const tx = {} as PrismaTx;
    expect(await config.resolve({ planVersionId: 'plan', method: 'STRIPE' }, tx)).toMatchObject(
      f.command.binding,
    );
    expect(
      await config.resolveBinding({ ...f.command.binding, accountReference: 'wrong' }, tx),
    ).toBeNull();
    expect(manual.resolve).not.toHaveBeenCalled();
  });
});
