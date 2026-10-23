import type { PrismaTx } from '@homeservicemarketplace/database';
import { toMoneyWire } from '@homeservicemarketplace/contracts';
import type { AuditService } from '../../iam/audit/audit.service';
import type { ManualRailConfiguration } from '../adapters/manual/manual-rail.config';
import type { MoneyTransportBinding } from '../ports/collection.port';
import { manualConflict, type ManualReviewService } from './manual-review.service';
import { ReceiptAcceptanceParticipant } from './receipt-acceptance.participant';

describe('R30 immutable review candidate enlists at the R24 confirmation boundary', () => {
  function fixture() {
    const binding: MoneyTransportBinding = {
      planVersionId: 'plan',
      method: 'CASH_OFFICE',
      adapterId: 'hsm.manual.v1',
      mode: 'SANDBOX',
      accountReference: 'sandbox',
      configVersion: 'v1',
      currency: 'XTS',
      debitAccountId: 'debit',
      creditAccountId: 'credit',
    };
    const settlement = {
      id: 'settlement',
      referenceCanonical: 'TEST-001',
      amountMinor: 1000n,
      currency: 'XTS',
      occurredAt: new Date(),
      recordedByUserId: 'independent-recorder',
    };
    const decision = {
      id: 'pending',
      paymentIntentId: 'intent',
      receiptId: 'receipt',
      inspectionId: 'inspection',
      reviewerUserId: 'reviewer',
      action: 'PENDING_APPROVAL',
      expectedVersion: 2,
      settlementId: 'settlement',
      providerMessage: 'Synthetic acceptance',
      internalNote: 'not public',
    };
    const receipt = {
      id: 'receipt',
      mediaAssetId: 'asset',
      submittedAt: new Date(),
      mediaAsset: {
        purpose: 'FINANCIAL_RECEIPT',
        visibility: 'RESTRICTED',
        ownerUserId: 'owner',
        uploadCompletedAt: new Date(),
        scanState: 'CLEAN',
        sha256: 'a'.repeat(64),
        deletedAt: null,
        erasureStartedAt: null,
      },
    };
    const tx = {
      moneyManualReview: {
        findUnique: jest.fn().mockResolvedValue({
          state: 'CONFIRMING',
          pendingDecisionId: 'pending',
          currentReceiptId: 'receipt',
          version: 3,
        }),
        update: jest.fn(),
      },
      moneyManualReviewDecision: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(decision),
        create: jest.fn().mockResolvedValue({ id: 'final-approved' }),
      },
      moneyManualReceiptVersion: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(receipt),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      moneyManualReceiptInspection: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'inspection',
          receiptId: 'receipt',
          reviewerUserId: 'reviewer',
          sha256: 'a'.repeat(64),
        }),
      },
      moneyManualSettlementClaim: { create: jest.fn() },
      moneyPaymentAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
      $executeRaw: jest.fn(),
    };
    const review = {
      authorize: jest.fn(),
      context: jest.fn().mockResolvedValue({
        binding,
        ownerUserId: 'owner',
        intent: {
          id: 'intent',
          providerProfileId: 'profile',
          totalMinor: 1000n,
          expiresAt: new Date(Date.now() + 60_000),
          status: 'PROCESSING',
        },
      }),
      validateSettlement: jest.fn().mockResolvedValue(settlement),
      notice: jest.fn(),
    };
    const audit = { record: jest.fn() };
    const participant = new ReceiptAcceptanceParticipant(
      review as unknown as ManualReviewService,
      {
        instruction: jest.fn().mockResolvedValue({ maxAmountMinor: 2000n }),
      } as unknown as ManualRailConfiguration,
      audit as unknown as AuditService,
    );
    const client = tx as unknown as PrismaTx;
    const input = {
      binding,
      ownerUserId: 'owner',
      reviewerUserId: 'reviewer',
      paymentIntentId: 'intent',
      receiptMediaAssetId: 'asset',
      idempotencyKey: 'r30_accept_key',
    };
    return { participant, review, tx, audit, client, input };
  }

  it('normalizes independently recorded settlement without treating an image digest as funds', async () => {
    const f = fixture();
    await expect(f.participant.accept(f.input, f.client)).resolves.toMatchObject({
      source: 'MANUAL_REVIEW',
      externalConfirmationId: 'TEST-001',
      externalOperationId: null,
      externalEventId: 'manual-decision:pending',
      amount: { amountMinor: '1000', currency: 'XTS' },
    });
    expect(f.tx.moneyManualSettlementClaim.create).not.toHaveBeenCalled();
  });

  it('uses the same transaction for final decision, unique claim, state and notice', async () => {
    const f = fixture();
    const event = await f.participant.accept(f.input, f.client);
    await f.participant.finalizeConfirmation(event, f.client);
    expect(f.tx.moneyManualReviewDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'APPROVED',
        inspectionId: 'inspection',
        settlementId: 'settlement',
      }),
    });
    expect(f.tx.moneyManualSettlementClaim.create).toHaveBeenCalledWith({
      data: {
        settlementId: 'settlement',
        paymentIntentId: 'intent',
        decisionId: 'final-approved',
      },
    });
    expect(f.review.notice).toHaveBeenCalledWith(
      'owner',
      'intent',
      'final-approved',
      'Synthetic acceptance',
      'reviewer',
      f.client,
    );
    expect(f.audit.record.mock.calls[0]?.[1]).toBe(f.client);
  });

  it('rechecks independent authority at finalization and leaves the candidate unconsumed on revocation', async () => {
    const f = fixture();
    const event = await f.participant.accept(f.input, f.client);
    f.review.validateSettlement.mockRejectedValue(manualConflict('REVOKED_SETTLEMENT_AUTHORITY'));
    await expect(f.participant.finalizeConfirmation(event, f.client)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(f.tx.moneyManualSettlementClaim.create).not.toHaveBeenCalled();
    expect(f.tx.moneyManualReview.update).not.toHaveBeenCalled();
  });

  it('refuses an inspection for a different revision and forged normalized amount', async () => {
    const f = fixture();
    const event = await f.participant.accept(f.input, f.client);
    await expect(
      f.participant.finalizeConfirmation(
        { ...event, amount: toMoneyWire({ amountMinor: 999n, currency: 'XTS' }) },
        f.client,
      ),
    ).rejects.toMatchObject({ details: { reason: 'MANUAL_EVENT_MISMATCH' } });
    f.tx.moneyManualReceiptInspection.findUnique.mockResolvedValue({
      id: 'inspection',
      receiptId: 'old',
      reviewerUserId: 'reviewer',
      sha256: 'a'.repeat(64),
    });
    await expect(f.participant.accept(f.input, f.client)).rejects.toMatchObject({
      details: { reason: 'CURRENT_RECEIPT_INSPECTION_REQUIRED' },
    });
    expect(f.tx.moneyManualReviewDecision.create).not.toHaveBeenCalled();
  });

  it('refuses approved same-provider bytes before consuming another economic reference', async () => {
    const f = fixture();
    const event = await f.participant.accept(f.input, f.client);
    f.tx.moneyManualReceiptVersion.findFirst.mockResolvedValue({ id: 'previously-paid-receipt' });
    await expect(f.participant.finalizeConfirmation(event, f.client)).rejects.toMatchObject({
      details: { reason: 'APPROVED_RECEIPT_REUSE' },
    });
    expect(f.tx.moneyManualSettlementClaim.create).not.toHaveBeenCalled();
  });
});
