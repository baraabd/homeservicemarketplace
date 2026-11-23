import { randomBytes } from 'node:crypto';
import { StripeSessionService } from './stripe-session.service';
import { fixture } from '../../../../test/support/r29-stripe.fixture';

type Args = ConstructorParameters<typeof StripeSessionService>;
function setup() {
  const f = fixture();
  const queries = {
    attempt: jest.fn().mockResolvedValue({ paymentIntentId: 'intent', status: 'STARTED' }),
    intent: jest.fn().mockResolvedValue({
      id: 'intent',
      total: f.command.amount,
      status: 'PROCESSING',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    }),
  };
  const command = { ...f.command, externalOperationId: 'pi_fixture' };
  const raw = {
    ...f.payment,
    status: 'requires_payment_method',
    amount_received: 0,
    client_secret: 'pi_fixture_secret_' + randomBytes(12).toString('hex'),
  };
  const bindings = { eventCommand: jest.fn().mockResolvedValue(command) };
  const retrieve = jest.fn().mockResolvedValue(raw);
  const sdk = { transport: jest.fn().mockResolvedValue({ paymentIntents: { retrieve } }) };
  const config = { get: () => 'pk_test_' + randomBytes(16).toString('hex') };
  const permissions = {
    resolveFreshForUser: jest.fn().mockResolvedValue(new Set(['money:purchase:self'])),
  };
  const service = new StripeSessionService(
    queries as unknown as Args[0],
    bindings as unknown as Args[1],
    sdk as unknown as Args[2],
    f.config,
    config as unknown as Args[4],
    permissions as unknown as Args[5],
  );
  return { service, queries, bindings, retrieve, raw, sdk, permissions, command };
}
describe('G3 ephemeral Stripe session (transport doubles)', () => {
  it('validates external binding and checks fresh authority before and after I/O', async () => {
    const h = setup();
    const result = await h.service.session('owner', 'attempt');
    expect(result.state).toBe('AWAITING_PAYMENT');
    expect(result.clientSecret).toBe(h.raw.client_secret);
    expect(h.queries.attempt).toHaveBeenCalledTimes(2);
    expect(h.permissions.resolveFreshForUser).toHaveBeenCalledTimes(2);
  });
  it('does not expose a secret when ownership is denied', async () => {
    const h = setup();
    h.queries.attempt.mockRejectedValue(new Error('not found'));
    await expect(h.service.session('other', 'attempt')).rejects.toThrow('not found');
    expect(h.sdk.transport).not.toHaveBeenCalled();
  });
  it('denies permission revoked while Stripe is responding', async () => {
    const h = setup();
    h.permissions.resolveFreshForUser
      .mockResolvedValueOnce(new Set(['money:purchase:self']))
      .mockResolvedValueOnce(new Set());
    await expect(h.service.session('owner', 'attempt')).rejects.toMatchObject({ status: 403 });
  });
  it.each([
    { currency: 'eur' },
    { amount: 1235 },
    { livemode: true },
    { metadata: {} },
    { id: 'pi_other' },
  ])('rejects mismatched provider evidence %j', (patch) => {
    const h = setup();
    h.retrieve.mockResolvedValue({ ...h.raw, ...patch });
    return expect(h.service.session('owner', 'attempt')).rejects.toThrow();
  });
  it.each(['processing', 'succeeded'])(
    'keeps %s external status pending until the application confirms',
    async (status) => {
      const h = setup();
      h.retrieve.mockResolvedValue({ ...h.raw, status, amount_received: 1234 });
      expect(await h.service.session('owner', 'attempt')).toMatchObject({
        state: 'PROCESSING',
        clientSecret: null,
      });
    },
  );
  it('only reports confirmed from the authorized application read', async () => {
    const h = setup();
    h.queries.intent.mockResolvedValue({
      id: 'intent',
      total: h.command.amount,
      status: 'SUCCEEDED',
    });
    expect(await h.service.session('owner', 'attempt')).toMatchObject({
      state: 'CONFIRMED',
      clientSecret: null,
    });
    expect(h.retrieve).not.toHaveBeenCalled();
  });
  it('does not create another intent on unknown dispatch', async () => {
    const h = setup();
    h.bindings.eventCommand.mockResolvedValue({ ...h.command, externalOperationId: null });
    expect(await h.service.session('owner', 'attempt')).toMatchObject({
      state: 'PROCESSING',
      clientSecret: null,
    });
    expect(h.retrieve).not.toHaveBeenCalled();
  });
  it('sanitizes provider errors', async () => {
    const h = setup();
    h.retrieve.mockRejectedValue(new Error(h.raw.client_secret));
    await expect(h.service.session('owner', 'attempt')).rejects.toMatchObject({
      details: { reason: 'STRIPE_CHECKOUT_UNAVAILABLE' },
    });
  });
});
