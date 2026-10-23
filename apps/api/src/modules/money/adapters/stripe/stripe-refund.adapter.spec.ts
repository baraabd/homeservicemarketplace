import { clock, fixture } from '../../../../../test/support/r29-stripe.fixture';
import { StripeRefundAdapter } from './stripe-refund.adapter';
function setup() {
  const f = fixture();
  return { ...f, adapter: new StripeRefundAdapter(f.config, f.sdk, f.store, () => clock) };
}
describe('R29 refund transport', () => {
  it('submits only a reserved amount against the original payment with the unchanged key', async () => {
    const f = setup();
    const result = await f.adapter.submit(f.refundCommand);
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      externalOperationId: 're_fixture',
      amount: f.refundCommand.amount,
    });
    expect(f.client.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_fixture', amount: 234, metadata: f.refund.metadata },
      { idempotencyKey: f.refundCommand.providerIdempotencyKey },
    );
  });
  it.each([
    ['pending', 'PENDING'],
    ['requires_action', 'PENDING'],
    ['succeeded', 'SUCCEEDED'],
    ['failed', 'FAILED'],
    ['canceled', 'FAILED'],
  ])('maps authoritative %s to %s', async (status, expected) => {
    const f = setup();
    f.client.refunds.create.mockResolvedValue({ ...f.refund, status });
    expect((await f.adapter.submit(f.refundCommand)).status).toBe(expected);
  });
  it.each([
    { amount: 235 },
    { currency: 'eur' },
    { payment_intent: 'pi_other' },
    { metadata: {} },
    { id: 'not_a_refund' },
    { status: null },
  ])('preserves reservation for mismatched or ambiguous response %#', async (patch) => {
    const f = setup();
    f.client.refunds.create.mockResolvedValue({ ...f.refund, ...patch });
    expect((await f.adapter.submit(f.refundCommand)).status).toBe('UNKNOWN');
  });
  it('queries an existing refund without another POST', async () => {
    const f = setup();
    await f.adapter.submit({ ...f.refundCommand, externalOperationId: 're_fixture' });
    expect(f.client.refunds.retrieve).toHaveBeenCalledWith('re_fixture');
    expect(f.client.refunds.create).not.toHaveBeenCalled();
  });
  it('uses provider lookup after timeout-after-success without a new key', async () => {
    const f = setup();
    f.client.refunds.create.mockRejectedValue(new Error('sensitive response'));
    expect((await f.adapter.submit(f.refundCommand)).status).toBe('UNKNOWN');
    expect((await f.adapter.query(f.refundCommand)).status).toBe('SUCCEEDED');
    expect(f.client.refunds.create).toHaveBeenCalledTimes(1);
  });
  it('queries old unknown operations and never recreates a pruned idempotency key', async () => {
    const f = setup();
    f.bindings.refund.mockResolvedValue({
      createdAt: new Date(clock - 24 * 3600_000),
      paymentId: 'pi_fixture',
    });
    await f.adapter.submit(f.refundCommand);
    expect(f.client.refunds.create).not.toHaveBeenCalled();
    expect(f.client.refunds.list).toHaveBeenCalled();
  });
  it('does not treat an empty lookup as a failed refund', async () => {
    const f = setup();
    f.client.refunds.list.mockResolvedValue({ object: 'list', has_more: false, data: [] });
    expect((await f.adapter.query(f.refundCommand)).status).toBe('UNKNOWN');
  });
  it('paginates and validates the matching refund on the final page', async () => {
    const f = setup();
    f.client.refunds.list.mockResolvedValueOnce({
      object: 'list',
      has_more: true,
      data: [{ ...f.refund, id: 're_other', metadata: { hsm_refund: 'other' } }],
    });
    expect((await f.adapter.query(f.refundCommand)).status).toBe('SUCCEEDED');
    expect(f.client.refunds.list.mock.calls[1]![0]).toEqual({
      payment_intent: 'pi_fixture',
      limit: 100,
      starting_after: 're_other',
    });
  });
  it.each(['duplicate-page', 'duplicate-effect', 'incomplete', 'unavailable'])(
    'reports UNKNOWN on %s',
    async (scenario) => {
      const f = setup();
      if (scenario === 'duplicate-page')
        f.client.refunds.list.mockResolvedValue({
          object: 'list',
          has_more: true,
          data: [f.refund],
        });
      if (scenario === 'duplicate-effect')
        f.client.refunds.list.mockResolvedValue({
          object: 'list',
          has_more: false,
          data: [f.refund, { ...f.refund, id: 're_second' }],
        });
      if (scenario === 'incomplete')
        f.client.refunds.list.mockResolvedValue({ object: 'list', has_more: true, data: [] });
      if (scenario === 'unavailable')
        f.client.refunds.list.mockRejectedValue(new Error('provider secret'));
      expect((await f.adapter.query(f.refundCommand)).status).toBe('UNKNOWN');
    },
  );
  it('caps paging at ten pages even when the provider has more', async () => {
    const f = setup();
    let n = 0;
    f.client.refunds.list.mockImplementation(async () => ({
      object: 'list',
      has_more: true,
      data: [{ ...f.refund, id: `re_page${n++}`, metadata: { hsm_refund: 'other' } }],
    }));
    expect((await f.adapter.query(f.refundCommand)).status).toBe('UNKNOWN');
    expect(f.client.refunds.list).toHaveBeenCalledTimes(10);
  });
  it('concurrent duplicate submissions all carry the original key and payload', async () => {
    const f = setup();
    await Promise.all(Array.from({ length: 8 }, () => f.adapter.submit(f.refundCommand)));
    expect(new Set(f.client.refunds.create.mock.calls.map((c) => JSON.stringify(c))).size).toBe(1);
  });
  it('refuses a missing durable reservation before any provider request', async () => {
    const f = setup();
    f.bindings.refund.mockRejectedValue(new Error('missing reservation'));
    await expect(f.adapter.submit(f.refundCommand)).rejects.toThrow();
    expect(f.client.accounts.retrieve).not.toHaveBeenCalled();
  });
  it.each(['refund.created', 'refund.updated', 'refund.failed'])(
    'normalizes signed %s through the same original binding',
    async (type) => {
      const f = setup();
      expect(
        (
          await f.adapter.normalizeSignedEvent(
            f.envelope({ ...f.event, type, data: { object: f.refund } }),
            f.refundCommand,
          )
        ).status,
      ).toBe('SUCCEEDED');
    },
  );
  it('rejects a signed refund in the wrong sandbox account', async () => {
    const f = setup();
    await expect(
      f.adapter.normalizeSignedEvent(
        { ...f.envelope(), accountReference: 'acct_other' },
        f.refundCommand,
      ),
    ).rejects.toThrow();
  });
});
