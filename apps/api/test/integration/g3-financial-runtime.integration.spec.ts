import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type {
  ManualPaymentDetailV1,
  ManualReceiptReservationV1,
  ManualReviewDetailV1,
  MoneyMyPlanWireV1,
  PaymentIntentWireV1,
} from '@homeservicemarketplace/contracts';
import {
  R24_PERMISSIONS,
  r24MoneyHttpFixture,
  type R24HttpSession,
  type R24MoneyHttpFixture,
} from '../support/r24-money-http.fixture';
import { OutboxWorker } from '../../src/infrastructure/outbox/outbox.worker';
import { OutboxEventType } from '../../src/infrastructure/outbox/outbox.tokens';
import { MoneyCommandService } from '../../src/modules/money/application/money-command.service';
import { LedgerService } from '../../src/modules/money/ledger/ledger.service';
import { MANUAL_ADAPTER_ID } from '../../src/modules/money/adapters/manual/manual-rail.config';
import { EntitlementUsageService } from '../../src/modules/money/entitlements/entitlement-usage.service';
import {
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
} from '../../src/modules/money/ports/collection.port';
import {
  MONEY_REFUND_ADAPTER,
  MONEY_REFUND_CONFIRMATION_PARTICIPANT,
} from '../../src/modules/money/ports/refund.port';
import { REFUND_POLICY_SOURCE } from '../../src/modules/money/refunds/refund-eligibility.policy';
import {
  MoneyCollectionRouter,
  MoneyRailConfiguration,
  MoneyRefundRouter,
} from '../../src/modules/money/runtime/money-rail-router';
import { ApprovedRefundParticipant } from '../../src/modules/money/runtime/approved-refund.participant';
import { ApprovedRefundPolicySource } from '../../src/modules/money/runtime/approved-refund-policy.source';

// Boots actual AppModule/HTTP/auth/PostgreSQL/Redis composition without replacing
// any money port. Disposable synthetic actors use normal login/OTP. No external
// provider call or commercial refund policy is claimed by these negative tests.
const db = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
const useRealManualRuntime =
  process.env.RUN_DB_INTEGRATION === '1' && process.env.RUN_R30_INTEGRATION === '1';
db('G3 mounted financial runtime (real infrastructure)', () => {
  let h: R24MoneyHttpFixture;
  let priorRefundFlag: string | undefined;
  beforeAll(async () => {
    priorRefundFlag = process.env.MONEY_REFUND_AUTHORIZATION_ENABLED;
    if (useRealManualRuntime) process.env.MONEY_REFUND_AUTHORIZATION_ENABLED = 'true';
    // One composition per Jest module: ConfigModule validates its environment
    // when AppModule is first imported. Share that actual composition below.
    h = await r24MoneyHttpFixture({
      scannerDriver: useRealManualRuntime ? 'clamav' : 'test',
      isolateRateLimits: true,
    });
  }, 120_000);
  afterAll(async () => {
    try {
      await h?.dispose();
    } finally {
      if (priorRefundFlag === undefined) delete process.env.MONEY_REFUND_AUTHORIZATION_ENABLED;
      else process.env.MONEY_REFUND_AUTHORIZATION_ENABLED = priorRefundFlag;
    }
  }, 30_000);
  it('binds one shared concrete implementation for every integrated port', () => {
    for (const [token, implementation] of [
      [MONEY_CONFIGURATION, MoneyRailConfiguration],
      [MONEY_COLLECTION_ADAPTER, MoneyCollectionRouter],
      [MONEY_REFUND_ADAPTER, MoneyRefundRouter],
      [MONEY_REFUND_CONFIRMATION_PARTICIPANT, ApprovedRefundParticipant],
      [REFUND_POLICY_SOURCE, ApprovedRefundPolicySource],
    ] as const)
      expect(h.app.get(token)).toBe(h.app.get(implementation));
  });
  it('mounts the private Stripe session route and denies anonymous and unprivileged fresh sessions', async () => {
    expect((await h.session().request('/v1/money/stripe/attempts/absent/session')).status).toBe(
      401,
    );
    const noPermission = await h.login('noPermission');
    expect((await noPermission.request('/v1/money/stripe/attempts/absent/session')).status).toBe(
      403,
    );
  });
  it('rejects client price/currency authority through the actual purchase route', async () => {
    const owner = await h.login('owner');
    const result = await owner.request('/v1/money/intents', {
      method: 'POST',
      idempotencyKey: h.key('tamper'),
      body: {
        contractVersion: 'hsm.money.v1',
        planVersionId: 'absent',
        method: 'STRIPE',
        amountMinor: '1',
        currency: 'USD',
      },
    });
    expect(result.status).toBe(400);
  });
  it('mounts signed ingress and fails closed without a configured Stripe account', async () => {
    const result = await h.session().request('/v1/money/webhooks/stripe', {
      method: 'POST',
      body: { id: 'synthetic-event' },
      headers: { 'stripe-signature': 't=1,v1=synthetic-negative-fixture' },
    });
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toMatch(/sk_test_|whsec_/u);
  });

  // Positive assembled-runtime evidence requires the same real ClamAV boundary as
  // R30. No money, policy-source, activation, refund or scanner port is replaced.
  // The isolated XTS plans, approval references and operator settlements below are
  // explicit SYNTHETIC fixtures, not commercial approval or external rail evidence.
  const manual = useRealManualRuntime ? describe : describe.skip;
  manual('G3 assembled manual collection and approved refund lifecycle (real ClamAV)', () => {
    let owner: R24HttpSession;
    let reviewer: R24HttpSession;
    let recorder: R24HttpSession;
    const version = { contractVersion: 'hsm.money.v1' };

    beforeAll(async () => {
      const admin = await h.prisma.role.findFirstOrThrow({
        where: { name: 'admin', deletedAt: null },
      });
      await h.prisma.userRole.create({
        data: { userId: h.actors.noPermission.userId, roleId: admin.id },
      });
      h.actors.noPermission.roleNames.push('admin');
      await h.grant('reviewer', R24_PERMISSIONS.receiptView);
      for (const permission of [
        R24_PERMISSIONS.review,
        R24_PERMISSIONS.receiptSettlement,
        R24_PERMISSIONS.refundReview,
      ])
        await h.grant('noPermission', permission);
      owner = await h.login('owner');
      reviewer = await h.login('reviewer');
      recorder = await h.login('noPermission');
    }, 120_000);

    async function post<T>(
      session: R24HttpSession,
      path: string,
      body: unknown,
      expectedStatus: number,
      idempotencyKey = h.key('g3-post'),
    ): Promise<T> {
      const response = await session.request<T>(path, {
        method: 'POST',
        idempotencyKey,
        body,
      });
      expect(response.status).toBe(expectedStatus);
      return response.body;
    }

    async function drainOutbox(): Promise<void> {
      const worker = h.app.get(OutboxWorker);
      // Due work may enqueue its notification in a later batch. Future expiry
      // work stays scheduled; no clock, availability or delivery row is altered.
      for (let batch = 0; batch < 10; batch += 1) if ((await worker.runOnce()) === 0) return;
      throw new Error('G3 isolated due outbox did not drain in ten bounded batches');
    }

    async function createCollectedPlan(effect: 'SUSPEND_SUBSCRIPTION' | 'CANCEL_SUBSCRIPTION') {
      const ledger = h.app.get(LedgerService);
      const label = randomUUID();
      const accounts = await Promise.all(
        ['clearing', 'revenue'].map((kind) =>
          ledger.openAccount(
            { kind: 'SYSTEM', system: 'g3.synthetic.fixture' },
            { key: label + '-' + kind, ownerType: 'PLATFORM', currency: 'XTS' },
          ),
        ),
      );
      const plan = await h.prisma.subscriptionPlanVersion.create({
        data: {
          planKey: 'g3-synthetic-' + label,
          version: 1,
          billingInterval: 'MONTHLY',
          priceMinor: 1000n,
          currency: 'XTS',
          entitlements: [{ key: 'g3.test', value: { kind: 'LIMIT', limit: 2 } }],
          publishedAt: new Date(Date.now() - 60_000),
        },
      });
      const policyVersion = 'g3-synthetic-' + label;
      await h.prisma.moneyManualInstructionVersion.create({
        data: {
          planVersionId: plan.id,
          method: 'CASH_OFFICE',
          adapterId: MANUAL_ADAPTER_ID,
          mode: 'SANDBOX',
          accountReference: 'SYNTHETIC-NO-TRANSFER-' + label,
          currency: 'XTS',
          debitAccountId: accounts[0]!.account.id,
          creditAccountId: accounts[1]!.account.id,
          configVersion: policyVersion,
          instructions: {
            en: 'Synthetic G3 operator simulation. Never transfer real money.',
            ar: 'محاكاة اختبارية فقط. لا تحوّل أموالاً حقيقية.',
          },
          market: 'SYNTHETIC_TEST',
          minorUnitScale: 0,
          policyVersion,
          referencePolicy: 'EXACT_TRIM',
          maxAmountMinor: 1000n,
          receiptMaxBytes: 128 * 1024,
          uploadTtlSeconds: 1800,
          quoteTtlSeconds: 3600,
          retentionDays: 7,
          validFrom: new Date(Date.now() - 60_000),
          validUntil: new Date(Date.now() + 3_600_000),
          approvedAt: new Date(Date.now() - 120_000),
          enabled: true,
        },
      });
      await h.prisma.moneyApprovedRefundPolicy.create({
        data: {
          version: policyVersion,
          planVersionId: plan.id,
          method: 'CASH_OFFICE',
          mode: 'SANDBOX',
          currency: 'XTS',
          approvalReference: 'SYNTHETIC-FIXTURE-NOT-COMMERCIAL-APPROVAL',
          approvedAt: new Date(Date.now() - 120_000),
          validFrom: new Date(Date.now() - 60_000),
          validUntil: new Date(Date.now() + 3_600_000),
          entitlementEffect: effect,
          rules: {
            version: policyVersion,
            approvalReference: 'SYNTHETIC-FIXTURE-NOT-COMMERCIAL-APPROVAL',
            planVersionId: plan.id,
            method: 'CASH_OFFICE',
            mode: 'SANDBOX',
            currency: 'XTS',
            reasonCodes: ['G3_SYNTHETIC_REFUND'],
            refundWindowSeconds: 3600,
            allowPartial: false,
            requireRequesterReviewerSeparation: true,
            requireOriginalReviewerSeparation: true,
            feeTreatment: 'NO_DEDUCTION',
            taxTreatment: 'NO_ADJUSTMENT',
            proRataTreatment: 'NONE',
            entitlementPolicyVersion: policyVersion,
          },
        },
      });
      const intent = await post<PaymentIntentWireV1>(
        owner,
        '/v1/money/intents',
        { ...version, method: 'CASH_OFFICE', planVersionId: plan.id },
        201,
      );
      const detailPath = '/v1/money/manual/intents/' + intent.id;
      const reviewPath = '/v1/money/manual/review/intents/' + intent.id;
      const initial = await owner.request<ManualPaymentDetailV1>(detailPath);
      expect(initial.status).toBe(200);
      const bytes = await sharp(randomBytes(48), { raw: { width: 4, height: 4, channels: 3 } })
        .png()
        .toBuffer();
      const reservation = await post<ManualReceiptReservationV1>(
        owner,
        detailPath + '/receipts',
        {
          contentType: 'image/png',
          sizeBytes: bytes.length,
          expectedVersion: initial.body.version,
          filename: 'g3-synthetic-receipt.png',
        },
        201,
      );
      const contentPath = '/v1/money/manual/receipts/' + reservation.mediaAssetId + '/content';
      expect(
        (
          await owner.request(contentPath, {
            method: 'PUT',
            rawBody: bytes,
            headers: { 'content-type': 'image/png' },
          })
        ).status,
      ).toBe(200);
      const finalized = await post<ManualPaymentDetailV1>(
        owner,
        '/v1/money/manual/receipts/' + reservation.mediaAssetId + '/finalize',
        undefined,
        200,
      );
      expect(finalized.receipts[0]?.scanStatus).toBe('CLEAN');
      await post(owner, detailPath + '/submit', { expectedVersion: finalized.version }, 200);
      const inspected = await reviewer.request<Uint8Array>(contentPath, {
        responseType: 'bytes',
        headers: { origin: 'http://127.0.0.1:5324' },
      });
      expect(inspected.status).toBe(200);
      expect(Buffer.from(inspected.body)).toEqual(bytes);
      expect(inspected.headers.get('cache-control')).toContain('no-store');
      const inspectionId = inspected.headers.get('x-receipt-inspection-id');
      expect(inspectionId).toBeTruthy();
      const settlement = await post<{ id: string }>(
        recorder,
        reviewPath + '/settlements',
        {
          reference: 'G3-SYNTHETIC-' + label,
          amount: intent.total,
          occurredAt: new Date().toISOString(),
          evidenceSource: 'SANDBOX_OPERATOR_SIMULATION',
        },
        201,
      );
      const state = await reviewer.request<ManualReviewDetailV1>(reviewPath);
      expect(state.status).toBe(200);
      const approval = {
        expectedVersion: state.body.version,
        receiptVersionId: reservation.receiptVersionId,
        inspectionId,
        action: 'APPROVE',
        settlementId: settlement.id,
        providerMessage: 'Synthetic G3 operator confirmation.',
      };
      const approvalKey = h.key('g3-approval');
      for (let delivery = 0; delivery < 2; delivery += 1) {
        const decision = await post<ManualReviewDetailV1>(
          reviewer,
          reviewPath + '/decisions',
          approval,
          202,
          approvalKey,
        );
        expect(decision.status).toBe('APPROVED');
      }
      const confirmation = await h.prisma.moneyPaymentConfirmation.findUniqueOrThrow({
        where: { paymentIntentId: intent.id },
        include: { period: true },
      });
      const period = confirmation.period!;
      expect(period).not.toBeNull();
      const readPlan = () =>
        owner.request<MoneyMyPlanWireV1>(
          '/v1/money/my-plan?subscriptionId=' + period.subscriptionId,
        );
      const active = await readPlan();
      expect(active.status).toBe(200);
      expect(active.body.status).toBe('ACTIVE');
      expect(active.body.entitlements).toEqual([
        expect.objectContaining({ key: 'g3.test', allowed: true, remaining: 2 }),
      ]);
      expect(
        await h.app.get(EntitlementUsageService).consume(h.actors.owner.userId, {
          subscriptionId: period.subscriptionId,
          entitlementKey: 'g3.test',
          usageKey: 'g3-synthetic-use:' + label,
        }),
      ).toMatchObject({ allowed: true, used: 1, remaining: 1 });
      expect(
        await h.prisma.outboxEvent.count({
          where: {
            aggregateId: period.subscriptionId,
            eventType: OutboxEventType.MONEY_SUBSCRIPTION_EXPIRY_DUE,
            availableAt: period.endsAt,
          },
        }),
      ).toBe(1);
      const event = await h.prisma.moneyExternalEvent.findFirstOrThrow({
        where: { paymentIntentId: intent.id, status: 'PROCESSED' },
      });
      // Redelivery executes the actual persisted command envelope.
      await h.app.get(MoneyCommandService).processExternalEvent(event.id);
      expect(
        await h.prisma.subscriptionPeriod.count({
          where: { paymentConfirmationId: confirmation.id },
        }),
      ).toBe(1);
      await drainOutbox();
      expect(
        await h.prisma.notification.count({
          where: {
            userId: h.actors.owner.userId,
            dedupeKey: `money.subscription.activated.v1:${confirmation.id}`,
          },
        }),
      ).toBe(1);
      const activationEvent = await h.prisma.outboxEvent.findFirstOrThrow({
        where: {
          aggregateId: period.subscriptionId,
          eventType: OutboxEventType.MONEY_SUBSCRIPTION_ACTIVATED,
        },
        include: { handlerRuns: true },
      });
      expect(activationEvent.status).toBe('PROCESSED');
      expect(activationEvent.handlerRuns.map((run) => run.handler)).toContain(
        'money.subscription.activated.notification.v1',
      );
      return { intent, confirmation, period, policyVersion, readPlan };
    }

    it.each([
      ['SUSPEND_SUBSCRIPTION', 'SUSPENDED', false],
      ['CANCEL_SUBSCRIPTION', 'CANCELLED', true],
    ] as const)(
      'integrates %s with real compensation, outbox, rollback and duplicate recovery',
      async (effect, expectedStatus, injectFailure) => {
        const profile = await h.prisma.providerProfile.findUniqueOrThrow({
          where: { id: h.actors.owner.providerProfileId! },
        });
        const grants = await h.prisma.rolePermission.count();
        const f = await createCollectedPlan(effect);
        const request = await post<{ id: string }>(
          owner,
          '/v1/money/refund-requests',
          {
            ...version,
            paymentConfirmationId: f.confirmation.id,
            amount: f.intent.total,
            reasonCode: 'G3_SYNTHETIC_REFUND',
          },
          202,
        );
        // The refund reviewer is distinct from both owner and original reviewer.
        const refund = await post<{ id: string }>(
          recorder,
          '/v1/money/review/refund-requests/' + request.id + '/reserve',
          version,
          201,
        );
        expect(
          await h.prisma.moneyRefundRequest.findUniqueOrThrow({ where: { id: request.id } }),
        ).toMatchObject({
          status: 'AUTHORIZED',
          policyVersion: f.policyVersion,
          refundId: refund.id,
        });
        expect(
          await h.prisma.moneyManualRefundOperation.findUnique({ where: { refundId: refund.id } }),
        ).toBeNull();
        // The registered real outbox handler submits the durable reservation.
        await drainOutbox();
        const operation = await h.prisma.moneyManualRefundOperation.findUniqueOrThrow({
          where: { refundId: refund.id },
        });
        expect(operation.state).toBe('PENDING');
        const refundEvent = await h.prisma.outboxEvent.findFirstOrThrow({
          where: { aggregateType: 'MoneyRefund', aggregateId: refund.id },
          include: { handlerRuns: true },
        });
        expect(refundEvent.status).toBe('PROCESSED');
        expect(refundEvent.handlerRuns.map((run) => run.handler)).toContain(
          'money.refund.dispatch.v1',
        );
        const evidence = {
          amount: f.intent.total,
          externalOperationId: 'g3-synthetic-' + randomUUID(),
          evidenceSource: 'SANDBOX_OPERATOR_SIMULATION',
        };
        const evidencePath = '/v1/money/manual/review/refunds/' + refund.id + '/evidence';
        await post(recorder, evidencePath, { ...evidence, type: 'DISPATCH' }, 201);
        expect((await f.readPlan()).body.status).toBe('ACTIVE');
        await post(
          reviewer,
          evidencePath,
          { ...evidence, type: 'CONFIRM_SUCCEEDED', reference: 'G3-RECEIVED-' + randomUUID() },
          201,
        );
        // Operator evidence alone cannot apply the subscription consequence.
        expect((await f.readPlan()).body.status).toBe('ACTIVE');
        const queryKey = h.key('g3-refund-query');
        const query = () =>
          post(
            recorder,
            '/v1/money/review/refunds/' + refund.id + '/query',
            version,
            202,
            queryKey,
          );
        const postingCount = await h.prisma.ledgerTransaction.count();
        const receiptWhere = {
          action: 'subscription.refund-effect',
          response: { path: ['subscriptionId'], equals: f.period.subscriptionId },
        };
        if (injectFailure) {
          const participant = h.app.get(ApprovedRefundParticipant);
          const apply = participant.applyConfirmedRefund.bind(participant);
          let realConsequenceReached = false;
          const fault = jest
            .spyOn(participant, 'applyConfirmedRefund')
            .mockImplementationOnce(async (input, tx) => {
              await apply(input, tx);
              realConsequenceReached = true;
              throw new Error('G3 synthetic fault after the real transactional consequence');
            });
          try {
            await query();
            expect(realConsequenceReached).toBe(true);
            expect(fault).toHaveBeenCalledTimes(1);
          } finally {
            fault.mockRestore();
          }
          expect((await f.readPlan()).body.status).toBe('ACTIVE');
          expect(await h.prisma.ledgerTransaction.count()).toBe(postingCount);
          expect(await h.prisma.moneyCommand.count({ where: receiptWhere })).toBe(0);
          expect(
            await h.prisma.moneyRefund.findUniqueOrThrow({ where: { id: refund.id } }),
          ).toMatchObject({ status: 'RESERVED', compensatingLedgerTransactionId: null });
          expect(
            await h.prisma.moneyDispatch.findUniqueOrThrow({ where: { refundId: refund.id } }),
          ).toMatchObject({ observation: { status: 'SUCCEEDED' } });
        }
        // A replay of the same accepted query recovers the persisted terminal
        // observation after rollback, through the same real transaction authority.
        await query();
        const completed = await h.prisma.moneyRefund.findUniqueOrThrow({
          where: { id: refund.id },
          include: { compensatingLedgerTxn: { include: { entries: true } } },
        });
        expect(completed.status).toBe('SUCCEEDED');
        expect(completed.compensatingLedgerTxn).toMatchObject({
          status: 'POSTED',
          currency: 'XTS',
        });
        const entries = completed.compensatingLedgerTxn!.entries;
        expect(entries).toHaveLength(2);
        expect(
          entries.filter((line) => line.side === 'DEBIT').map((line) => line.amountMinor),
        ).toEqual([1000n]);
        expect(
          entries.filter((line) => line.side === 'CREDIT').map((line) => line.amountMinor),
        ).toEqual([1000n]);
        const finalPlan = await f.readPlan();
        expect(finalPlan.status).toBe(200);
        expect(finalPlan.body.status).toBe(expectedStatus);
        expect(finalPlan.body.entitlements).toEqual([
          expect.objectContaining({ key: 'g3.test', allowed: false, used: 1 }),
        ]);
        await expect(
          h.app.get(EntitlementUsageService).consume(h.actors.owner.userId, {
            subscriptionId: f.period.subscriptionId,
            entitlementKey: 'g3.test',
            usageKey: 'g3-after-refund:' + refund.id,
          }),
        ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
        expect(await h.prisma.moneyCommand.count({ where: receiptWhere })).toBe(1);
        expect(await h.prisma.ledgerTransaction.count()).toBe(postingCount + 1);
        await query();
        await drainOutbox();
        expect(await h.prisma.ledgerTransaction.count()).toBe(postingCount + 1);
        expect(await h.prisma.moneyCommand.count({ where: receiptWhere })).toBe(1);
        expect(
          await h.prisma.moneyManualRefundOperation.count({ where: { refundId: refund.id } }),
        ).toBe(1);
        expect(
          (
            await h.prisma.moneyManualRefundOperation.findUniqueOrThrow({
              where: { refundId: refund.id },
            })
          ).providerIdempotencyKey,
        ).toBe(operation.providerIdempotencyKey);
        expect(
          await h.prisma.providerProfile.findUniqueOrThrow({ where: { id: profile.id } }),
        ).toEqual(profile);
        expect(await h.prisma.rolePermission.count()).toBe(grants);
      },
      90_000,
    );
  });
});
