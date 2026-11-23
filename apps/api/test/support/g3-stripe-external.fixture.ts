import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import Stripe from 'stripe';
import type {
  MoneyCommandAcceptedV1,
  MoneyMyPlanWireV1,
  MoneyRefundRequestWireV1,
  MoneyStripeSessionV1,
  PaymentIntentWireV1,
  PlanEntitlementContract,
  RefundWireV1,
} from '@homeservicemarketplace/contracts';
import { Prisma } from '@homeservicemarketplace/database';
import { OutboxWorker } from '../../src/infrastructure/outbox/outbox.worker';
import { MoneyCommandService } from '../../src/modules/money/application/money-command.service';
import { StripeSdk } from '../../src/modules/money/adapters/stripe/stripe-sdk';
import {
  STRIPE_API_VERSION,
  STRIPE_SDK_VERSION,
  StripeSandboxConfiguration,
} from '../../src/modules/money/adapters/stripe/stripe-sandbox.config';
import { MONEY_ACTIVATION_PARTICIPANT } from '../../src/modules/money/ports/activation.port';
import {
  MONEY_CONFIGURATION,
  MONEY_COLLECTION_ADAPTER,
} from '../../src/modules/money/ports/collection.port';
import {
  MONEY_REFUND_ADAPTER,
  MONEY_REFUND_CONFIRMATION_PARTICIPANT,
} from '../../src/modules/money/ports/refund.port';
import {
  approvedPolicySchema,
  REFUND_POLICY_SOURCE,
  type ApprovedRefundPolicy,
} from '../../src/modules/money/refunds/refund-eligibility.policy';
import { RefundOrchestratorService } from '../../src/modules/money/refunds/refund-orchestrator.service';
import { ApprovedRefundParticipant } from '../../src/modules/money/runtime/approved-refund.participant';
import { ApprovedRefundPolicySource } from '../../src/modules/money/runtime/approved-refund-policy.source';
import {
  MoneyCollectionRouter,
  MoneyRailConfiguration,
  MoneyRefundRouter,
} from '../../src/modules/money/runtime/money-rail-router';
import { StripeInboxJob } from '../../src/modules/money/webhooks/stripe/stripe-inbox.job';
import { SubscriptionActivationParticipant } from '../../src/modules/money/subscriptions/subscription-activation.participant';
import { parsePlanEntitlements } from '../../src/modules/money/entitlements/entitlement-policy';
import { EntitlementUsageService } from '../../src/modules/money/entitlements/entitlement-usage.service';
import {
  R24_PERMISSIONS,
  r24MoneyHttpFixture,
  type R24MoneyHttpFixture,
} from './r24-money-http.fixture';

export interface G3ExternalInput {
  schemaVersion: 1;
  approvalReference: string;
  expiresAt: string;
  authorizeSandboxOperations: true;
  authorizeDisposableFixtures: true;
  maxSandboxAmountMinor: string;
  webhookForwardPort: number;
  webhookTimeoutSeconds: number;
  testPaymentMethod: 'pm_card_visa';
  plan: {
    id: string;
    planKey: string;
    version: number;
    billingInterval: 'MONTHLY' | 'ANNUAL';
    priceMinor: string;
    currency: string;
    entitlements: PlanEntitlementContract[];
    publishedAt: string;
    approvalReference: string;
  };
  refundPolicy: {
    rules: ApprovedRefundPolicy;
    approvedAt: string;
    validFrom: string;
    validUntil: string;
    entitlementEffect: 'SUSPEND_SUBSCRIPTION' | 'CANCEL_SUBSCRIPTION';
  };
}

const VERSION = { contractVersion: 'hsm.money.v1' as const };
const WEBHOOK_PATH = '/v1/money/webhooks/stripe';
const REFUND_EVENT = 'money.refund.dispatch-requested.v1';
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
async function until(predicate: () => Promise<boolean>, milliseconds: number, code: string) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(250);
  }
  throw new Error(code);
}
interface Delivery {
  bytes: Buffer;
  signature: string;
  eventId: string;
}

/** Local bridge for an operator-controlled Stripe CLI forwarder. It never
 * signs or reserializes an event. The accepted original remains in memory only.
 * The real HTTP route/official SDK verifies the untouched forwarded signature.
 */
async function webhookBridge(target: string, port: number) {
  let paymentId: string | undefined;
  let delivery: Delivery | undefined;
  let failed = false;
  const server: Server = createServer((request, response) => {
    void (async () => {
      if (
        request.method !== 'POST' ||
        request.url !== WEBHOOK_PATH ||
        request.headers['content-encoding'] !== undefined
      ) {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        length += bytes.length;
        if (length > 65_536) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      const signature = request.headers['stripe-signature'];
      check(
        typeof signature === 'string' && signature.length <= 4096,
        'G3_AUTHENTIC_WEBHOOK_REQUIRED',
      );
      const event = JSON.parse(bytes.toString('utf8')) as {
        id?: string;
        type?: string;
        livemode?: boolean;
        data?: { object?: { id?: string } };
      };
      if (
        !paymentId ||
        event.data?.object?.id !== paymentId ||
        event.type !== 'payment_intent.succeeded' ||
        event.livemode !== false
      ) {
        response.writeHead(409).end();
        return;
      }
      const forwarded = await fetch(target + WEBHOOK_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': signature },
        body: bytes,
        signal: AbortSignal.timeout(30_000),
      });
      const result = (await forwarded.json()) as { received?: boolean };
      check(
        forwarded.status === 200 && result.received === true && typeof event.id === 'string',
        'G3_AUTHENTIC_WEBHOOK_REJECTED',
      );
      if (!delivery) delivery = { bytes, signature, eventId: event.id };
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"received":true}');
    })().catch(() => {
      failed = true;
      if (!response.headersSent) response.writeHead(400);
      response.end();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 20;
  await new Promise<void>((resolve, reject) => {
    server.once('error', () => reject(new Error('G3_FORWARD_PORT_UNAVAILABLE')));
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    expectPayment(value: string) {
      paymentId = value;
    },
    async received(timeout: number): Promise<Delivery> {
      await until(
        async () => {
          check(!failed, 'G3_AUTHENTIC_WEBHOOK_REJECTED');
          return delivery !== undefined;
        },
        timeout,
        'G3_AUTHENTIC_WEBHOOK_NOT_DELIVERED',
      );
      return delivery!;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      delivery?.bytes.fill(0);
      delivery = undefined;
    },
  };
}

/** Invocation is restricted to verify-external.cjs after explicit scope,
 * secret, source, environment and toolchain checks. No test runner discovers
 * or executes this file during ordinary CI. All money ports are real.
 */
export async function runExternalStripeEvidence(
  input: G3ExternalInput,
  onScenarioPassed: (name: string) => void = () => undefined,
) {
  const passedScenarios: string[] = [];
  const passed = (name: string) => {
    passedScenarios.push(name);
    onScenarioPassed(name);
  };
  const requireUnexpiredAuthority = () =>
    check(Date.parse(input.expiresAt) > Date.now(), 'G3_OPERATION_APPROVAL_EXPIRED');
  requireUnexpiredAuthority();
  const policy = approvedPolicySchema.safeParse(input.refundPolicy.rules);
  check(policy.success, 'G3_REFUND_RULES_INVALID');
  const definitions = parsePlanEntitlements(input.plan.entitlements);
  const usableEntitlement = definitions.find((entry) =>
    entry.value.kind === 'BOOLEAN'
      ? entry.value.enabled
      : entry.value.limit === null || entry.value.limit > 0,
  );
  check(usableEntitlement, 'G3_APPROVED_PAID_ENTITLEMENT_REQUIRED');
  const settings = new StripeSandboxConfiguration(
    JSON.parse(process.env.MONEY_STRIPE_SANDBOX_JSON ?? 'null'),
  ).requireEnabled();
  check(Stripe.PACKAGE_VERSION === STRIPE_SDK_VERSION, 'G3_STRIPE_SDK_PIN');
  const provider = new Stripe(settings.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    timeout: 10_000,
    maxNetworkRetries: 0,
    telemetry: false,
  });
  let independentProviderRequests = 0;
  provider.on('request', () => {
    independentProviderRequests++;
  });
  let h: R24MoneyHttpFixture | undefined;
  let bridge: Awaited<ReturnType<typeof webhookBridge>> | undefined;
  let retainedDatabase: string | undefined;
  let externalOperationMayExist = false;
  let completed = false;
  let failure: Error | undefined;
  let observation:
    | {
        realProviderAccount: boolean;
        authenticForwardedWebhook: boolean;
        moneyPortOverrides: number;
        independentProviderRequests: number;
        passedScenarios: string[];
        providerPaymentDigest: string;
        providerRefundDigest: string;
        webhookDigest: string;
      }
    | undefined;
  const retainRecoveryIdentity = (error: Error) => {
    if (retainedDatabase)
      Object.assign(error, { retainedDatabase, recoveryRequiredBeforeCleanup: true });
  };
  try {
    // The shared fixture creates and migrates its own disposable database and
    // synthetic actors. No existing user, permission or app database is changed.
    h = await r24MoneyHttpFixture({ isolateRateLimits: true });
    const fixture = h;
    const prisma = fixture.prisma;
    // Cache the owned database identity before provider I/O. Recovery reporting
    // must still work when the database itself is the failed dependency.
    const databases = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      'SELECT current_database() AS name',
    );
    check(
      databases.length === 1 && /^hsm_it_r24_money_[a-f0-9]{32}$/u.test(databases[0]!.name),
      'G3_ISOLATED_DATABASE_IDENTITY_INVALID',
    );
    retainedDatabase = databases[0]!.name;
    const account = await provider.accounts.retrieve(null);
    check(account.id === settings.accountReference, 'G3_PROVIDER_ACCOUNT_MISMATCH');
    passed('real-provider-account');
    const binding = settings.bindings[0]!;
    for (const [token, implementation] of [
      [MONEY_CONFIGURATION, MoneyRailConfiguration],
      [MONEY_COLLECTION_ADAPTER, MoneyCollectionRouter],
      [MONEY_REFUND_ADAPTER, MoneyRefundRouter],
      [MONEY_ACTIVATION_PARTICIPANT, SubscriptionActivationParticipant],
      [MONEY_REFUND_CONFIRMATION_PARTICIPANT, ApprovedRefundParticipant],
      [REFUND_POLICY_SOURCE, ApprovedRefundPolicySource],
    ] as const)
      check(
        fixture.app.get(token) === fixture.app.get(implementation),
        'G3_CONCRETE_PORT_REGISTRATION_REQUIRED',
      );
    check(fixture.app.get(StripeSdk) instanceof StripeSdk, 'G3_REAL_SDK_REQUIRED');
    passed('registered-concrete-money-ports');
    // Copy only the supplied approved immutable snapshot; no fallback policy,
    // price, market, currency, grant or entitlement is selected by this runner.
    await prisma.subscriptionPlanVersion.create({
      data: {
        id: input.plan.id,
        planKey: input.plan.planKey,
        version: input.plan.version,
        billingInterval: input.plan.billingInterval,
        priceMinor: BigInt(input.plan.priceMinor),
        currency: input.plan.currency,
        entitlements: definitions as unknown as Prisma.InputJsonValue,
        publishedAt: new Date(input.plan.publishedAt),
      },
    });
    for (const accountId of [binding.debitAccountId, binding.creditAccountId]) {
      await prisma.ledgerAccount.create({
        data: {
          id: accountId,
          key: accountId,
          ownerType: 'PLATFORM',
          currency: input.plan.currency,
        },
      });
    }
    await prisma.moneyApprovedRefundPolicy.create({
      data: {
        version: policy.data.version,
        planVersionId: input.plan.id,
        method: 'STRIPE',
        mode: 'SANDBOX',
        currency: input.plan.currency,
        approvalReference: policy.data.approvalReference,
        approvedAt: new Date(input.refundPolicy.approvedAt),
        validFrom: new Date(input.refundPolicy.validFrom),
        validUntil: new Date(input.refundPolicy.validUntil),
        rules: policy.data,
        entitlementEffect: input.refundPolicy.entitlementEffect,
      },
    });
    const owner = await fixture.login('owner');
    const other = await fixture.login('otherProvider');
    const reviewer = await fixture.login('reviewer');
    const purchase = { ...VERSION, planVersionId: input.plan.id, method: 'STRIPE' };
    const forged = await owner.request('/v1/money/intents', {
      method: 'POST',
      idempotencyKey: fixture.key('tamper'),
      body: { ...purchase, amountMinor: '1', currency: input.plan.currency },
    });
    check(forged.status === 400, 'G3_SERVER_PRICE_AUTHORITY');
    const purchaseKey = fixture.key('purchase');
    const intent = await owner.request<PaymentIntentWireV1>('/v1/money/intents', {
      method: 'POST',
      idempotencyKey: purchaseKey,
      body: purchase,
    });
    check(
      intent.status === 201 &&
        intent.body.total.amountMinor === input.plan.priceMinor &&
        intent.body.total.currency === input.plan.currency,
      'G3_PURCHASE_FAILED',
    );
    const replayIntent = await owner.request<PaymentIntentWireV1>('/v1/money/intents', {
      method: 'POST',
      idempotencyKey: purchaseKey,
      body: purchase,
    });
    check(
      replayIntent.status === 201 && replayIntent.body.id === intent.body.id,
      'G3_PURCHASE_REPLAY_DIVERGED',
    );
    check(
      (await other.request('/v1/money/intents/' + intent.body.id)).status === 404,
      'G3_OWNER_BOUNDARY_FAILED',
    );
    // Retain this isolated DB on any later failure: even a lost response can
    // conceal a remote operation. Never erase its durable recovery authority.
    externalOperationMayExist = true;
    requireUnexpiredAuthority();
    const started = await owner.request<MoneyCommandAcceptedV1>(
      '/v1/money/intents/' + intent.body.id + '/attempts',
      { method: 'POST', idempotencyKey: fixture.key('attempt'), body: VERSION },
    );
    check(started.status === 202, 'G3_COLLECTION_FAILED');
    const attemptId = started.body.resourceId;
    const firstDispatch = await prisma.moneyDispatch.findUniqueOrThrow({
      where: { paymentAttemptId: attemptId },
    });
    check(
      typeof firstDispatch.externalOperationId === 'string' &&
        /^pi_[A-Za-z0-9]+$/u.test(firstDispatch.externalOperationId),
      'G3_PROVIDER_INTENT_MISSING',
    );
    const paymentId = firstDispatch.externalOperationId;
    const sessionPath = '/v1/money/stripe/attempts/' + attemptId + '/session';
    check((await other.request(sessionPath)).status === 404, 'G3_SESSION_OWNER_BOUNDARY_FAILED');
    const session = await owner.request<MoneyStripeSessionV1>(sessionPath);
    check(
      session.status === 200 &&
        session.body.state === 'AWAITING_PAYMENT' &&
        typeof session.body.clientSecret === 'string' &&
        session.body.clientSecret.startsWith(paymentId + '_secret_'),
      'G3_CHECKOUT_SESSION_FAILED',
    );
    await fixture.revoke('owner', R24_PERMISSIONS.purchase);
    check((await owner.request(sessionPath)).status === 403, 'G3_FRESH_AUTHORITY_FAILED');
    await fixture.grant('owner', R24_PERMISSIONS.purchase);
    passed('owner-and-price-authority');
    const resumed = await owner.request('/v1/money/attempts/' + attemptId + '/resume', {
      method: 'POST',
      idempotencyKey: fixture.key('resume'),
      body: VERSION,
    });
    const retried = await prisma.moneyDispatch.findUniqueOrThrow({
      where: { paymentAttemptId: attemptId },
    });
    check(
      resumed.status === 202 &&
        retried.externalOperationId === paymentId &&
        retried.providerIdempotencyKey === firstDispatch.providerIdempotencyKey &&
        (await prisma.moneyPaymentAttempt.count({ where: { paymentIntentId: intent.body.id } })) ===
          1,
      'G3_COLLECTION_RETRY_DIVERGED',
    );
    passed('stable-collection-retry');
    bridge = await webhookBridge(fixture.url, input.webhookForwardPort);
    bridge.expectPayment(paymentId);
    const beforePayment = await provider.paymentIntents.retrieve(paymentId);
    check(
      beforePayment.livemode === false &&
        beforePayment.amount === Number(input.plan.priceMinor) &&
        beforePayment.currency === input.plan.currency.toLowerCase() &&
        beforePayment.metadata.hsm_intent === intent.body.id &&
        beforePayment.metadata.hsm_attempt === attemptId,
      'G3_PROVIDER_BINDING_MISMATCH',
    );
    requireUnexpiredAuthority();
    const paid = await provider.paymentIntents.confirm(
      paymentId,
      {
        payment_method: input.testPaymentMethod,
      },
      { idempotencyKey: fixture.key('operator-confirm') },
    );
    check(
      paid.livemode === false &&
        paid.status === 'succeeded' &&
        paid.amount_received === Number(input.plan.priceMinor),
      'G3_PROVIDER_PAYMENT_UNCONFIRMED',
    );
    passed('real-provider-payment');
    const delivery = await bridge.received(input.webhookTimeoutSeconds * 1000);
    const inbox = await prisma.moneyExternalEvent.findFirstOrThrow({
      where: { paymentIntentId: intent.body.id, externalEventId: delivery.eventId },
    });
    check(
      inbox.status === 'RECEIVED' &&
        (await prisma.moneyPaymentConfirmation.count({
          where: { paymentIntentId: intent.body.id },
        })) === 0,
      'G3_INBOX_BEFORE_ACK_FAILED',
    );
    passed('authentic-webhook-before-confirmation');
    const submit = (bytes: Buffer) =>
      fixture.session().request(WEBHOOK_PATH, {
        method: 'POST',
        rawBody: bytes,
        headers: { 'content-type': 'application/json', 'stripe-signature': delivery.signature },
      });
    check(
      (await submit(Buffer.concat([delivery.bytes, Buffer.from(' ')]))).status === 400,
      'G3_RAW_BODY_TAMPER_ACCEPTED',
    );
    const duplicates = await Promise.all([submit(delivery.bytes), submit(delivery.bytes)]);
    check(
      duplicates.every((response) => response.status === 200) &&
        (await prisma.moneyExternalEvent.count({ where: { paymentIntentId: intent.body.id } })) ===
          1,
      'G3_WEBHOOK_REPLAY_DIVERGED',
    );
    passed('raw-body-tamper-and-concurrent-replay');
    const commands = fixture.app.get(MoneyCommandService);
    // Real PostgreSQL failure after participants have run, before commit. This
    // is deliberate transaction fault injection, not a claim of process crash.
    await prisma.$executeRawUnsafe(
      'CREATE FUNCTION g3_external_fail_activation() RETURNS trigger LANGUAGE plpgsql AS ' +
        "'BEGIN IF NEW.\"eventType\" = ''money.subscription.activated.v1'' THEN " +
        "RAISE EXCEPTION ''g3-injected-activation''; END IF; RETURN NEW; END'",
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER g3_external_activation_failure BEFORE INSERT ON "OutboxEvent" ' +
        'FOR EACH ROW EXECUTE FUNCTION g3_external_fail_activation()',
    );
    let rolledBack = false;
    try {
      await commands.processExternalEvent(inbox.id);
    } catch {
      rolledBack = true;
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER g3_external_activation_failure ON "OutboxEvent"',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION g3_external_fail_activation()');
    }
    check(
      rolledBack &&
        (await prisma.moneyPaymentConfirmation.count()) === 0 &&
        (await prisma.subscriptionPeriod.count()) === 0 &&
        (await prisma.ledgerTransaction.count()) === 0,
      'G3_ACTIVATION_PARTIAL_COMMIT',
    );
    passed('activation-transaction-rollback');
    await fixture.app.get(StripeInboxJob).runBatch();
    await Promise.all([
      commands.processExternalEvent(inbox.id),
      commands.processExternalEvent(inbox.id),
    ]);
    const confirmation = await prisma.moneyPaymentConfirmation.findUniqueOrThrow({
      where: { paymentIntentId: intent.body.id },
      include: { period: true },
    });
    check(confirmation.period, 'G3_ATOMIC_PERIOD_MISSING');
    const period = confirmation.period;
    const lines = await prisma.ledgerEntry.findMany({
      where: { transactionId: confirmation.ledgerTransactionId },
    });
    check(
      lines.length === 2 &&
        lines.reduce(
          (sum, line) => sum + (line.side === 'DEBIT' ? line.amountMinor : -line.amountMinor),
          0n,
        ) === 0n &&
        (await prisma.moneyPaymentConfirmation.count()) === 1 &&
        (await prisma.subscriptionPeriod.count()) === 1 &&
        (await prisma.outboxEvent.count({
          where: {
            dedupeKey: 'money.subscription.activated.v1:' + confirmation.id,
          },
        })) === 1,
      'G3_ATOMIC_ACTIVATION_DIVERGED',
    );
    passed('durable-inbox-recovery-and-atomic-activation');
    const fresh = await fixture.login('owner');
    const myPlan = await fresh.request<MoneyMyPlanWireV1>('/v1/money/my-plan');
    check(
      myPlan.status === 200 &&
        myPlan.body.status === 'ACTIVE' &&
        myPlan.body.subscription?.id === period.subscriptionId &&
        myPlan.body.entitlements.some(
          (item) => item.key === usableEntitlement.key && item.allowed,
        ) &&
        myPlan.body.grantsIdentityVerification === false &&
        myPlan.body.grantsWorkAccess === false,
      'G3_PAID_ENTITLEMENT_OR_IDENTITY_BOUNDARY',
    );
    const usage = fixture.app.get(EntitlementUsageService);
    const consumed = await usage.consume(fixture.actors.owner.userId, {
      subscriptionId: period.subscriptionId,
      entitlementKey: usableEntitlement.key,
      usageKey: fixture.key('approved-usage'),
    });
    check(consumed.allowed, 'G3_ENTITLEMENT_UNAVAILABLE');
    passed('fresh-login-and-paid-entitlement');
    const refundBody = {
      ...VERSION,
      paymentConfirmationId: confirmation.id,
      amount: { amountMinor: input.plan.priceMinor, currency: input.plan.currency },
      reasonCode: policy.data.reasonCodes[0]!,
    };
    check(
      (
        await other.request('/v1/money/refund-requests', {
          method: 'POST',
          idempotencyKey: fixture.key('foreign-refund'),
          body: refundBody,
        })
      ).status === 404,
      'G3_REFUND_OWNER_BOUNDARY',
    );
    const requested = await fresh.request<MoneyRefundRequestWireV1>('/v1/money/refund-requests', {
      method: 'POST',
      idempotencyKey: fixture.key('refund-request'),
      body: refundBody,
    });
    check(requested.status === 202, 'G3_REFUND_REQUEST_FAILED');
    requireUnexpiredAuthority();
    const reserved = await reviewer.request<RefundWireV1>(
      '/v1/money/review/refund-requests/' + requested.body.id + '/reserve',
      { method: 'POST', idempotencyKey: fixture.key('reserve'), body: VERSION },
    );
    check(reserved.status === 201, 'G3_APPROVED_REFUND_RESERVATION_FAILED');
    const refundId = reserved.body.id;
    const dispatch = await prisma.moneyDispatch.findUniqueOrThrow({ where: { refundId } });
    const intentEvent = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: refundId, eventType: REFUND_EVENT },
    });
    const untouched = await provider.refunds.list({ payment_intent: paymentId, limit: 10 });
    check(
      dispatch.status === 'NOT_DISPATCHED' &&
        intentEvent.status === 'PENDING' &&
        untouched.data.length === 0,
      'G3_REFUND_DISPATCHED_BEFORE_OUTBOX',
    );
    passed('approved-refund-reservation-and-outbox');
    await prisma.$executeRawUnsafe(
      'CREATE FUNCTION g3_external_fail_refund() RETURNS trigger LANGUAGE plpgsql AS ' +
        "'BEGIN IF NEW.status IN (''CANCELLED'', ''SUSPENDED'') THEN " +
        "RAISE EXCEPTION ''g3-injected-refund''; END IF; RETURN NEW; END'",
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER g3_external_refund_failure BEFORE UPDATE ON "ProviderSubscription" ' +
        'FOR EACH ROW EXECUTE FUNCTION g3_external_fail_refund()',
    );
    let remoteRefund: Stripe.Refund | undefined;
    try {
      const worker = fixture.app.get(OutboxWorker);
      const recovery = fixture.app.get(RefundOrchestratorService);
      await until(
        async () => {
          requireUnexpiredAuthority();
          await worker.runOnce();
          await recovery.recoverBatch(10);
          const row = await prisma.moneyDispatch.findUniqueOrThrow({ where: { refundId } });
          const observation = row.observation as { status?: string } | null;
          return observation?.status === 'SUCCEEDED';
        },
        60_000,
        'G3_PROVIDER_REFUND_UNCONFIRMED',
      );
      const refunds = await provider.refunds.list({ payment_intent: paymentId, limit: 10 });
      check(
        !refunds.has_more &&
          refunds.data.length === 1 &&
          refunds.data[0]!.status === 'succeeded' &&
          refunds.data[0]!.amount === Number(input.plan.priceMinor) &&
          refunds.data[0]!.currency === input.plan.currency.toLowerCase(),
        'G3_INDEPENDENT_REFUND_UNVERIFIED',
      );
      remoteRefund = refunds.data[0]!;
      const local = await prisma.moneyRefund.findUniqueOrThrow({ where: { id: refundId } });
      const subscription = await prisma.providerSubscription.findUniqueOrThrow({
        where: { id: period.subscriptionId },
      });
      check(
        local.status !== 'SUCCEEDED' &&
          local.compensatingLedgerTransactionId === null &&
          subscription.status === 'ACTIVE' &&
          (await prisma.ledgerTransaction.count()) === 1,
        'G3_REFUND_PARTIAL_COMMIT',
      );
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER g3_external_refund_failure ON "ProviderSubscription"',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION g3_external_fail_refund()');
    }
    passed('remote-refund-local-failure-atomicity');
    const query = await reviewer.request('/v1/money/review/refunds/' + refundId + '/query', {
      method: 'POST',
      idempotencyKey: fixture.key('query-after-failure'),
      body: VERSION,
    });
    const recovered = await prisma.moneyRefund.findUniqueOrThrow({ where: { id: refundId } });
    const recoveredDispatch = await prisma.moneyDispatch.findUniqueOrThrow({ where: { refundId } });
    const independentRefunds = await provider.refunds.list({
      payment_intent: paymentId,
      limit: 10,
    });
    check(
      query.status === 202 &&
        recovered.status === 'SUCCEEDED' &&
        recovered.compensatingLedgerTransactionId &&
        recoveredDispatch.providerIdempotencyKey === dispatch.providerIdempotencyKey &&
        independentRefunds.data.length === 1 &&
        !independentRefunds.has_more &&
        independentRefunds.data[0]!.id === remoteRefund!.id,
      'G3_REFUND_RECOVERY_DIVERGED',
    );
    passed('query-recovery-without-second-refund');
    await fixture.app.get(OutboxWorker).runOnce();
    const after = await (
      await fixture.login('owner')
    ).request<MoneyMyPlanWireV1>('/v1/money/my-plan');
    const expected =
      input.refundPolicy.entitlementEffect === 'CANCEL_SUBSCRIPTION' ? 'CANCELLED' : 'SUSPENDED';
    const compensation = await prisma.ledgerEntry.findMany({
      where: { transactionId: recovered.compensatingLedgerTransactionId },
    });
    check(
      after.status === 200 &&
        after.body.status === expected &&
        after.body.entitlements.every((item) => item.allowed === false) &&
        compensation.length === 2 &&
        compensation.reduce(
          (sum, line) => sum + (line.side === 'DEBIT' ? line.amountMinor : -line.amountMinor),
          0n,
        ) === 0n &&
        (await prisma.outboxHandlerRun.count({
          where: {
            eventId: intentEvent.id,
            handler: 'money.refund.dispatch.v1',
          },
        })) === 1 &&
        (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: intentEvent.id } })).status ===
          'PROCESSED',
      'G3_REFUND_EFFECT_OR_OUTBOX_FAILED',
    );
    let denied = false;
    try {
      await usage.consume(fixture.actors.owner.userId, {
        subscriptionId: period.subscriptionId,
        entitlementKey: usableEntitlement.key,
        usageKey: fixture.key('usage-after-refund'),
      });
    } catch {
      denied = true;
    }
    check(denied, 'G3_REFUNDED_ENTITLEMENT_STILL_GRANTED');
    passed('refund-entitlement-and-postcommit-outbox');
    observation = {
      realProviderAccount: true,
      authenticForwardedWebhook: true,
      moneyPortOverrides: 0,
      independentProviderRequests,
      passedScenarios,
      providerPaymentDigest: digest(paymentId),
      providerRefundDigest: digest(remoteRefund!.id),
      webhookDigest: digest(delivery.bytes),
    };
    completed = true;
  } catch (error) {
    failure = new Error(
      error instanceof Error && /^G3_[A-Z_]+$/u.test(error.message)
        ? error.message
        : 'G3_EXTERNAL_EXECUTION_FAILED',
    );
    if (externalOperationMayExist) retainRecoveryIdentity(failure);
  }
  let cleanupFailed = false;
  const cleanup = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch {
      cleanupFailed = true;
    }
  };
  await cleanup(async () => bridge?.close());
  const preserveDatabase = externalOperationMayExist && (!completed || cleanupFailed);
  if (h && preserveDatabase) {
    // Only connections close. The operator retains the original local
    // dispatch keys/evidence for reconciliation before explicit cleanup.
    // Attempt both closures; neither can replace the original fixed failure
    // reason or erase its cached recovery identity.
    await cleanup(() => h!.app.close());
    await cleanup(() => h!.prisma.$disconnect());
  } else {
    await cleanup(async () => h?.dispose());
  }
  if (cleanupFailed && !failure) {
    failure = new Error('G3_EXTERNAL_CLEANUP_FAILED');
    if (preserveDatabase) retainRecoveryIdentity(failure);
  }
  if (failure) throw failure;
  check(observation, 'G3_EXTERNAL_EXECUTION_FAILED');
  return observation;
}
