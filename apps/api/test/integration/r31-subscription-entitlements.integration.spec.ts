import {
  MONEY_CONTRACT_VERSION,
  toMoneyWire,
  type MoneyMyPlanWireV1,
  type MoneyPlanCatalogWireV1,
  type PaymentMethod,
} from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { randomBytes, randomUUID } from 'node:crypto';

import { OutboxRepository } from '../../src/infrastructure/outbox/outbox.repository';
import { OutboxEventType } from '../../src/infrastructure/outbox/outbox.tokens';
import { TransactionRunner } from '../../src/infrastructure/prisma/transaction.runner';
import { AuditService } from '../../src/modules/iam/audit/audit.service';
import { MoneyCommandService } from '../../src/modules/money/application/money-command.service';
import { SubscriptionActivationService } from '../../src/modules/money/domain/subscription-activation.service';
import { EntitlementUsageService } from '../../src/modules/money/entitlements/entitlement-usage.service';
import { LedgerService } from '../../src/modules/money/ledger/ledger.service';
import { MONEY_ACTIVATION_PARTICIPANT } from '../../src/modules/money/ports/activation.port';
import {
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
  type MoneyBindingConfiguration,
  type MoneyCollectionAdapterPort,
  type MoneyCollectionCommand,
  type MoneyCollectionObservation,
  type MoneyConfigurationPort,
  type MoneyExternalEventInput,
  type NormalizedMoneyExternalEvent,
} from '../../src/modules/money/ports/collection.port';
import type { MoneyConfirmedRefund } from '../../src/modules/money/ports/refund.port';
import { PlanVersionService } from '../../src/modules/money/subscriptions/plan-version.service';
import { SubscriptionActivationParticipant } from '../../src/modules/money/subscriptions/subscription-activation.participant';
import {
  SubscriptionLifecycleService,
  unresolvedSubscriptionPolicy,
  type ApprovedSubscriptionTransition,
  type SubscriptionLifecyclePolicy,
} from '../../src/modules/money/subscriptions/subscription-lifecycle.service';
import { SubscriptionOutboxHandler } from '../../src/modules/money/subscriptions/subscription-outbox.handler';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { AppError } from '../../src/shared/errors/app-error';
import {
  R24_PERMISSIONS,
  r24MoneyHttpFixture,
  type R24ActorName,
  type R24HttpSession,
  type R24MoneyHttpFixture,
} from '../support/r24-money-http.fixture';

// Real AppModule, HTTP authentication/guards, PostgreSQL transactions, Redis,
// R19 ledger/confirmation, and the default R31 activation participant. Only
// configuration and collection are explicit CONTRACT COMPONENTS. They prove
// no R29/R30 rail, hosted journey, SMTP, commercial policy or live payment.
// Every financial fixture is synthetic XTS in a separately migrated database.
const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
const VERSION = MONEY_CONTRACT_VERSION;
const DAY = 86_400_000;
const explicitPolicy: SubscriptionLifecyclePolicy = {
  version: 'r31-test-only-policy-v1',
  reminderLeadTimeMs: DAY,
  cancellation: 'IMMEDIATE',
  suspension: 'SUSPEND',
  refundEffect: 'SUSPEND_SUBSCRIPTION',
};

class ConfigurationComponent implements MoneyConfigurationPort {
  readonly bindings = new Map<string, MoneyBindingConfiguration>();
  async resolve(input: { planVersionId: string; method: PaymentMethod }) {
    const binding = this.bindings.get(input.planVersionId);
    return binding?.method === input.method ? binding : null;
  }
}

class CollectionComponent implements MoneyCollectionAdapterPort {
  readonly events = new Map<string, NormalizedMoneyExternalEvent>();
  readonly proof = randomBytes(24).toString('hex');
  outcome: MoneyCollectionObservation['status'] = 'PENDING';
  isConfigured(): boolean {
    return true;
  }
  async createOrResume(command: MoneyCollectionCommand): Promise<MoneyCollectionObservation> {
    return {
      status: this.outcome,
      externalOperationId: `r31-operation-${command.paymentAttemptId}`,
    };
  }
  async validateAndNormalizeExternalEvent(input: MoneyExternalEventInput) {
    const eventId = (input.payload as { fixtureEventId?: string } | null)?.fixtureEventId;
    const event = eventId ? this.events.get(eventId) : undefined;
    if (!event || input.headers['x-r31-component-proof'] !== this.proof) {
      throw new AppError('UNAUTHORIZED', 'Invalid synthetic component evidence.', 401);
    }
    return structuredClone(event);
  }
}

dbDescribe('R31 subscription/entitlement atomicity and concurrency (real PostgreSQL)', () => {
  let h: R24MoneyHttpFixture;
  let commands: MoneyCommandService;
  let activation: SubscriptionActivationService;
  let participant: SubscriptionActivationParticipant;
  let plans: PlanVersionService;
  let usage: EntitlementUsageService;
  let lifecycle: SubscriptionLifecycleService;
  let ledger: LedgerService;
  let owner: R24HttpSession;
  let other: R24HttpSession;
  let noPermission: R24HttpSession;
  let basePlan: string;
  let debitAccountId: string;
  let creditAccountId: string;
  const configuration = new ConfigurationComponent();
  const collection = new CollectionComponent();

  beforeAll(async () => {
    h = await r24MoneyHttpFixture({
      // Parallel suites share Redis; retain real limits in a per-fixture bucket.
      isolateRateLimits: true,
      adapters: [
        { token: MONEY_CONFIGURATION, value: configuration },
        { token: MONEY_COLLECTION_ADAPTER, value: collection },
      ],
    });
    commands = h.app.get(MoneyCommandService);
    activation = h.app.get(SubscriptionActivationService);
    participant = h.app.get(SubscriptionActivationParticipant);
    plans = h.app.get(PlanVersionService);
    usage = h.app.get(EntitlementUsageService);
    lifecycle = h.app.get(SubscriptionLifecycleService);
    ledger = h.app.get(LedgerService);
    debitAccountId = (
      await ledger.openAccount(
        { kind: 'SYSTEM', system: 'r31.fixture' },
        { key: `${h.prefix}r31:clearing`, ownerType: 'PLATFORM', currency: 'XTS' },
      )
    ).account.id;
    creditAccountId = (
      await ledger.openAccount(
        { kind: 'SYSTEM', system: 'r31.fixture' },
        { key: `${h.prefix}r31:revenue`, ownerType: 'PLATFORM', currency: 'XTS' },
      )
    ).account.id;
    basePlan = await makePlan();
    owner = await h.login('owner');
    other = await h.login('otherProvider');
    // Real password/OTP setup can wait for the unchanged login rate limit.
    // Keep that fixture work outside the five-second authorization assertion.
    noPermission = await h.login('noPermission');
  }, 120_000);
  beforeEach(() => {
    collection.outcome = 'PENDING';
  });
  afterAll(async () => {
    await h?.dispose();
  }, 30_000);

  function bind(planVersionId: string) {
    configuration.bindings.set(planVersionId, {
      planVersionId,
      method: 'STRIPE',
      currency: 'XTS',
      adapterId: 'r31-contract-component',
      mode: 'SANDBOX',
      accountReference: 'r31-synthetic-account',
      debitAccountId,
      creditAccountId,
      configVersion: 'r31-component-v1',
      quoteTtlSeconds: 3600,
    });
  }

  async function makePlan(
    options: {
      key?: string;
      version?: number;
      priceMinor?: bigint;
      interval?: 'MONTHLY' | 'ANNUAL';
    } = {},
  ) {
    const plan = await h.prisma.$transaction((tx) =>
      plans.publishApprovedVersion(
        {
          planKey: options.key ?? `it-r31-${randomUUID().slice(0, 12)}`,
          version: options.version ?? 1,
          billingInterval: options.interval ?? 'MONTHLY',
          priceMinor: options.priceMinor ?? 1000n,
          currency: 'XTS',
          approvalReference: 'r31-fixture-explicit-commercial-input-only',
          entitlements: [
            { key: 'listing.publish', value: { kind: 'LIMIT', limit: 2 } },
            { key: 'profile.featured', value: { kind: 'BOOLEAN', enabled: false } },
          ],
        },
        tx,
      ),
    );
    bind(plan.id);
    return plan.id;
  }

  async function begin(
    actor: R24ActorName = 'owner',
    planVersionId = basePlan,
    couponCode?: string,
  ) {
    const userId = h.actors[actor].userId;
    const intent = await commands.createIntent(userId, h.key('r31_intent'), {
      contractVersion: VERSION,
      planVersionId,
      method: 'STRIPE',
      ...(couponCode ? { couponCode } : {}),
    });
    const attempt = await commands.startCollection(userId, h.key('r31_start'), intent.id);
    return { intent, attemptId: attempt.resourceId, actor };
  }

  async function receive(
    started: Awaited<ReturnType<typeof begin>>,
    overrides: Partial<NormalizedMoneyExternalEvent> = {},
  ) {
    const binding = configuration.bindings.get(started.intent.planVersionId)!;
    const event: NormalizedMoneyExternalEvent = {
      contractVersion: VERSION,
      adapterId: binding.adapterId,
      mode: 'SANDBOX',
      accountReference: binding.accountReference,
      externalEventId: `r31-event-${randomUUID()}`,
      externalConfirmationId: `r31-confirmed-${randomUUID()}`,
      externalOperationId: `r31-operation-${started.attemptId}`,
      paymentIntentId: started.intent.id,
      paymentAttemptId: started.attemptId,
      source: 'PROVIDER_WEBHOOK',
      amount: started.intent.total,
      confirmedAt: new Date(Date.now() - DAY).toISOString(),
      receiptMediaAssetId: null,
      reviewerUserId: null,
      ...overrides,
    };
    collection.events.set(event.externalEventId, event);
    const accepted = await commands.acceptExternalEvent({
      adapterId: event.adapterId,
      mode: event.mode,
      accountReference: event.accountReference,
      payload: { fixtureEventId: event.externalEventId },
      headers: { 'x-r31-component-proof': collection.proof },
    });
    return { ...started, event, eventId: accepted.eventId };
  }

  async function confirm(
    options: { actor?: R24ActorName; planVersionId?: string; confirmedAt?: Date } = {},
  ) {
    const event = await receive(
      await begin(options.actor, options.planVersionId),
      options.confirmedAt ? { confirmedAt: options.confirmedAt.toISOString() } : {},
    );
    return { ...event, result: await commands.processExternalEvent(event.eventId) };
  }

  function controlled(
    at: Date,
    policy: SubscriptionLifecyclePolicy = unresolvedSubscriptionPolicy,
  ) {
    return new SubscriptionLifecycleService(
      h.app.get(TransactionRunner),
      plans,
      usage,
      h.app.get(OutboxRepository),
      h.app.get(NotificationsService),
      h.app.get(AuditService),
      { now: () => at },
      policy,
    );
  }

  async function renew(original: Awaited<ReturnType<typeof confirm>>, confirmedAt = new Date()) {
    // R24 has no approved public renewal endpoint. This is the existing R19
    // trusted confirmation contract plus the real R31 participant in one tx.
    return h.prisma.$transaction(async (tx) => {
      const intent = await tx.moneyPaymentIntent.create({
        data: {
          providerProfileId: h.actors[original.actor].providerProfileId!,
          planVersionId: original.intent.planVersionId,
          method: 'STRIPE',
          currency: 'XTS',
          subtotalMinor: 1000n,
          discountMinor: 0n,
          totalMinor: 1000n,
          idempotencyKey: h.key('r31_renew'),
          requestDigest: 'a'.repeat(64),
          expiresAt: new Date(Date.now() + DAY),
        },
      });
      await tx.moneyPaymentIntent.update({
        where: { id: intent.id },
        data: { status: 'PROCESSING' },
      });
      const result = await activation.confirmAndActivate(
        {
          idempotencyKey: h.key('r31_confirm'),
          paymentIntentId: intent.id,
          source: 'PROVIDER_WEBHOOK',
          externalConfirmationId: `r31-renew-${randomUUID()}`,
          amountMinor: 1000n,
          currency: 'XTS',
          confirmedAt,
          subscriptionId: original.result.subscriptionId,
          ledgerAccounts: { debitAccountId, creditAccountId },
        },
        tx,
      );
      await participant.activatePeriod(
        {
          ...result,
          providerProfileId: intent.providerProfileId,
          planVersionId: intent.planVersionId,
        },
        tx,
      );
      return result;
    });
  }

  async function financialSnapshot() {
    const [
      postings,
      entries,
      confirmations,
      subscriptions,
      periods,
      redemptions,
      outbox,
      audits,
      receipts,
    ] = await Promise.all([
      h.prisma.ledgerTransaction.count(),
      h.prisma.ledgerEntry.count(),
      h.prisma.moneyPaymentConfirmation.count(),
      h.prisma.providerSubscription.count(),
      h.prisma.subscriptionPeriod.count(),
      h.prisma.moneyCouponRedemption.count(),
      h.prisma.outboxEvent.count(),
      h.prisma.auditEvent.count(),
      h.prisma.moneyCommand.count(),
    ]);
    return {
      postings,
      entries,
      confirmations,
      subscriptions,
      periods,
      redemptions,
      outbox,
      audits,
      receipts,
    };
  }

  async function coupon(
    options: { maxRedemptions?: number; maxRedemptionsPerProvider?: number } = {},
  ) {
    return h.prisma.moneyCoupon.create({
      data: {
        code: `R31${randomBytes(8).toString('hex').toUpperCase()}`,
        kind: 'FIXED',
        value: 100n,
        currency: 'XTS',
        active: true,
        ...options,
      },
    });
  }

  it('boots the actual R31 binding, denies anonymous/ungranted reads and exposes no action endpoints', async () => {
    expect(h.app.get(MONEY_ACTIVATION_PARTICIPANT)).toBe(participant);
    expect(h.initialMoneyGrants).toBe(0);
    expect((await h.session().request('/v1/money/my-plan')).status).toBe(401);
    expect((await noPermission.request('/v1/money/my-plan')).status).toBe(403);
    expect((await owner.request('/v1/money/my-plan', { method: 'POST', body: {} })).status).toBe(
      404,
    );
    const view = await owner.request<MoneyMyPlanWireV1>('/v1/money/my-plan');
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({
      status: 'NONE',
      grantsIdentityVerification: false,
      grantsWorkAccess: false,
      policy: { state: 'POLICY_BLOCKED', canRenew: false, canCancel: false, canApplyCoupon: false },
    });
  });

  it('does not activate, redeem or consume for failed or cancelled collections', async () => {
    const discount = await coupon();
    collection.outcome = 'FAILED';
    const failed = await begin('otherProvider', basePlan, discount.code);
    expect(await lifecycle.myPlan(h.actors.otherProvider.userId)).toMatchObject({
      status: 'FAILED',
      subscription: null,
      payment: { id: failed.intent.id, status: 'PROCESSING', latestAttemptStatus: 'FAILED' },
    });
    const failedIntent = await h.prisma.moneyPaymentIntent.findUniqueOrThrow({
      where: { id: failed.intent.id },
    });
    expect(failedIntent.status).toBe('PROCESSING');
    const cancelled = await commands.createIntent(
      h.actors.otherProvider.userId,
      h.key('r31_cancel'),
      {
        contractVersion: VERSION,
        planVersionId: basePlan,
        method: 'STRIPE',
        couponCode: discount.code,
      },
    );
    await commands.cancelIntent(
      h.actors.otherProvider.userId,
      h.key('r31_cancel_command'),
      cancelled.id,
    );
    expect((await lifecycle.myPlan(h.actors.otherProvider.userId)).status).toBe('CANCELLED');
    expect(
      await h.prisma.moneyPaymentConfirmation.count({
        where: { paymentIntentId: { in: [failed.intent.id, cancelled.id] } },
      }),
    ).toBe(0);
    expect(await h.prisma.moneyCouponRedemption.count({ where: { couponId: discount.id } })).toBe(
      0,
    );
    expect(
      await h.prisma.providerSubscription.count({
        where: { providerProfileId: h.actors.otherProvider.providerProfileId! },
      }),
    ).toBe(0);
    expect(await h.prisma.moneyEntitlementUsage.count()).toBe(0);
  });

  it('paginates the catalog with exact money strings and refuses foreign cursors or forged selection', async () => {
    await makePlan({ priceMinor: 9007199254740993n });
    const first = await owner.request<MoneyPlanCatalogWireV1>('/v1/money/plans?limit=1');
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await owner.request<MoneyPlanCatalogWireV1>(
      `/v1/money/plans?limit=1&cursor=${first.body.nextCursor}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    expect([
      first.body.items[0].price.amountMinor,
      second.body.items[0].price.amountMinor,
    ]).toContain('9007199254740993');
    expect((await other.request(`/v1/money/plans?cursor=${first.body.nextCursor}`)).status).toBe(
      400,
    );
    expect((await owner.request('/v1/money/plans?limit=51')).status).toBe(400);
    expect((await owner.request('/v1/money/my-plan?providerProfileId=someone_else')).status).toBe(
      400,
    );
  });

  it('atomically confirms once under concurrent replay without changing identity, work status or grants', async () => {
    const accountBefore = await h.prisma.providerProfile.findUniqueOrThrow({
      where: { id: h.actors.owner.providerProfileId! },
    });
    const rolesBefore = await h.prisma.userRole.findMany({
      where: { userId: h.actors.owner.userId },
      orderBy: { roleId: 'asc' },
    });
    const pending = await receive(await begin());
    const results = await Promise.all(
      Array.from({ length: 4 }, () => commands.processExternalEvent(pending.eventId)),
    );
    expect(new Set(results.map((row) => row.subscriptionPeriodId)).size).toBe(1);
    const result = results[0];
    expect(
      await h.prisma.moneyPaymentConfirmation.count({
        where: { paymentIntentId: pending.intent.id },
      }),
    ).toBe(1);
    expect(
      await h.prisma.subscriptionPeriod.count({ where: { subscriptionId: result.subscriptionId } }),
    ).toBe(1);
    expect(
      await h.prisma.outboxEvent.count({
        where: {
          dedupeKey: `${OutboxEventType.MONEY_SUBSCRIPTION_EXPIRY_DUE}:${result.subscriptionPeriodId}`,
        },
      }),
    ).toBe(1);
    const duplicate = await receive(pending, {
      ...pending.event,
      externalEventId: `r31-duplicate-${randomUUID()}`,
    });
    expect((await commands.processExternalEvent(duplicate.eventId)).subscriptionPeriodId).toBe(
      result.subscriptionPeriodId,
    );
    expect(
      await h.prisma.providerProfile.findUniqueOrThrow({
        where: { id: h.actors.owner.providerProfileId! },
      }),
    ).toEqual(accountBefore);
    expect(
      await h.prisma.userRole.findMany({
        where: { userId: h.actors.owner.userId },
        orderBy: { roleId: 'asc' },
      }),
    ).toEqual(rolesBefore);
    const view = await owner.request<MoneyMyPlanWireV1>(
      `/v1/money/my-plan?subscriptionId=${result.subscriptionId}`,
    );
    expect(view.body).toMatchObject({
      status: 'ACTIVE',
      subscription: { currentPeriod: { id: result.subscriptionPeriodId } },
      grantsIdentityVerification: false,
      grantsWorkAccess: false,
    });
    expect(
      (await other.request(`/v1/money/my-plan?subscriptionId=${result.subscriptionId}`)).status,
    ).toBe(404);
  });

  it('exposes a later failed collection independently of an already confirmed active subscription', async () => {
    const purchase = await confirm();
    collection.outcome = 'FAILED';
    const later = await begin();
    expect(later.intent.id).not.toBe(purchase.intent.id);
    const response = await owner.request<MoneyMyPlanWireV1>('/v1/money/my-plan');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ACTIVE',
      subscription: {
        id: purchase.result.subscriptionId,
        status: 'ACTIVE',
        currentPeriod: {
          id: purchase.result.subscriptionPeriodId,
          paymentConfirmationId: purchase.result.paymentConfirmationId,
        },
      },
      payment: { id: later.intent.id, status: 'PROCESSING', latestAttemptStatus: 'FAILED' },
    });
    const selected = await owner.request<MoneyMyPlanWireV1>(
      `/v1/money/my-plan?subscriptionId=${purchase.result.subscriptionId}`,
    );
    expect(selected.status).toBe(200);
    expect(selected.body.payment).toMatchObject({
      id: purchase.intent.id,
      status: 'SUCCEEDED',
    });
    expect(response.body.entitlements.find((item) => item.key === 'listing.publish')?.allowed).toBe(
      true,
    );
    expect(
      await h.prisma.moneyPaymentConfirmation.count({
        where: { paymentIntentId: later.intent.id },
      }),
    ).toBe(0);
    expect(
      await h.prisma.subscriptionPeriod.count({
        where: { subscriptionId: purchase.result.subscriptionId },
      }),
    ).toBe(1);
  });

  it('keeps two confirmed purchases of the same plan associated with their own payments', async () => {
    const first = await confirm();
    const second = await confirm();
    expect(first.intent.planVersionId).toBe(second.intent.planVersionId);
    expect(first.result.subscriptionId).not.toBe(second.result.subscriptionId);
    for (const purchase of [first, second]) {
      const selected = await owner.request<MoneyMyPlanWireV1>(
        `/v1/money/my-plan?subscriptionId=${purchase.result.subscriptionId}`,
      );
      expect(selected.status).toBe(200);
      expect(selected.body).toMatchObject({
        subscription: { id: purchase.result.subscriptionId },
        payment: { id: purchase.intent.id, status: 'SUCCEEDED' },
      });
    }
  });

  it('rolls back confirmation, ledger, period, coupon, audit and receipts on a real R31 snapshot failure', async () => {
    // An explicitly malformed legacy snapshot tests the participant's fail-closed
    // boundary. It bypasses plan publication only in this isolated fixture.
    const malformed = await h.prisma.subscriptionPlanVersion.create({
      data: {
        planKey: `it-r31-invalid-${randomUUID().slice(0, 8)}`,
        version: 1,
        billingInterval: 'MONTHLY',
        priceMinor: 1000n,
        currency: 'XTS',
        entitlements: [{ key: 'listing.publish', value: { kind: 'LIMIT', limit: 'unlimited' } }],
        publishedAt: new Date(Date.now() - DAY),
      },
    });
    bind(malformed.id);
    const discount = await coupon();
    const pending = await receive(await begin('owner', malformed.id, discount.code));
    const before = await financialSnapshot();
    await expect(commands.processExternalEvent(pending.eventId)).rejects.toMatchObject({
      status: 500,
    });
    expect(await financialSnapshot()).toEqual(before);
    expect(
      (await h.prisma.moneyPaymentIntent.findUniqueOrThrow({ where: { id: pending.intent.id } }))
        .status,
    ).toBe('PROCESSING');
    expect(
      (await h.prisma.moneyExternalEvent.findUniqueOrThrow({ where: { id: pending.eventId } }))
        .status,
    ).toBe('RECEIVED');
    expect(await h.prisma.moneyCouponRedemption.count({ where: { couponId: discount.id } })).toBe(
      0,
    );
    // Retire this deliberately invalid fixture so later catalog tests remain
    // scoped to their own valid commercial snapshots. Its immutable history
    // and failed confirmation evidence remain intact.
    await h.prisma.subscriptionPlanVersion.update({
      where: { id: malformed.id },
      data: { retiredAt: new Date() },
    });
  });

  it('rejects cross-payer and plan activation bindings against immutable existing history', async () => {
    const purchase = await confirm();
    const input = {
      ...purchase.result,
      providerProfileId: h.actors.owner.providerProfileId!,
      planVersionId: basePlan,
    };
    for (const mismatched of [
      { ...input, providerProfileId: h.actors.otherProvider.providerProfileId! },
      { ...input, planVersionId: 'foreign_plan' },
    ]) {
      await expect(
        h.prisma.$transaction((tx) => participant.activatePeriod(mismatched, tx)),
      ).rejects.toMatchObject({ status: 409 });
    }
    await Promise.all(
      Array.from({ length: 3 }, () =>
        h.prisma.$transaction((tx) => participant.activatePeriod(input, tx)),
      ),
    );
    expect(
      await h.prisma.outboxEvent.count({
        where: {
          dedupeKey: `${OutboxEventType.MONEY_SUBSCRIPTION_EXPIRY_DUE}:${purchase.result.subscriptionPeriodId}`,
        },
      }),
    ).toBe(1);
  });

  it('enforces purchased quota under distinct-key and same-key races, with fresh authorization', async () => {
    const purchase = await confirm();
    const subscriptionId = purchase.result.subscriptionId;
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        usage.consume(h.actors.owner.userId, {
          subscriptionId,
          entitlementKey: 'listing.publish',
          usageKey: `listing:${index}`,
        }),
      ),
    );
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(4);
    const stored = await h.prisma.moneyEntitlementUsage.findMany({ where: { subscriptionId } });
    expect(stored).toHaveLength(2);
    const replayed = await usage.consume(h.actors.owner.userId, {
      subscriptionId,
      entitlementKey: 'listing.publish',
      usageKey: stored[0].usageKey,
    });
    expect(replayed).toMatchObject({ allowed: true, used: 2, remaining: 0, replayed: true });
    expect(replayed).not.toHaveProperty('reason');
    await expect(
      usage.consume(h.actors.otherProvider.userId, {
        subscriptionId,
        entitlementKey: 'listing.publish',
        usageKey: 'foreign',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await h.revoke('owner', R24_PERMISSIONS.read);
    try {
      expect(
        (await owner.request(`/v1/money/my-plan?subscriptionId=${subscriptionId}`)).status,
      ).toBe(403);
      await expect(
        usage.consume(h.actors.owner.userId, {
          subscriptionId,
          entitlementKey: 'listing.publish',
          usageKey: stored[0].usageKey,
        }),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await h.grant('owner', R24_PERMISSIONS.read);
    }
    const second = await confirm();
    const same = await Promise.all(
      Array.from({ length: 4 }, () =>
        usage.consume(h.actors.owner.userId, {
          subscriptionId: second.result.subscriptionId,
          entitlementKey: 'listing.publish',
          usageKey: 'same-operation',
        }),
      ),
    );
    expect(same.filter((result) => !result.replayed)).toHaveLength(1);
    expect(
      await h.prisma.moneyEntitlementUsage.count({
        where: { subscriptionId: second.result.subscriptionId },
      }),
    ).toBe(1);
  });

  it('does not grant before a confirmed future start or after the exact paid-period end', async () => {
    const future = await confirm({ confirmedAt: new Date(Date.now() + DAY) });
    expect(
      (await lifecycle.myPlan(h.actors.owner.userId, future.result.subscriptionId)).status,
    ).toBe('SCHEDULED');
    await expect(
      usage.consume(h.actors.owner.userId, {
        subscriptionId: future.result.subscriptionId,
        entitlementKey: 'listing.publish',
        usageKey: 'too-early',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const active = await confirm();
    const clockAtEnd = new Date(active.result.periodEndsAt);
    const atEnd = controlled(clockAtEnd);
    expect((await atEnd.myPlan(h.actors.owner.userId, active.result.subscriptionId)).status).toBe(
      'EXPIRED',
    );
    const sub = await h.prisma.providerSubscription.findUniqueOrThrow({
      where: { id: active.result.subscriptionId },
    });
    await expect(
      h.prisma.$transaction((tx) => usage.hasCurrentPaidPeriod(tx, sub, clockAtEnd)),
    ).resolves.toBe(false);
    await expect(
      h.prisma.$transaction((tx) =>
        atEnd.expirePeriod(sub.id, active.result.subscriptionPeriodId, tx),
      ),
    ).resolves.toBe(true);
    await expect(
      h.prisma.$transaction((tx) =>
        atEnd.expirePeriod(sub.id, active.result.subscriptionPeriodId, tx),
      ),
    ).resolves.toBe(false);
  });

  it('preserves purchased immutable terms when a plan is retired and a newer version is published', async () => {
    const planKey = `it-r31-version-${randomUUID().slice(0, 8)}`;
    const originalId = await makePlan({ key: planKey });
    const purchase = await confirm({ planVersionId: originalId });
    await expect(
      h.prisma.subscriptionPlanVersion.update({
        where: { id: originalId },
        data: { priceMinor: 2000n },
      }),
    ).rejects.toThrow(/immutable|version/iu);
    await expect(
      h.prisma.providerSubscription.update({
        where: { id: purchase.result.subscriptionId },
        data: { planVersionId: basePlan },
      }),
    ).rejects.toThrow();
    await h.prisma.subscriptionPlanVersion.update({
      where: { id: originalId },
      data: { retiredAt: new Date() },
    });
    const newerId = await makePlan({ key: planKey, version: 2, priceMinor: 2000n });
    const view = await lifecycle.myPlan(h.actors.owner.userId, purchase.result.subscriptionId);
    expect(view.subscription?.plan).toMatchObject({
      id: originalId,
      version: 1,
      price: { amountMinor: '1000' },
    });
    expect(view.status).toBe('ACTIVE');
    const catalog = await plans.listForUser(h.actors.owner.userId, { limit: 50 });
    expect(catalog.items.some((row) => row.id === originalId)).toBe(false);
    expect(catalog.items.some((row) => row.id === newerId)).toBe(true);
  });

  it('ignores an old expiry after a confirmed renewal and does not invent a usage reset', async () => {
    const purchase = await confirm();
    await usage.consume(h.actors.owner.userId, {
      subscriptionId: purchase.result.subscriptionId,
      entitlementKey: 'listing.publish',
      usageKey: 'before-renewal',
    });
    const renewal = await renew(purchase);
    expect(renewal.periodStartsAt).toBe(purchase.result.periodEndsAt);
    const atOldEnd = controlled(new Date(purchase.result.periodEndsAt));
    await expect(
      h.prisma.$transaction((tx) =>
        atOldEnd.expirePeriod(
          purchase.result.subscriptionId,
          purchase.result.subscriptionPeriodId,
          tx,
        ),
      ),
    ).resolves.toBe(false);
    const view = await atOldEnd.myPlan(h.actors.owner.userId, purchase.result.subscriptionId);
    expect(view.status).toBe('ACTIVE');
    expect(view.subscription?.currentPeriod?.id).toBe(renewal.subscriptionPeriodId);
    expect(view.entitlements.find((item) => item.key === 'listing.publish')).toMatchObject({
      used: 1,
      remaining: 1,
    });
    expect(view.policy.blockers).toContain('USAGE_RESET_POLICY_UNAPPROVED');
  });

  it('serializes named suspension receipts and never reapplies an old decision after renewal', async () => {
    const purchase = await confirm();
    const configured = controlled(new Date(), explicitPolicy);
    const input: ApprovedSubscriptionTransition = {
      operationId: h.key('suspend'),
      subscriptionId: purchase.result.subscriptionId,
      subscriptionPeriodId: purchase.result.subscriptionPeriodId,
      policyVersion: explicitPolicy.version!,
      action: 'SUSPEND',
      reasonCode: 'TEST_POLICY',
    };
    expect(() => lifecycle.applyApprovedTransition(input, h.prisma as unknown as PrismaTx)).toThrow(
      'not approved',
    );
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        h.prisma.$transaction((tx) => configured.applyApprovedTransition(input, tx)),
      ),
    );
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    await expect(
      usage.consume(h.actors.owner.userId, {
        subscriptionId: input.subscriptionId,
        entitlementKey: 'listing.publish',
        usageKey: 'while-suspended',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await renew(purchase);
    await expect(
      h.prisma.$transaction((tx) => configured.applyApprovedTransition(input, tx)),
    ).resolves.toMatchObject({ replayed: true, status: 'SUSPENDED' });
    expect(
      (
        await h.prisma.providerSubscription.findUniqueOrThrow({
          where: { id: input.subscriptionId },
        })
      ).status,
    ).toBe('ACTIVE');
    await expect(
      h.prisma.$transaction((tx) =>
        configured.applyApprovedTransition({ ...input, operationId: h.key('stale') }, tx),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      h.prisma.$transaction((tx) =>
        configured.applyApprovedTransition({ ...input, reasonCode: 'DIFFERENT' }, tx),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rolls cancellation and its audit/receipt back with the caller, then commits exactly once', async () => {
    const purchase = await confirm();
    const configured = controlled(new Date(), explicitPolicy);
    const input: ApprovedSubscriptionTransition = {
      operationId: h.key('cancel_subscription'),
      subscriptionId: purchase.result.subscriptionId,
      subscriptionPeriodId: purchase.result.subscriptionPeriodId,
      policyVersion: explicitPolicy.version!,
      action: 'CANCEL',
      reasonCode: 'TEST_POLICY',
    };
    const before = await financialSnapshot();
    await expect(
      h.prisma.$transaction(async (tx) => {
        await configured.applyApprovedTransition(input, tx);
        throw new Error('r31 caller rollback');
      }),
    ).rejects.toThrow('r31 caller rollback');
    expect(await financialSnapshot()).toEqual(before);
    expect(
      (
        await h.prisma.providerSubscription.findUniqueOrThrow({
          where: { id: input.subscriptionId },
        })
      ).status,
    ).toBe('ACTIVE');
    const results = await Promise.all(
      [1, 2].map(() =>
        h.prisma.$transaction((tx) => configured.applyApprovedTransition(input, tx)),
      ),
    );
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect((await lifecycle.myPlan(h.actors.owner.userId, input.subscriptionId)).status).toBe(
      'CANCELLED',
    );
    await expect(
      usage.consume(h.actors.owner.userId, {
        subscriptionId: input.subscriptionId,
        entitlementKey: 'listing.publish',
        usageKey: 'cancelled',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('delivers a policy-approved in-app reminder transactionally and deduplicates retries', async () => {
    const purchase = await confirm();
    const period = await h.prisma.subscriptionPeriod.findUniqueOrThrow({
      where: { id: purchase.result.subscriptionPeriodId },
    });
    const configured = controlled(new Date(period.endsAt.getTime() - DAY), explicitPolicy);
    await h.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ProviderSubscription" WHERE "id" = ${period.subscriptionId} FOR UPDATE`;
      await configured.schedulePeriod(period, tx);
    });
    const event = await h.prisma.outboxEvent.findUniqueOrThrow({
      where: { dedupeKey: `${OutboxEventType.MONEY_SUBSCRIPTION_REMINDER_DUE}:${period.id}` },
    });
    const handler = new SubscriptionOutboxHandler(configured);
    const dedupeKey = `money.subscription.reminder.v1:${period.id}`;
    await expect(
      h.prisma.$transaction(async (tx) => {
        await handler.handle(event, tx);
        throw new Error('r31 notification rollback');
      }),
    ).rejects.toThrow('r31 notification rollback');
    expect(await h.prisma.notification.count({ where: { dedupeKey } })).toBe(0);
    await Promise.all(
      [1, 2, 3].map(() => h.prisma.$transaction((tx) => handler.handle(event, tx))),
    );
    const notification = await h.prisma.notification.findUniqueOrThrow({ where: { dedupeKey } });
    expect(notification.userId).toBe(h.actors.owner.userId);
    expect(await h.prisma.notification.count({ where: { dedupeKey } })).toBe(1);
    expect(
      await h.prisma.outboxEvent.count({
        where: { dedupeKey: `notification.created:${notification.id}` },
      }),
    ).toBe(1);
  });

  it('requires and atomically applies an explicit confirmed-refund consequence with immutable replay', async () => {
    const purchase = await confirm();
    const configured = controlled(new Date(), explicitPolicy);
    const request = await commands.requestRefund(h.actors.owner.userId, h.key('refund_request'), {
      contractVersion: VERSION,
      paymentConfirmationId: purchase.result.paymentConfirmationId,
      amount: toMoneyWire({ amountMinor: 100n, currency: 'XTS' }),
      reasonCode: 'TEST_POLICY',
    });
    // Explicit test-only policy reservation and authoritative refund evidence.
    // This tests R31 consequences with actual persisted compensation; no R32
    // orchestration or provider refund acceptance is claimed.
    const refundKey = h.key('refund');
    const compensationKey = h.key('compensation');
    async function compensate(tx: PrismaTx): Promise<MoneyConfirmedRefund> {
      const refund = await tx.moneyRefund.create({
        data: {
          paymentConfirmationId: purchase.result.paymentConfirmationId,
          amountMinor: 100n,
          currency: 'XTS',
          reasonCode: 'TEST_POLICY',
          idempotencyKey: refundKey,
          requestDigest: 'a'.repeat(64),
        },
      });
      await tx.moneyRefundRequest.update({
        where: { id: request.id },
        data: { status: 'AUTHORIZED', refundId: refund.id, policyVersion: explicitPolicy.version },
      });
      await tx.moneyRefund.update({ where: { id: refund.id }, data: { status: 'DISPATCHED' } });
      const compensation = await ledger.post(
        { kind: 'SYSTEM', system: 'r31.fixture' },
        {
          idempotencyKey: compensationKey,
          currency: 'XTS',
          description: 'R31 synthetic refund compensation',
          externalReference: `money.refund:${refund.id}`,
          lines: [
            { accountId: creditAccountId, side: 'DEBIT', amountMinor: 100n },
            { accountId: debitAccountId, side: 'CREDIT', amountMinor: 100n },
          ],
        },
        tx,
      );
      await tx.moneyRefund.update({
        where: { id: refund.id },
        data: { status: 'SUCCEEDED', compensatingLedgerTransactionId: compensation.transaction.id },
      });
      return {
        refundId: refund.id,
        refundRequestId: request.id,
        paymentConfirmationId: purchase.result.paymentConfirmationId,
        policyVersion: explicitPolicy.version!,
        amount: toMoneyWire({ amountMinor: 100n, currency: 'XTS' }),
        compensatingLedgerTransactionId: compensation.transaction.id,
      };
    }
    const before = await financialSnapshot();
    await expect(
      h.prisma.$transaction(async (tx) => {
        const input = await compensate(tx);
        await configured.applyConfirmedRefund(input, tx);
        throw new Error('r31 refund consequence rollback');
      }),
    ).rejects.toThrow('r31 refund consequence rollback');
    expect(await financialSnapshot()).toEqual(before);
    expect(await h.prisma.moneyRefund.count({ where: { idempotencyKey: refundKey } })).toBe(0);
    const input = await h.prisma.$transaction(async (tx) => {
      const input = await compensate(tx);
      await configured.applyConfirmedRefund(input, tx);
      return input;
    });
    const replay = await Promise.all(
      [1, 2].map(() => h.prisma.$transaction((tx) => configured.applyConfirmedRefund(input, tx))),
    );
    expect(replay.every((result) => result.replayed)).toBe(true);
    expect(
      (await lifecycle.myPlan(h.actors.owner.userId, purchase.result.subscriptionId)).status,
    ).toBe('SUSPENDED');
    await expect(
      h.prisma.$transaction((tx) =>
        configured.applyConfirmedRefund(
          { ...input, amount: toMoneyWire({ amountMinor: 99n, currency: 'XTS' }) },
          tx,
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    // Refund evidence denies capability but does not invalidate immutable
    // history for the already scheduled expiry event.
    const atEnd = controlled(new Date(purchase.result.periodEndsAt), explicitPolicy);
    await expect(
      h.prisma.$transaction((tx) =>
        atEnd.expirePeriod(
          purchase.result.subscriptionId,
          purchase.result.subscriptionPeriodId,
          tx,
        ),
      ),
    ).resolves.toBe(true);
    expect(
      (await lifecycle.myPlan(h.actors.owner.userId, purchase.result.subscriptionId)).status,
    ).toBe('EXPIRED');
  });

  it.each(['global', 'per-provider'] as const)(
    'enforces the %s coupon cap under concurrent real confirmations',
    async (scope) => {
      const discount = await coupon(
        scope === 'global' ? { maxRedemptions: 1 } : { maxRedemptionsPerProvider: 1 },
      );
      // Both quoted obligations exist before either confirmation. R19's locked
      // redemption guard, not an optimistic catalog count, resolves the race.
      const first = await receive(await begin('owner', basePlan, discount.code));
      const second = await receive(
        await begin(scope === 'global' ? 'otherProvider' : 'owner', basePlan, discount.code),
      );
      const results = await Promise.allSettled([
        commands.processExternalEvent(first.eventId),
        commands.processExternalEvent(second.eventId),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(await h.prisma.moneyCouponRedemption.count({ where: { couponId: discount.id } })).toBe(
        1,
      );
      expect(
        await h.prisma.moneyPaymentConfirmation.count({
          where: { paymentIntentId: { in: [first.intent.id, second.intent.id] } },
        }),
      ).toBe(1);
      const loser = results[0].status === 'rejected' ? first : second;
      expect(
        (await h.prisma.moneyPaymentIntent.findUniqueOrThrow({ where: { id: loser.intent.id } }))
          .status,
      ).toBe('PROCESSING');
      expect(
        (await h.prisma.moneyExternalEvent.findUniqueOrThrow({ where: { id: loser.eventId } }))
          .status,
      ).toBe('RECEIVED');
    },
  );
});
