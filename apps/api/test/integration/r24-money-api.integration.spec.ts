import type {
  FinancialProjectionV1,
  MoneyAttemptStatusWireV1,
  MoneyCommandAcceptedV1,
  MoneyPurchaseRequestV1,
  MoneyRefundRequestWireV1,
  PaymentIntentWireV1,
  PaymentMethod,
  QuoteWireV1,
  RefundWireV1,
  SubscriptionActivationResultV1,
} from '@homeservicemarketplace/contracts';
import { toMoneyWire } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { ModulesContainer } from '@nestjs/core';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { MoneyCommandService } from '../../src/modules/money/application/money-command.service';
import type {
  MoneySubscriptionRead,
  MoneyUsageRead,
} from '../../src/modules/money/application/money-query.service';
import type { LedgerService } from '../../src/modules/money/ledger/ledger.service';
import {
  MONEY_ACTIVATION_PARTICIPANT,
  type MoneyActivationParticipantPort,
  type MoneyPeriodActivation,
} from '../../src/modules/money/ports/activation.port';
import {
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
  MONEY_RECEIPT_ACCEPTANCE,
  unavailableMoneyPort,
  type MoneyBindingConfiguration,
  type MoneyCollectionAdapterPort,
  type MoneyCollectionCommand,
  type MoneyCollectionObservation,
  type MoneyConfigurationPort,
  type MoneyExternalEventInput,
  type MoneyReceiptAcceptancePort,
  type NormalizedMoneyExternalEvent,
} from '../../src/modules/money/ports/collection.port';
import {
  MONEY_REFUND_ADAPTER,
  MONEY_REFUND_CONFIRMATION_PARTICIPANT,
  MONEY_REFUND_POLICY,
  type MoneyRefundAdapterPort,
  type MoneyConfirmedRefund,
  type MoneyRefundConfirmationParticipantPort,
  type MoneyRefundObservation,
  type MoneyRefundPolicyPort,
  type MoneyRefundTransportCommand,
} from '../../src/modules/money/ports/refund.port';
import { AppError } from '../../src/shared/errors/app-error';
import {
  R24_PERMISSIONS,
  r24MoneyHttpFixture,
  type R24HttpResponse,
  type R24HttpSession,
  type R24MoneyHttpFixture,
} from '../support/r24-money-http.fixture';

// Real HTTP, real auth/CSRF/permission guards, real PostgreSQL and Redis.
// Configurations and the collection/receipt/refund/activation participants below
// are explicitly CONTRACT COMPONENTS. They certify no provider rail, SMTP,
// malware scanner, sandbox journey, hosted system or live payment.
// Only synthetic XTS/XXX prices/accounts are used in a separately migrated DB.
const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
const VERSION = 'hsm.money.v1' as const;
const COMMAND_BODY = { contractVersion: VERSION };

interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; requestId?: string; details?: { reason?: string } };
}
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

function errorResponse(
  response: R24HttpResponse<unknown>,
  status: number,
  code: string,
  reason?: string,
): void {
  expect(response.status).toBe(status);
  const body = response.body as ErrorEnvelope;
  expect(body).toMatchObject({ success: false, error: { code, message: expect.any(String) } });
  expect(body.error.message.length).toBeGreaterThan(0);
  if (reason) expect(body.error.details?.reason).toBe(reason);
  expect(JSON.stringify(body)).not.toMatch(/PrismaClient|node_modules|requestDigest|stackTrace/u);
}

class ConfigurationComponent implements MoneyConfigurationPort {
  available = true;
  bindings = new Map<string, MoneyBindingConfiguration>();
  async resolve(input: { planVersionId: string; method: PaymentMethod }) {
    if (!this.available) return null;
    return this.bindings.get(`${input.planVersionId}:${input.method}`) ?? null;
  }
}

class CollectionComponent implements MoneyCollectionAdapterPort {
  configured = true;
  outcome: MoneyCollectionObservation['status'] | 'TIMEOUT' = 'PENDING';
  calls: MoneyCollectionCommand[] = [];
  events = new Map<string, NormalizedMoneyExternalEvent>();
  readonly proof = randomBytes(24).toString('hex');
  beforeTransport?: (command: MoneyCollectionCommand) => Promise<void>;
  isConfigured(): boolean {
    return this.configured;
  }
  async createOrResume(command: MoneyCollectionCommand): Promise<MoneyCollectionObservation> {
    this.calls.push(structuredClone(command));
    await this.beforeTransport?.(command);
    if (this.outcome === 'TIMEOUT') throw new Error('R24 contract-component transport timeout');
    return {
      status: this.outcome,
      externalOperationId:
        command.externalOperationId ?? `r24-operation-${command.paymentAttemptId}`,
    };
  }
  async validateAndNormalizeExternalEvent(
    input: MoneyExternalEventInput,
  ): Promise<NormalizedMoneyExternalEvent> {
    if (!this.configured) throw unavailableMoneyPort('MONEY_COLLECTION_UNAVAILABLE');
    if (input.headers['x-r24-component-proof'] !== this.proof) {
      throw new AppError('UNAUTHORIZED', 'Synthetic external evidence was not authenticated.', 401);
    }
    const eventId = (input.payload as { fixtureEventId?: string } | null)?.fixtureEventId;
    const event = eventId ? this.events.get(eventId) : undefined;
    if (!event) throw new AppError('VALIDATION_ERROR', 'Unknown component event.', 400);
    return structuredClone(event);
  }
}

class ActivationComponent implements MoneyActivationParticipantPort {
  configured = true;
  fail = false;
  calls: MoneyPeriodActivation[] = [];
  isConfigured(): boolean {
    return this.configured;
  }
  async activatePeriod(input: MoneyPeriodActivation, tx: PrismaTx): Promise<void> {
    this.calls.push(structuredClone(input));
    // An inert fixture marker makes participant transaction enlistment observable.
    // It is not an entitlement, work-access grant or replacement R31 policy.
    await tx.platformSetting.create({
      data: { key: `it-r24-participant:${input.subscriptionPeriodId}`, value: { ...input } },
    });
    if (this.fail) throw new Error('R24 contract-component activation rollback');
  }
}

class RefundPolicyComponent implements MoneyRefundPolicyPort {
  configured = true;
  async authorizeReservation(
    input: Parameters<MoneyRefundPolicyPort['authorizeReservation']>[0],
    tx: PrismaTx,
  ): Promise<{ policyVersion: string }> {
    if (!this.configured) throw unavailableMoneyPort('MONEY_REFUND_POLICY_UNAVAILABLE');
    const request = await tx.moneyRefundRequest.findUniqueOrThrow({
      where: { id: input.refundRequestId },
    });
    expect(request.amountMinor.toString()).toBe(input.amount.amountMinor);
    return { policyVersion: 'r24-contract-component-policy' };
  }
}

/** Synthetic transaction participant; this marker is not a paid entitlement. */
class RefundConfirmationComponent implements MoneyRefundConfirmationParticipantPort {
  isConfigured(): boolean {
    return true;
  }
  async applyConfirmedRefund(input: MoneyConfirmedRefund, tx: PrismaTx): Promise<void> {
    await tx.platformSetting.create({
      data: { key: `it-r24-refund-participant:${input.refundId}`, value: { ...input } },
    });
  }
}

class RefundComponent implements MoneyRefundAdapterPort {
  configured = true;
  outcome: MoneyRefundObservation['status'] | 'TIMEOUT' = 'PENDING';
  mismatchAccount = false;
  calls: MoneyRefundTransportCommand[] = [];
  isConfigured(): boolean {
    return this.configured;
  }
  submit(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation> {
    return this.observe(command);
  }
  query(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation> {
    return this.observe(command);
  }
  private async observe(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation> {
    this.calls.push(structuredClone(command));
    if (this.outcome === 'TIMEOUT') throw new Error('R24 contract-component refund timeout');
    return {
      status: this.outcome,
      refundId: command.refundId,
      paymentConfirmationId: command.paymentConfirmationId,
      adapterId: command.binding.adapterId,
      mode: command.binding.mode,
      accountReference: this.mismatchAccount
        ? 'r24-wrong-account'
        : command.binding.accountReference,
      amount: command.amount,
      externalOperationId: command.externalOperationId ?? `r24-refund-${command.refundId}`,
    };
  }
}

class ReceiptComponent implements MoneyReceiptAcceptancePort {
  configured = true;
  isConfigured(): boolean {
    return this.configured;
  }
  async accept(
    input: Parameters<MoneyReceiptAcceptancePort['accept']>[0],
    tx: PrismaTx,
  ): Promise<NormalizedMoneyExternalEvent> {
    const intent = await tx.moneyPaymentIntent.findUniqueOrThrow({
      where: { id: input.paymentIntentId },
    });
    return {
      contractVersion: VERSION,
      adapterId: input.binding.adapterId,
      mode: input.binding.mode,
      accountReference: input.binding.accountReference,
      externalEventId: `r24-receipt-${input.idempotencyKey}`,
      externalConfirmationId: `r24-confirmed-receipt-${input.receiptMediaAssetId}`,
      externalOperationId: null,
      paymentIntentId: input.paymentIntentId,
      paymentAttemptId: null,
      source: 'MANUAL_REVIEW',
      amount: toMoneyWire({ amountMinor: intent.totalMinor, currency: intent.currency }),
      confirmedAt: new Date().toISOString(),
      receiptMediaAssetId: input.receiptMediaAssetId,
      reviewerUserId: input.reviewerUserId,
    };
  }
}

dbDescribe(
  'R24 money API and transaction boundaries (real HTTP/PostgreSQL; explicit adapter components)',
  () => {
    let h: R24MoneyHttpFixture;
    let commands: MoneyCommandService;
    let ledger: LedgerService;
    let owner: R24HttpSession;
    let other: R24HttpSession;
    let reviewer: R24HttpSession;
    let unprivileged: R24HttpSession;
    let seeker: R24HttpSession;
    const configuration = new ConfigurationComponent();
    const collection = new CollectionComponent();
    const participant = new ActivationComponent();
    const refundPolicy = new RefundPolicyComponent();
    const refunds = new RefundComponent();
    const receipts = new ReceiptComponent();
    const plans: Record<string, string> = {};

    beforeAll(async () => {
      h = await r24MoneyHttpFixture({
        adapters: [
          { token: MONEY_CONFIGURATION, value: configuration },
          { token: MONEY_COLLECTION_ADAPTER, value: collection },
          { token: MONEY_ACTIVATION_PARTICIPANT, value: participant },
          { token: MONEY_REFUND_POLICY, value: refundPolicy },
          { token: MONEY_REFUND_ADAPTER, value: refunds },
          {
            token: MONEY_REFUND_CONFIRMATION_PARTICIPANT,
            value: new RefundConfirmationComponent(),
          },
          { token: MONEY_RECEIPT_ACCEPTANCE, value: receipts },
        ],
      });
      const { MoneyCommandService } =
        await import('../../src/modules/money/application/money-command.service');
      const { LedgerService } = await import('../../src/modules/money/ledger/ledger.service');
      commands = h.app.get(MoneyCommandService);
      ledger = h.app.get(LedgerService);
      for (const currency of ['XTS', 'XXX']) {
        const debit = await ledger.openAccount(
          { kind: 'SYSTEM', system: 'r24.fixture' },
          {
            key: `${h.prefix}${currency.toLowerCase()}:clearing`,
            ownerType: 'PLATFORM',
            currency,
          },
        );
        const credit = await ledger.openAccount(
          { kind: 'SYSTEM', system: 'r24.fixture' },
          {
            key: `${h.prefix}${currency.toLowerCase()}:revenue`,
            ownerType: 'PLATFORM',
            currency,
          },
        );
        for (const label of currency === 'XTS'
          ? ['monthly', 'annual', 'future', 'retired']
          : ['xxx']) {
          const plan = await h.prisma.subscriptionPlanVersion.create({
            data: {
              planKey: `${h.prefix}${label}`,
              version: 1,
              billingInterval: label === 'annual' ? 'ANNUAL' : 'MONTHLY',
              priceMinor: 1000n,
              currency,
              entitlements: [],
              publishedAt: new Date(Date.now() + (label === 'future' ? 86_400_000 : -172_800_000)),
              ...(label === 'retired' ? { retiredAt: new Date(Date.now() - 86_400_000) } : {}),
            },
          });
          plans[label] = plan.id;
          for (const method of ['STRIPE', 'SHAM_CASH', 'SYRIATEL_CASH', 'CASH_OFFICE'] as const) {
            configuration.bindings.set(`${plan.id}:${method}`, {
              planVersionId: plan.id,
              method,
              currency,
              adapterId: 'r24-contract-component',
              mode: 'SANDBOX',
              accountReference: `r24-private-account-${currency}`,
              debitAccountId: debit.account.id,
              creditAccountId: credit.account.id,
              configVersion: 'r24-component-v1',
              quoteTtlSeconds: 3600,
            });
          }
        }
      }
      owner = await h.login('owner');
      other = await h.login('otherProvider');
      reviewer = await h.login('reviewer');
      unprivileged = await h.login('noPermission');
      seeker = await h.login('seeker');
    }, 120_000);

    beforeEach(() => {
      configuration.available = true;
      collection.configured = true;
      collection.outcome = 'PENDING';
      collection.calls = [];
      collection.beforeTransport = undefined;
      participant.configured = true;
      participant.fail = false;
      participant.calls = [];
      refundPolicy.configured = true;
      refunds.configured = true;
      refunds.outcome = 'PENDING';
      refunds.mismatchAccount = false;
      refunds.calls = [];
      receipts.configured = true;
    });

    afterAll(async () => {
      await h?.dispose();
    }, 30_000);

    function purchase(extra: Partial<MoneyPurchaseRequestV1> = {}): MoneyPurchaseRequestV1 {
      return { contractVersion: VERSION, planVersionId: plans.monthly, method: 'STRIPE', ...extra };
    }
    async function createIntent(
      client = owner,
      extra: Partial<MoneyPurchaseRequestV1> = {},
      key = h.key('intent'),
    ) {
      const response = await client.request<PaymentIntentWireV1>('/v1/money/intents', {
        method: 'POST',
        idempotencyKey: key,
        body: purchase(extra),
      });
      expect(response.status).toBe(201);
      return response.body;
    }
    async function start(intent: PaymentIntentWireV1, client = owner, key = h.key('start')) {
      const response = await client.request<MoneyCommandAcceptedV1>(
        `/v1/money/intents/${intent.id}/attempts`,
        {
          method: 'POST',
          idempotencyKey: key,
          body: COMMAND_BODY,
        },
      );
      expect(response.status).toBe(202);
      expect(response.body).toMatchObject({
        contractVersion: VERSION,
        status: 'ACCEPTED',
        resourceType: 'COLLECTION',
      });
      const attempt = await h.prisma.moneyPaymentAttempt.findUniqueOrThrow({
        where: { id: response.body.resourceId },
      });
      expect(attempt.paymentIntentId).toBe(intent.id);
      return { attempt, accepted: response.body };
    }
    function eventInput(event: NormalizedMoneyExternalEvent): MoneyExternalEventInput {
      collection.events.set(event.externalEventId, event);
      return {
        adapterId: event.adapterId,
        mode: event.mode,
        accountReference: event.accountReference,
        payload: {
          fixtureEventId: event.externalEventId,
          discardedRawField: 'r24-private-raw-sentinel',
        },
        headers: { 'x-r24-component-proof': collection.proof },
      };
    }
    async function normalizedEvent(
      intent: PaymentIntentWireV1,
      attemptId: string,
      extra: Partial<NormalizedMoneyExternalEvent> = {},
    ): Promise<NormalizedMoneyExternalEvent> {
      const binding = await h.prisma.moneyIntentBinding.findUniqueOrThrow({
        where: { paymentIntentId: intent.id },
      });
      return {
        contractVersion: VERSION,
        adapterId: binding.adapterId,
        mode: binding.mode,
        accountReference: binding.accountReference,
        externalEventId: `r24-event-${randomUUID()}`,
        externalConfirmationId: `r24-confirmation-${randomUUID()}`,
        externalOperationId: `r24-operation-${attemptId}`,
        paymentIntentId: intent.id,
        paymentAttemptId: attemptId,
        source: 'PROVIDER_WEBHOOK',
        amount: intent.total,
        confirmedAt: new Date().toISOString(),
        receiptMediaAssetId: null,
        reviewerUserId: null,
        ...extra,
      };
    }
    async function confirm(client = owner, extra: Partial<MoneyPurchaseRequestV1> = {}) {
      const intent = await createIntent(client, extra);
      const { attempt } = await start(intent, client);
      const event = await normalizedEvent(intent, attempt.id);
      const accepted = await commands.acceptExternalEvent(eventInput(event));
      const result = await commands.processExternalEvent(accepted.eventId);
      return { intent, attempt, event, eventId: accepted.eventId, result };
    }
    async function financialCounts() {
      const [
        postings,
        lines,
        confirmations,
        subscriptions,
        periods,
        outbox,
        audit,
        commandRows,
        markers,
      ] = await Promise.all([
        h.prisma.ledgerTransaction.count(),
        h.prisma.ledgerEntry.count(),
        h.prisma.moneyPaymentConfirmation.count(),
        h.prisma.providerSubscription.count(),
        h.prisma.subscriptionPeriod.count(),
        h.prisma.outboxEvent.count(),
        h.prisma.auditEvent.count(),
        h.prisma.moneyCommand.count(),
        h.prisma.platformSetting.count({ where: { key: { startsWith: 'it-r24-participant:' } } }),
      ]);
      return {
        postings,
        lines,
        confirmations,
        subscriptions,
        periods,
        outbox,
        audit,
        commandRows,
        markers,
      };
    }
    async function refundRequest(
      confirmationId: string,
      amountMinor = '200',
      key = h.key('refund-request'),
    ) {
      const response = await owner.request<MoneyRefundRequestWireV1>('/v1/money/refund-requests', {
        method: 'POST',
        idempotencyKey: key,
        body: {
          contractVersion: VERSION,
          paymentConfirmationId: confirmationId,
          amount: { amountMinor, currency: 'XTS' },
          reasonCode: 'R24_COMPONENT_REQUEST',
        },
      });
      expect(response.status).toBe(202);
      return response.body;
    }
    async function reserve(requestId: string) {
      const response = await reviewer.request<RefundWireV1>(
        `/v1/money/review/refund-requests/${requestId}/reserve`,
        {
          method: 'POST',
          idempotencyKey: h.key('reserve'),
          body: COMMAND_BODY,
        },
      );
      expect(response.status).toBe(201);
      return response.body;
    }

    async function projection(currency = 'XTS'): Promise<FinancialProjectionV1> {
      const response = await reviewer.request<FinancialProjectionV1>(
        `/v1/money/review/financials?currency=${currency}&asOf=${encodeURIComponent(new Date().toISOString())}`,
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ contractVersion: VERSION, source: 'LEDGER' });
      expect(response.body.totals).toHaveLength(1);
      expect(response.body.totals[0]?.currency).toBe(currency);
      return response.body;
    }

    async function receiptAsset(extra: Record<string, unknown> = {}) {
      // Real isolated bytes and metadata; CLEAN is explicitly a scanner contract
      // component verdict, not a claim of ClamAV or payment-rail acceptance.
      const bytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=',
        'base64',
      );
      const storageKey = `r24-receipt-${randomUUID()}.png`;
      await mkdir(join(h.storageRoot, 'restricted'), { recursive: true, mode: 0o700 });
      await writeFile(join(h.storageRoot, 'restricted', storageKey), bytes, { mode: 0o600 });
      return h.prisma.mediaAsset.create({
        data: {
          visibility: 'RESTRICTED',
          storageKey,
          declaredMimeType: 'image/png',
          detectedMimeType: 'image/png',
          sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          scanState: 'CLEAN',
          scannedAt: new Date(),
          ownerUserId: h.actors.owner.userId,
          uploadCompletedAt: new Date(),
          ...extra,
        },
      });
    }

    it('boots one MoneyModule with the existing LedgerModule and only six ungranted migrated capabilities', async () => {
      const names = [...h.app.get(ModulesContainer).values()].map((module) => module.metatype.name);
      expect(names.filter((name) => name === 'MoneyModule')).toHaveLength(1);
      expect(names.filter((name) => name === 'LedgerModule')).toHaveLength(1);
      expect(names).toContain('SupportModule');
      const [identity] = await h.prisma.$queryRaw<
        Array<{ database: string }>
      >`SELECT current_database() AS database`;
      expect(identity?.database).toMatch(/^hsm_it_r24_money_[a-f0-9]{32}$/u);
      expect(h.initialMoneyPermissions).toEqual(Object.values(R24_PERMISSIONS).sort());
      expect(h.initialMoneyGrants).toBe(0);
      expect(await h.prisma.providerWorkAccessGrant.count()).toBe(0);
      expect(await h.prisma.moneyPaymentConfirmation.count()).toBe(0);
    });

    it('fails closed for missing configuration, unavailable collection and a LIVE binding', async () => {
      const request = () =>
        owner.request('/v1/money/quotes', {
          method: 'POST',
          idempotencyKey: h.key('unavailable'),
          body: purchase(),
        });
      const before = await financialCounts();
      configuration.available = false;
      errorResponse(
        await request(),
        503,
        'DEPENDENCY_UNAVAILABLE',
        'MONEY_CONFIGURATION_UNAVAILABLE',
      );
      configuration.available = true;
      collection.configured = false;
      errorResponse(await request(), 503, 'DEPENDENCY_UNAVAILABLE', 'MONEY_COLLECTION_UNAVAILABLE');
      collection.configured = true;
      const bindingKey = `${plans.monthly}:STRIPE`;
      const original = configuration.bindings.get(bindingKey)!;
      configuration.bindings.set(bindingKey, { ...original, mode: 'LIVE' });
      try {
        errorResponse(await request(), 503, 'DEPENDENCY_UNAVAILABLE', 'MONEY_LIVE_DISABLED');
      } finally {
        configuration.bindings.set(bindingKey, original);
      }
      expect(collection.calls).toHaveLength(0);
      expect(await financialCounts()).toEqual(before);
    });

    it('uses real session, provider role, permission and CSRF checks before writing commands', async () => {
      const before = await financialCounts();
      const options = { method: 'POST', idempotencyKey: h.key('denied'), body: purchase() };
      errorResponse(
        await h.session().request('/v1/money/intents', options),
        401,
        'AUTH_INVALID_CREDENTIALS',
      );
      errorResponse(await unprivileged.request('/v1/money/intents', options), 403, 'FORBIDDEN');
      await h.grant('seeker', R24_PERMISSIONS.purchase);
      try {
        errorResponse(await seeker.request('/v1/money/intents', options), 403, 'FORBIDDEN');
      } finally {
        await h.revoke('seeker', R24_PERMISSIONS.purchase);
      }
      errorResponse(
        await owner.request('/v1/money/intents', { ...options, csrf: false }),
        403,
        'AUTH_CSRF_FAILED',
      );
      errorResponse(
        await owner.request('/v1/money/intents', { method: 'POST', body: purchase() }),
        400,
        'VALIDATION_ERROR',
      );
      errorResponse(
        await owner.request('/v1/money/intents', {
          ...options,
          body: { ...purchase(), contractVersion: 'hsm.money.v0' },
        }),
        400,
        'VALIDATION_ERROR',
      );
      expect(await financialCounts()).toEqual(before);
    });

    it.each([
      ['actorId', 'some-other-user'],
      ['providerProfileId', 'some-other-provider'],
      ['accountId', 'untrusted-account'],
      ['currency', 'XXX'],
      ['amount', 1],
      ['totalMinor', '1'],
      ['mode', 'LIVE'],
      ['quote', { totalMinor: '1' }],
    ])('rejects client authority field %s at the real DTO boundary', async (field, value) => {
      const before = await h.prisma.moneyCommand.count();
      errorResponse(
        await owner.request('/v1/money/intents', {
          method: 'POST',
          idempotencyKey: h.key('tamper'),
          body: { ...purchase(), [field as string]: value },
        }),
        400,
        'VALIDATION_ERROR',
      );
      expect(await h.prisma.moneyCommand.count()).toBe(before);
    });

    it.each(['future', 'retired'])(
      'refuses the %s plan version from the real published-version catalog',
      async (label) => {
        errorResponse(
          await owner.request('/v1/money/quotes', {
            method: 'POST',
            idempotencyKey: h.key('plan-version'),
            body: purchase({ planVersionId: plans[label] }),
          }),
          400,
          'VALIDATION_ERROR',
          'PLAN_VERSION_UNAVAILABLE',
        );
      },
    );

    it('rejects configuration currency drift before any financial or command write', async () => {
      const bindingKey = `${plans.monthly}:STRIPE`;
      const original = configuration.bindings.get(bindingKey)!;
      const before = await financialCounts();
      configuration.bindings.set(bindingKey, { ...original, currency: 'XXX' });
      try {
        errorResponse(
          await owner.request('/v1/money/intents', {
            method: 'POST',
            idempotencyKey: h.key('currency-drift'),
            body: purchase(),
          }),
          409,
          'CONFLICT',
          'MONEY_BINDING_MISMATCH',
        );
      } finally {
        configuration.bindings.set(bindingKey, original);
      }
      expect(await financialCounts()).toEqual(before);
    });

    it('calculates quotes on the server and replays the canonical request while rejecting key reuse across actions, actors and obligations', async () => {
      const key = h.key('quote-replay');
      const response = await owner.request<QuoteWireV1>('/v1/money/quotes', {
        method: 'POST',
        idempotencyKey: key,
        body: purchase(),
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        contractVersion: VERSION,
        subtotal: { amountMinor: '1000', currency: 'XTS' },
        discount: { amountMinor: '0', currency: 'XTS' },
        total: { amountMinor: '1000', currency: 'XTS' },
      });
      const reordered = await owner.request('/v1/money/quotes', {
        method: 'POST',
        idempotencyKey: key,
        body: { method: 'STRIPE', planVersionId: plans.monthly, contractVersion: VERSION },
      });
      expect(reordered.status).toBe(200);
      expect(reordered.body).toEqual(response.body);
      for (const [client, route, body] of [
        [owner, '/v1/money/intents', purchase()],
        [other, '/v1/money/quotes', purchase()],
        [owner, '/v1/money/quotes', purchase({ planVersionId: plans.annual })],
      ] as const) {
        errorResponse(
          await client.request(route, { method: 'POST', idempotencyKey: key, body }),
          409,
          'CONFLICT',
          'MONEY_IDEMPOTENCY_CONFLICT',
        );
      }
      expect(await h.prisma.moneyCommand.count({ where: { idempotencyKey: key } })).toBe(1);
    });

    it('serializes concurrent duplicate HTTP commands into one immutable intent, binding and response', async () => {
      const key = h.key('concurrent-intent');
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          owner.request<PaymentIntentWireV1>('/v1/money/intents', {
            method: 'POST',
            idempotencyKey: key,
            body: purchase(),
          }),
        ),
      );
      expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
      for (const response of responses) expect(response.body).toEqual(responses[0]!.body);
      const id = responses[0]!.body.id;
      expect(await h.prisma.moneyPaymentIntent.count({ where: { id } })).toBe(1);
      expect(await h.prisma.moneyIntentBinding.count({ where: { paymentIntentId: id } })).toBe(1);
      expect(await h.prisma.moneyCommand.count({ where: { idempotencyKey: key } })).toBe(1);
      const fresh = await owner.request<PaymentIntentWireV1>(`/v1/money/intents/${id}`);
      expect(fresh.status).toBe(200);
      expect(fresh.body).toEqual(responses[0]!.body);
    });

    it.each(['r24_event_', 'r24_process_', 'r24_refund_result_'])(
      'rejects the reserved internal command namespace %s at HTTP',
      async (prefix) => {
        const before = await h.prisma.moneyCommand.count();
        errorResponse(
          await owner.request('/v1/money/intents', {
            method: 'POST',
            idempotencyKey: `${prefix}${randomUUID()}`,
            body: purchase(),
          }),
          400,
          'VALIDATION_ERROR',
        );
        expect(await h.prisma.moneyCommand.count()).toBe(before);
      },
    );

    it('allows only one actor to own a command key when providers race', async () => {
      const key = h.key('actor-race');
      const responses = await Promise.all(
        [owner, other].map((client) =>
          client.request<PaymentIntentWireV1>('/v1/money/intents', {
            method: 'POST',
            idempotencyKey: key,
            body: purchase(),
          }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      errorResponse(
        responses.find((response) => response.status === 409)!,
        409,
        'CONFLICT',
        'MONEY_IDEMPOTENCY_CONFLICT',
      );
      expect(await h.prisma.moneyCommand.count({ where: { idempotencyKey: key } })).toBe(1);
    });

    it('returns the same not-found envelope for another provider intent/attempt and a nonexistent resource', async () => {
      const intent = await createIntent();
      const { attempt } = await start(intent);
      const before = await financialCounts();
      const missing = await other.request<ErrorEnvelope>(`/v1/money/intents/${randomUUID()}`);
      const owned = await other.request<ErrorEnvelope>(`/v1/money/intents/${intent.id}`);
      errorResponse(owned, 404, 'NOT_FOUND');
      expect(owned.body.error.message).toBe(missing.body.error.message);
      errorResponse(await other.request(`/v1/money/attempts/${attempt.id}`), 404, 'NOT_FOUND');
      for (const path of [
        `/v1/money/intents/${intent.id}/attempts`,
        `/v1/money/intents/${intent.id}/cancel`,
        `/v1/money/attempts/${attempt.id}/resume`,
      ]) {
        errorResponse(
          await other.request(path, {
            method: 'POST',
            idempotencyKey: h.key('idor'),
            body: COMMAND_BODY,
          }),
          404,
          'NOT_FOUND',
        );
      }
      expect(await financialCounts()).toEqual(before);
    });

    it('observes permission and role revocation with the existing cookie and a populated Redis role cache', async () => {
      const { PermissionResolverService } =
        await import('../../src/modules/iam/authorization/services/permission-resolver.service');
      const permissions = h.app.get(PermissionResolverService);
      expect(
        (await permissions.resolveForRoles(h.actors.owner.roleNames)).has(R24_PERMISSIONS.purchase),
      ).toBe(true);
      const key = h.key('revoked-replay');
      const intent = await createIntent(owner, {}, key);
      await h.revoke('owner', R24_PERMISSIONS.purchase);
      try {
        expect(
          (await permissions.resolveForRoles(h.actors.owner.roleNames)).has(
            R24_PERMISSIONS.purchase,
          ),
        ).toBe(true);
        errorResponse(
          await owner.request('/v1/money/intents', {
            method: 'POST',
            idempotencyKey: key,
            body: purchase(),
          }),
          403,
          'FORBIDDEN',
        );
      } finally {
        await h.grant('owner', R24_PERMISSIONS.purchase);
      }
      await h.revoke('owner', R24_PERMISSIONS.read);
      try {
        errorResponse(await owner.request(`/v1/money/intents/${intent.id}`), 403, 'FORBIDDEN');
      } finally {
        await h.grant('owner', R24_PERMISSIONS.read);
      }
      await h.revoke('reviewer', R24_PERMISSIONS.review);
      try {
        errorResponse(await reviewer.request('/v1/money/review/intents'), 403, 'FORBIDDEN');
      } finally {
        await h.grant('reviewer', R24_PERMISSIONS.review);
      }
      const role = await h.prisma.role.findUniqueOrThrow({ where: { name: 'provider' } });
      await h.prisma.userRole.delete({
        where: { userId_roleId: { userId: h.actors.owner.userId, roleId: role.id } },
      });
      try {
        errorResponse(await owner.request(`/v1/money/intents/${intent.id}`), 403, 'FORBIDDEN');
        errorResponse(
          await owner.request('/v1/money/intents', {
            method: 'POST',
            idempotencyKey: h.key('revoked-provider-role'),
            body: purchase(),
          }),
          403,
          'FORBIDDEN',
        );
      } finally {
        await h.prisma.userRole.create({
          data: { userId: h.actors.owner.userId, roleId: role.id },
        });
      }
    });

    it('requires the current reviewer base role for reads and receipt commands despite a retained money grant', async () => {
      const role = await h.prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
      const before = await financialCounts();
      await h.prisma.userRole.delete({
        where: {
          userId_roleId: {
            userId: h.actors.reviewer.userId,
            roleId: role.id,
          },
        },
      });
      try {
        errorResponse(await reviewer.request('/v1/money/review/intents'), 403, 'FORBIDDEN');
        errorResponse(
          await reviewer.request('/v1/money/review/receipts/accept', {
            method: 'POST',
            idempotencyKey: h.key('revoked-reviewer-role'),
            body: {
              contractVersion: VERSION,
              paymentIntentId: randomUUID(),
              receiptMediaAssetId: randomUUID(),
            },
          }),
          403,
          'FORBIDDEN',
        );
        expect(await financialCounts()).toEqual(before);
      } finally {
        await h.prisma.userRole.create({
          data: { userId: h.actors.reviewer.userId, roleId: role.id },
        });
      }
    });

    it('commits the dispatch before transport, exposes timeout as UNKNOWN, and resumes the same attempt/provider key', async () => {
      const intent = await createIntent();
      collection.outcome = 'TIMEOUT';
      let durableAtTransport = false;
      collection.beforeTransport = async (input) => {
        const dispatch = await h.prisma.moneyDispatch.findUniqueOrThrow({
          where: { paymentAttemptId: input.paymentAttemptId },
        });
        expect(
          await h.prisma.moneyCommand.findUnique({ where: { id: dispatch.commandId } }),
        ).not.toBeNull();
        expect(
          await h.prisma.moneyPaymentAttempt.findUnique({ where: { id: input.paymentAttemptId } }),
        ).not.toBeNull();
        durableAtTransport = true;
      };
      const { attempt } = await start(intent);
      expect(durableAtTransport).toBe(true);
      let observed = await owner.request<MoneyAttemptStatusWireV1>(
        `/v1/money/attempts/${attempt.id}`,
      );
      expect(observed.status).toBe(200);
      expect(observed.body).toMatchObject({
        id: attempt.id,
        status: 'STARTED',
        dispatchStatus: 'UNKNOWN',
      });
      const providerKey = collection.calls[0]!.providerIdempotencyKey;
      collection.outcome = 'SUCCEEDED';
      const resumed = await owner.request<MoneyCommandAcceptedV1>(
        `/v1/money/attempts/${attempt.id}/resume`,
        {
          method: 'POST',
          idempotencyKey: h.key('resume-timeout'),
          body: COMMAND_BODY,
        },
      );
      expect(resumed.status).toBe(202);
      expect(resumed.body.resourceId).toBe(attempt.id);
      expect(collection.calls.map((call) => call.providerIdempotencyKey)).toEqual([
        providerKey,
        providerKey,
      ]);
      observed = await owner.request<MoneyAttemptStatusWireV1>(`/v1/money/attempts/${attempt.id}`);
      expect(observed.body).toMatchObject({ status: 'STARTED', dispatchStatus: 'PENDING' });
      expect(
        await h.prisma.moneyPaymentConfirmation.count({ where: { paymentIntentId: intent.id } }),
      ).toBe(0);
      expect(
        await h.prisma.moneyPaymentAttempt.count({ where: { paymentIntentId: intent.id } }),
      ).toBe(1);
    });

    it('keeps a normalized event retryable without an activator, then commits one posting/period/outbox together', async () => {
      const intent = await createIntent();
      const { attempt } = await start(intent);
      const event = await normalizedEvent(intent, attempt.id);
      const { eventId } = await commands.acceptExternalEvent(eventInput(event));
      const before = await financialCounts();
      participant.configured = false;
      await expect(commands.processExternalEvent(eventId)).rejects.toMatchObject({
        status: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
        details: { reason: 'MONEY_ACTIVATION_UNAVAILABLE' },
      });
      expect(await financialCounts()).toEqual(before);
      expect(
        await h.prisma.moneyExternalEvent.findUniqueOrThrow({ where: { id: eventId } }),
      ).toMatchObject({ status: 'RECEIVED', processedAt: null });
      participant.configured = true;
      const result = await commands.processExternalEvent(eventId);
      expect(result).toMatchObject({ contractVersion: VERSION, status: 'ACTIVE' });
      expect(await commands.processExternalEvent(eventId)).toEqual(result);
      const after = await financialCounts();
      expect(after.postings - before.postings).toBe(1);
      expect(after.lines - before.lines).toBe(2);
      expect(after.confirmations - before.confirmations).toBe(1);
      expect(after.periods - before.periods).toBe(1);
      expect(after.outbox - before.outbox).toBe(1);
      expect(after.markers - before.markers).toBe(1);
      expect(participant.calls).toHaveLength(1);
      expect(participant.calls[0]).toMatchObject({
        planVersionId: intent.planVersionId,
        providerProfileId: intent.providerProfileId,
        subscriptionPeriodId: result.subscriptionPeriodId,
        paymentConfirmationId: result.paymentConfirmationId,
      });
      const outbox = await h.prisma.outboxEvent.findUniqueOrThrow({
        where: { dedupeKey: `money.subscription.activated.v1:${result.paymentConfirmationId}` },
      });
      expect(outbox.payload).toMatchObject({
        paymentConfirmationId: result.paymentConfirmationId,
        subscriptionPeriodId: result.subscriptionPeriodId,
      });
      const stored = await h.prisma.moneyExternalEvent.findUniqueOrThrow({
        where: { id: eventId },
      });
      expect(stored).toMatchObject({
        status: 'PROCESSED',
        externalOperationId: event.externalOperationId,
      });
      expect(
        JSON.stringify(stored, (_, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
      ).not.toContain('r24-private-raw-sentinel');
    });

    it.each(['amount', 'currency', 'account', 'mode', 'operation'] as const)(
      'rejects a normalized external %s mismatch without posting or accepting an event',
      async (kind) => {
        const intent = await createIntent();
        const { attempt } = await start(intent);
        const event = await normalizedEvent(intent, attempt.id);
        if (kind === 'amount') event.amount = toMoneyWire({ amountMinor: 999n, currency: 'XTS' });
        if (kind === 'currency')
          event.amount = toMoneyWire({ amountMinor: 1000n, currency: 'XXX' });
        if (kind === 'account') event.accountReference = 'r24-wrong-account';
        if (kind === 'mode') event.mode = 'LIVE';
        if (kind === 'operation') event.externalOperationId = 'r24-wrong-operation';
        const before = await financialCounts();
        const events = await h.prisma.moneyExternalEvent.count();
        await expect(commands.acceptExternalEvent(eventInput(event))).rejects.toMatchObject(
          kind === 'mode'
            ? { status: 503, details: { reason: 'MONEY_LIVE_DISABLED' } }
            : {
                status: 409,
                details: {
                  reason:
                    kind === 'operation' ? 'MONEY_EXTERNAL_ID_MISMATCH' : 'MONEY_BINDING_MISMATCH',
                },
              },
        );
        expect(await financialCounts()).toEqual(before);
        expect(await h.prisma.moneyExternalEvent.count()).toBe(events);
      },
    );

    it('deduplicates simultaneous normalized event delivery and processing with real database locks', async () => {
      const intent = await createIntent();
      const { attempt } = await start(intent);
      const input = eventInput(await normalizedEvent(intent, attempt.id));
      const deliveries = await Promise.all(
        Array.from({ length: 4 }, () => commands.acceptExternalEvent(input)),
      );
      expect(new Set(deliveries.map((item) => item.eventId)).size).toBe(1);
      const before = await financialCounts();
      const outcomes = await Promise.all(
        deliveries.map((item) => commands.processExternalEvent(item.eventId)),
      );
      for (const outcome of outcomes) expect(outcome).toEqual(outcomes[0]);
      expect((await financialCounts()).confirmations - before.confirmations).toBe(1);
      expect((await financialCounts()).postings - before.postings).toBe(1);
      expect((await financialCounts()).periods - before.periods).toBe(1);
      expect(participant.calls).toHaveLength(1);
    });

    it('deduplicates one scoped payment confirmation delivered through distinct event IDs', async () => {
      const intent = await createIntent();
      const { attempt } = await start(intent);
      const normalized = await normalizedEvent(intent, attempt.id);
      const second = { ...normalized, externalEventId: `r24-event-${randomUUID()}` };
      const deliveries = await Promise.all(
        [normalized, second].map((event) => commands.acceptExternalEvent(eventInput(event))),
      );
      expect(new Set(deliveries.map((delivery) => delivery.eventId)).size).toBe(2);
      const before = await financialCounts();
      const results = await Promise.all(
        deliveries.map((delivery) => commands.processExternalEvent(delivery.eventId)),
      );
      expect(new Set(results.map((result) => result.paymentConfirmationId)).size).toBe(1);
      expect(new Set(results.map((result) => result.subscriptionPeriodId)).size).toBe(1);
      expect(new Set(results.map((result) => result.ledgerTransactionId)).size).toBe(1);
      expect(participant.calls).toHaveLength(1);
      const after = await financialCounts();
      expect(after.postings - before.postings).toBe(1);
      expect(after.confirmations - before.confirmations).toBe(1);
      expect(after.periods - before.periods).toBe(1);
      expect(after.outbox - before.outbox).toBe(1);
      expect(after.markers - before.markers).toBe(1);
      expect(
        await h.prisma.moneyExternalEvent.count({
          where: {
            id: { in: deliveries.map((delivery) => delivery.eventId) },
            status: 'PROCESSED',
          },
        }),
      ).toBe(2);
    });

    it.each(['SHAM_CASH', 'SYRIATEL_CASH', 'CASH_OFFICE'] as const)(
      'rejects a provider webhook as authority for the manual method %s',
      async (method) => {
        const intent = await createIntent(owner, { method });
        const { attempt } = await start(intent);
        const events = await h.prisma.moneyExternalEvent.count();
        const before = await financialCounts();
        await expect(
          commands.acceptExternalEvent(eventInput(await normalizedEvent(intent, attempt.id))),
        ).rejects.toMatchObject({
          status: 409,
          code: 'CONFLICT',
          details: { reason: 'MONEY_BINDING_MISMATCH' },
        });
        expect(await h.prisma.moneyExternalEvent.count()).toBe(events);
        expect(await financialCounts()).toEqual(before);
      },
    );

    it('rolls back the participant, ledger, period, audit and outbox when a configured activator throws', async () => {
      const intent = await createIntent();
      const { attempt } = await start(intent);
      const { eventId } = await commands.acceptExternalEvent(
        eventInput(await normalizedEvent(intent, attempt.id)),
      );
      const before = await financialCounts();
      participant.fail = true;
      const attemptResult = commands.processExternalEvent(eventId);
      await expect(attemptResult).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'The money command could not be completed.',
        details: { reason: 'MONEY_COMMAND_FAILED' },
      });
      await expect(attemptResult).rejects.not.toThrow('R24 contract-component activation rollback');
      expect(await financialCounts()).toEqual(before);
      expect(
        await h.prisma.moneyPaymentIntent.findUniqueOrThrow({ where: { id: intent.id } }),
      ).toMatchObject({ status: 'PROCESSING' });
      expect(
        await h.prisma.moneyExternalEvent.findUniqueOrThrow({ where: { id: eventId } }),
      ).toMatchObject({ status: 'RECEIVED', processedAt: null });
      participant.fail = false;
      expect(await commands.processExternalEvent(eventId)).toMatchObject({ status: 'ACTIVE' });
      expect((await financialCounts()).postings - before.postings).toBe(1);
    });

    it('does not acknowledge confirmation before PostgreSQL commit, including a deferred constraint failure', async () => {
      const intent = await createIntent();
      const { attempt } = await start(intent);
      const { eventId } = await commands.acceptExternalEvent(
        eventInput(await normalizedEvent(intent, attempt.id)),
      );
      await h.prisma.platformSetting.create({
        data: { key: 'it-r24-fail-commit', value: { eventId } },
      });
      await h.prisma.$executeRaw`
      CREATE FUNCTION r24_fixture_reject_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."status" = 'PROCESSED' AND EXISTS (
          SELECT 1 FROM "PlatformSetting" WHERE "key" = 'it-r24-fail-commit'
            AND "value"->>'eventId' = NEW."id"
        ) THEN RAISE EXCEPTION 'R24 deferred commit fixture rejection' USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
      END $$`;
      await h.prisma.$executeRaw`
      CREATE CONSTRAINT TRIGGER r24_fixture_commit_gate AFTER UPDATE ON "MoneyExternalEvent"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION r24_fixture_reject_commit()`;
      const before = await financialCounts();
      try {
        await expect(commands.processExternalEvent(eventId)).rejects.toBeDefined();
        expect(participant.calls).toHaveLength(1);
        expect(await financialCounts()).toEqual(before);
        expect(
          await h.prisma.moneyExternalEvent.findUniqueOrThrow({ where: { id: eventId } }),
        ).toMatchObject({ status: 'RECEIVED', processedAt: null });
      } finally {
        await h.prisma.$executeRaw`DROP TRIGGER r24_fixture_commit_gate ON "MoneyExternalEvent"`;
        await h.prisma.$executeRaw`DROP FUNCTION r24_fixture_reject_commit()`;
        await h.prisma.platformSetting.delete({ where: { key: 'it-r24-fail-commit' } });
      }
      const result = await commands.processExternalEvent(eventId);
      expect(result.status).toBe('ACTIVE');
      expect((await financialCounts()).outbox - before.outbox).toBe(1);
      expect((await financialCounts()).postings - before.postings).toBe(1);
    });

    it('preserves a verified success when a delayed collection observation returns afterward', async () => {
      const intent = await createIntent();
      let releaseTransport!: () => void;
      let transportStarted!: (input: MoneyCollectionCommand) => void;
      const release = new Promise<void>((resolve) => {
        releaseTransport = resolve;
      });
      const started = new Promise<MoneyCollectionCommand>((resolve) => {
        transportStarted = resolve;
      });
      collection.beforeTransport = async (input) => {
        transportStarted(input);
        await release;
      };
      const responsePromise = owner.request<MoneyCommandAcceptedV1>(
        `/v1/money/intents/${intent.id}/attempts`,
        {
          method: 'POST',
          idempotencyKey: h.key('delayed-observation'),
          body: COMMAND_BODY,
        },
      );
      const input = await started;
      let result: SubscriptionActivationResultV1;
      try {
        const { eventId } = await commands.acceptExternalEvent(
          eventInput(await normalizedEvent(intent, input.paymentAttemptId)),
        );
        result = await commands.processExternalEvent(eventId);
      } finally {
        releaseTransport();
      }
      expect((await responsePromise).status).toBe(202);
      const observed = await owner.request<MoneyAttemptStatusWireV1>(
        `/v1/money/attempts/${input.paymentAttemptId}`,
      );
      expect(observed.body).toMatchObject({ status: 'SUCCEEDED', dispatchStatus: 'SUCCEEDED' });
      expect(
        await h.prisma.moneyPaymentConfirmation.count({ where: { paymentIntentId: intent.id } }),
      ).toBe(1);
      expect(
        await h.prisma.subscriptionPeriod.count({
          where: { paymentConfirmationId: result!.paymentConfirmationId },
        }),
      ).toBe(1);
    });

    it.each(['wrongOwner', 'public', 'unscanned', 'incomplete', 'erasing'] as const)(
      'rejects %s receipt evidence before a reviewer can create authority',
      async (kind) => {
        const intent = await createIntent(owner, { method: 'SHAM_CASH' });
        const extra = {
          wrongOwner: { ownerUserId: h.actors.otherProvider.userId },
          public: { visibility: 'PUBLIC' },
          unscanned: { scanState: 'PENDING' },
          incomplete: { uploadCompletedAt: null },
          erasing: { erasureStartedAt: new Date() },
        }[kind];
        const asset = await receiptAsset(extra);
        const before = await financialCounts();
        errorResponse(
          await reviewer.request('/v1/money/review/receipts/accept', {
            method: 'POST',
            idempotencyKey: h.key('invalid-receipt'),
            body: {
              contractVersion: VERSION,
              paymentIntentId: intent.id,
              receiptMediaAssetId: asset.id,
            },
          }),
          404,
          'NOT_FOUND',
        );
        expect(await financialCounts()).toEqual(before);
      },
    );

    it('requires the configured receipt participant, current reviewer permission and later activation', async () => {
      const intent = await createIntent(owner, { method: 'SHAM_CASH' });
      const asset = await receiptAsset();
      const input = {
        method: 'POST',
        idempotencyKey: h.key('receipt-accept'),
        body: {
          contractVersion: VERSION,
          paymentIntentId: intent.id,
          receiptMediaAssetId: asset.id,
        },
      };
      errorResponse(
        await owner.request('/v1/money/review/receipts/accept', input),
        403,
        'FORBIDDEN',
      );
      errorResponse(
        await reviewer.request('/v1/money/review/receipts/accept', { ...input, csrf: false }),
        403,
        'AUTH_CSRF_FAILED',
      );
      receipts.configured = false;
      errorResponse(
        await reviewer.request('/v1/money/review/receipts/accept', input),
        503,
        'DEPENDENCY_UNAVAILABLE',
        'MONEY_RECEIPT_UNAVAILABLE',
      );
      receipts.configured = true;
      const response = await reviewer.request<MoneyCommandAcceptedV1>(
        '/v1/money/review/receipts/accept',
        input,
      );
      expect(response.status).toBe(202);
      expect(response.body.resourceType).toBe('RECEIPT');
      expect(
        await h.prisma.moneyPaymentConfirmation.count({ where: { paymentIntentId: intent.id } }),
      ).toBe(0);
      participant.configured = false;
      await expect(commands.processExternalEvent(response.body.resourceId)).rejects.toMatchObject({
        status: 503,
        details: { reason: 'MONEY_ACTIVATION_UNAVAILABLE' },
      });
      participant.configured = true;
      await h.revoke('reviewer', R24_PERMISSIONS.receiptReview);
      try {
        await expect(commands.processExternalEvent(response.body.resourceId)).rejects.toMatchObject(
          { status: 403, code: 'FORBIDDEN' },
        );
      } finally {
        await h.grant('reviewer', R24_PERMISSIONS.receiptReview);
      }
      const reviewerRole = await h.prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
      await h.prisma.userRole.delete({
        where: {
          userId_roleId: {
            userId: h.actors.reviewer.userId,
            roleId: reviewerRole.id,
          },
        },
      });
      try {
        await expect(commands.processExternalEvent(response.body.resourceId)).rejects.toMatchObject(
          { status: 403, code: 'FORBIDDEN' },
        );
        expect(
          await h.prisma.moneyExternalEvent.findUniqueOrThrow({
            where: { id: response.body.resourceId },
          }),
        ).toMatchObject({ status: 'RECEIVED' });
      } finally {
        await h.prisma.userRole.create({
          data: { userId: h.actors.reviewer.userId, roleId: reviewerRole.id },
        });
      }
      const result = await commands.processExternalEvent(response.body.resourceId);
      expect(
        await h.prisma.moneyPaymentConfirmation.findUniqueOrThrow({
          where: { id: result.paymentConfirmationId },
        }),
      ).toMatchObject({
        source: 'MANUAL_REVIEW',
        receiptMediaAssetId: asset.id,
        reviewerUserId: h.actors.reviewer.userId,
      });
    });

    it('separates owned refund requests from policy reservation and completed refunds', async () => {
      const { result } = await confirm();
      const before = await financialCounts();
      const request = await refundRequest(result.paymentConfirmationId);
      expect(request).toMatchObject({
        status: 'PENDING_POLICY',
        refundId: null,
        amount: { amountMinor: '200', currency: 'XTS' },
      });
      expect(
        await h.prisma.moneyRefund.count({
          where: { paymentConfirmationId: result.paymentConfirmationId },
        }),
      ).toBe(0);
      expect((await financialCounts()).postings).toBe(before.postings);
      errorResponse(
        await other.request(`/v1/money/refund-requests/${request.id}`),
        404,
        'NOT_FOUND',
      );
      errorResponse(
        await other.request('/v1/money/refund-requests', {
          method: 'POST',
          idempotencyKey: h.key('refund-idor'),
          body: {
            contractVersion: VERSION,
            paymentConfirmationId: result.paymentConfirmationId,
            amount: { amountMinor: '200', currency: 'XTS' },
            reasonCode: 'R24_COMPONENT_REQUEST',
          },
        }),
        404,
        'NOT_FOUND',
      );
      errorResponse(
        await owner.request(`/v1/money/review/refund-requests/${request.id}/reserve`, {
          method: 'POST',
          idempotencyKey: h.key('unauthorized-reserve'),
          body: COMMAND_BODY,
        }),
        403,
        'FORBIDDEN',
      );
      refundPolicy.configured = false;
      errorResponse(
        await reviewer.request(`/v1/money/review/refund-requests/${request.id}/reserve`, {
          method: 'POST',
          idempotencyKey: h.key('no-policy'),
          body: COMMAND_BODY,
        }),
        503,
        'DEPENDENCY_UNAVAILABLE',
        'MONEY_REFUND_POLICY_UNAVAILABLE',
      );
      expect(
        await h.prisma.moneyRefundRequest.findUniqueOrThrow({ where: { id: request.id } }),
      ).toMatchObject({ status: 'PENDING_POLICY', refundId: null });
      refundPolicy.configured = true;
      const reserved = await reserve(request.id);
      expect(reserved).toMatchObject({
        status: 'RESERVED',
        compensatingLedgerTransactionId: null,
        externalRefundId: null,
      });
      expect((await financialCounts()).postings).toBe(before.postings);
      const fresh = await owner.request<MoneyRefundRequestWireV1>(
        `/v1/money/refund-requests/${request.id}`,
      );
      expect(fresh.body).toMatchObject({ status: 'AUTHORIZED', refundId: reserved.id });
      expect(Object.keys(fresh.body).sort()).toEqual(
        [
          'amount',
          'contractVersion',
          'id',
          'paymentConfirmationId',
          'reasonCode',
          'refundId',
          'status',
        ].sort(),
      );
    });

    it('binds refund key reuse to the exact amount and currency and rejects malformed or excessive amounts', async () => {
      const { result } = await confirm();
      const key = h.key('refund-fingerprint');
      const request = await refundRequest(result.paymentConfirmationId, '200', key);
      expect(await refundRequest(result.paymentConfirmationId, '200', key)).toEqual(request);
      for (const amount of [
        { amountMinor: '201', currency: 'XTS' },
        { amountMinor: '200', currency: 'XXX' },
      ]) {
        errorResponse(
          await owner.request('/v1/money/refund-requests', {
            method: 'POST',
            idempotencyKey: key,
            body: {
              contractVersion: VERSION,
              paymentConfirmationId: result.paymentConfirmationId,
              amount,
              reasonCode: 'R24_COMPONENT_REQUEST',
            },
          }),
          409,
          'CONFLICT',
          'MONEY_IDEMPOTENCY_CONFLICT',
        );
      }
      for (const amountMinor of ['0', '-1', '01', '1001', '9223372036854775808', 200]) {
        errorResponse(
          await owner.request('/v1/money/refund-requests', {
            method: 'POST',
            idempotencyKey: h.key('refund-amount'),
            body: {
              contractVersion: VERSION,
              paymentConfirmationId: result.paymentConfirmationId,
              amount: { amountMinor, currency: 'XTS' },
              reasonCode: 'R24_COMPONENT_REQUEST',
            },
          }),
          400,
          'VALIDATION_ERROR',
        );
      }
    });

    it('serializes competing refund reservations against the original paid obligation', async () => {
      const { result } = await confirm();
      const requests = await Promise.all([
        refundRequest(result.paymentConfirmationId, '600'),
        refundRequest(result.paymentConfirmationId, '600'),
      ]);
      const responses = await Promise.all(
        requests.map((request) =>
          reviewer.request<RefundWireV1>(`/v1/money/review/refund-requests/${request.id}/reserve`, {
            method: 'POST',
            idempotencyKey: h.key('reserve-race'),
            body: COMMAND_BODY,
          }),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      errorResponse(
        responses.find((response) => response.status === 409)!,
        409,
        'CONFLICT',
        'MONEY_REFUND_RESERVATION_EXCEEDED',
      );
      const reserved = await h.prisma.moneyRefund.aggregate({
        where: { paymentConfirmationId: result.paymentConfirmationId },
        _sum: { amountMinor: true },
        _count: true,
      });
      expect(reserved._sum.amountMinor).toBe(600n);
      expect(reserved._count).toBe(1);
    });

    it('keeps timed-out refunds reserved/UNKNOWN until a matching query posts one compensation', async () => {
      const { result } = await confirm();
      const request = await refundRequest(result.paymentConfirmationId);
      const reserved = await reserve(request.id);
      const before = await financialCounts();
      const route = (action: 'dispatch' | 'query') =>
        reviewer.request<MoneyCommandAcceptedV1>(
          `/v1/money/review/refunds/${reserved.id}/${action}`,
          { method: 'POST', idempotencyKey: h.key(`refund-${action}`), body: COMMAND_BODY },
        );
      refunds.configured = false;
      errorResponse(
        await route('dispatch'),
        503,
        'DEPENDENCY_UNAVAILABLE',
        'MONEY_REFUND_ADAPTER_UNAVAILABLE',
      );
      refunds.configured = true;
      refunds.outcome = 'TIMEOUT';
      expect((await route('dispatch')).status).toBe(202);
      let dispatch = await h.prisma.moneyDispatch.findUniqueOrThrow({
        where: { refundId: reserved.id },
      });
      expect(dispatch.status).toBe('UNKNOWN');
      expect(
        await h.prisma.moneyRefund.findUniqueOrThrow({ where: { id: reserved.id } }),
      ).toMatchObject({ status: 'RESERVED', compensatingLedgerTransactionId: null });
      expect((await financialCounts()).postings).toBe(before.postings);
      refunds.outcome = 'PENDING';
      expect((await route('query')).status).toBe(202);
      refunds.outcome = 'SUCCEEDED';
      expect((await route('query')).status).toBe(202);
      expect(new Set(refunds.calls.map((call) => call.providerIdempotencyKey)).size).toBe(1);
      dispatch = await h.prisma.moneyDispatch.findUniqueOrThrow({
        where: { refundId: reserved.id },
      });
      const completed = await h.prisma.moneyRefund.findUniqueOrThrow({
        where: { id: reserved.id },
      });
      expect(dispatch.status).toBe('SUCCEEDED');
      expect(completed.status).toBe('SUCCEEDED');
      expect(completed.compensatingLedgerTransactionId).not.toBeNull();
      expect(
        await h.prisma.ledgerTransaction.findUniqueOrThrow({
          where: { id: completed.compensatingLedgerTransactionId! },
        }),
      ).toMatchObject({ status: 'POSTED', currency: 'XTS' });
      expect((await financialCounts()).postings - before.postings).toBe(1);
      const observation = dispatch.observation as unknown as MoneyRefundObservation;
      expect(await commands.recordRefundResult(dispatch.id, observation)).toMatchObject({
        id: reserved.id,
        status: 'SUCCEEDED',
      });
      expect((await financialCounts()).postings - before.postings).toBe(1);
    });

    it('cannot turn a mismatched refund observation into a ledger compensation', async () => {
      const { result } = await confirm();
      const request = await refundRequest(result.paymentConfirmationId);
      const reserved = await reserve(request.id);
      const before = await financialCounts();
      refunds.outcome = 'SUCCEEDED';
      refunds.mismatchAccount = true;
      const response = await reviewer.request(`/v1/money/review/refunds/${reserved.id}/dispatch`, {
        method: 'POST',
        idempotencyKey: h.key('refund-binding'),
        body: COMMAND_BODY,
      });
      expect(response.status).toBe(202);
      expect(
        await h.prisma.moneyDispatch.findUniqueOrThrow({ where: { refundId: reserved.id } }),
      ).toMatchObject({ status: 'UNKNOWN' });
      expect(
        await h.prisma.moneyRefund.findUniqueOrThrow({ where: { id: reserved.id } }),
      ).toMatchObject({ status: 'RESERVED', compensatingLedgerTransactionId: null });
      expect((await financialCounts()).postings).toBe(before.postings);
    });

    it('recovers a durably verified refund after local audit rollback without another provider call', async () => {
      const { result } = await confirm();
      const request = await refundRequest(result.paymentConfirmationId);
      const reserved = await reserve(request.id);
      const before = await financialCounts();
      const { AuditService } = await import('../../src/modules/iam/audit/audit.service');
      const audit = h.app.get(AuditService);
      const originalRecord = audit.record.bind(audit);
      let injected = false;
      const failure = jest.spyOn(audit, 'record').mockImplementation(async (event, tx) => {
        if (!injected && event.type === 'MONEY_REFUND_RESULT_RECORDED') {
          injected = true;
          throw new Error('r24-private-audit-failure-sentinel');
        }
        return originalRecord(event, tx);
      });
      refunds.outcome = 'SUCCEEDED';
      const key = h.key('refund-local-recovery');
      try {
        const first = await reviewer.request(`/v1/money/review/refunds/${reserved.id}/dispatch`, {
          method: 'POST',
          idempotencyKey: key,
          body: COMMAND_BODY,
        });
        expect(first.status).toBe(202);
      } finally {
        failure.mockRestore();
      }
      expect(injected).toBe(true);
      expect(refunds.calls).toHaveLength(1);
      const stored = await h.prisma.moneyDispatch.findUniqueOrThrow({
        where: { refundId: reserved.id },
      });
      expect(stored).toMatchObject({
        status: 'UNKNOWN',
        externalOperationId: `r24-refund-${reserved.id}`,
      });
      expect(stored.observation).toMatchObject({ status: 'SUCCEEDED', refundId: reserved.id });
      await expect(h.prisma.$executeRaw`
        UPDATE "MoneyDispatch" SET "observation" = '{"status":"PENDING"}'::jsonb WHERE "id" = ${stored.id}
      `).rejects.toMatchObject({ code: 'P2010', meta: { code: '23001' } });
      expect(
        (await h.prisma.moneyDispatch.findUniqueOrThrow({ where: { id: stored.id } })).observation,
      ).toEqual(stored.observation);
      expect(JSON.stringify(stored.observation)).not.toContain(
        'r24-private-audit-failure-sentinel',
      );
      expect(
        await h.prisma.moneyRefund.findUniqueOrThrow({ where: { id: reserved.id } }),
      ).toMatchObject({ status: 'RESERVED', compensatingLedgerTransactionId: null });
      expect((await financialCounts()).postings).toBe(before.postings);
      configuration.available = false;
      refunds.configured = false;
      const recovered = await reviewer.request(`/v1/money/review/refunds/${reserved.id}/query`, {
        method: 'POST',
        idempotencyKey: h.key('recover-without-adapter'),
        body: COMMAND_BODY,
      });
      expect(recovered.status).toBe(202);
      expect(refunds.calls).toHaveLength(1);
      expect(
        await h.prisma.moneyRefund.findUniqueOrThrow({ where: { id: reserved.id } }),
      ).toMatchObject({ status: 'SUCCEEDED', compensatingLedgerTransactionId: expect.any(String) });
      expect((await financialCounts()).postings - before.postings).toBe(1);
      const replay = await reviewer.request(`/v1/money/review/refunds/${reserved.id}/dispatch`, {
        method: 'POST',
        idempotencyKey: key,
        body: COMMAND_BODY,
      });
      expect(replay.status).toBe(202);
      expect(refunds.calls).toHaveLength(1);
      expect((await financialCounts()).postings - before.postings).toBe(1);
    });

    it('derives review totals from posted confirmation/compensation links and keeps currencies separate', async () => {
      const before = await projection();
      await createIntent();
      expect((await projection()).totals).toEqual(before.totals);
      const { result } = await confirm();
      const after = await projection();
      expect(
        BigInt(after.totals[0]!.captured.amountMinor) -
          BigInt(before.totals[0]!.captured.amountMinor),
      ).toBe(1000n);
      expect(after.totals[0]!.refunded).toEqual(before.totals[0]!.refunded);
      const request = await refundRequest(result.paymentConfirmationId);
      const reserved = await reserve(request.id);
      expect((await projection()).totals).toEqual(after.totals);
      refunds.outcome = 'SUCCEEDED';
      expect(
        (
          await reviewer.request(`/v1/money/review/refunds/${reserved.id}/dispatch`, {
            method: 'POST',
            idempotencyKey: h.key('financial-refund'),
            body: COMMAND_BODY,
          })
        ).status,
      ).toBe(202);
      const compensated = await projection();
      expect(compensated.totals[0]!.captured).toEqual(after.totals[0]!.captured);
      expect(
        BigInt(compensated.totals[0]!.refunded.amountMinor) -
          BigInt(after.totals[0]!.refunded.amountMinor),
      ).toBe(200n);
      const otherCurrency = await projection('XXX');
      await confirm(other, { planVersionId: plans.xxx });
      const afterOther = await projection('XXX');
      expect(
        BigInt(afterOther.totals[0]!.captured.amountMinor) -
          BigInt(otherCurrency.totals[0]!.captured.amountMinor),
      ).toBe(1000n);
      expect((await projection()).totals).toEqual(compensated.totals);
      errorResponse(
        await owner.request('/v1/money/review/financials?currency=XTS'),
        403,
        'FORBIDDEN',
      );
      errorResponse(
        await reviewer.request('/v1/money/review/financials?currency=xts'),
        400,
        'VALIDATION_ERROR',
      );
    });

    it('paginates owned reads without leaking another provider or private command/binding metadata', async () => {
      await createIntent();
      await createIntent();
      await createIntent(other);
      const first = await owner.request<Page<PaymentIntentWireV1>>(
        '/v1/money/intents?limit=1&currency=XTS',
      );
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(1);
      expect(first.body.items[0]!.providerProfileId).toBe(h.actors.owner.providerProfileId);
      expect(first.body.nextCursor).toEqual(expect.any(String));
      const cursor = first.body.nextCursor!;
      const second = await owner.request<Page<PaymentIntentWireV1>>(
        `/v1/money/intents?limit=1&currency=XTS&cursor=${cursor}`,
      );
      expect(second.status).toBe(200);
      expect(second.body.items).toHaveLength(1);
      expect(second.body.items[0]!.id).not.toBe(first.body.items[0]!.id);
      expect(second.body.items[0]!.providerProfileId).toBe(h.actors.owner.providerProfileId);
      errorResponse(
        await other.request(`/v1/money/intents?limit=1&currency=XTS&cursor=${cursor}`),
        400,
        'VALIDATION_ERROR',
      );
      errorResponse(
        await owner.request(`/v1/money/intents?limit=1&currency=XXX&cursor=${cursor}`),
        400,
        'VALIDATION_ERROR',
      );
      for (const query of ['limit=0', 'limit=51', 'limit=1.5', 'cursor=broken', 'currency=xts']) {
        errorResponse(await owner.request(`/v1/money/intents?${query}`), 400, 'VALIDATION_ERROR');
      }
      const review = await reviewer.request<Page<PaymentIntentWireV1>>(
        '/v1/money/review/intents?limit=50&currency=XTS',
      );
      expect(review.status).toBe(200);
      expect(
        review.body.items.some(
          (item) => item.providerProfileId === h.actors.otherProvider.providerProfileId,
        ),
      ).toBe(true);
      expect(JSON.stringify([first.body, second.body, review.body])).not.toMatch(
        /requestDigest|responseJson|accountReference|debitAccountId|creditAccountId|r24-private-account|providerIdempotencyKey/u,
      );
    });

    it('reads persisted subscription periods and grouped usage with owned, scope-bound pagination', async () => {
      const { result } = await confirm();
      const response = await owner.request<MoneySubscriptionRead>(
        `/v1/money/subscriptions/${result.subscriptionId}`,
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        contractVersion: VERSION,
        id: result.subscriptionId,
        status: 'ACTIVE',
        providerProfileId: h.actors.owner.providerProfileId,
        planVersionId: plans.monthly,
      });
      for (const suffix of ['', '/usage']) {
        errorResponse(
          await other.request(`/v1/money/subscriptions/${result.subscriptionId}${suffix}`),
          404,
          'NOT_FOUND',
        );
      }
      // Read-side component data only: this is not the R31 policy or usage writer.
      await h.prisma.moneyEntitlementUsage.createMany({
        data: [
          {
            subscriptionId: result.subscriptionId,
            entitlementKey: 'r24.alpha',
            usageKey: randomUUID(),
          },
          {
            subscriptionId: result.subscriptionId,
            entitlementKey: 'r24.alpha',
            usageKey: randomUUID(),
          },
          {
            subscriptionId: result.subscriptionId,
            entitlementKey: 'r24.beta',
            usageKey: randomUUID(),
          },
        ],
      });
      const usage = await owner.request<MoneyUsageRead>(
        `/v1/money/subscriptions/${result.subscriptionId}/usage?limit=1`,
      );
      expect(usage.status).toBe(200);
      expect(usage.body.items).toEqual([{ entitlementKey: 'r24.alpha', used: 2 }]);
      expect(usage.body.nextCursor).toEqual(expect.any(String));
      const next = await owner.request<MoneyUsageRead>(
        `/v1/money/subscriptions/${result.subscriptionId}/usage?limit=1&cursor=${usage.body.nextCursor}`,
      );
      expect(next.body.items).toEqual([{ entitlementKey: 'r24.beta', used: 1 }]);
      expect(next.body.nextCursor).toBeNull();
      const subscriptions = await owner.request<Page<MoneySubscriptionRead>>(
        '/v1/money/subscriptions?limit=50',
      );
      expect(subscriptions.status).toBe(200);
      expect(subscriptions.body.items).toContainEqual(response.body);
    });

    it('paginates the explicit exception projection and refuses unsupported currency scoping', async () => {
      const ids = [randomUUID(), randomUUID()];
      await h.prisma.moneyReconciliationException.createMany({
        data: ids.map((id) => ({
          id,
          kind: 'AMOUNT_MISMATCH',
          subjectType: 'PaymentConfirmation',
          subjectId: `r24-component-${id}`,
        })),
      });
      const first = await reviewer.request<Page<{ id: string }>>(
        '/v1/money/review/exceptions?limit=1',
      );
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(1);
      expect(ids).toContain(first.body.items[0]!.id);
      const next = await reviewer.request<Page<{ id: string }>>(
        `/v1/money/review/exceptions?limit=1&cursor=${first.body.nextCursor}`,
      );
      expect(next.status).toBe(200);
      expect(next.body.items).toHaveLength(1);
      expect(next.body.items[0]!.id).not.toBe(first.body.items[0]!.id);
      expect(next.body.nextCursor).toBeNull();
      errorResponse(
        await reviewer.request('/v1/money/review/exceptions?currency=XTS'),
        400,
        'VALIDATION_ERROR',
      );
      errorResponse(await owner.request('/v1/money/review/exceptions'), 403, 'FORBIDDEN');
    });

    it('preserves booking-derived wallet reads and work-access guards after a subscription payment', async () => {
      const { ProviderWalletService } =
        await import('../../src/modules/provider/wallet/provider-wallet.service');
      const wallet = h.app.get(ProviderWalletService);
      const before = await wallet.summary(h.actors.owner.userId);
      const bookings = await h.prisma.booking.count();
      const guardedBefore = await owner.request('/v1/me/provider/earnings');
      expect(guardedBefore.status).toBe(200);
      expect(guardedBefore.body).toEqual(before);
      const bookingReadBefore = await owner.request('/v1/me/provider/bookings');
      expect(bookingReadBefore.status).toBe(200);
      await confirm();
      expect(await wallet.summary(h.actors.owner.userId)).toEqual(before);
      expect(before).toMatchObject({ totalGross: 0, pendingAmount: 0, completedJobsCount: 0 });
      expect(await h.prisma.booking.count()).toBe(bookings);
      expect(await h.prisma.providerWorkAccessGrant.count()).toBe(0);
      const guardedAfter = await owner.request('/v1/me/provider/earnings');
      expect(guardedAfter.status).toBe(200);
      expect(guardedAfter.body).toEqual(guardedBefore.body);
      const bookingReadAfter = await owner.request('/v1/me/provider/bookings');
      expect(bookingReadAfter.status).toBe(200);
      expect(bookingReadAfter.body).toEqual(bookingReadBefore.body);
    });

    it('keeps confirmation off public HTTP and enforces cancellation state after read-after-write', async () => {
      const before = await h.prisma.moneyPaymentConfirmation.count();
      errorResponse(
        await owner.request('/v1/money/confirmations', {
          method: 'POST',
          idempotencyKey: h.key('no-public-confirmation'),
          body: { contractVersion: VERSION },
        }),
        404,
        'NOT_FOUND',
      );
      const intent = await createIntent();
      const cancelled = await owner.request<PaymentIntentWireV1>(
        `/v1/money/intents/${intent.id}/cancel`,
        {
          method: 'POST',
          idempotencyKey: h.key('cancel'),
          body: COMMAND_BODY,
        },
      );
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(
        (await owner.request<PaymentIntentWireV1>(`/v1/money/intents/${intent.id}`)).body.status,
      ).toBe('CANCELLED');
      errorResponse(
        await owner.request(`/v1/money/intents/${intent.id}/attempts`, {
          method: 'POST',
          idempotencyKey: h.key('cancelled-start'),
          body: COMMAND_BODY,
        }),
        409,
        'CONFLICT',
      );
      expect(await h.prisma.moneyPaymentConfirmation.count()).toBe(before);
    });
  },
);
