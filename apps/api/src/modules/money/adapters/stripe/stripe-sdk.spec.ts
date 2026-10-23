import { clock, fixture } from '../../../../../test/support/r29-stripe.fixture';
import { STRIPE_BODY_LIMIT, StripeSandboxConfiguration } from './stripe-sandbox.config';
import { StripeSdk } from './stripe-sdk';
describe('R29 official SDK boundary (contract double)', () => {
  it('does not construct a client when disabled', () => {
    const factory = jest.fn();
    new StripeSdk(new StripeSandboxConfiguration(), factory as never);
    expect(factory).not.toHaveBeenCalled();
  });
  it('rejects a missing or different SDK pin', () => {
    const f = fixture();
    expect(() => new StripeSdk(f.config)).toThrow();
    f.SdkDouble.PACKAGE_VERSION = 'other';
    expect(() => new StripeSdk(f.config, f.SdkDouble)).toThrow();
  });
  it('verifies the untouched Buffer using the official verifier interface', () => {
    const f = fixture();
    const e = f.envelope();
    expect(f.sdk.verify(e.payload, e.headers['stripe-signature'])).toEqual(f.event);
    expect(f.client.webhooks.constructEvent).toHaveBeenCalledWith(
      e.payload,
      e.headers['stripe-signature'],
      f.input.webhookSecret,
      300,
    );
  });
  it.each([undefined, {}, '', Buffer.alloc(0), Buffer.alloc(STRIPE_BODY_LIMIT + 1)])(
    'rejects missing, parsed or oversized raw payload %#',
    (payload) => {
      const f = fixture();
      expect(() => f.sdk.verify(payload, f.envelope().headers['stripe-signature'])).toThrow();
      expect(f.client.webhooks.constructEvent).not.toHaveBeenCalled();
    },
  );
  it.each([
    undefined,
    ['signature'],
    'x'.repeat(4097),
    `t=${clock / 1000 - 301},v1=x`,
    `t=${clock / 1000 + 301},v1=x`,
    `t=${clock / 1000},t=${clock / 1000},v1=x`,
  ])('rejects invalid signature envelope %#', (signature) => {
    const f = fixture();
    expect(() => f.sdk.verify(f.envelope().payload, signature)).toThrow();
  });
  it.each([
    { livemode: true },
    { api_version: '2020-01-01' },
    { account: 'acct_other' },
    { context: 'org_other' },
    { created: clock / 1000 + 301 },
  ])('rejects unsupported signed scope %#', (patch) => {
    const f = fixture();
    const e = f.envelope({ ...f.event, ...patch });
    expect(() => f.sdk.verify(e.payload, e.headers['stripe-signature'])).toThrow();
  });
  it('redacts signature verifier errors and rejects an unexpected account', async () => {
    const f = fixture();
    f.client.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('private provider payload');
    });
    expect(() =>
      f.sdk.verify(f.envelope().payload, f.envelope().headers['stripe-signature']),
    ).toThrow('Stripe sandbox operation could not be verified.');
    f.client.accounts.retrieve.mockResolvedValue({ id: 'acct_other', object: 'account' });
    await expect(f.sdk.transport()).rejects.toThrow();
  });
});
