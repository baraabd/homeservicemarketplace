import type {
  ManualPaymentDetailV1,
  ManualReceiptReservationV1,
  ManualReviewDetailV1,
  PaymentIntentWireV1,
} from '@homeservicemarketplace/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { MoneyCommandService } from '../../src/modules/money/application/money-command.service';
import { ManualEventProcessingJob } from '../../src/modules/money/manual-review/manual-event-processing.job';
import { ReceiptUploadService } from '../../src/modules/money/manual-review/receipt-upload.service';
import { EvidenceScanService } from '../../src/modules/provider/verification/media/evidence-scan.service';
import { EvidenceCleanupService } from '../../src/modules/provider/verification/media/evidence-cleanup.service';
import { EvidenceRetentionRepository } from '../../src/modules/provider/verification/retention/retention.repository';
import { EICAR_TEST_SIGNATURE } from '../../src/modules/provider/verification/media/malware-scanner.port';
import { OutboxRepository } from '../../src/infrastructure/outbox/outbox.repository';
import {
  R24_PERMISSIONS,
  type R24HttpResponse,
  type R24HttpSession,
} from '../support/r24-money-http.fixture';
import { r30ManualHttpFixture } from '../support/r30-manual-http.fixture';

// This suite is real HTTP + PostgreSQL + Redis + private filesystem + ClamAV.
// Receipt/payment evidence is synthetic SANDBOX_OPERATOR_SIMULATION. R31/R32
// doubles prove atomic contract behavior only, never production entitlements.
const realDescribe =
  process.env.RUN_R30_INTEGRATION === '1' && process.env.RUN_DB_INTEGRATION === '1'
    ? describe
    : describe.skip;
const VERSION = { contractVersion: 'hsm.money.v1' };

function pdf(label: string = randomUUID(), extra = ''): Buffer {
  const content = '% Synthetic sandbox receipt: ' + label + '\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R' +
      (extra ? ' /Names << /EmbeddedFiles << /Names [(eicar.com) 5 0 R] >> >>' : '') +
      ' >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>',
    '<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + 'endstream',
    ...(extra
      ? [
          '<< /Type /Filespec /F (eicar.com) /EF << /F 6 0 R >> >>',
          '<< /Type /EmbeddedFile /Length ' +
            Buffer.byteLength(extra) +
            ' >>\nstream\n' +
            extra +
            '\nendstream',
        ]
      : []),
  ];
  let document = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += index + 1 + ' 0 obj\n' + object + '\nendobj\n';
  });
  const xref = Buffer.byteLength(document);
  document +=
    'xref\n0 ' +
    (objects.length + 1) +
    '\n0000000000 65535 f \n' +
    offsets.map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Root 1 0 R /Size ' +
    (objects.length + 1) +
    ' >>\nstartxref\n' +
    xref +
    '\n%%EOF\n';
  return Buffer.from(document);
}
function failure(response: R24HttpResponse<unknown>, status: number, reason?: string): void {
  expect(response.status).toBe(status);
  expect(response.body).toMatchObject({ success: false, error: { code: expect.any(String) } });
  if (reason) expect(response.body).toMatchObject({ error: { details: { reason } } });
  expect(JSON.stringify(response.body)).not.toMatch(/PrismaClient|node_modules|stackTrace/u);
}

realDescribe('R30 manual payments with real private storage and ClamAV', () => {
  jest.setTimeout(30_000);
  let f: Awaited<ReturnType<typeof r30ManualHttpFixture>>;
  let owner: R24HttpSession;
  let reviewer: R24HttpSession;
  let recorder: R24HttpSession;
  let outsider: R24HttpSession;
  let completedIntent: PaymentIntentWireV1;
  let completedBytes: Buffer;

  beforeAll(async () => {
    f = await r30ManualHttpFixture();
    ({ owner, reviewer, recorder, outsider } = f.sessions);
  }, 180_000);
  afterAll(async () => {
    await f?.h.dispose();
  }, 60_000);
  afterEach(() => {
    if (f) {
      f.activation.fail = false;
      f.activation.configured = true;
    }
  });

  const detailPath = (id: string) => '/v1/money/manual/intents/' + id;
  const reviewPath = (id: string) => '/v1/money/manual/review/intents/' + id;
  const contentPath = (id: string) => '/v1/money/manual/receipts/' + id + '/content';
  async function detail(id: string, client = owner, admin = false) {
    const response = await client.request<ManualReviewDetailV1>(
      admin ? reviewPath(id) : detailPath(id),
    );
    expect(response.status).toBe(200);
    return response.body;
  }
  async function reserve(intentId: string, bytes: Buffer, client = owner) {
    const state = await detail(intentId, client);
    const response = await client.request<ManualReceiptReservationV1>(
      detailPath(intentId) + '/receipts',
      {
        method: 'POST',
        idempotencyKey: f.h.key('receipt'),
        body: {
          contentType: 'application/pdf',
          sizeBytes: bytes.length,
          expectedVersion: state.version,
          filename: 'synthetic.pdf',
        },
      },
    );
    expect(response.status).toBe(201);
    return response.body;
  }
  async function put(assetId: string, bytes: Buffer, client = owner) {
    return client.request(contentPath(assetId), {
      method: 'PUT',
      rawBody: bytes,
      headers: { 'content-type': 'application/pdf' },
    });
  }
  async function finalize(assetId: string, client = owner) {
    return client.request<ManualPaymentDetailV1>(
      '/v1/money/manual/receipts/' + assetId + '/finalize',
      { method: 'POST' },
    );
  }
  async function submit(intentId: string, client = owner) {
    const state = await detail(intentId, client);
    const response = await client.request<ManualPaymentDetailV1>(detailPath(intentId) + '/submit', {
      method: 'POST',
      idempotencyKey: f.h.key('submit'),
      body: { expectedVersion: state.version },
    });
    expect(response.status).toBe(200);
    return response.body;
  }
  async function cleanReceipt(intentId: string, bytes = pdf(), client = owner) {
    const reservation = await reserve(intentId, bytes, client);
    expect((await put(reservation.mediaAssetId, bytes, client)).status).toBe(200);
    const finalized = await finalize(reservation.mediaAssetId, client);
    expect(finalized.status).toBe(200);
    expect(finalized.body.receipts[0]?.scanStatus).toBe('CLEAN');
    await submit(intentId, client);
    return { ...reservation, bytes };
  }
  async function inspect(assetId: string, client = reviewer) {
    const response = await client.request<Uint8Array>(contentPath(assetId), {
      responseType: 'bytes',
      headers: { origin: 'http://127.0.0.1:5324' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('access-control-expose-headers')).toContain(
      'X-Receipt-Inspection-Id',
    );
    const inspectionId = response.headers.get('x-receipt-inspection-id');
    expect(inspectionId).toBeTruthy();
    return inspectionId!;
  }
  async function settlement(
    intent: PaymentIntentWireV1,
    reference = 'R30-' + randomUUID(),
    client = recorder,
  ) {
    const response = await client.request<{ id: string }>(reviewPath(intent.id) + '/settlements', {
      method: 'POST',
      idempotencyKey: f.h.key('settlement'),
      body: {
        reference,
        amount: intent.total,
        occurredAt: new Date().toISOString(),
        evidenceSource: 'SANDBOX_OPERATOR_SIMULATION',
      },
    });
    expect(response.status).toBe(201);
    return response.body.id;
  }
  async function decision(
    intentId: string,
    receiptVersionId: string,
    inspectionId: string,
    action: 'APPROVE' | 'REJECT' | 'REQUEST_REPLACEMENT',
    settlementId?: string,
    client = reviewer,
  ) {
    const state = await detail(intentId, client, true);
    return client.request<ManualReviewDetailV1>(reviewPath(intentId) + '/decisions', {
      method: 'POST',
      idempotencyKey: f.h.key('decision'),
      body: {
        expectedVersion: state.version,
        receiptVersionId,
        inspectionId,
        action,
        settlementId,
        providerMessage:
          action === 'REQUEST_REPLACEMENT'
            ? 'Please upload the full synthetic page.'
            : 'Synthetic review decision.',
        internalNote: 'R30_INTERNAL_ONLY_DO_NOT_EXPOSE',
      },
    });
  }

  it('keeps methods disabled without approved policy and rejects amounts over the explicit threshold', async () => {
    expect(f.h.initialMoneyGrants).toBe(0);
    const disabled = await detail(f.disabledIntent.id);
    expect(disabled).toMatchObject({
      availability: 'METHOD_DISABLED',
      availableActions: [],
      instructions: null,
      mode: 'SANDBOX',
    });
    const threshold = await f.createIntent(owner, 'CASH_OFFICE', f.plans.threshold);
    const response = await owner.request(detailPath(threshold.id) + '/receipts', {
      method: 'POST',
      idempotencyKey: f.h.key('over-threshold'),
      body: { contentType: 'application/pdf', sizeBytes: 100, expectedVersion: 0 },
    });
    failure(response, 503, 'APPROVAL_THRESHOLD_EXCEEDED');
    expect(
      await f.h.prisma.moneyManualReceiptVersion.count({
        where: { paymentIntentId: threshold.id },
      }),
    ).toBe(0);
  });

  it('requires actual bytes, owner access, CSRF, valid MIME/signature and exact declared length', async () => {
    const intent = await f.createIntent();
    const bytes = pdf();
    const receipt = await reserve(intent.id, bytes);
    failure(await finalize(receipt.mediaAssetId), 409, 'RECEIPT_UPLOAD_INCOMPLETE');
    failure(await owner.request(contentPath(receipt.mediaAssetId)), 404);
    failure(await f.h.session().request(contentPath(receipt.mediaAssetId)), 401);
    const hiddenReceipt = await outsider.request(contentPath(receipt.mediaAssetId));
    const absentReceipt = await outsider.request(contentPath('missing-private-receipt'));
    failure(hiddenReceipt, 404);
    failure(absentReceipt, 404);
    expect(hiddenReceipt.headers.get('cache-control')).toContain('no-store');
    expect(absentReceipt.headers.get('cache-control')).toContain('no-store');
    failure(
      await owner.request(contentPath(receipt.mediaAssetId), {
        method: 'PUT',
        rawBody: bytes,
        csrf: false,
        headers: { 'content-type': 'application/pdf' },
      }),
      403,
    );
    failure(
      await owner.request(contentPath(receipt.mediaAssetId), {
        method: 'PUT',
        rawBody: bytes,
        headers: { 'content-type': 'image/png' },
      }),
      409,
      'IMMUTABLE_RECEIPT_CONTENT',
    );
    failure(
      await put(receipt.mediaAssetId, Buffer.alloc(bytes.length, 65)),
      400,
      'UNRECOGNISED_FORMAT',
    );
    failure(
      await put(receipt.mediaAssetId, bytes.subarray(0, bytes.length - 1)),
      400,
      'RECEIPT_LENGTH_MISMATCH',
    );
    const puts = await Promise.all([
      put(receipt.mediaAssetId, bytes),
      put(receipt.mediaAssetId, bytes),
    ]);
    expect(puts.map((response) => response.status)).toEqual([200, 200]);
    const finals = await Promise.all([
      finalize(receipt.mediaAssetId),
      finalize(receipt.mediaAssetId),
    ]);
    expect(finals.map((response) => response.status)).toEqual([200, 200]);
    const completed = finals[0]!;
    expect(completed.body.receipts[0]?.scanStatus).toBe('CLEAN');
    const stored = await f.h.prisma.mediaAsset.findUniqueOrThrow({
      where: { id: receipt.mediaAssetId },
    });
    expect(stored).toMatchObject({
      purpose: 'FINANCIAL_RECEIPT',
      visibility: 'RESTRICTED',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      uploadCompletedAt: expect.any(Date),
    });
    expect(await readFile(join(f.h.storageRoot, 'restricted', stored.storageKey))).toEqual(bytes);
    failure(await put(receipt.mediaAssetId, bytes), 409, 'IMMUTABLE_RECEIPT_CONTENT');
  });

  it('quarantines real ClamAV EICAR evidence and never permits inspection or submission', async () => {
    const intent = await f.createIntent();
    const infected = pdf('harmless-antivirus-test', EICAR_TEST_SIGNATURE);
    const receipt = await reserve(intent.id, infected);
    expect((await put(receipt.mediaAssetId, infected)).status).toBe(200);
    const result = await finalize(receipt.mediaAssetId);
    expect(result.status).toBe(200);
    expect(result.body.receipts[0]?.scanStatus).toBe('QUARANTINED');
    failure(await reviewer.request(contentPath(receipt.mediaAssetId)), 404);
    failure(
      await owner.request(detailPath(intent.id) + '/submit', {
        method: 'POST',
        idempotencyKey: f.h.key('infected-submit'),
        body: { expectedVersion: result.body.version },
      }),
      409,
      'RECEIPT_NOT_CLEAN',
    );
    expect(
      await f.h.prisma.moneyManualReceiptInspection.count({
        where: { receiptId: receipt.receiptVersionId },
      }),
    ).toBe(0);
  });

  it('records no inspection for absent bytes and excludes finance from identity/public workflows', async () => {
    const intent = await f.createIntent();
    const receipt = await cleanReceipt(intent.id);
    const asset = await f.h.prisma.mediaAsset.findUniqueOrThrow({
      where: { id: receipt.mediaAssetId },
    });
    expect(await f.h.app.get(EvidenceScanService).scanPending()).toMatchObject({ examined: 0 });
    expect(
      await f.h.app.get(EvidenceCleanupService).sweepExpiredPreparations({
        now: new Date(Date.now() + 10 * 86_400_000),
      }),
    ).toMatchObject({ examined: 0 });
    const retention = new EvidenceRetentionRepository(f.h.prisma, f.h.app.get(OutboxRepository));
    const candidates = await retention.candidates(undefined, 100);
    expect(candidates.map((row) => row.id)).not.toContain(asset.id);
    const attach = await owner.request(
      '/v1/me/provider/verification/evidence/' + asset.id + '/finalize',
      { method: 'POST' },
    );
    expect([403, 404, 409]).toContain(attach.status);
    const publicRead = await fetch(f.h.url + '/v1/media/files/' + asset.storageKey);
    expect(publicRead.status).toBe(404);
    await unlink(join(f.h.storageRoot, 'restricted', asset.storageKey));
    failure(await reviewer.request(contentPath(asset.id)), 404);
    expect(
      await f.h.prisma.moneyManualReceiptInspection.count({
        where: { receiptId: receipt.receiptVersionId },
      }),
    ).toBe(0);
  });

  it('preserves correction history, reload/relogin, old bytes and private notes across replacement', async () => {
    const intent = await f.createIntent();
    const first = await cleanReceipt(intent.id);
    const firstInspection = await inspect(first.mediaAssetId);
    const correction = await decision(
      intent.id,
      first.receiptVersionId,
      firstInspection,
      'REQUEST_REPLACEMENT',
    );
    expect(correction.status).toBe(202);
    expect(correction.body.status).toBe('ACTION_REQUIRED');
    owner = await f.h.login('owner');
    const reloaded = await detail(intent.id);
    expect(reloaded.history[0]?.providerMessage).toBe('Please upload the full synthetic page.');
    expect(JSON.stringify(reloaded)).not.toContain('R30_INTERNAL_ONLY_DO_NOT_EXPOSE');
    expect(reloaded.availableActions).toContain('UPLOAD_RECEIPT');
    const second = await cleanReceipt(intent.id);
    expect(second.receiptVersionId).not.toBe(first.receiptVersionId);
    const secondState = await detail(intent.id);
    expect(secondState.receipts.map((row) => row.revision)).toEqual([2, 1]);
    const oldBytes = await owner.request<Uint8Array>(contentPath(first.mediaAssetId), {
      responseType: 'bytes',
    });
    expect(Buffer.from(oldBytes.body)).toEqual(first.bytes);
    failure(
      await decision(intent.id, first.receiptVersionId, firstInspection, 'REJECT'),
      409,
      'STALE_RECEIPT_REVISION',
    );
    await expect(
      f.h.prisma.moneyManualReceiptVersion.update({
        where: { id: first.receiptVersionId },
        data: { mediaAssetId: second.mediaAssetId },
      }),
    ).rejects.toThrow();
    await expect(
      f.h.prisma.mediaAsset.update({
        where: { id: first.mediaAssetId },
        data: { sha256: 'b'.repeat(64) },
      }),
    ).rejects.toThrow();
    const secondInspection = await inspect(second.mediaAssetId);
    const rejected = await decision(intent.id, second.receiptVersionId, secondInspection, 'REJECT');
    expect(rejected.body.status).toBe('REJECTED');
    expect(
      await f.h.prisma.moneyManualReviewDecision.count({ where: { paymentIntentId: intent.id } }),
    ).toBe(2);
    const notices = await f.h.prisma.notification.findMany({
      where: {
        userId: f.h.actors.owner.userId,
        deepLink: '/provider/manual-payments/' + intent.id,
      },
    });
    expect(notices).toHaveLength(2);
    expect(JSON.stringify(notices)).not.toContain('R30_INTERNAL_ONLY_DO_NOT_EXPOSE');
  });

  it('rejects a revoked reviewer and a recorder approving their own independent evidence', async () => {
    const intent = await f.createIntent();
    const receipt = await cleanReceipt(intent.id);
    const inspectionId = await inspect(receipt.mediaAssetId);
    await f.h.revoke('reviewer', R24_PERMISSIONS.receiptView);
    try {
      failure(await reviewer.request(contentPath(receipt.mediaAssetId)), 404);
      failure(await decision(intent.id, receipt.receiptVersionId, inspectionId, 'REJECT'), 403);
    } finally {
      await f.h.grant('reviewer', R24_PERMISSIONS.receiptView);
    }
    const settlementId = await settlement(intent);
    const ownInspection = await inspect(receipt.mediaAssetId, recorder);
    const recorderDetail = await detail(intent.id, recorder, true);
    expect(recorderDetail.settlements.find((row) => row.id === settlementId)?.canApprove).toBe(
      false,
    );
    failure(
      await decision(
        intent.id,
        receipt.receiptVersionId,
        ownInspection,
        'APPROVE',
        settlementId,
        recorder,
      ),
      409,
      'INDEPENDENT_SETTLEMENT_MISMATCH',
    );
    await f.h.revoke('noPermission', R24_PERMISSIONS.receiptSettlement);
    try {
      failure(
        await decision(intent.id, receipt.receiptVersionId, inspectionId, 'APPROVE', settlementId),
        403,
      );
    } finally {
      await f.h.grant('noPermission', R24_PERMISSIONS.receiptSettlement);
    }
    expect(
      await f.h.prisma.moneyPaymentConfirmation.count({ where: { paymentIntentId: intent.id } }),
    ).toBe(0);
  });

  it('deduplicates deposit references and double approval races with one atomic economic effect', async () => {
    const intent = await f.createIntent();
    const receipt = await cleanReceipt(intent.id);
    const inspectionId = await inspect(receipt.mediaAssetId);
    const reference = 'R30-RACE-' + randomUUID();
    const input = {
      reference,
      amount: intent.total,
      occurredAt: new Date().toISOString(),
      evidenceSource: 'SANDBOX_OPERATOR_SIMULATION',
    };
    const deposits = await Promise.all(
      [1, 2].map(() =>
        recorder.request<{ id: string }>(reviewPath(intent.id) + '/settlements', {
          method: 'POST',
          idempotencyKey: f.h.key('deposit-race'),
          body: input,
        }),
      ),
    );
    expect(deposits.map((row) => row.status).sort()).toEqual([201, 409]);
    const settlementId = deposits.find((row) => row.status === 201)!.body.id;
    const state = await detail(intent.id, reviewer, true);
    const body = {
      expectedVersion: state.version,
      receiptVersionId: receipt.receiptVersionId,
      inspectionId,
      action: 'APPROVE',
      settlementId,
      providerMessage: 'Synthetic accepted.',
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        reviewer.request<ManualReviewDetailV1>(reviewPath(intent.id) + '/decisions', {
          method: 'POST',
          idempotencyKey: f.h.key('approval-race'),
          body,
        }),
      ),
    );
    expect(results.map((row) => row.status).sort()).toEqual([202, 409]);
    expect(results.find((row) => row.status === 202)!.body.status).toBe('APPROVED');
    const confirmation = await f.h.prisma.moneyPaymentConfirmation.findUniqueOrThrow({
      where: { paymentIntentId: intent.id },
    });
    expect(
      await f.h.prisma.moneyManualSettlementClaim.count({ where: { paymentIntentId: intent.id } }),
    ).toBe(1);
    expect(
      await f.h.prisma.moneyManualReviewDecision.count({
        where: { paymentIntentId: intent.id, action: 'APPROVED' },
      }),
    ).toBe(1);
    expect(
      await f.h.prisma.subscriptionPeriod.count({
        where: { paymentConfirmationId: confirmation.id },
      }),
    ).toBe(1);
    const claim = await f.h.prisma.moneyManualSettlementClaim.findUniqueOrThrow({
      where: { paymentIntentId: intent.id },
      include: { decision: true },
    });
    expect(claim.decision.action).toBe('APPROVED');
    expect(
      await f.h.prisma.platformSetting.count({
        where: { key: { startsWith: 'it-r30-activation-contract:' } },
      }),
    ).toBeGreaterThan(0);
    completedIntent = intent;
    completedBytes = receipt.bytes;
  });

  it('rejects a previously approved receipt fingerprint on a fresh obligation', async () => {
    expect(completedIntent).toBeDefined();
    const intent = await f.createIntent();
    const receipt = await reserve(intent.id, completedBytes);
    expect((await put(receipt.mediaAssetId, completedBytes)).status).toBe(200);
    failure(await finalize(receipt.mediaAssetId), 409, 'APPROVED_RECEIPT_REUSE');
    expect(
      await f.h.prisma.moneyPaymentConfirmation.count({ where: { paymentIntentId: intent.id } }),
    ).toBe(0);
  });

  it('serializes identical evidence approved concurrently for two distinct obligations', async () => {
    const bytes = pdf();
    const intents = [await f.createIntent(), await f.createIntent()];
    const receipts = [
      await cleanReceipt(intents[0]!.id, bytes),
      await cleanReceipt(intents[1]!.id, bytes),
    ];
    const inspectionIds = [
      await inspect(receipts[0]!.mediaAssetId),
      await inspect(receipts[1]!.mediaAssetId),
    ];
    const settlementIds = [await settlement(intents[0]!), await settlement(intents[1]!)];
    const results = await Promise.all(
      intents.map((intent, index) =>
        decision(
          intent.id,
          receipts[index]!.receiptVersionId,
          inspectionIds[index]!,
          'APPROVE',
          settlementIds[index],
        ),
      ),
    );
    expect(results.map((row) => row.status)).toEqual([202, 202]);
    expect(results.map((row) => row.body.status).sort()).toEqual([
      'APPROVED',
      'RECONCILIATION_REQUIRED',
    ]);
    expect(
      await f.h.prisma.moneyPaymentConfirmation.count({
        where: { paymentIntentId: { in: intents.map((row) => row.id) } },
      }),
    ).toBe(1);
    expect(
      await f.h.prisma.moneyManualSettlementClaim.count({
        where: { paymentIntentId: { in: intents.map((row) => row.id) } },
      }),
    ).toBe(1);
  });

  it('rolls final receipt claim, ledger, period and notice back together, then recovers the durable event', async () => {
    const intent = await f.createIntent();
    const receipt = await cleanReceipt(intent.id);
    const inspectionId = await inspect(receipt.mediaAssetId);
    const settlementId = await settlement(intent);
    f.activation.fail = true;
    const pending = await decision(
      intent.id,
      receipt.receiptVersionId,
      inspectionId,
      'APPROVE',
      settlementId,
    );
    expect(pending.status).toBe(202);
    expect(pending.body.status).toBe('CONFIRMING');
    const event = await f.h.prisma.moneyExternalEvent.findFirstOrThrow({
      where: { paymentIntentId: intent.id },
    });
    expect(event.status).toBe('RECEIVED');
    expect(
      await f.h.prisma.moneyManualSettlementClaim.count({ where: { paymentIntentId: intent.id } }),
    ).toBe(0);
    expect(
      await f.h.prisma.moneyPaymentConfirmation.count({ where: { paymentIntentId: intent.id } }),
    ).toBe(0);
    expect(
      await f.h.prisma.moneyManualReviewDecision.count({
        where: { paymentIntentId: intent.id, action: 'APPROVED' },
      }),
    ).toBe(0);
    expect(
      await f.h.prisma.notification.count({
        where: { deepLink: '/provider/manual-payments/' + intent.id },
      }),
    ).toBe(0);
    f.activation.fail = false;
    expect(await f.h.app.get(ManualEventProcessingJob).process(intent.id)).toBe(true);
    const approved = await detail(intent.id);
    expect(approved.status).toBe('APPROVED');
    expect(
      await f.h.prisma.moneyManualSettlementClaim.count({ where: { paymentIntentId: intent.id } }),
    ).toBe(1);
    const command = f.h.app.get(MoneyCommandService);
    await command.processExternalEvent(event.id);
    expect(
      await f.h.prisma.notification.count({
        where: { deepLink: '/provider/manual-payments/' + intent.id },
      }),
    ).toBe(1);
  });

  it('stops permanent revoked-authority retries and permits only the restored original reviewer to reconcile', async () => {
    const intent = await f.createIntent();
    const receipt = await cleanReceipt(intent.id);
    const inspectionId = await inspect(receipt.mediaAssetId);
    const settlementId = await settlement(intent);
    f.activation.configured = false;
    const waiting = await decision(
      intent.id,
      receipt.receiptVersionId,
      inspectionId,
      'APPROVE',
      settlementId,
    );
    expect(waiting.body.status).toBe('CONFIRMING');
    expect(waiting.body.processing?.reason).toBe('MONEY_ACTIVATION_UNAVAILABLE');
    await f.h.revoke('reviewer', R24_PERMISSIONS.receiptReview);
    try {
      expect(await f.h.app.get(ManualEventProcessingJob).process(intent.id)).toBe(false);
      const state = await detail(intent.id, reviewer, true);
      expect(state.status).toBe('RECONCILIATION_REQUIRED');
      expect(state.processing).toMatchObject({ reconciliationRequired: true, canRetry: false });
      const attempts = state.processing?.attemptCount;
      await f.h.app.get(ManualEventProcessingJob).process(intent.id);
      expect((await detail(intent.id, reviewer, true)).processing?.attemptCount).toBe(attempts);
      failure(
        await recorder.request(reviewPath(intent.id) + '/retry', {
          method: 'POST',
          idempotencyKey: f.h.key('wrong-retry'),
          body: { expectedVersion: state.version },
        }),
        409,
        'RECONCILIATION_REVIEW_REQUIRED',
      );
    } finally {
      await f.h.grant('reviewer', R24_PERMISSIONS.receiptReview);
    }
    f.activation.configured = true;
    const state = await detail(intent.id, reviewer, true);
    expect(state.processing?.canRetry).toBe(true);
    const retry = await reviewer.request<ManualReviewDetailV1>(reviewPath(intent.id) + '/retry', {
      method: 'POST',
      idempotencyKey: f.h.key('retry'),
      body: { expectedVersion: state.version },
    });
    expect(retry.status).toBe(202);
    expect(retry.body.status).toBe('APPROVED');
  });

  it('fences concurrent PostgreSQL failure transitions and exposes the eighth failure for reconciliation', async () => {
    const intent = await f.createIntent();
    const receipt = await cleanReceipt(intent.id);
    const inspectionId = await inspect(receipt.mediaAssetId);
    const settlementId = await settlement(intent);
    f.activation.configured = false;
    const waiting = await decision(
      intent.id,
      receipt.receiptVersionId,
      inspectionId,
      'APPROVE',
      settlementId,
    );
    expect(waiting.body.status).toBe('CONFIRMING');
    const original = await f.h.prisma.moneyManualReview.update({
      where: { paymentIntentId: intent.id },
      data: { attemptCount: 6, nextAttemptAt: new Date(0) },
    });
    const job = f.h.app.get(ManualEventProcessingJob);
    const commands = f.h.app.get(MoneyCommandService);
    const failures: Array<(error: Error) => void> = [];
    let bothEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    // Hold only the failing external-event call. The receipt acceptance,
    // immutable candidate and compare-and-set writes use real PostgreSQL.
    const eventFailure = jest.spyOn(commands, 'processExternalEvent').mockImplementation(
      () =>
        new Promise<never>((_, reject) => {
          failures.push(reject);
          if (failures.length === 2) bothEntered();
        }),
    );
    try {
      const processing = Promise.all([job.process(intent.id), job.process(intent.id)]);
      await entered;
      failures[0]!(new Error('Concurrent failure A'));
      failures[1]!(new Error('Concurrent failure B'));
      await expect(processing).resolves.toEqual([false, false]);
      expect(
        await f.h.prisma.moneyManualReview.findUniqueOrThrow({
          where: { paymentIntentId: intent.id },
        }),
      ).toMatchObject({
        attemptCount: 7,
        reconciliationRequired: false,
        pendingDecisionId: original.pendingDecisionId,
        version: original.version,
      });
    } finally {
      eventFailure.mockRestore();
    }

    expect(await job.process(intent.id)).toBe(false);
    const halted = await detail(intent.id, reviewer, true);
    expect(halted.status).toBe('RECONCILIATION_REQUIRED');
    expect(halted.processing).toMatchObject({
      attemptCount: 8,
      reconciliationRequired: true,
      canRetry: true,
    });
    expect(halted.availableActions).toContain('RETRY_CONFIRMATION');
    expect(await job.process(intent.id)).toBe(false);
    expect((await detail(intent.id, reviewer, true)).processing?.attemptCount).toBe(8);
    expect(
      await f.h.prisma.moneyPaymentConfirmation.count({ where: { paymentIntentId: intent.id } }),
    ).toBe(0);
    expect(
      await f.h.prisma.moneyManualSettlementClaim.count({ where: { paymentIntentId: intent.id } }),
    ).toBe(0);
  });

  it('retains unknown operator refunds until an independent recorded confirmation', async () => {
    const confirmation = await f.h.prisma.moneyPaymentConfirmation.findUniqueOrThrow({
      where: { paymentIntentId: completedIntent.id },
    });
    const request = await owner.request<{ id: string }>('/v1/money/refund-requests', {
      method: 'POST',
      idempotencyKey: f.h.key('refund-request'),
      body: {
        ...VERSION,
        paymentConfirmationId: confirmation.id,
        amount: { amountMinor: '200', currency: 'XTS' },
        reasonCode: 'R30_SANDBOX_CONTRACT',
      },
    });
    expect(request.status).toBe(202);
    const reservation = await reviewer.request<{ id: string }>(
      '/v1/money/review/refund-requests/' + request.body.id + '/reserve',
      {
        method: 'POST',
        idempotencyKey: f.h.key('refund-reserve'),
        body: VERSION,
      },
    );
    expect(reservation.status).toBe(201);
    const refundId = reservation.body.id;
    const dispatch = await reviewer.request('/v1/money/review/refunds/' + refundId + '/dispatch', {
      method: 'POST',
      idempotencyKey: f.h.key('refund-dispatch'),
      body: VERSION,
    });
    expect(dispatch.status).toBe(202);
    const firstOperation = await f.h.prisma.moneyManualRefundOperation.findUniqueOrThrow({
      where: { refundId },
    });
    expect(firstOperation).toMatchObject({ state: 'PENDING', externalOperationId: null });
    const evidence = {
      amount: { amountMinor: '200', currency: 'XTS' },
      externalOperationId: 'sandbox-return-' + randomUUID(),
      evidenceSource: 'SANDBOX_OPERATOR_SIMULATION',
    };
    const dispatched = await recorder.request(
      '/v1/money/manual/review/refunds/' + refundId + '/evidence',
      {
        method: 'POST',
        idempotencyKey: f.h.key('operator-dispatch'),
        body: { ...evidence, type: 'DISPATCH' },
      },
    );
    expect(dispatched.status).toBe(201);
    expect(
      await f.h.prisma.moneyManualRefundOperation.findUniqueOrThrow({ where: { refundId } }),
    ).toMatchObject({ state: 'UNKNOWN' });
    const confirmedInput = {
      ...evidence,
      type: 'CONFIRM_SUCCEEDED',
      reference: 'sandbox-received-' + randomUUID(),
    };
    failure(
      await recorder.request('/v1/money/manual/review/refunds/' + refundId + '/evidence', {
        method: 'POST',
        idempotencyKey: f.h.key('self-refund'),
        body: confirmedInput,
      }),
      409,
      'INDEPENDENT_REFUND_CONFIRMATION_REQUIRED',
    );
    const confirmed = await reviewer.request(
      '/v1/money/manual/review/refunds/' + refundId + '/evidence',
      {
        method: 'POST',
        idempotencyKey: f.h.key('independent-refund'),
        body: confirmedInput,
      },
    );
    expect(confirmed.status).toBe(201);
    const operation = await f.h.prisma.moneyManualRefundOperation.findUniqueOrThrow({
      where: { refundId },
    });
    expect(operation.state).toBe('SUCCEEDED');
    expect(operation.providerIdempotencyKey).toBe(firstOperation.providerIdempotencyKey);
    expect(operation.confirmationUserId).not.toBe(operation.dispatchUserId);
    expect(await f.h.prisma.moneyManualRefundEvent.count({ where: { refundId } })).toBe(2);
    await expect(
      f.h.prisma.moneyManualRefundEvent.updateMany({
        where: { refundId },
        data: { evidenceSource: 'CHANGED' },
      }),
    ).rejects.toThrow();
  });

  it('paginates active provider records even when retained historical providers are deleted', async () => {
    const intent = await f.createIntent(outsider);
    const profileId = f.h.actors.otherProvider.providerProfileId!;
    await f.h.prisma.providerProfile.update({
      where: { id: profileId },
      data: { deletedAt: new Date() },
    });
    try {
      const queue = await reviewer.request<{ items: Array<{ paymentIntentId: string }> }>(
        '/v1/money/manual/review/intents',
      );
      expect(queue.status).toBe(200);
      expect(queue.body.items.some((row) => row.paymentIntentId === intent.id)).toBe(false);
      expect(queue.body.items.length).toBeGreaterThan(0);
    } finally {
      await f.h.prisma.providerProfile.update({
        where: { id: profileId },
        data: { deletedAt: null },
      });
    }
  });

  it('retries a current failed scan without starving behind ten superseded failed revisions', async () => {
    const intent = await f.createIntent();
    const uploads = f.h.app.get(ReceiptUploadService);
    const bytes = pdf();
    let expectedVersion = 0;
    // Direct authorized service reservations avoid consuming the HTTP upload
    // budget. Historical SCAN_FAILED metadata is a failure fixture, never
    // accepted scanner evidence, and none of these abandoned bytes is trusted.
    for (let revision = 0; revision < 10; revision++) {
      const old = await uploads.reserve(f.h.actors.owner.userId, f.h.key('abandoned'), intent.id, {
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        expectedVersion,
        filename: 'synthetic.pdf',
      });
      expectedVersion = old.version;
      await f.h.prisma.mediaAsset.update({
        where: { id: old.mediaAssetId },
        data: {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          detectedMimeType: 'application/pdf',
          uploadCompletedAt: new Date(),
          scanState: 'SCAN_FAILED',
          scannedAt: new Date(Date.now() - 600_000),
        },
      });
    }
    const current = await reserve(intent.id, bytes);
    expect((await put(current.mediaAssetId, bytes)).status).toBe(200);
    await f.h.prisma.mediaAsset.update({
      where: { id: current.mediaAssetId },
      data: {
        uploadCompletedAt: new Date(),
        scanState: 'SCAN_FAILED',
        scannedAt: new Date(Date.now() - 600_000),
      },
    });
    expect(await uploads.retryScans(10)).toBeGreaterThan(0);
    expect(
      await f.h.prisma.mediaAsset.findUniqueOrThrow({ where: { id: current.mediaAssetId } }),
    ).toMatchObject({ scanState: 'CLEAN' });
    expect(
      await f.h.prisma.moneyManualReceiptVersion.count({
        where: {
          paymentIntentId: intent.id,
          mediaAsset: { scanState: 'SCAN_FAILED' },
        },
      }),
    ).toBe(10);
  });

  it('enforces the actual thirty-per-hour upload guard in the isolated real Redis namespace', async () => {
    let blocked = false;
    for (let attempt = 0; attempt < 31; attempt++) {
      const response = await owner.request(contentPath('missing-test-asset'), {
        method: 'PUT',
        rawBody: new Uint8Array(),
        headers: { 'content-type': 'image/gif' },
      });
      if (response.status === 429) {
        failure(response, 429);
        expect(response.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
        expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
        blocked = true;
        break;
      }
      expect(response.status).toBe(400);
      expect(
        Number(
          response.headers.get('x-ratelimit-limit') ??
            response.headers.get('x-ratelimit-limit-default'),
        ),
      ).toBe(30);
    }
    expect(blocked).toBe(true);
  });
});
