import { toMoneyWire, type MoneyWire } from '@homeservicemarketplace/contracts';
import type { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { fixture, clock } from '../../../../../test/support/r29-stripe.fixture';
import { StripeBindings, stripeAmount, bindingDigest } from './stripe-bindings';
function setup() {
  const f = fixture();
  const intent = {
    id: 'intent',
    planVersionId: 'plan',
    method: 'STRIPE',
    currency: 'USD',
    totalMinor: 1234n,
    binding: f.command.binding,
  };
  const attempt = {
    id: 'attempt',
    paymentIntentId: 'intent',
    status: 'STARTED',
    paymentIntent: intent,
    dispatch: {
      kind: 'COLLECTION',
      providerIdempotencyKey: f.command.providerIdempotencyKey,
      externalOperationId: null,
      createdAt: new Date(clock),
    },
  };
  const refund = {
    status: 'RESERVED',
    paymentConfirmationId: 'confirmation',
    amountMinor: 234n,
    currency: 'USD',
    dispatch: {
      ...attempt.dispatch,
      kind: 'REFUND',
      providerIdempotencyKey: f.refundCommand.providerIdempotencyKey,
    },
    paymentConfirmation: {
      source: 'PROVIDER_WEBHOOK',
      amountMinor: 1234n,
      paymentIntentId: 'intent',
      paymentIntent: intent,
    },
  };
  const client = {
    moneyPaymentAttempt: { findUnique: jest.fn().mockResolvedValue(attempt) },
    moneyRefund: { findUnique: jest.fn().mockResolvedValue(refund) },
    moneyExternalEvent: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { externalOperationId: 'pi_fixture', externalConfirmationId: 'pi_fixture' },
        ]),
    },
  };
  return {
    ...f,
    intent,
    attempt,
    refundRow: refund,
    db: client,
    repo: new StripeBindings({ client } as unknown as PrismaService),
  };
}
describe('R29 existing durable binding authority', () => {
  it.each(['0', '01', '-1', '1.1', '1e3', '100000000', '9007199254740993'])(
    'rejects unsupported minor-unit input %s',
    (amountMinor) =>
      expect(() =>
        stripeAmount({ amountMinor, currency: 'USD' } as unknown as MoneyWire),
      ).toThrow(),
  );
  it('uses exact positive minor units and a stable binding digest', () => {
    const f = setup();
    expect(stripeAmount(toMoneyWire({ amountMinor: 99999999n, currency: 'USD' }))).toBe(99999999);
    expect(bindingDigest(f.command.binding)).toBe(bindingDigest({ ...f.command.binding }));
    expect(bindingDigest({ ...f.command.binding, accountReference: 'acct_other' })).not.toBe(
      bindingDigest(f.command.binding),
    );
  });
  it('reads the committed attempt and reconstructs event scope without browser authority', async () => {
    const f = setup();
    expect(await f.repo.collection(f.command)).toEqual({ createdAt: new Date(clock) });
    expect(await f.repo.eventCommand('intent', 'attempt')).toMatchObject(f.command);
  });
  it.each([
    'missing-attempt',
    'missing-dispatch',
    'wrong-key',
    'wrong-intent',
    'wrong-amount',
    'wrong-currency',
    'wrong-operation',
    'failed-attempt',
    'wrong-account',
  ])('rejects %s', async (name) => {
    const f = setup();
    if (name === 'missing-attempt') f.db.moneyPaymentAttempt.findUnique.mockResolvedValue(null);
    if (name === 'missing-dispatch')
      f.db.moneyPaymentAttempt.findUnique.mockResolvedValue({ ...f.attempt, dispatch: null });
    if (name === 'wrong-key') f.attempt.dispatch.providerIdempotencyKey = 'other';
    if (name === 'wrong-intent') f.attempt.paymentIntentId = 'other';
    if (name === 'wrong-amount') f.intent.totalMinor = 1235n;
    if (name === 'wrong-currency') f.intent.currency = 'EUR';
    if (name === 'wrong-operation')
      f.db.moneyPaymentAttempt.findUnique.mockResolvedValue({
        ...f.attempt,
        dispatch: { ...f.attempt.dispatch, externalOperationId: 'pi_other' },
      });
    if (name === 'failed-attempt') f.attempt.status = 'FAILED';
    if (name === 'wrong-account')
      f.intent.binding = { ...f.intent.binding, accountReference: 'acct_other' };
    await expect(f.repo.collection(f.command)).rejects.toThrow();
  });
  it('binds a refund to a single processed original payment', async () => {
    const f = setup();
    expect(await f.repo.refund(f.refundCommand)).toEqual({
      paymentId: 'pi_fixture',
      createdAt: new Date(clock),
    });
    expect(f.db.moneyExternalEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PROCESSED',
          mode: 'SANDBOX',
          accountReference: 'acct_fixture',
        }),
      }),
    );
  });
  it.each([
    'missing',
    'unreserved',
    'over-refund',
    'wrong-key',
    'wrong-confirmation',
    'ambiguous-original',
    'unprocessed-original',
    'wrong-original',
  ])('refuses refund %s', async (name) => {
    const f = setup();
    if (name === 'missing') f.db.moneyRefund.findUnique.mockResolvedValue(null);
    if (name === 'unreserved') f.refundRow.status = 'CANCELLED';
    if (name === 'over-refund') f.refundRow.paymentConfirmation.amountMinor = 100n;
    if (name === 'wrong-key') f.refundRow.dispatch.providerIdempotencyKey = 'other';
    if (name === 'wrong-confirmation') f.refundRow.paymentConfirmationId = 'other';
    if (name === 'ambiguous-original')
      f.db.moneyExternalEvent.findMany.mockResolvedValue([
        { externalOperationId: 'pi_fixture', externalConfirmationId: 'pi_fixture' },
        { externalOperationId: 'pi_other', externalConfirmationId: 'pi_other' },
      ]);
    if (name === 'unprocessed-original') f.db.moneyExternalEvent.findMany.mockResolvedValue([]);
    if (name === 'wrong-original')
      f.db.moneyExternalEvent.findMany.mockResolvedValue([
        { externalOperationId: 'pi_fixture', externalConfirmationId: 'pi_other' },
      ]);
    await expect(f.repo.refund(f.refundCommand)).rejects.toThrow();
  });
});
