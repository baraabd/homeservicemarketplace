import type {
  MoneyCommandAcceptedV1,
  MoneyRefundRequestWireV1,
  PaymentIntentWireV1,
  RefundWireV1,
} from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { randomUUID } from 'node:crypto';

import { OutboxRepository } from '../../src/infrastructure/outbox/outbox.repository';
import { OutboxWorker } from '../../src/infrastructure/outbox/outbox.worker';
import { AuditService } from '../../src/modules/iam/audit/audit.service';
import { PermissionResolverService } from '../../src/modules/iam/authorization/services/permission-resolver.service';
import { MoneyCommandService } from '../../src/modules/money/application/money-command.service';
import { LedgerService } from '../../src/modules/money/ledger/ledger.service';
import {
  MONEY_ACTIVATION_PARTICIPANT,
  type MoneyActivationParticipantPort,
} from '../../src/modules/money/ports/activation.port';
import {
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
  type MoneyBindingConfiguration,
  type MoneyCollectionAdapterPort,
  type MoneyCollectionCommand,
  type MoneyConfigurationPort,
  type MoneyExternalEventInput,
  type NormalizedMoneyExternalEvent,
} from '../../src/modules/money/ports/collection.port';
import {
  MONEY_REFUND_ADAPTER,
  MONEY_REFUND_CONFIRMATION_PARTICIPANT,
  MONEY_REFUND_POLICY,
  type MoneyConfirmedRefund,
  type MoneyRefundAdapterPort,
  type MoneyRefundConfirmationParticipantPort,
  type MoneyRefundObservation,
  type MoneyRefundPolicyPort,
  type MoneyRefundTransportCommand,
} from '../../src/modules/money/ports/refund.port';
import { RefundOutboxConsumer } from '../../src/modules/money/recovery/refund-outbox.consumer';
import type {
  RefundRecoveryInspection,
  RefundRecoveryResult,
} from '../../src/modules/money/recovery/refund-recovery.service';
import { RefundOrchestratorService } from '../../src/modules/money/refunds/refund-orchestrator.service';
import {
  RefundEligibilityPolicy,
  type ApprovedRefundPolicy,
  type RefundPolicySourcePort,
} from '../../src/modules/money/refunds/refund-eligibility.policy';
import {
  R24_PERMISSIONS,
  r24MoneyHttpFixture,
  type R24HttpSession,
  type R24MoneyHttpFixture,
} from '../support/r24-money-http.fixture';

// The application, authorization, HTTP, PostgreSQL, Redis, migrations, ledger,
// audit, outbox and eligibility evaluator are real. Payment transports and
// commercial-policy source/consequence are explicitly synthetic CONTRACT
// COMPONENTS. XTS is test currency;
// these tests establish neither a returned rail payment nor live policy.
const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
const VERSION = 'hsm.money.v1' as const;
const BODY = { contractVersion: VERSION };
const REFUND_EVENT = 'money.refund.dispatch-requested.v1';
const POLICY_VERSION = 'r32-contract-component-policy-v1';

class ConfigurationComponent implements MoneyConfigurationPort {
  available = true;
  binding!: MoneyBindingConfiguration;
  async resolve(): Promise<MoneyBindingConfiguration | null> {
    return this.available ? this.binding : null;
  }
}

class CollectionComponent implements MoneyCollectionAdapterPort {
  events = new Map<string, NormalizedMoneyExternalEvent>();
  isConfigured(): boolean {
    return true;
  }
  async createOrResume(command: MoneyCollectionCommand) {
    return {
      status: 'PENDING' as const,
      externalOperationId: `r32-collection-${command.paymentAttemptId}`,
    };
  }
  async validateAndNormalizeExternalEvent(input: MoneyExternalEventInput) {
    const event = this.events.get(String(input.payload));
    if (!event) throw new Error('Unknown synthetic R32 collection proof');
    return event;
  }
}

class ActivationComponent implements MoneyActivationParticipantPort {
  isConfigured(): boolean {
    return true;
  }
  async activatePeriod(): Promise<void> {
    // R31's actual entitlement policy is deliberately outside this component.
  }
}

class ReservationPolicyComponent implements MoneyRefundPolicyPort {
  delegate!: MoneyRefundPolicyPort;
  async authorizeReservation(
    input: Parameters<MoneyRefundPolicyPort['authorizeReservation']>[0],
    tx: PrismaTx,
  ): Promise<{ policyVersion: string }> {
    return this.delegate.authorizeReservation(input, tx);
  }
}

class PolicySourceComponent implements RefundPolicySourcePort {
  policy: ApprovedRefundPolicy | null = null;
  async resolve(): Promise<ApprovedRefundPolicy | null> {
    return this.policy;
  }
}

class ConfirmationComponent implements MoneyRefundConfirmationParticipantPort {
  configured = true;
  fail = false;
  calls: MoneyConfirmedRefund[] = [];
  isConfigured(): boolean {
    return this.configured;
  }
  async applyConfirmedRefund(input: MoneyConfirmedRefund, tx: PrismaTx): Promise<void> {
    this.calls.push(structuredClone(input));
    const request = await tx.moneyRefundRequest.findUniqueOrThrow({
      where: { id: input.refundRequestId },
    });
    expect(request.policyVersion).toBe(POLICY_VERSION);
    expect(input.policyVersion).toBe(POLICY_VERSION);
    expect(request.refundId).toBe(input.refundId);
    expect(request.amountMinor.toString()).toBe(input.amount.amountMinor);
    expect(
      await tx.ledgerTransaction.findUniqueOrThrow({
        where: { id: input.compensatingLedgerTransactionId },
      }),
    ).toMatchObject({ status: 'POSTED', kind: 'STANDARD' });
    // A committed marker makes transaction participation observable. It is not
    // an entitlement, provider grant, balance, or substitute commercial policy.
    await tx.platformSetting.create({
      data: { key: `it-r32-consequence:${input.refundId}`, value: { ...input } },
    });
    if (this.fail) throw new Error('r32-private-consequence-failure-sentinel');
  }
}

type CallKind = 'submit' | 'query';
class RefundRailComponent implements MoneyRefundAdapterPort {
  configured = true;
  submitStatus: MoneyRefundObservation['status'] | 'TIMEOUT' | 'SUCCESS_RESPONSE_LOST' = 'PENDING';
  queryStatus: MoneyRefundObservation['status'] = 'PENDING';
  calls: Array<{ kind: CallKind; command: MoneyRefundTransportCommand }> = [];
  remembered = new Map<string, MoneyRefundObservation>();
  beforeTransport?: (kind: CallKind, command: MoneyRefundTransportCommand) => Promise<void>;
  isConfigured(): boolean {
    return this.configured;
  }
  observation(command: MoneyRefundTransportCommand, status: MoneyRefundObservation['status']) {
    return {
      status,
      refundId: command.refundId,
      paymentConfirmationId: command.paymentConfirmationId,
      adapterId: command.binding.adapterId,
      mode: command.binding.mode,
      accountReference: command.binding.accountReference,
      amount: command.amount,
      externalOperationId: command.externalOperationId ?? `r32-return-${command.refundId}`,
    } satisfies MoneyRefundObservation;
  }
  async submit(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation> {
    this.calls.push({ kind: 'submit', command: structuredClone(command) });
    await this.beforeTransport?.('submit', command);
    if (this.submitStatus === 'SUCCESS_RESPONSE_LOST') {
      this.remembered.set(command.refundId, this.observation(command, 'SUCCEEDED'));
      throw new Error('r32-private-transport-response-loss-sentinel');
    }
    if (this.submitStatus === 'TIMEOUT') {
      throw new Error('r32-private-transport-timeout-sentinel');
    }
    return this.observation(command, this.submitStatus);
  }
  async query(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation> {
    this.calls.push({ kind: 'query', command: structuredClone(command) });
    await this.beforeTransport?.('query', command);
    return this.remembered.get(command.refundId) ?? this.observation(command, this.queryStatus);
  }
}

dbDescribe(
  'R32 durable refund recovery (real HTTP/PostgreSQL/Redis; contract rail components)',
  () => {
    let h: R24MoneyHttpFixture;
    let owner: R24HttpSession;
    let reviewer: R24HttpSession;
    let secondReviewer: R24HttpSession;
    let commands: MoneyCommandService;
    let consumer: RefundOutboxConsumer;
    const configuration = new ConfigurationComponent();
    const collection = new CollectionComponent();
    const consequence = new ConfirmationComponent();
    const rail = new RefundRailComponent();
    const policy = new ReservationPolicyComponent();
    const policySource = new PolicySourceComponent();
    let planId: string;

    beforeAll(async () => {
      h = await r24MoneyHttpFixture({
        adapters: [
          { token: MONEY_CONFIGURATION, value: configuration },
          { token: MONEY_COLLECTION_ADAPTER, value: collection },
          { token: MONEY_ACTIVATION_PARTICIPANT, value: new ActivationComponent() },
          { token: MONEY_REFUND_POLICY, value: policy },
          { token: MONEY_REFUND_ADAPTER, value: rail },
          { token: MONEY_REFUND_CONFIRMATION_PARTICIPANT, value: consequence },
        ],
      });
      commands = h.app.get(MoneyCommandService);
      consumer = h.app.get(RefundOutboxConsumer);
      policy.delegate = new RefundEligibilityPolicy(
        policySource,
        h.app.get(PermissionResolverService),
      );
      const ledger = h.app.get(LedgerService);
      const accounts = await Promise.all(
        ['clearing', 'subscription-revenue'].map((name) =>
          ledger.openAccount(
            { kind: 'SYSTEM', system: 'r32.contract-component' },
            { key: `${h.prefix}${name}`, ownerType: 'PLATFORM', currency: 'XTS' },
          ),
        ),
      );
      const plan = await h.prisma.subscriptionPlanVersion.create({
        data: {
          planKey: `${h.prefix}r32-plan`,
          version: 1,
          billingInterval: 'MONTHLY',
          priceMinor: 1000n,
          currency: 'XTS',
          entitlements: [],
          publishedAt: new Date(Date.now() - 86_400_000),
        },
      });
      planId = plan.id;
      configuration.binding = {
        planVersionId: plan.id,
        method: 'STRIPE',
        currency: 'XTS',
        adapterId: 'r32-contract-component',
        mode: 'SANDBOX',
        accountReference: 'r32-private-account-reference',
        debitAccountId: accounts[0]!.account.id,
        creditAccountId: accounts[1]!.account.id,
        configVersion: 'r32-contract-component-v1',
        quoteTtlSeconds: 3600,
      };
      owner = await h.login('owner');
      reviewer = await h.login('reviewer');
      // This isolated fixture's otherwise unused actor becomes reviewer B
      // through real role/grant records and a newly issued authenticated session.
      const admin = await h.prisma.role.findUniqueOrThrow({ where: { name: 'admin' } });
      await h.prisma.userRole.create({
        data: { userId: h.actors.noPermission.userId, roleId: admin.id },
      });
      await h.grant('noPermission', R24_PERMISSIONS.review);
      await h.grant('noPermission', R24_PERMISSIONS.refundReview);
      secondReviewer = await h.login('noPermission');
    }, 120_000);

    beforeEach(() => {
      configuration.available = true;
      consequence.configured = true;
      consequence.fail = false;
      consequence.calls = [];
      rail.configured = true;
      rail.submitStatus = 'PENDING';
      rail.queryStatus = 'PENDING';
      rail.calls = [];
      rail.beforeTransport = undefined;
      policySource.policy = {
        version: POLICY_VERSION,
        approvalReference: 'synthetic-component-only-not-commercial-approval',
        mode: 'SANDBOX',
        planVersionId: planId,
        method: 'STRIPE',
        currency: 'XTS',
        reasonCodes: ['R32_CONTRACT_COMPONENT'],
        refundWindowSeconds: null,
        allowPartial: true,
        requireRequesterReviewerSeparation: true,
        requireOriginalReviewerSeparation: true,
        feeTreatment: 'NO_DEDUCTION',
        taxTreatment: 'NO_ADJUSTMENT',
        proRataTreatment: 'NONE',
        entitlementPolicyVersion: 'r32-synthetic-consequence-v1',
      };
    });

    afterAll(async () => {
      await h?.dispose();
    }, 30_000);

    async function paid(confirmedAt = new Date()) {
      const created = await owner.request<PaymentIntentWireV1>('/v1/money/intents', {
        method: 'POST',
        idempotencyKey: h.key('r32-intent'),
        body: { ...BODY, planVersionId: planId, method: 'STRIPE' },
      });
      expect(created.status).toBe(201);
      const intent = created.body;
      const started = await owner.request<MoneyCommandAcceptedV1>(
        `/v1/money/intents/${intent.id}/attempts`,
        { method: 'POST', idempotencyKey: h.key('r32-collection'), body: BODY },
      );
      expect(started.status).toBe(202);
      const event: NormalizedMoneyExternalEvent = {
        contractVersion: VERSION,
        adapterId: configuration.binding.adapterId,
        mode: 'SANDBOX',
        accountReference: configuration.binding.accountReference,
        externalEventId: `r32-event-${randomUUID()}`,
        externalConfirmationId: `r32-confirmation-${randomUUID()}`,
        externalOperationId: `r32-collection-${started.body.resourceId}`,
        paymentIntentId: intent.id,
        paymentAttemptId: started.body.resourceId,
        source: 'PROVIDER_WEBHOOK',
        amount: intent.total,
        confirmedAt: confirmedAt.toISOString(),
        receiptMediaAssetId: null,
        reviewerUserId: null,
      };
      collection.events.set(event.externalEventId, event);
      const accepted = await commands.acceptExternalEvent({
        adapterId: event.adapterId,
        mode: event.mode,
        accountReference: event.accountReference,
        payload: event.externalEventId,
        headers: {},
      });
      const confirmed = await commands.processExternalEvent(accepted.eventId);
      return { intent, confirmationId: confirmed.paymentConfirmationId };
    }

    async function request(confirmationId: string, amountMinor = '200') {
      const response = await owner.request<MoneyRefundRequestWireV1>('/v1/money/refund-requests', {
        method: 'POST',
        idempotencyKey: h.key('r32-request'),
        body: {
          ...BODY,
          paymentConfirmationId: confirmationId,
          amount: { amountMinor, currency: 'XTS' },
          reasonCode: 'R32_CONTRACT_COMPONENT',
        },
      });
      expect(response.status).toBe(202);
      return response.body;
    }

    function reserveResponse(requestId: string, key = h.key('r32-reserve')) {
      return reviewer.request<RefundWireV1>(
        `/v1/money/review/refund-requests/${requestId}/reserve`,
        { method: 'POST', idempotencyKey: key, body: BODY },
      );
    }

    async function reserve(requestId: string, key?: string) {
      const response = await reserveResponse(requestId, key);
      expect(response.status).toBe(201);
      return response.body;
    }

    async function reserved(amountMinor = '200') {
      const original = await paid();
      const requested = await request(original.confirmationId, amountMinor);
      const refund = await reserve(requested.id);
      return { ...original, requested, refund };
    }

    async function dispatch(id: string) {
      const response = await reviewer.request<MoneyCommandAcceptedV1>(
        `/v1/money/review/refunds/${id}/dispatch`,
        { method: 'POST', idempotencyKey: h.key('r32-dispatch'), body: BODY },
      );
      expect(response.status).toBe(202);
      return response.body;
    }

    async function row(id: string) {
      return h.prisma.moneyRefund.findUniqueOrThrow({ where: { id } });
    }

    async function dispatchRow(refundId: string) {
      return h.prisma.moneyDispatch.findUniqueOrThrow({ where: { refundId } });
    }

    async function marker(refundId: string) {
      return h.prisma.platformSetting.findUnique({
        where: { key: `it-r32-consequence:${refundId}` },
      });
    }

    async function reverseOriginal(confirmationId: string) {
      const confirmation = await h.prisma.moneyPaymentConfirmation.findUniqueOrThrow({
        where: { id: confirmationId },
      });
      const reversal = await h.app.get(LedgerService).reverse(
        { kind: 'SYSTEM', system: 'r32.contract-component' },
        {
          transactionId: confirmation.ledgerTransactionId,
          idempotencyKey: h.key('r32-original-reversal'),
          description: 'Synthetic R32 original reversal fence',
        },
      );
      expect(reversal.transaction).toMatchObject({
        status: 'POSTED',
        kind: 'REVERSAL',
        reversesTransactionId: confirmation.ledgerTransactionId,
      });
      return reversal;
    }

    async function snapshot() {
      const [refunds, dispatches, events, audit, postings, lines, requests, commandRows, markers] =
        await Promise.all([
          h.prisma.moneyRefund.count(),
          h.prisma.moneyDispatch.count({ where: { kind: 'REFUND' } }),
          h.prisma.outboxEvent.count({ where: { eventType: REFUND_EVENT } }),
          h.prisma.auditEvent.count(),
          h.prisma.ledgerTransaction.count(),
          h.prisma.ledgerEntry.count(),
          h.prisma.moneyRefundRequest.count(),
          h.prisma.moneyCommand.count(),
          h.prisma.platformSetting.count({ where: { key: { startsWith: 'it-r32-consequence:' } } }),
        ]);
      return {
        refunds,
        dispatches,
        events,
        audit,
        postings,
        lines,
        requests,
        commandRows,
        markers,
      };
    }

    it('recovers committed reservations when the outbox after-commit callback was lost', async () => {
      const { refund } = await reserved();
      const event = await h.prisma.outboxEvent.findFirstOrThrow({
        where: { aggregateId: refund.id, eventType: REFUND_EVENT },
      });
      expect(event.payload).toMatchObject({ refundId: refund.id, commandId: expect.any(String) });
      const orchestrator = h.app.get(RefundOrchestratorService);
      let lostCallback = false;
      const original = orchestrator.deliver.bind(orchestrator);
      const failure = jest
        .spyOn(orchestrator, 'deliver')
        .mockImplementation(async (id, commandId) => {
          if (id === refund.id) {
            lostCallback = true;
            throw new Error('Synthetic crash before the after-commit transport call');
          }
          return original(id, commandId);
        });
      try {
        await h.app.get(OutboxWorker).runOnce();
      } finally {
        failure.mockRestore();
      }
      expect(lostCallback).toBe(true);
      expect(
        await h.prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
      ).toMatchObject({ status: 'PROCESSED' });
      expect(
        await h.prisma.outboxHandlerRun.count({
          where: { eventId: event.id, handler: consumer.name },
        }),
      ).toBe(1);
      expect(rail.calls).toHaveLength(0);
      // R22 has committed its handler marker and processed event. The separate
      // durable dispatch scanner must still finish after callback loss.
      rail.submitStatus = 'SUCCEEDED';
      await orchestrator.recoverBatch(10);
      expect(await row(refund.id)).toMatchObject({ status: 'SUCCEEDED' });
      expect(await marker(refund.id)).not.toBeNull();
      expect(rail.calls.map((call) => call.kind)).toEqual(['submit']);
    });

    it('rejects untouched queries at every recovery boundary and preserves the first submit', async () => {
      const { refund, confirmationId } = await reserved();
      const route = `/v1/money/review/refunds/${refund.id}/recovery`;
      const inspection = await reviewer.request<RefundRecoveryInspection>(
        `${route}?paymentConfirmationId=${confirmationId}`,
      );
      expect(inspection.status).toBe(200);
      expect(inspection.body.allowedOperations).toEqual(['DISPATCH']);
      const initial = await dispatchRow(refund.id);
      const before = await snapshot();
      const input = {
        ...BODY,
        paymentConfirmationId: confirmationId,
        expectedStateRevision: inspection.body.stateRevision,
        operation: 'QUERY',
        approvalReference: 'r32-untouched-query-regression',
      };
      for (const dryRun of [true, false]) {
        const response = await reviewer.request(route, {
          method: 'POST',
          idempotencyKey: h.key('r32-untouched-recovery'),
          body: { ...input, dryRun },
        });
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({
          error: { details: { reason: 'MONEY_REFUND_NOT_DISPATCHED' } },
        });
      }
      const direct = await reviewer.request(`/v1/money/review/refunds/${refund.id}/query`, {
        method: 'POST',
        idempotencyKey: h.key('r32-untouched-direct'),
        body: BODY,
      });
      expect(direct.status).toBe(409);
      expect(direct.body).toMatchObject({
        error: { details: { reason: 'MONEY_REFUND_NOT_DISPATCHED' } },
      });
      await expect(commands.deliverRefund(refund.id, undefined, true)).rejects.toMatchObject({
        details: { reason: 'MONEY_REFUND_NOT_DISPATCHED' },
      });
      expect(await dispatchRow(refund.id)).toEqual(initial);
      expect(await row(refund.id)).toMatchObject({ status: 'RESERVED' });
      const after = await snapshot();
      expect(after.commandRows).toBe(before.commandRows);
      expect(after.events).toBe(before.events);
      expect(after.postings).toBe(before.postings);
      expect(rail.calls).toEqual([]);
      rail.submitStatus = 'SUCCEEDED';
      await dispatch(refund.id);
      expect(rail.calls.map((call) => call.kind)).toEqual(['submit']);
      expect(rail.calls[0]!.command.providerIdempotencyKey).toBe(initial.providerIdempotencyKey);
      expect(await row(refund.id)).toMatchObject({ status: 'SUCCEEDED' });
      expect(await marker(refund.id)).not.toBeNull();
    });

    it.each(['QUERY', 'DISPATCH'] as const)(
      'recovers a later reviewer B %s command after reviewer A is revoked and both delivery callbacks are lost',
      async (operation) => {
        const { refund } = await reserved();
        if (operation === 'QUERY') {
          // A later QUERY is valid only after a real, possibly delivered attempt.
          rail.submitStatus = 'TIMEOUT';
          await commands.deliverRefund(refund.id);
          expect((await dispatchRow(refund.id)).status).toBe('UNKNOWN');
          expect(rail.calls.map((call) => call.kind)).toEqual(['submit']);
          rail.calls.length = 0; // Count the subsequent reviewer recovery separately.
        }
        const initial = await dispatchRow(refund.id);
        const orchestrator = h.app.get(RefundOrchestratorService);
        await h.revoke('reviewer', R24_PERMISSIONS.refundReview);
        try {
          const accelerator = jest
            .spyOn(commands, 'deliverRefund')
            .mockResolvedValueOnce(undefined);
          let acceptedCommand!: MoneyCommandAcceptedV1;
          try {
            const response = await secondReviewer.request<MoneyCommandAcceptedV1>(
              `/v1/money/review/refunds/${refund.id}/${operation.toLowerCase()}`,
              { method: 'POST', idempotencyKey: h.key('r32-reviewer-b'), body: BODY },
            );
            expect(response.status).toBe(202);
            acceptedCommand = response.body;
          } finally {
            accelerator.mockRestore();
          }
          expect(
            await h.prisma.moneyCommand.findUniqueOrThrow({
              where: { id: acceptedCommand.commandId },
            }),
          ).toMatchObject({
            actorUserId: h.actors.noPermission.userId,
            action: `${operation}_REFUND`,
          });
          const lostCallbacks = jest
            .spyOn(orchestrator, 'deliver')
            .mockRejectedValue(
              new Error('Synthetic loss after the outbox handler transaction committed'),
            );
          try {
            await h.app.get(OutboxWorker).runOnce();
          } finally {
            lostCallbacks.mockRestore();
          }
          const events = await h.prisma.outboxEvent.findMany({
            where: { aggregateId: refund.id, eventType: REFUND_EVENT },
          });
          expect(events).toHaveLength(2);
          expect(events.every((event) => event.status === 'PROCESSED')).toBe(true);
          expect(rail.calls).toHaveLength(0);
          expect(await dispatchRow(refund.id)).toMatchObject({
            commandId: initial.commandId,
            providerIdempotencyKey: initial.providerIdempotencyKey,
            status: operation === 'QUERY' ? 'UNKNOWN' : 'NOT_DISPATCHED',
          });
          rail.queryStatus = 'SUCCEEDED';
          rail.submitStatus = 'SUCCEEDED';
          await orchestrator.recoverBatch(10);
          expect(rail.calls.map((call) => call.kind)).toEqual([
            operation === 'QUERY' ? 'query' : 'submit',
          ]);
          expect(rail.calls[0]!.command.providerIdempotencyKey).toBe(
            initial.providerIdempotencyKey,
          );
          expect(await row(refund.id)).toMatchObject({ status: 'SUCCEEDED' });
          expect(await marker(refund.id)).not.toBeNull();
        } finally {
          await h.grant('reviewer', R24_PERMISSIONS.refundReview);
        }
      },
    );

    it('enforces scoped HTTP recovery, CSRF, approval and revision while dry-run never dispatches', async () => {
      const { refund, confirmationId } = await reserved();
      const route = `/v1/money/review/refunds/${refund.id}/recovery`;
      const scoped = `${route}?paymentConfirmationId=${confirmationId}`;
      expect((await h.session().request(scoped)).status).toBe(401);
      expect((await owner.request(scoped)).status).toBe(403);
      expect((await reviewer.request(route)).status).toBe(400);
      expect(
        (await reviewer.request(`${route}?paymentConfirmationId=r32-unrelated-confirmation`))
          .status,
      ).toBe(404);
      const inspection = await reviewer.request<RefundRecoveryInspection>(scoped);
      expect(inspection.status).toBe(200);
      expect(inspection.body).toMatchObject({
        state: 'RESERVED',
        diagnosticCode: 'READY_FOR_DISPATCH',
        reservationHeld: true,
        automaticReservationRelease: false,
      });
      expect(inspection.body.stateRevision).toMatch(/^[a-f0-9]{64}$/u);
      const input = {
        ...BODY,
        paymentConfirmationId: confirmationId,
        expectedStateRevision: inspection.body.stateRevision,
        operation: 'DISPATCH',
      };
      const before = await snapshot();
      const dryRun = await reviewer.request<RefundRecoveryResult>(route, {
        method: 'POST',
        idempotencyKey: h.key('r32-recovery-dry-run'),
        body: input,
      });
      expect(dryRun.status).toBe(201);
      expect(dryRun.body).toMatchObject({ dryRun: true, outcome: 'DRY_RUN' });
      expect(dryRun.body.inspection.stateRevision).toBe(inspection.body.stateRevision);
      const after = await snapshot();
      expect(after.commandRows).toBe(before.commandRows);
      expect(after.postings).toBe(before.postings);
      expect(after.lines).toBe(before.lines);
      expect(after.markers).toBe(before.markers);
      expect(rail.calls).toHaveLength(0);

      expect(
        (
          await reviewer.request(route, {
            method: 'POST',
            idempotencyKey: h.key('r32-recovery-missing-approval'),
            body: { ...input, dryRun: false },
          })
        ).status,
      ).toBe(400);
      const execution = {
        ...input,
        dryRun: false,
        approvalReference: 'r32-synthetic-component-review-ticket',
      };
      expect(
        (
          await reviewer.request(route, {
            method: 'POST',
            csrf: false,
            idempotencyKey: h.key('r32-recovery-no-csrf'),
            body: execution,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await reviewer.request(route, {
            method: 'POST',
            idempotencyKey: h.key('r32-recovery-stale'),
            body: { ...execution, expectedStateRevision: '0'.repeat(64) },
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await reviewer.request(route, {
            method: 'POST',
            idempotencyKey: h.key('r32-recovery-forged-actor'),
            body: { ...execution, actorUserId: h.actors.owner.userId },
          })
        ).status,
      ).toBe(400);
      expect(rail.calls).toHaveLength(0);
      rail.submitStatus = 'SUCCEEDED';
      const key = h.key('r32-recovery-approved');
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await reviewer.request<RefundRecoveryResult>(route, {
          method: 'POST',
          idempotencyKey: key,
          body: execution,
        });
        expect(result.status).toBe(201);
        expect(result.body).toMatchObject({
          dryRun: false,
          outcome: 'CONFIRMED_SUCCEEDED',
          inspection: { reservationHeld: false, allowedOperations: [] },
        });
      }
      expect(rail.calls.map((call) => call.kind)).toEqual(['submit']);
      expect(consequence.calls).toHaveLength(1);
    });

    it('commits reservation, approval, command, audit and one outbox event before transport and releases DB locks', async () => {
      const { confirmationId } = await paid();
      const requested = await request(confirmationId);
      const key = h.key('r32-reservation-replay');
      const refund = await reserve(requested.id, key);
      expect(await reserve(requested.id, key)).toEqual(refund);
      expect(rail.calls).toHaveLength(0);
      let verifiedOutsideTransaction = false;
      rail.beforeTransport = async (_kind, command) => {
        const durable = await dispatchRow(refund.id);
        const accepted = await h.prisma.moneyCommand.findUniqueOrThrow({
          where: { id: durable.commandId },
        });
        expect(accepted).toMatchObject({
          action: 'RESERVE_REFUND',
          actorUserId: h.actors.reviewer.userId,
        });
        expect(command.providerIdempotencyKey).toBe(durable.providerIdempotencyKey);
        expect(
          await h.prisma.outboxEvent.count({
            where: { aggregateId: refund.id, eventType: REFUND_EVENT },
          }),
        ).toBe(1);
        expect(
          await h.prisma.auditEvent.count({
            where: {
              type: 'MONEY_COMMAND_ACCEPTED',
              metadata: { path: ['moneyCommandId'], equals: accepted.id },
            },
          }),
        ).toBe(1);
        await h.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "MoneyPaymentConfirmation" WHERE "id" = ${confirmationId} FOR UPDATE NOWAIT`;
          await tx.$queryRaw`SELECT "id" FROM "MoneyRefund" WHERE "id" = ${refund.id} FOR UPDATE NOWAIT`;
        });
        verifiedOutsideTransaction = true;
      };
      rail.submitStatus = 'SUCCEEDED';
      await commands.deliverRefund(refund.id);
      expect(verifiedOutsideTransaction).toBe(true);
      expect(await row(refund.id)).toMatchObject({ status: 'SUCCEEDED' });
    });

    it('rolls back a requested refund and its command when request audit fails', async () => {
      const { confirmationId } = await paid();
      const before = await snapshot();
      const audit = h.app.get(AuditService);
      const original = audit.record.bind(audit);
      const fail = jest.spyOn(audit, 'record').mockImplementation(async (event, tx) => {
        if (event.metadata?.moneyAction === 'REQUEST_REFUND')
          throw new Error('r32-private-request-audit');
        return original(event, tx);
      });
      try {
        const response = await owner.request('/v1/money/refund-requests', {
          method: 'POST',
          idempotencyKey: h.key('r32-request-audit'),
          body: {
            ...BODY,
            paymentConfirmationId: confirmationId,
            amount: { amountMinor: '200', currency: 'XTS' },
            reasonCode: 'R32_CONTRACT_COMPONENT',
          },
        });
        expect(response.status).toBe(500);
        expect(JSON.stringify(response.body)).not.toContain('r32-private-request-audit');
      } finally {
        fail.mockRestore();
      }
      expect(await snapshot()).toEqual(before);
      expect(rail.calls).toHaveLength(0);
    });

    it.each(['audit', 'outbox'] as const)(
      'rolls back the reservation and durable dispatch when %s fails',
      async (fault) => {
        const { confirmationId } = await paid();
        const requested = await request(confirmationId);
        const before = await snapshot();
        const audit = h.app.get(AuditService);
        const outbox = h.app.get(OutboxRepository);
        const record = audit.record.bind(audit);
        const enqueue = outbox.enqueue.bind(outbox);
        const auditSpy = jest.spyOn(audit, 'record').mockImplementation(async (event, tx) => {
          if (fault === 'audit' && event.metadata?.moneyAction === 'RESERVE_REFUND')
            throw new Error('r32-private-reservation-audit');
          return record(event, tx);
        });
        const outboxSpy = jest.spyOn(outbox, 'enqueue').mockImplementation(async (event, tx) => {
          if (fault === 'outbox' && event.eventType === REFUND_EVENT)
            throw new Error('r32-private-reservation-outbox');
          return enqueue(event, tx);
        });
        try {
          const response = await reserveResponse(requested.id);
          expect(response.status).toBe(500);
          expect(JSON.stringify(response.body)).not.toContain('r32-private-reservation');
        } finally {
          auditSpy.mockRestore();
          outboxSpy.mockRestore();
        }
        expect(await snapshot()).toEqual(before);
        expect(
          await h.prisma.moneyRefundRequest.findUniqueOrThrow({ where: { id: requested.id } }),
        ).toMatchObject({ status: 'PENDING_POLICY', refundId: null });
        expect(rail.calls).toHaveLength(0);
      },
    );

    it('fails closed without a policy source and leaves a requested refund unreserved', async () => {
      const { confirmationId } = await paid();
      const requested = await request(confirmationId);
      const before = await snapshot();
      policySource.policy = null;
      const response = await reserveResponse(requested.id);
      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          details: { reason: 'MONEY_REFUND_POLICY_UNAVAILABLE' },
        },
      });
      expect(await snapshot()).toEqual(before);
      expect(rail.calls).toHaveLength(0);
    });

    it('rechecks the original requester permission during reservation using real authorization data', async () => {
      const { confirmationId } = await paid();
      const requested = await request(confirmationId);
      const before = await snapshot();
      await h.revoke('owner', R24_PERMISSIONS.requestRefund);
      try {
        const response = await reserveResponse(requested.id);
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
        expect(await snapshot()).toEqual(before);
      } finally {
        await h.grant('owner', R24_PERMISSIONS.requestRefund);
      }
      expect(rail.calls).toHaveLength(0);
    });

    it('enforces an explicitly full-only policy instead of inferring permission for a partial refund', async () => {
      const { confirmationId } = await paid();
      const requested = await request(confirmationId, '200');
      policySource.policy = { ...policySource.policy!, allowPartial: false };
      const response = await reserveResponse(requested.id);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        error: { code: 'CONFLICT', details: { reason: 'MONEY_REFUND_PARTIAL_NOT_APPROVED' } },
      });
      expect(
        await h.prisma.moneyRefund.count({ where: { paymentConfirmationId: confirmationId } }),
      ).toBe(0);
      expect(rail.calls).toHaveLength(0);
    });

    it('enforces an explicit refund window against the authoritative confirmation and PostgreSQL clock', async () => {
      const { confirmationId } = await paid(new Date(Date.now() - 120_000));
      const requested = await request(confirmationId);
      policySource.policy = { ...policySource.policy!, refundWindowSeconds: 60 };
      const response = await reserveResponse(requested.id);
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        error: { code: 'CONFLICT', details: { reason: 'MONEY_REFUND_WINDOW_CLOSED' } },
      });
      expect(
        await h.prisma.moneyRefund.count({ where: { paymentConfirmationId: confirmationId } }),
      ).toBe(0);
      expect(rail.calls).toHaveLength(0);
    });

    it('reserves concurrent partial requests only up to paid capacity and never releases pending or unknown amounts', async () => {
      const { confirmationId } = await paid();
      const requests = await Promise.all([
        request(confirmationId, '600'),
        request(confirmationId, '600'),
      ]);
      const results = await Promise.all(requests.map((candidate) => reserveResponse(candidate.id)));
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      const refund = results.find((result) => result.status === 201)!.body;
      rail.submitStatus = 'TIMEOUT';
      await commands.deliverRefund(refund.id);
      expect(await dispatchRow(refund.id)).toMatchObject({ status: 'UNKNOWN' });
      const remainder = await request(confirmationId, '401');
      expect((await reserveResponse(remainder.id)).status).toBe(409);
      rail.queryStatus = 'PENDING';
      await commands.deliverRefund(refund.id);
      expect(await dispatchRow(refund.id)).toMatchObject({ status: 'PENDING' });
      expect((await reserveResponse(remainder.id)).status).toBe(409);
      const total = await h.prisma.moneyRefund.aggregate({
        where: { paymentConfirmationId: confirmationId },
        _sum: { amountMinor: true },
      });
      expect(total._sum.amountMinor).toBe(600n);
      expect(await marker(refund.id)).toBeNull();
    });

    it('queries a successful response-lost operation with the original outbound key even when HTTP requests dispatch again', async () => {
      const { refund } = await reserved();
      rail.submitStatus = 'SUCCESS_RESPONSE_LOST';
      await dispatch(refund.id);
      expect(await dispatchRow(refund.id)).toMatchObject({ status: 'UNKNOWN' });
      expect(await row(refund.id)).toMatchObject({
        status: 'RESERVED',
        compensatingLedgerTransactionId: null,
      });
      expect(await marker(refund.id)).toBeNull();
      await dispatch(refund.id);
      expect(rail.calls.map((call) => call.kind)).toEqual(['submit', 'query']);
      expect(new Set(rail.calls.map((call) => call.command.providerIdempotencyKey)).size).toBe(1);
      expect(await row(refund.id)).toMatchObject({ status: 'SUCCEEDED' });
      expect(consequence.calls).toHaveLength(1);
      expect(JSON.stringify((await dispatchRow(refund.id)).observation)).not.toContain(
        'r32-private-transport',
      );
    });

    it('queries an expired claimed attempt after a simulated crash before the outbound call and preserves its reservation', async () => {
      const { refund, confirmationId } = await reserved('1000');
      await h.prisma.moneyDispatch.update({
        where: { refundId: refund.id },
        data: { status: 'PENDING', claimId: randomUUID(), leaseUntil: new Date(0) },
      });
      rail.queryStatus = 'UNKNOWN';
      await commands.deliverRefund(refund.id);
      await commands.deliverRefund(refund.id);
      expect(rail.calls.map((call) => call.kind)).toEqual(['query', 'query']);
      expect(new Set(rail.calls.map((call) => call.command.providerIdempotencyKey)).size).toBe(1);
      expect(await row(refund.id)).toMatchObject({ status: 'RESERVED' });
      const extra = await request(confirmationId, '1');
      expect((await reserveResponse(extra.id)).status).toBe(409);
      expect(await marker(refund.id)).toBeNull();
    });

    it('lets only one concurrent worker submit the same durable refund', async () => {
      const { refund } = await reserved();
      rail.submitStatus = 'SUCCEEDED';
      await Promise.all(Array.from({ length: 6 }, () => commands.deliverRefund(refund.id)));
      expect(rail.calls.filter((call) => call.kind === 'submit')).toHaveLength(1);
      expect(consequence.calls).toHaveLength(1);
      expect(await row(refund.id)).toMatchObject({ status: 'SUCCEEDED' });
    });

    it('retains definitive success when an older pending response arrives after lease recovery', async () => {
      const { refund } = await reserved();
      let release!: () => void;
      let entered!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      rail.beforeTransport = async (kind) => {
        if (kind === 'submit') {
          entered();
          await blocked;
        }
      };
      rail.submitStatus = 'PENDING';
      rail.queryStatus = 'SUCCEEDED';
      const late = commands.deliverRefund(refund.id);
      await started;
      try {
        await h.prisma.moneyDispatch.update({
          where: { refundId: refund.id },
          data: { leaseUntil: new Date(0) },
        });
        await commands.deliverRefund(refund.id);
        expect(await row(refund.id)).toMatchObject({ status: 'SUCCEEDED' });
      } finally {
        release();
        await late;
      }
      expect(await dispatchRow(refund.id)).toMatchObject({
        status: 'SUCCEEDED',
        observation: { status: 'SUCCEEDED' },
      });
      expect(consequence.calls).toHaveLength(1);
      expect(rail.calls.map((call) => call.kind)).toEqual(['submit', 'query']);
    });

    it('rolls back compensation and the enlisted consequence, retaining proof for recovery without another network call', async () => {
      const { refund, confirmationId } = await reserved();
      const before = await snapshot();
      consequence.fail = true;
      rail.submitStatus = 'SUCCEEDED';
      await commands.deliverRefund(refund.id);
      expect(await row(refund.id)).toMatchObject({
        status: 'RESERVED',
        compensatingLedgerTransactionId: null,
      });
      expect(await dispatchRow(refund.id)).toMatchObject({
        status: 'UNKNOWN',
        observation: { status: 'SUCCEEDED' },
      });
      expect(await marker(refund.id)).toBeNull();
      const failed = await snapshot();
      expect(failed.postings).toBe(before.postings);
      expect(failed.lines).toBe(before.lines);
      expect(failed.markers).toBe(before.markers);
      const inspection = await reviewer.request<RefundRecoveryInspection>(
        `/v1/money/review/refunds/${refund.id}/recovery?paymentConfirmationId=${confirmationId}`,
      );
      expect(inspection.status).toBe(200);
      expect(inspection.body).toMatchObject({
        state: 'AMBIGUOUS',
        diagnosticCode: 'LOCAL_COMPLETION_REQUIRED',
        allowedOperations: ['QUERY'],
        reservationHeld: true,
        expiryPolicy: 'POLICY_BLOCKED',
        automaticReservationRelease: false,
      });
      expect(JSON.stringify(inspection.body)).not.toMatch(
        /r32-private|r24_refund_|externalOperationId|providerIdempotencyKey|accountReference/u,
      );
      consequence.fail = false;
      rail.configured = false;
      configuration.available = false;
      await commands.deliverRefund(refund.id);
      expect(await row(refund.id)).toMatchObject({ status: 'SUCCEEDED' });
      expect(await marker(refund.id)).not.toBeNull();
      expect(rail.calls).toHaveLength(1);
      expect((await snapshot()).postings - before.postings).toBe(1);
      expect(consequence.calls).toHaveLength(2);
    });

    it('rolls back the enlisted consequence when final audit fails, and replays exactly one compensation', async () => {
      const { refund } = await reserved();
      const before = await snapshot();
      const audit = h.app.get(AuditService);
      const record = audit.record.bind(audit);
      const failure = jest.spyOn(audit, 'record').mockImplementation(async (event, tx) => {
        if (event.type === 'MONEY_REFUND_RESULT_RECORDED')
          throw new Error('r32-private-result-audit');
        return record(event, tx);
      });
      rail.submitStatus = 'SUCCEEDED';
      try {
        await commands.deliverRefund(refund.id);
      } finally {
        failure.mockRestore();
      }
      expect(await row(refund.id)).toMatchObject({
        status: 'RESERVED',
        compensatingLedgerTransactionId: null,
      });
      expect(await marker(refund.id)).toBeNull();
      expect((await snapshot()).postings).toBe(before.postings);
      rail.configured = false;
      await commands.deliverRefund(refund.id);
      const completed = await row(refund.id);
      expect(completed).toMatchObject({ status: 'SUCCEEDED' });
      const proof = await dispatchRow(refund.id);
      await commands.recordRefundResult(
        proof.id,
        proof.observation as unknown as MoneyRefundObservation,
      );
      expect((await snapshot()).postings - before.postings).toBe(1);
      expect((await snapshot()).markers - before.markers).toBe(1);
      expect(rail.calls).toHaveLength(1);
    });

    it('blocks external execution when the approved consequence participant is unavailable', async () => {
      const { refund } = await reserved();
      consequence.configured = false;
      rail.submitStatus = 'SUCCEEDED';
      await expect(commands.deliverRefund(refund.id)).rejects.toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
      });
      expect(rail.calls).toHaveLength(0);
      expect(await row(refund.id)).toMatchObject({
        status: 'RESERVED',
        compensatingLedgerTransactionId: null,
      });
      expect(await marker(refund.id)).toBeNull();
    });

    it('rechecks the durable approving actor before queued delivery after their permission is revoked', async () => {
      const { refund } = await reserved();
      await h.revoke('reviewer', R24_PERMISSIONS.refundReview);
      try {
        await expect(commands.deliverRefund(refund.id)).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        expect(rail.calls).toHaveLength(0);
        expect(await row(refund.id)).toMatchObject({ status: 'RESERVED' });
      } finally {
        await h.grant('reviewer', R24_PERMISSIONS.refundReview);
      }
      rail.queryStatus = 'SUCCEEDED';
      rail.submitStatus = 'SUCCEEDED';
      await commands.deliverRefund(refund.id);
      expect(await row(refund.id)).toMatchObject({ status: 'SUCCEEDED' });
    });

    it('blocks submission after the original posting is reversed while preserving the full reservation', async () => {
      const { refund, confirmationId } = await reserved('1000');
      const dispatch = await dispatchRow(refund.id);
      await reverseOriginal(confirmationId);
      const before = await snapshot();
      rail.submitStatus = 'SUCCEEDED';
      await expect(commands.deliverRefund(refund.id)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'MONEY_REFUND_ORIGINAL_REVERSED' },
      });
      expect(rail.calls).toHaveLength(0);
      expect(consequence.calls).toHaveLength(0);
      expect(await row(refund.id)).toMatchObject({
        status: 'RESERVED',
        amountMinor: 1000n,
        compensatingLedgerTransactionId: null,
      });
      expect(await dispatchRow(refund.id)).toEqual(dispatch);
      expect(await marker(refund.id)).toBeNull();
      const after = await snapshot();
      expect(after.postings).toBe(before.postings);
      expect(after.lines).toBe(before.lines);
    });

    it('retains successful transport evidence after original reversal and creates one reconciliation exception instead of compensation', async () => {
      const { refund, confirmationId } = await reserved('1000');
      consequence.fail = true;
      rail.submitStatus = 'SUCCEEDED';
      await commands.deliverRefund(refund.id);
      const proof = await dispatchRow(refund.id);
      expect(proof).toMatchObject({ status: 'UNKNOWN', observation: { status: 'SUCCEEDED' } });
      expect(await marker(refund.id)).toBeNull();
      await reverseOriginal(confirmationId);
      const before = await snapshot();
      consequence.fail = false;
      rail.configured = false;
      configuration.available = false;
      await commands.deliverRefund(refund.id);
      await commands.deliverRefund(refund.id);
      expect(await row(refund.id)).toMatchObject({
        status: 'RESERVED',
        amountMinor: 1000n,
        compensatingLedgerTransactionId: null,
      });
      expect(await dispatchRow(refund.id)).toMatchObject({
        status: 'UNKNOWN',
        observation: proof.observation,
        providerIdempotencyKey: proof.providerIdempotencyKey,
      });
      expect(rail.calls).toHaveLength(1);
      expect(consequence.calls).toHaveLength(1);
      expect(await marker(refund.id)).toBeNull();
      const after = await snapshot();
      expect(after.postings).toBe(before.postings);
      expect(after.lines).toBe(before.lines);
      expect(
        await h.prisma.moneyReconciliationException.findMany({
          where: {
            kind: 'REFUND_WITHOUT_COMPENSATION',
            subjectType: 'Refund',
            subjectId: refund.id,
          },
        }),
      ).toEqual([expect.objectContaining({ resolvedAt: null })]);
      expect(
        await h.prisma.auditEvent.count({
          where: {
            type: 'MONEY_COMMAND_ACCEPTED',
            AND: [
              { metadata: { path: ['moneyAction'], equals: 'REFUND_RECONCILIATION_REQUIRED' } },
              { metadata: { path: ['refundId'], equals: refund.id } },
            ],
          },
        }),
      ).toBe(1);
    });

    it('creates independently linked partial STANDARD compensations and preserves the original posted history', async () => {
      const { confirmationId } = await paid();
      const original = await h.prisma.moneyPaymentConfirmation.findUniqueOrThrow({
        where: { id: confirmationId },
      });
      const history = await h.prisma.ledgerTransaction.findUniqueOrThrow({
        where: { id: original.ledgerTransactionId },
        include: { entries: true },
      });
      const first = await reserve((await request(confirmationId, '300')).id);
      const second = await reserve((await request(confirmationId, '700')).id);
      rail.submitStatus = 'SUCCEEDED';
      await Promise.all([commands.deliverRefund(first.id), commands.deliverRefund(second.id)]);
      const refunds = await h.prisma.moneyRefund.findMany({
        where: { paymentConfirmationId: confirmationId },
        orderBy: { amountMinor: 'asc' },
      });
      expect(refunds.map((refund) => refund.status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
      expect(new Set(refunds.map((refund) => refund.compensatingLedgerTransactionId)).size).toBe(2);
      for (const refund of refunds) {
        const posting = await h.prisma.ledgerTransaction.findUniqueOrThrow({
          where: { id: refund.compensatingLedgerTransactionId! },
          include: { entries: true },
        });
        expect(posting).toMatchObject({
          status: 'POSTED',
          kind: 'STANDARD',
          reversesTransactionId: null,
        });
        expect(posting.entries).toHaveLength(2);
        expect(posting.entries.every((entry) => entry.amountMinor === refund.amountMinor)).toBe(
          true,
        );
        expect(await marker(refund.id)).not.toBeNull();
      }
      expect(
        await h.prisma.ledgerTransaction.findUniqueOrThrow({
          where: { id: original.ledgerTransactionId },
          include: { entries: true },
        }),
      ).toEqual(history);
      expect((await reserveResponse((await request(confirmationId, '1')).id)).status).toBe(409);
    });

    it('rejects conflicting terminal results without rewriting the original proof or compensation', async () => {
      const { refund } = await reserved();
      rail.submitStatus = 'SUCCEEDED';
      await commands.deliverRefund(refund.id);
      const proof = await dispatchRow(refund.id);
      const original = await row(refund.id);
      const observed = proof.observation as unknown as MoneyRefundObservation;
      await expect(
        commands.recordRefundResult(proof.id, { ...observed, status: 'FAILED' }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await row(refund.id)).toEqual(original);
      expect((await dispatchRow(refund.id)).observation).toEqual(proof.observation);
      expect(consequence.calls).toHaveLength(1);
    });
  },
);
