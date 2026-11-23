import { clock, fixture } from '../../../../../test/support/r29-stripe.fixture';
import { StripeCollectionAdapter } from './stripe-collection.adapter';
function setup() {
  const f = fixture();
  return { ...f, adapter: new StripeCollectionAdapter(f.config, f.sdk, f.store, () => clock) };
}
describe('R29 collection transport and signed confirmation', () => {
  it('creates only after the durable binding and preserves the provider key', async () => {
    const f = setup();
    expect(await f.adapter.createOrResume(f.command)).toEqual({
      status: 'SUCCEEDED',
      externalOperationId: 'pi_fixture',
    });
    expect(f.bindings.collection.mock.invocationCallOrder[0]).toBeLessThan(
      f.client.paymentIntents.create.mock.invocationCallOrder[0]!,
    );
    expect(f.client.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1234, currency: 'usd', capture_method: 'automatic' }),
      { idempotencyKey: f.command.providerIdempotencyKey },
    );
  });
  it('does not return client tokens or create another payment on known-ID retry', async () => {
    const f = setup();
    f.client.paymentIntents.retrieve.mockResolvedValue({
      ...f.payment,
      client_secret: 'never-return-this',
    });
    const result = await f.adapter.createOrResume({
      ...f.command,
      externalOperationId: 'pi_fixture',
    });
    expect(JSON.stringify(result)).not.toContain('never-return');
    expect(f.client.paymentIntents.create).not.toHaveBeenCalled();
  });
  it.each([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'processing',
    'requires_capture',
  ])('keeps %s pending', async (status) => {
    const f = setup();
    f.client.paymentIntents.create.mockResolvedValue({ ...f.payment, status, amount_received: 0 });
    expect((await f.adapter.createOrResume(f.command)).status).toBe('PENDING');
  });
  it('recognizes only a bound canceled operation as failure', async () => {
    const f = setup();
    f.client.paymentIntents.create.mockResolvedValue({ ...f.payment, status: 'canceled' });
    expect((await f.adapter.createOrResume(f.command)).status).toBe('FAILED');
  });
  it.each([
    { amount: 1235 },
    { currency: 'eur' },
    { livemode: true },
    { metadata: {} },
    { capture_method: 'manual' },
    { amount_received: 1233 },
    { amount_capturable: 1 },
  ])('keeps mismatched provider data unknown %#', async (patch) => {
    const f = setup();
    f.client.paymentIntents.create.mockResolvedValue({ ...f.payment, ...patch });
    expect((await f.adapter.createOrResume(f.command)).status).toBe('UNKNOWN');
  });
  it('retains unknown after timeout and retries with the unchanged key', async () => {
    const f = setup();
    f.client.paymentIntents.create.mockRejectedValueOnce(new Error('secret provider response'));
    expect((await f.adapter.createOrResume(f.command)).status).toBe('UNKNOWN');
    await f.adapter.createOrResume(f.command);
    expect(f.client.paymentIntents.create.mock.calls.map((c) => c[1])).toEqual([
      { idempotencyKey: f.command.providerIdempotencyKey },
      { idempotencyKey: f.command.providerIdempotencyKey },
    ]);
  });
  it.each([clock - 23 * 3600_000, clock + 1])(
    'never re-creates an expired or future unknown attempt %s',
    async (time) => {
      const f = setup();
      f.bindings.collection.mockResolvedValue({ createdAt: new Date(time) });
      expect((await f.adapter.createOrResume(f.command)).status).toBe('UNKNOWN');
      expect(f.client.paymentIntents.create).not.toHaveBeenCalled();
    },
  );
  it('refuses missing durable state before network execution', async () => {
    const f = setup();
    f.bindings.collection.mockRejectedValue(new Error('DB'));
    await expect(f.adapter.createOrResume(f.command)).rejects.toThrow();
    expect(f.client.accounts.retrieve).not.toHaveBeenCalled();
  });
  it('concurrent transport calls retain one economic idempotency key', async () => {
    const f = setup();
    await Promise.all(Array.from({ length: 8 }, () => f.adapter.createOrResume(f.command)));
    expect(
      new Set(f.client.paymentIntents.create.mock.calls.map((c) => c[1].idempotencyKey)).size,
    ).toBe(1);
  });
  it('normalizes separate deliveries to one payment and stable capture timestamp', async () => {
    const f = setup();
    const a = await f.adapter.validateAndNormalizeExternalEvent(f.envelope());
    const b = await f.adapter.validateAndNormalizeExternalEvent(
      f.envelope({ ...f.event, id: 'evt_second', created: f.event.created - 5 }),
    );
    expect(a.externalEventId).not.toBe(b.externalEventId);
    expect(a.externalConfirmationId).toBe(b.externalConfirmationId);
    expect(a.confirmedAt).toBe(b.confirmedAt);
    expect(a.source).toBe('PROVIDER_WEBHOOK');
  });
  it.each([
    'checkout.session.completed',
    'payment_intent.processing',
    'payment_intent.payment_failed',
    'refund.updated',
  ])('does not acknowledge %s as a payment confirmation', async (type) => {
    const f = setup();
    await expect(
      f.adapter.validateAndNormalizeExternalEvent(f.envelope({ ...f.event, type })),
    ).rejects.toThrow();
  });
  it.each([
    { paid: false },
    { captured: false },
    { amount_captured: 1233 },
    { payment_intent: 'pi_other' },
    { currency: 'eur' },
    { livemode: true },
  ])('requires a verified full capture %#', async (patch) => {
    const f = setup();
    f.client.charges.retrieve.mockResolvedValue({ ...f.charge, ...patch });
    await expect(f.adapter.validateAndNormalizeExternalEvent(f.envelope())).rejects.toThrow();
  });
  it('refuses invalid signatures before looking up application state', async () => {
    const f = setup();
    f.client.webhooks.constructEvent.mockImplementation(() => {
      throw new Error();
    });
    await expect(f.adapter.validateAndNormalizeExternalEvent(f.envelope())).rejects.toThrow();
    expect(f.bindings.eventCommand).not.toHaveBeenCalled();
  });
});
