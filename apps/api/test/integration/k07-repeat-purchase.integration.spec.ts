import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type {
  ManualPaymentDetailV1,
  ManualReceiptReservationV1,
  ManualReviewDetailV1,
  PaymentIntentWireV1,
} from '@homeservicemarketplace/contracts';
import {
  R24_PERMISSIONS,
  r24MoneyHttpFixture,
  type R24HttpSession,
  type R24MoneyHttpFixture,
} from '../support/r24-money-http.fixture';
import { LedgerService } from '../../src/modules/money/ledger/ledger.service';
import { MANUAL_ADAPTER_ID } from '../../src/modules/money/adapters/manual/manual-rail.config';

// K07 — the server contract behind the same-tab repeat-purchase fix.
//
// Actual AppModule/HTTP/auth/PostgreSQL/Redis; no money port is replaced. The
// browser keeps its idempotency identities until the server settles a purchase,
// then rotates them for an explicit new purchase. This proves the facts that
// rule depends on: an idempotent replay returns the stored snapshot (so the
// client must re-read), the fresh owner read is current, and a second purchase
// of the same immutable plan version with new identities is a distinct intent
// whose confirmation opens a distinct, non-overlapping period.
//
// Manual receipts accept only a real scanner (never the deterministic double),
// so this runs with the R30 services, including real ClamAV. XTS plans,
// approvals and operator settlements are SYNTHETIC fixtures, not commercial
// approval or any external rail evidence.
const db =
  process.env.RUN_DB_INTEGRATION === '1' && process.env.RUN_R30_INTEGRATION === '1'
    ? describe
    : describe.skip;
db('K07 repeat purchase of one plan version (real infrastructure)', () => {
  let h: R24MoneyHttpFixture;
  let owner: R24HttpSession;
  let reviewer: R24HttpSession;
  let recorder: R24HttpSession;
  const version = { contractVersion: 'hsm.money.v1' };

  beforeAll(async () => {
    h = await r24MoneyHttpFixture({ scannerDriver: 'clamav', isolateRateLimits: true });
    const admin = await h.prisma.role.findFirstOrThrow({
      where: { name: 'admin', deletedAt: null },
    });
    await h.prisma.userRole.create({
      data: { userId: h.actors.noPermission.userId, roleId: admin.id },
    });
    h.actors.noPermission.roleNames.push('admin');
    await h.grant('reviewer', R24_PERMISSIONS.receiptView);
    for (const permission of [R24_PERMISSIONS.review, R24_PERMISSIONS.receiptSettlement])
      await h.grant('noPermission', permission);
    owner = await h.login('owner');
    reviewer = await h.login('reviewer');
    recorder = await h.login('noPermission');
  }, 120_000);
  afterAll(async () => {
    await h?.dispose();
  }, 30_000);

  async function post<T>(
    session: R24HttpSession,
    path: string,
    body: unknown,
    expectedStatus: number,
    idempotencyKey = h.key('k07-post'),
  ): Promise<T> {
    const response = await session.request<T>(path, { method: 'POST', idempotencyKey, body });
    // A failure names the route and the server's stable reason code.
    if (response.status !== expectedStatus)
      throw new Error(
        `${path} returned ${response.status}, expected ${expectedStatus}: ` +
          JSON.stringify(response.body),
      );
    return response.body;
  }

  async function syntheticPlan() {
    const ledger = h.app.get(LedgerService);
    const label = randomUUID();
    const accounts = await Promise.all(
      ['clearing', 'revenue'].map((kind) =>
        ledger.openAccount(
          { kind: 'SYSTEM', system: 'k07.synthetic.fixture' },
          { key: label + '-' + kind, ownerType: 'PLATFORM', currency: 'XTS' },
        ),
      ),
    );
    const plan = await h.prisma.subscriptionPlanVersion.create({
      data: {
        planKey: label, // Disposable UUID identity; this is not a provider credential.
        version: 1,
        billingInterval: 'MONTHLY',
        priceMinor: 1000n,
        currency: 'XTS',
        entitlements: [],
        publishedAt: new Date(Date.now() - 60_000),
      },
    });
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
        configVersion: 'k07-synthetic-' + label,
        instructions: {
          en: 'Synthetic K07 operator simulation. Never transfer real money.',
          ar: 'محاكاة اختبارية فقط. لا تحوّل أموالاً حقيقية.',
        },
        market: 'SYNTHETIC_TEST',
        minorUnitScale: 0,
        policyVersion: 'k07-synthetic-' + label,
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
    return plan;
  }

  /** Authoritative confirmation through the manual review route, never the browser. */
  async function confirmThroughReview(intent: PaymentIntentWireV1) {
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
        filename: 'k07-synthetic-receipt.png',
      },
      201,
    );
    const contentPath = '/v1/money/manual/receipts/' + reservation.mediaAssetId + '/content';
    const upload = await owner.request(contentPath, {
      method: 'PUT',
      rawBody: bytes,
      headers: { 'content-type': 'image/png' },
    });
    expect(upload.status).toBe(200);
    const finalized = await post<ManualPaymentDetailV1>(
      owner,
      '/v1/money/manual/receipts/' + reservation.mediaAssetId + '/finalize',
      undefined,
      200,
    );
    await post(owner, detailPath + '/submit', { expectedVersion: finalized.version }, 200);
    const inspected = await reviewer.request<Uint8Array>(contentPath, {
      responseType: 'bytes',
      headers: { origin: 'http://127.0.0.1:5324' },
    });
    expect(inspected.status).toBe(200);
    const settlement = await post<{ id: string }>(
      recorder,
      reviewPath + '/settlements',
      {
        reference: 'K07-SYNTHETIC-' + randomUUID(),
        amount: intent.total,
        occurredAt: new Date().toISOString(),
        evidenceSource: 'SANDBOX_OPERATOR_SIMULATION',
      },
      201,
    );
    const state = await reviewer.request<ManualReviewDetailV1>(reviewPath);
    expect(state.status).toBe(200);
    const decision = await post<ManualReviewDetailV1>(
      reviewer,
      reviewPath + '/decisions',
      {
        expectedVersion: state.body.version,
        receiptVersionId: reservation.receiptVersionId,
        inspectionId: inspected.headers.get('x-receipt-inspection-id'),
        action: 'APPROVE',
        settlementId: settlement.id,
        providerMessage: 'Synthetic K07 operator confirmation.',
      },
      202,
    );
    expect(decision.status).toBe('APPROVED');
    return h.prisma.moneyPaymentConfirmation.findUniqueOrThrow({
      where: { paymentIntentId: intent.id },
      include: { period: true },
    });
  }

  it('replays a stale snapshot, reads current status, and buys the same plan version again', async () => {
    const plan = await syntheticPlan();
    const body = { ...version, method: 'CASH_OFFICE', planVersionId: plan.id };
    const firstKey = h.key('k07-first');
    const first = await post<PaymentIntentWireV1>(owner, '/v1/money/intents', body, 201, firstKey);
    const firstConfirmation = await confirmThroughReview(first);

    // The replay is the stored command result; only the fresh read is current.
    const replay = await post<PaymentIntentWireV1>(owner, '/v1/money/intents', body, 201, firstKey);
    expect(replay.id).toBe(first.id);
    expect(replay.status).toBe(first.status);
    expect(replay.status).not.toBe('SUCCEEDED');
    const current = await owner.request<PaymentIntentWireV1>('/v1/money/intents/' + first.id);
    expect(current.status).toBe(200);
    expect(current.body.status).toBe('SUCCEEDED');

    // A rotated identity after confirmation is a distinct purchase of the same version.
    const second = await post<PaymentIntentWireV1>(
      owner,
      '/v1/money/intents',
      body,
      201,
      h.key('k07-second'),
    );
    expect(second.id).not.toBe(first.id);
    expect(second.planVersionId).toBe(first.planVersionId);
    expect(second.total).toEqual(first.total);
    const secondConfirmation = await confirmThroughReview(second);

    expect(secondConfirmation.id).not.toBe(firstConfirmation.id);
    const [a, b] = [firstConfirmation.period!, secondConfirmation.period!];
    expect(b.id).not.toBe(a.id);
    // Deliberately NOT asserted: whether the second period renews the first
    // subscription, runs in parallel, or should have been refused. Today the
    // HTTP confirmation path opens a separate subscription with an overlapping
    // period. That is open owner decision K07-OD-01 (docs/production-readiness/
    // ksa-launch/K07/OWNER_DECISIONS.md); a test must not freeze either answer.
    const periods = () =>
      h.prisma.subscriptionPeriod.count({
        where: { paymentConfirmationId: { in: [firstConfirmation.id, secondConfirmation.id] } },
      });
    expect(await periods()).toBe(2);
    expect(
      await h.prisma.moneyPaymentConfirmation.count({
        where: { paymentIntentId: { in: [first.id, second.id] } },
      }),
    ).toBe(2);
    // Replaying the first identity again never creates a third intent or period.
    const again = await post<PaymentIntentWireV1>(owner, '/v1/money/intents', body, 201, firstKey);
    expect(again.id).toBe(first.id);
    expect(await h.prisma.moneyPaymentIntent.count({ where: { planVersionId: plan.id } })).toBe(2);
    expect(await periods()).toBe(2);
  }, 120_000);

  it('denies another provider the fresh read of an owner intent', async () => {
    const plan = await syntheticPlan();
    const intent = await post<PaymentIntentWireV1>(
      owner,
      '/v1/money/intents',
      { ...version, method: 'CASH_OFFICE', planVersionId: plan.id },
      201,
    );
    const other = await h.login('reviewer');
    const read = await other.request('/v1/money/intents/' + intent.id);
    expect([403, 404]).toContain(read.status);
    expect(JSON.stringify(read.body)).not.toContain(intent.id);
  }, 60_000);
});
