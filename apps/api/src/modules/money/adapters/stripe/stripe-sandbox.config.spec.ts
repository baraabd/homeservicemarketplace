import type { PrismaTx } from '@homeservicemarketplace/database';
import { clock, settings } from '../../../../../test/support/r29-stripe.fixture';
import { StripeSandboxConfiguration } from './stripe-sandbox.config';
const tx = {} as PrismaTx;
describe('R29 explicit sandbox configuration', () => {
  it('defaults off and resolves no authority', async () => {
    const config = new StripeSandboxConfiguration();
    expect(config.isEnabled()).toBe(false);
    await expect(
      config.resolve({ planVersionId: 'plan', method: 'STRIPE' }, tx),
    ).resolves.toBeNull();
    expect(() => config.requireEnabled()).toThrow();
  });
  it('expires credentials during a running process', () => {
    let now = clock;
    const config = new StripeSandboxConfiguration(settings(), () => now);
    expect(config.isEnabled()).toBe(true);
    now += 3600_000;
    expect(config.isEnabled()).toBe(false);
  });
  it.each([
    [
      'live key',
      (v: ReturnType<typeof settings>) => {
        v.secretKey = v.secretKey.replace('_test_', '_live_');
      },
    ],
    [
      'expired',
      (v: ReturnType<typeof settings>) => {
        v.expiresAt = new Date(clock).toISOString();
      },
    ],
    [
      'unbounded credential',
      (v: ReturnType<typeof settings>) => {
        v.expiresAt = new Date(clock + 86_400_001).toISOString();
      },
    ],
    [
      'timestamp tolerance',
      (v: ReturnType<typeof settings>) => {
        v.signatureToleranceSeconds = 0;
      },
    ],
    [
      'account mismatch',
      (v: ReturnType<typeof settings>) => {
        v.bindings[0]!.accountReference = 'acct_other';
      },
    ],
    [
      'same accounts',
      (v: ReturnType<typeof settings>) => {
        v.bindings[0]!.creditAccountId = v.bindings[0]!.debitAccountId;
      },
    ],
    [
      'duplicate plan',
      (v: ReturnType<typeof settings>) => {
        v.bindings.push({ ...v.bindings[0]! });
      },
    ],
    [
      'invalid currency',
      (v: ReturnType<typeof settings>) => {
        v.bindings[0]!.currency = 'usd';
      },
    ],
  ] as const)('rejects %s without echoing input', (_name, change) => {
    const input = settings();
    change(input);
    try {
      new StripeSandboxConfiguration(input, () => clock);
      throw new Error('accepted');
    } catch (error) {
      expect(error).toMatchObject({ details: { reason: 'STRIPE_CONFIGURATION_INVALID' } });
      expect(JSON.stringify(error)).not.toContain(input.secretKey);
    }
  });
  it('resolves exact snapshots and refuses any changed binding field', async () => {
    const input = settings();
    const config = new StripeSandboxConfiguration(input, () => clock);
    const binding = input.bindings[0]!;
    expect(await config.resolve({ planVersionId: 'plan', method: 'STRIPE' }, tx)).toEqual(binding);
    expect(await config.resolve({ planVersionId: 'plan', method: 'SHAM_CASH' }, tx)).toBeNull();
    for (const key of Object.keys(binding).filter((k) => k !== 'quoteTtlSeconds'))
      expect(config.isConfigured({ ...binding, [key]: 'changed' })).toBe(false);
    input.bindings[0]!.currency = 'EUR';
    const copy = config.requireEnabled();
    copy.bindings[0]!.currency = 'GBP';
    expect((await config.resolve({ planVersionId: 'plan', method: 'STRIPE' }, tx))?.currency).toBe(
      'USD',
    );
    expect(JSON.stringify(config)).not.toContain(input.secretKey);
  });
});
