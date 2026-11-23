import { randomBytes } from 'node:crypto';
import type {
  MoneyCommandAcceptedV1,
  PaymentIntentWireV1,
} from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { MoneyCommandService } from '../../src/modules/money/application/money-command.service';
import { LedgerService } from '../../src/modules/money/ledger/ledger.service';
import {
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
  type MoneyCollectionAdapterPort,
  type MoneyConfigurationPort,
} from '../../src/modules/money/ports/collection.port';
import { StripeBindings } from '../../src/modules/money/adapters/stripe/stripe-bindings';
import { StripeCollectionAdapter } from '../../src/modules/money/adapters/stripe/stripe-collection.adapter';
import {
  StripeSandboxConfiguration,
  STRIPE_API_VERSION,
} from '../../src/modules/money/adapters/stripe/stripe-sandbox.config';
import { StripeSdk } from '../../src/modules/money/adapters/stripe/stripe-sdk';
import { StripeWebhookService } from '../../src/modules/money/webhooks/stripe/stripe-webhook.service';
import { StripeInboxJob } from '../../src/modules/money/webhooks/stripe/stripe-inbox.job';
import { SubscriptionActivationParticipant } from '../../src/modules/money/subscriptions/subscription-activation.participant';
import { fixture } from '../support/r29-stripe.fixture';
import {
  r24MoneyHttpFixture,
  type R24MoneyHttpFixture,
  type R24HttpSession,
} from '../support/r24-money-http.fixture';

// Real AppModule/auth/HTTP/PostgreSQL/Redis/R31 activation/ledger/audit/outbox.
// ONLY provider SDK transport/signature is an explicit contract double. This
// suite cannot establish Stripe sandbox funds or the unapproved refund policy.
// Uses the repository's standard isolated DB gate; absent infrastructure is a
// reported NOT_RUN, never a claimed sandbox pass.
const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
dbDescribe('R29 real persistence with explicitly synthetic Stripe SDK', () => {
  let h: R24MoneyHttpFixture;
  let owner: R24HttpSession;
  let commands: MoneyCommandService;
  let config: StripeSandboxConfiguration;
  let adapter: StripeCollectionAdapter;
  let webhook: StripeWebhookService;
  let planId: string;
  const f = fixture();
  const payments = new Map<string, typeof f.payment>();
  const charges = new Map<string, typeof f.charge>();
  const configuration: MoneyConfigurationPort = {
    resolve: (input, tx) => config.resolve(input, tx),
    resolveBinding: (binding, tx) => config.resolveBinding(binding, tx),
  };
  const collection: MoneyCollectionAdapterPort = {
    isConfigured: (binding) => adapter.isConfigured(binding),
    createOrResume: (command) => adapter.createOrResume(command),
    validateAndNormalizeExternalEvent: (input) => adapter.validateAndNormalizeExternalEvent(input),
  };
  beforeAll(async () => {
    h = await r24MoneyHttpFixture({
      adapters: [
        { token: MONEY_CONFIGURATION, value: configuration },
        { token: MONEY_COLLECTION_ADAPTER, value: collection },
      ],
      isolateRateLimits: true,
    });
    commands = h.app.get(MoneyCommandService);
    const ledger = h.app.get(LedgerService);
    const accounts = await Promise.all(
      ['clearing', 'revenue'].map((kind) =>
        ledger.openAccount(
          { kind: 'SYSTEM', system: 'r29.contract-component' },
          { key: `${h.prefix}${kind}`, ownerType: 'PLATFORM', currency: 'USD' },
        ),
      ),
    );
    const plan = await h.prisma.subscriptionPlanVersion.create({
      data: {
        planKey: `${h.prefix}plan`,
        version: 1,
        billingInterval: 'MONTHLY',
        priceMinor: 1234n,
        currency: 'USD',
        entitlements: [],
        publishedAt: new Date(Date.now() - 86400_000),
      },
    });
    planId = plan.id;
    config = new StripeSandboxConfiguration({
      ...f.input,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      bindings: [
        {
          ...f.input.bindings[0]!,
          planVersionId: planId,
          debitAccountId: accounts[0]!.account.id,
          creditAccountId: accounts[1]!.account.id,
        },
      ],
    });
    f.client.paymentIntents.create.mockImplementation(async (params) => {
      const suffix = randomBytes(12).toString('hex');
      const payment = {
        ...f.payment,
        id: `pi_${suffix}`,
        amount: params.amount,
        currency: params.currency,
        metadata: params.metadata,
        latest_charge: `ch_${suffix}`,
        status: 'processing',
        amount_received: 0,
      };
      payments.set(payment.id, payment);
      charges.set(payment.latest_charge, {
        ...f.charge,
        id: payment.latest_charge,
        payment_intent: payment.id,
        created: Math.floor(Date.now() / 1000),
      });
      return payment;
    });
    f.client.paymentIntents.retrieve.mockImplementation(async (id) => payments.get(id));
    f.client.charges.retrieve.mockImplementation(async (id) => charges.get(id));
    const sdk = new StripeSdk(config, f.SdkDouble);
    adapter = new StripeCollectionAdapter(
      config,
      sdk,
      new StripeBindings(h.app.get(PrismaService)),
    );
    webhook = new StripeWebhookService(config, commands);
    owner = await h.login('owner');
  }, 120_000);
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await h?.dispose();
  }, 30_000);
  async function pending() {
    const intent = await owner.request<PaymentIntentWireV1>('/v1/money/intents', {
      method: 'POST',
      idempotencyKey: h.key('intent'),
      body: { contractVersion: 'hsm.money.v1', planVersionId: planId, method: 'STRIPE' },
    });
    expect(intent.status).toBe(201);
    const started = await owner.request<MoneyCommandAcceptedV1>(
      `/v1/money/intents/${intent.body.id}/attempts`,
      {
        method: 'POST',
        idempotencyKey: h.key('attempt'),
        body: { contractVersion: 'hsm.money.v1' },
      },
    );
    expect(started.status).toBe(202);
    const dispatch = await h.prisma.moneyDispatch.findUniqueOrThrow({
      where: { paymentAttemptId: started.body.resourceId },
    });
    expect(dispatch.externalOperationId).toMatch(/^pi_/u);
    const payment = payments.get(dispatch.externalOperationId!)!;
    const event = {
      ...f.event,
      id: `evt_${randomBytes(12).toString('hex')}`,
      api_version: STRIPE_API_VERSION,
      created: Math.floor(Date.now() / 1000),
      data: { object: { ...payment, status: 'succeeded', amount_received: payment.amount } },
    };
    return { intent: intent.body, dispatch, event };
  }
  function envelope(event: unknown) {
    return {
      body: Buffer.from(JSON.stringify(event)),
      signature: `t=${Math.floor(Date.now() / 1000)},v1=explicit-contract-double`,
    };
  }
  async function receive(event: unknown) {
    const value = envelope(event);
    return webhook.receive(value.body, value.signature);
  }
  async function process(intentId: string) {
    const row = await h.prisma.moneyExternalEvent.findFirstOrThrow({
      where: { paymentIntentId: intentId },
      orderBy: { id: 'asc' },
    });
    return commands.processExternalEvent(row.id);
  }
  it('persists evidence before acknowledgement and posts balanced money with real R31 activation once', async () => {
    const p = await pending();
    expect(
      await h.prisma.moneyPaymentConfirmation.count({ where: { paymentIntentId: p.intent.id } }),
    ).toBe(0);
    expect(await receive(p.event)).toEqual({ received: true, processing: 'PENDING' });
    expect(
      await h.prisma.moneyExternalEvent.count({
        where: { paymentIntentId: p.intent.id, status: 'RECEIVED' },
      }),
    ).toBe(1);
    const result = await process(p.intent.id);
    const entries = await h.prisma.ledgerEntry.findMany({
      where: { transactionId: result.ledgerTransactionId },
    });
    expect(
      entries.reduce(
        (sum, row) => sum + (row.side === 'DEBIT' ? row.amountMinor : -row.amountMinor),
        0n,
      ),
    ).toBe(0n);
    expect(entries).toHaveLength(2);
    expect(
      await h.prisma.subscriptionPeriod.count({
        where: { paymentConfirmationId: result.paymentConfirmationId },
      }),
    ).toBe(1);
    expect(
      await h.prisma.outboxEvent.count({
        where: { dedupeKey: `money.subscription.activated.v1:${result.paymentConfirmationId}` },
      }),
    ).toBe(1);
  });
  it('deduplicates concurrent deliveries and distinct events for one economic payment', async () => {
    const p = await pending();
    await Promise.all(Array.from({ length: 4 }, () => receive(p.event)));
    await receive({
      ...p.event,
      id: `evt_${randomBytes(12).toString('hex')}`,
      created: p.event.created + 1,
    });
    const rows = await h.prisma.moneyExternalEvent.findMany({
      where: { paymentIntentId: p.intent.id },
    });
    expect(rows).toHaveLength(2);
    await Promise.all(
      rows.flatMap((row) => [
        commands.processExternalEvent(row.id),
        commands.processExternalEvent(row.id),
      ]),
    );
    expect(
      await h.prisma.moneyPaymentConfirmation.count({ where: { paymentIntentId: p.intent.id } }),
    ).toBe(1);
    expect(
      await h.prisma.subscriptionPeriod.count({
        where: { paymentConfirmation: { paymentIntentId: p.intent.id } },
      }),
    ).toBe(1);
  });
  it('refuses a mismatched amount or currency before writing the inbox', async () => {
    const p = await pending();
    for (const patch of [{ amount: 1235 }, { currency: 'eur' }])
      await expect(
        receive({ ...p.event, data: { object: { ...p.event.data.object, ...patch } } }),
      ).rejects.toThrow();
    expect(
      await h.prisma.moneyExternalEvent.count({ where: { paymentIntentId: p.intent.id } }),
    ).toBe(0);
  });
  it('does not acknowledge when durable inbox commit fails', async () => {
    const p = await pending();
    const spy = jest
      .spyOn(h.prisma, '$transaction')
      .mockRejectedValueOnce(new Error('synthetic commit failure'));
    await expect(receive(p.event)).rejects.toThrow();
    spy.mockRestore();
    expect(
      await h.prisma.moneyExternalEvent.count({ where: { paymentIntentId: p.intent.id } }),
    ).toBe(0);
    await receive(p.event);
    expect(
      await h.prisma.moneyExternalEvent.count({ where: { paymentIntentId: p.intent.id } }),
    ).toBe(1);
  });
  it('rolls back a failed activation and recovers durable receipt after worker restart', async () => {
    const p = await pending();
    await receive(p.event);
    const participant = h.app.get(SubscriptionActivationParticipant);
    const failure = jest
      .spyOn(participant, 'activatePeriod')
      .mockRejectedValueOnce(new Error('synthetic activation failure'));
    await expect(process(p.intent.id)).rejects.toThrow();
    failure.mockRestore();
    expect(
      await h.prisma.moneyPaymentConfirmation.count({ where: { paymentIntentId: p.intent.id } }),
    ).toBe(0);
    expect(
      await h.prisma.moneyExternalEvent.count({
        where: { paymentIntentId: p.intent.id, status: 'RECEIVED' },
      }),
    ).toBe(1);
    const restart = new StripeInboxJob(h.app.get(PrismaService), commands, config);
    await restart.runBatch();
    expect(
      await h.prisma.moneyExternalEvent.count({
        where: { paymentIntentId: p.intent.id, status: 'PROCESSED' },
      }),
    ).toBe(1);
  });
  it('keeps a browser success or pending transport from creating any activation', async () => {
    const p = await pending();
    const response = await owner.request('/v1/money/confirmations', {
      method: 'POST',
      body: { paymentIntentId: p.intent.id, status: 'SUCCEEDED' },
    });
    expect([403, 404]).toContain(response.status);
    expect(
      await h.prisma.moneyPaymentConfirmation.count({ where: { paymentIntentId: p.intent.id } }),
    ).toBe(0);
    expect(
      await h.prisma.subscriptionPeriod.count({
        where: { paymentConfirmation: { paymentIntentId: p.intent.id } },
      }),
    ).toBe(0);
    expect(
      await config.resolveBinding({ ...f.command.binding, mode: 'LIVE' }, {} as PrismaTx),
    ).toBeNull();
  });
});
