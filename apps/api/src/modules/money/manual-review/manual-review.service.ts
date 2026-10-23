import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  canonicalJson,
  fromMoneyWire,
  MONEY_CONTRACT_VERSION,
  toMoneyWire,
  type ManualPaymentDetailV1,
  type ManualReviewDetailV1,
  type ManualReviewDecisionRequestV1,
  type ManualSettlementRequestV1,
  type ManualPaymentQueuePageV1,
  type ManualPaymentMethodV1,
} from '@homeservicemarketplace/contracts';
import { Prisma, type PrismaTx } from '@homeservicemarketplace/database';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { AuditService } from '../../iam/audit/audit.service';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { moneyCommandDigest } from '../application/money-command.service';
import {
  ManualRailConfiguration,
  MANUAL_METHODS,
  manualInstructionsSchema,
} from '../adapters/manual/manual-rail.config';
import { type MoneyTransportBinding, unavailableMoneyPort } from '../ports/collection.port';

export const MANUAL_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };
export function manualNotFound(): AppError {
  return new AppError('NOT_FOUND', 'Payment resource not found.', 404);
}
export function manualConflict(reason: string): AppError {
  return new AppError(
    'CONFLICT',
    'The payment changed. Reload and review its current state.',
    409,
    { reason },
  );
}
export function manualInvalid(reason: string): AppError {
  return new AppError('VALIDATION_ERROR', 'Invalid manual-payment request.', 400, { reason });
}
export function manualId(id: string): string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(id)) throw manualNotFound();
  return id;
}
export function manualDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
export function manualJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export function manualKey(key: string): string {
  if (
    typeof key !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/u.test(key) ||
    ['r24_event_', 'r24_process_', 'r24_refund_result_'].some((prefix) => key.startsWith(prefix))
  )
    throw manualInvalid('INVALID_IDEMPOTENCY_KEY');
  return key;
}

@Injectable()
export class ManualReviewService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly permissions: PermissionResolverService,
    private readonly config: ManualRailConfiguration,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async authorize(userId: string, permission: string, tx: PrismaTx): Promise<Set<string>> {
    manualId(userId);
    const rights = await this.permissions.resolveFreshForUser(userId, tx);
    const role = permission.endsWith(':self') ? 'provider' : 'admin';
    if (
      !rights.has(permission) ||
      !(await tx.user.findFirst({
        where: {
          id: userId,
          status: 'ACTIVE',
          isActive: true,
          deletedAt: null,
          userRoles: { some: { role: { name: role, deletedAt: null } } },
        },
        select: { id: true },
      }))
    )
      throw new AppError('FORBIDDEN', 'A current money permission is required.', 403);
    return rights;
  }

  async context(paymentIntentId: string, tx: PrismaTx, ownerUserId?: string) {
    const intent = await tx.moneyPaymentIntent.findUnique({
      where: { id: manualId(paymentIntentId) },
      include: { providerProfile: true, binding: true },
    });
    if (
      !intent ||
      !(MANUAL_METHODS as readonly string[]).includes(intent.method) ||
      !intent.binding ||
      intent.providerProfile.deletedAt ||
      !intent.providerProfile.userId ||
      (ownerUserId !== undefined &&
        (intent.providerProfile.userId !== ownerUserId ||
          ['SUSPENDED', 'REJECTED'].includes(intent.providerProfile.status)))
    )
      throw manualNotFound();
    const binding: MoneyTransportBinding = {
      planVersionId: intent.planVersionId,
      method: intent.method,
      currency: intent.currency,
      adapterId: intent.binding.adapterId,
      mode: intent.binding.mode,
      accountReference: intent.binding.accountReference,
      configVersion: intent.binding.configVersion,
      debitAccountId: intent.binding.debitAccountId,
      creditAccountId: intent.binding.creditAccountId,
    };
    return { intent, binding, ownerUserId: intent.providerProfile.userId };
  }

  async lockIntent(paymentIntentId: string, tx: PrismaTx): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "MoneyPaymentIntent" WHERE "id" = ${manualId(paymentIntentId)} FOR UPDATE`;
  }

  async editable(paymentIntentId: string, tx: PrismaTx, ownerUserId?: string) {
    const context = await this.context(paymentIntentId, tx, ownerUserId);
    if (
      !['CREATED', 'AWAITING_PAYMENT'].includes(context.intent.status) ||
      context.intent.expiresAt <= new Date()
    )
      throw manualConflict('OBLIGATION_NOT_EDITABLE');
    const instruction = await this.config.instruction(context.binding, tx);
    if (context.intent.totalMinor <= 0n || context.intent.totalMinor > instruction.maxAmountMinor)
      throw unavailableMoneyPort('APPROVAL_THRESHOLD_EXCEEDED');
    return { ...context, instruction };
  }

  async runMutation<T>(
    userId: string,
    key: string,
    action: string,
    request: unknown,
    permission: string,
    check: (tx: PrismaTx) => Promise<unknown>,
    execute: (tx: PrismaTx) => Promise<T>,
  ): Promise<T> {
    manualKey(key);
    canonicalJson(request);
    try {
      return await this.transactions.run(async (tx) => {
        await this.authorize(userId, permission, tx);
        await check(tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`r24.money.command:${key}`}, 0))`;
        const prior = await tx.moneyCommand.findUnique({ where: { idempotencyKey: key } });
        if (prior) {
          const stored = prior.response as { request?: unknown; value?: T; authority?: unknown };
          if (
            prior.actorUserId !== userId ||
            prior.actorSystem ||
            prior.action !== action ||
            !Object.hasOwn(stored, 'value') ||
            canonicalJson(stored.request) !== canonicalJson(request) ||
            moneyCommandDigest({ userId }, action, request, stored.authority) !==
              prior.requestDigest
          )
            throw manualConflict('IDEMPOTENCY_CONFLICT');
          return stored.value as T;
        }
        const value = await execute(tx);
        const authority = { session: 'R30', mode: 'SANDBOX' };
        const command = await tx.moneyCommand.create({
          data: {
            id: randomUUID(),
            idempotencyKey: key,
            actorUserId: userId,
            action,
            contractVersion: MONEY_CONTRACT_VERSION,
            requestDigest: moneyCommandDigest({ userId }, action, request, authority),
            response: manualJson({ request, value, authority }),
          },
        });
        await this.audit.record(
          {
            type: 'MONEY_COMMAND_ACCEPTED',
            userId,
            metadata: { moneyCommandId: command.id, moneyAction: action },
          },
          tx,
        );
        return value;
      }, MANUAL_TX_OPTIONS);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2004'].includes(error.code)
      )
        throw manualConflict('MANUAL_STORED_STATE_CONFLICT');
      throw error;
    }
  }

  async detail(
    userId: string,
    paymentIntentId: string,
    reviewer = false,
  ): Promise<ManualPaymentDetailV1 | ManualReviewDetailV1> {
    return this.transactions.run(
      (tx) => this.detailInTransaction(userId, paymentIntentId, reviewer, tx),
      { ...MANUAL_TX_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async detailInTransaction(
    userId: string,
    paymentIntentId: string,
    reviewer: boolean,
    tx: PrismaTx,
  ): Promise<ManualPaymentDetailV1 | ManualReviewDetailV1> {
    const rights = await this.authorize(
      userId,
      reviewer ? 'money:review:read' : 'money:read:self',
      tx,
    );
    const { intent, binding, ownerUserId } = await this.context(
      paymentIntentId,
      tx,
      reviewer ? undefined : userId,
    );
    const configured = await this.config.resolveBinding(binding, tx);
    const instruction = configured ? await this.config.instruction(binding, tx) : null;
    const review = await tx.moneyManualReview.findUnique({ where: { paymentIntentId } });
    const receipts = await tx.moneyManualReceiptVersion.findMany({
      where: { paymentIntentId },
      orderBy: { revision: 'desc' },
      include: { mediaAsset: true },
      take: 100,
    });
    const decisions = await tx.moneyManualReviewDecision.findMany({
      where: { paymentIntentId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const current = receipts.find((receipt) => receipt.id === review?.currentReceiptId);
    const currentClean =
      current?.mediaAsset.scanState === 'CLEAN' &&
      current.submittedAt !== null &&
      current.mediaAsset.uploadCompletedAt !== null &&
      !current.mediaAsset.deletedAt &&
      !current.mediaAsset.erasureStartedAt;
    const enabled =
      instruction !== null &&
      intent.totalMinor > 0n &&
      intent.totalMinor <= instruction.maxAmountMinor;
    const state = review?.state ?? 'RECEIPT_REQUIRED';
    const pendingDecision = decisions.find((decision) => decision.id === review?.pendingDecisionId);
    const canRetry =
      reviewer &&
      !!review?.reconciliationRequired &&
      state === 'CONFIRMING' &&
      pendingDecision?.reviewerUserId === userId &&
      ownerUserId !== userId &&
      enabled &&
      intent.expiresAt > new Date() &&
      currentClean &&
      rights.has('money:receipt:review') &&
      rights.has('money:receipt:view');
    const editable =
      enabled &&
      ['CREATED', 'AWAITING_PAYMENT'].includes(intent.status) &&
      intent.expiresAt > new Date();
    const availableActions: ManualPaymentDetailV1['availableActions'] = [];
    if (
      !reviewer &&
      editable &&
      rights.has('money:purchase:self') &&
      ['RECEIPT_REQUIRED', 'ACTION_REQUIRED'].includes(state)
    ) {
      availableActions.push('UPLOAD_RECEIPT');
      if (
        current?.mediaAsset.scanState === 'CLEAN' &&
        current.mediaAsset.uploadCompletedAt &&
        !current.submittedAt
      )
        availableActions.push('SUBMIT');
    }
    if (
      reviewer &&
      editable &&
      ownerUserId !== userId &&
      state === 'IN_REVIEW' &&
      currentClean &&
      rights.has('money:receipt:review') &&
      rights.has('money:receipt:view')
    )
      availableActions.push('APPROVE', 'REJECT', 'REQUEST_REPLACEMENT');
    if (reviewer && editable && ownerUserId !== userId && rights.has('money:receipt:settlement'))
      availableActions.push('RECORD_SETTLEMENT');
    if (canRetry) availableActions.push('RETRY_CONFIRMATION');
    const detail: ManualPaymentDetailV1 = {
      contractVersion: MONEY_CONTRACT_VERSION,
      paymentIntentId,
      method: intent.method as ManualPaymentMethodV1,
      mode: binding.mode,
      status: review?.reconciliationRequired ? 'RECONCILIATION_REQUIRED' : state,
      amount: toMoneyWire({ amountMinor: intent.totalMinor, currency: intent.currency }),
      minorUnitScale: instruction?.minorUnitScale ?? null,
      expiresAt: intent.expiresAt.toISOString(),
      version: review?.version ?? 0,
      availability: enabled ? 'ENABLED' : 'METHOD_DISABLED',
      disabledReason: enabled ? null : 'METHOD_DISABLED',
      instructions: instruction
        ? {
            version: instruction.configVersion,
            text: manualInstructionsSchema.parse(instruction.instructions),
          }
        : null,
      uploadPolicy: instruction
        ? {
            maxBytes: instruction.receiptMaxBytes,
            allowedContentTypes: ['image/jpeg', 'image/png', 'application/pdf'],
          }
        : null,
      currentReceiptVersionId: review?.currentReceiptId ?? null,
      receipts: receipts.map((receipt) => ({
        id: receipt.id,
        mediaAssetId: receipt.mediaAssetId,
        revision: receipt.revision,
        contentType: receipt.mediaAsset.detectedMimeType,
        scanStatus: receipt.mediaAsset.scanState,
        createdAt: receipt.createdAt.toISOString(),
        submittedAt: receipt.submittedAt?.toISOString() ?? null,
        canRead:
          receipt.mediaAsset.scanState === 'CLEAN' &&
          receipt.mediaAsset.uploadCompletedAt !== null &&
          !receipt.mediaAsset.deletedAt &&
          !receipt.mediaAsset.erasureStartedAt &&
          (!reviewer || rights.has('money:receipt:view')),
      })),
      history: decisions
        .filter((decision) => decision.action !== 'PENDING_APPROVAL')
        .map((decision) => ({
          id: decision.id,
          action: decision.action,
          providerMessage: decision.providerMessage,
          createdAt: decision.createdAt.toISOString(),
        })),
      availableActions,
    };
    if (!reviewer) return detail;
    const settlements = await tx.moneyManualSettlement.findMany({
      where: {
        adapterId: binding.adapterId,
        mode: binding.mode,
        accountReference: binding.accountReference,
        amountMinor: intent.totalMinor,
        currency: intent.currency,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    const claims = await tx.moneyManualSettlementClaim.findMany({
      where: { settlementId: { in: settlements.map((item) => item.id) } },
    });
    return {
      ...detail,
      processing: {
        reason: review?.lastErrorCode ?? null,
        reconciliationRequired: review?.reconciliationRequired ?? false,
        attemptCount: review?.attemptCount ?? 0,
        canRetry: Boolean(canRetry),
      },
      reviewHistory: decisions.map((decision) => ({
        id: decision.id,
        action: decision.action,
        providerMessage: decision.providerMessage,
        internalNote: decision.internalNote,
        reviewerUserId: decision.reviewerUserId,
        createdAt: decision.createdAt.toISOString(),
      })),
      settlements: settlements.map((settlement) => ({
        id: settlement.id,
        reference: settlement.referenceCanonical,
        amount: toMoneyWire({ amountMinor: settlement.amountMinor, currency: settlement.currency }),
        occurredAt: settlement.occurredAt.toISOString(),
        recordedByUserId: settlement.recordedByUserId,
        evidenceSource: settlement.evidenceSource,
        canApprove:
          settlement.recordedByUserId !== userId &&
          settlement.recordedByUserId !== ownerUserId &&
          !claims.some((claim) => claim.settlementId === settlement.id),
      })),
    };
  }

  async queue(userId: string, cursor?: string): Promise<ManualPaymentQueuePageV1> {
    return this.transactions.run(async (tx) => {
      await this.authorize(userId, 'money:review:read', tx);
      let anchor: { createdAt: Date; id: string } | null = null;
      if (cursor) {
        anchor = await tx.moneyPaymentIntent.findFirst({
          where: {
            id: manualId(cursor),
            method: { in: [...MANUAL_METHODS] },
            providerProfile: { deletedAt: null, userId: { not: null } },
          },
          select: { createdAt: true, id: true },
        });
        if (!anchor) throw manualInvalid('INVALID_CURSOR');
      }
      const rows = await tx.moneyPaymentIntent.findMany({
        where: {
          method: { in: [...MANUAL_METHODS] },
          providerProfile: { deletedAt: null, userId: { not: null } },
          ...(anchor
            ? {
                OR: [
                  { createdAt: { lt: anchor.createdAt } },
                  { createdAt: anchor.createdAt, id: { lt: anchor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 21,
      });
      const items = [];
      for (const row of rows.slice(0, 20)) {
        const detail = await this.detailInTransaction(userId, row.id, true, tx);
        items.push({
          paymentIntentId: row.id,
          method: detail.method,
          amount: detail.amount,
          minorUnitScale: detail.minorUnitScale,
          status: detail.status,
          updatedAt: row.updatedAt.toISOString(),
        });
      }
      return { items, nextCursor: rows.length > 20 ? rows[19]!.id : null };
    }, MANUAL_TX_OPTIONS);
  }

  async submit(
    userId: string,
    key: string,
    paymentIntentId: string,
    expectedVersion: number,
  ): Promise<ManualPaymentDetailV1> {
    await this.runMutation(
      userId,
      key,
      'R30_SUBMIT',
      { paymentIntentId, expectedVersion },
      'money:purchase:self',
      (tx) => this.context(paymentIntentId, tx, userId),
      async (tx) => {
        await this.lockIntent(paymentIntentId, tx);
        await this.editable(paymentIntentId, tx, userId);
        const review = await tx.moneyManualReview.findUnique({ where: { paymentIntentId } });
        if (
          !review ||
          review.version !== expectedVersion ||
          !review.currentReceiptId ||
          !['RECEIPT_REQUIRED', 'ACTION_REQUIRED'].includes(review.state)
        )
          throw manualConflict('STALE_RECEIPT_REVISION');
        const receipt = await tx.moneyManualReceiptVersion.findUniqueOrThrow({
          where: { id: review.currentReceiptId },
          include: { mediaAsset: true },
        });
        if (
          !receipt.mediaAsset.uploadCompletedAt ||
          receipt.mediaAsset.scanState !== 'CLEAN' ||
          receipt.mediaAsset.deletedAt ||
          receipt.mediaAsset.erasureStartedAt
        )
          throw manualConflict('RECEIPT_NOT_CLEAN');
        await tx.moneyManualReceiptVersion.update({
          where: { id: receipt.id },
          data: { submittedAt: new Date() },
        });
        await tx.moneyManualReview.update({
          where: { paymentIntentId },
          data: { state: 'IN_REVIEW', version: { increment: 1 } },
        });
        return { paymentIntentId };
      },
    );
    return this.detail(userId, paymentIntentId) as Promise<ManualPaymentDetailV1>;
  }

  async recordSettlement(
    userId: string,
    key: string,
    paymentIntentId: string,
    input: ManualSettlementRequestV1,
  ): Promise<{ id: string }> {
    const reference = typeof input.reference === 'string' ? input.reference.trim() : '';
    if (
      !reference ||
      reference.length > 200 ||
      /\p{Cc}/u.test(reference) ||
      input.evidenceSource !== 'SANDBOX_OPERATOR_SIMULATION'
    )
      throw manualInvalid('INVALID_SETTLEMENT_EVIDENCE');
    let amount;
    try {
      amount = fromMoneyWire(input.amount);
    } catch {
      throw manualInvalid('INVALID_SETTLEMENT_AMOUNT');
    }
    const occurredAt = new Date(input.occurredAt);
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt > new Date())
      throw manualInvalid('INVALID_SETTLEMENT_TIME');
    const request = { paymentIntentId, ...input, reference };
    return this.runMutation(
      userId,
      key,
      'R30_RECORD_SETTLEMENT',
      request,
      'money:receipt:settlement',
      (tx) => this.context(paymentIntentId, tx),
      async (tx) => {
        await this.lockIntent(paymentIntentId, tx);
        const { intent, binding, instruction, ownerUserId } = await this.editable(
          paymentIntentId,
          tx,
        );
        if (ownerUserId === userId) throw manualConflict('SELF_SETTLEMENT_FORBIDDEN');
        if (
          amount.amountMinor !== intent.totalMinor ||
          amount.currency !== intent.currency ||
          occurredAt < intent.createdAt ||
          occurredAt > intent.expiresAt
        )
          throw manualConflict('SETTLEMENT_OBLIGATION_MISMATCH');
        const row = await tx.moneyManualSettlement.create({
          data: {
            adapterId: binding.adapterId,
            mode: binding.mode,
            accountReference: binding.accountReference,
            referenceCanonical: reference,
            amountMinor: amount.amountMinor,
            currency: amount.currency,
            occurredAt,
            recordedByUserId: userId,
            evidenceSource: input.evidenceSource,
            policyVersion: instruction.policyVersion,
            idempotencyKey: key,
            requestDigest: manualDigest(request),
          },
        });
        await this.audit.record(
          {
            type: 'MONEY_MANUAL_SETTLEMENT_RECORDED',
            userId,
            metadata: {
              paymentIntentId,
              manualSettlementId: row.id,
              reason: 'SETTLEMENT_RECORDED',
            },
          },
          tx,
        );
        return { id: row.id };
      },
    );
  }

  async decide(
    userId: string,
    key: string,
    paymentIntentId: string,
    input: ManualReviewDecisionRequestV1,
  ): Promise<{ decisionId: string; approval: boolean }> {
    const providerMessage =
      typeof input.providerMessage === 'string' ? input.providerMessage.trim() : '';
    const internalNote = input.internalNote?.trim() || null;
    if (
      !providerMessage ||
      providerMessage.length > 2000 ||
      (internalNote?.length ?? 0) > 2000 ||
      !['APPROVE', 'REJECT', 'REQUEST_REPLACEMENT'].includes(input.action)
    )
      throw manualInvalid('DECISION_MESSAGE_REQUIRED');
    const request = {
      paymentIntentId,
      ...input,
      providerMessage,
      internalNote,
      settlementId: input.settlementId ?? null,
    };
    return this.runMutation(
      userId,
      key,
      'R30_DECIDE',
      request,
      'money:receipt:review',
      async (tx) => {
        await this.authorize(userId, 'money:receipt:view', tx);
        return this.context(paymentIntentId, tx);
      },
      async (tx) => {
        await this.authorize(userId, 'money:receipt:view', tx);
        await this.lockIntent(paymentIntentId, tx);
        const context = await this.editable(paymentIntentId, tx);
        if (context.ownerUserId === userId) throw manualConflict('SELF_REVIEW_FORBIDDEN');
        const review = await tx.moneyManualReview.findUnique({ where: { paymentIntentId } });
        if (
          !review ||
          review.state !== 'IN_REVIEW' ||
          review.version !== input.expectedVersion ||
          review.currentReceiptId !== input.receiptVersionId
        )
          throw manualConflict('STALE_RECEIPT_REVISION');
        const receipt = await tx.moneyManualReceiptVersion.findUniqueOrThrow({
          where: { id: review.currentReceiptId! },
          include: { mediaAsset: true },
        });
        const inspection = await tx.moneyManualReceiptInspection.findUnique({
          where: { id: manualId(input.inspectionId) },
        });
        if (
          !inspection ||
          inspection.reviewerUserId !== userId ||
          inspection.receiptId !== receipt.id ||
          inspection.sha256 !== receipt.mediaAsset.sha256 ||
          receipt.mediaAsset.scanState !== 'CLEAN' ||
          !receipt.submittedAt ||
          receipt.mediaAsset.deletedAt ||
          receipt.mediaAsset.erasureStartedAt
        )
          throw manualConflict('CURRENT_RECEIPT_INSPECTION_REQUIRED');
        if (input.action === 'APPROVE') {
          if (!input.settlementId) throw manualInvalid('INDEPENDENT_SETTLEMENT_REQUIRED');
          await this.validateSettlement(input.settlementId, userId, context, tx);
        }
        const action =
          input.action === 'APPROVE'
            ? 'PENDING_APPROVAL'
            : input.action === 'REJECT'
              ? 'REJECTED'
              : 'REPLACEMENT_REQUESTED';
        const decision = await tx.moneyManualReviewDecision.create({
          data: {
            paymentIntentId,
            receiptId: receipt.id,
            reviewerUserId: userId,
            inspectionId: inspection.id,
            action,
            settlementId: input.action === 'APPROVE' ? input.settlementId : null,
            expectedVersion: input.expectedVersion,
            providerMessage,
            internalNote,
            idempotencyKey: key,
            requestDigest: manualDigest(request),
          },
        });
        await tx.moneyManualReview.update({
          where: { paymentIntentId },
          data: {
            state:
              input.action === 'APPROVE'
                ? 'CONFIRMING'
                : input.action === 'REJECT'
                  ? 'REJECTED'
                  : 'ACTION_REQUIRED',
            version: { increment: 1 },
            pendingDecisionId: input.action === 'APPROVE' ? decision.id : null,
            nextAttemptAt: input.action === 'APPROVE' ? new Date() : null,
          },
        });
        await this.audit.record(
          {
            type: 'MONEY_MANUAL_REVIEW_DECIDED',
            userId,
            metadata: { paymentIntentId, manualDecisionId: decision.id, reason: action },
          },
          tx,
        );
        if (input.action !== 'APPROVE')
          await this.notice(
            context.ownerUserId,
            paymentIntentId,
            decision.id,
            providerMessage,
            userId,
            tx,
          );
        return { decisionId: decision.id, approval: input.action === 'APPROVE' };
      },
    );
  }

  async validateSettlement(
    settlementId: string,
    reviewerUserId: string,
    context: Awaited<ReturnType<ManualReviewService['editable']>>,
    tx: PrismaTx,
  ) {
    const settlement = await tx.moneyManualSettlement.findUnique({
      where: { id: manualId(settlementId) },
    });
    const { intent, binding, instruction, ownerUserId } = context;
    if (
      !settlement ||
      settlement.recordedByUserId === reviewerUserId ||
      settlement.recordedByUserId === ownerUserId ||
      settlement.adapterId !== binding.adapterId ||
      settlement.mode !== binding.mode ||
      settlement.accountReference !== binding.accountReference ||
      settlement.currency !== intent.currency ||
      settlement.amountMinor !== intent.totalMinor ||
      settlement.policyVersion !== instruction.policyVersion ||
      settlement.evidenceSource !== 'SANDBOX_OPERATOR_SIMULATION' ||
      settlement.occurredAt < intent.createdAt ||
      settlement.occurredAt > intent.expiresAt
    )
      throw manualConflict('INDEPENDENT_SETTLEMENT_MISMATCH');
    await this.authorize(settlement.recordedByUserId, 'money:receipt:settlement', tx);
    return settlement;
  }

  async retry(
    userId: string,
    key: string,
    paymentIntentId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.runMutation(
      userId,
      key,
      'R30_RETRY_CONFIRMATION',
      { paymentIntentId, expectedVersion },
      'money:receipt:review',
      async (tx) => {
        await this.authorize(userId, 'money:receipt:view', tx);
        return this.context(paymentIntentId, tx);
      },
      async (tx) => {
        await this.lockIntent(paymentIntentId, tx);
        const context = await this.context(paymentIntentId, tx);
        const instruction = await this.config.instruction(context.binding, tx);
        const state = await tx.moneyManualReview.findUnique({
          where: { paymentIntentId },
          include: {
            pendingDecision: {
              include: { receipt: { include: { mediaAsset: true } }, inspection: true },
            },
          },
        });
        const decision = state?.pendingDecision;
        if (
          !state ||
          !decision ||
          state.state !== 'CONFIRMING' ||
          !state.reconciliationRequired ||
          state.version !== expectedVersion ||
          decision.expectedVersion + 1 !== state.version ||
          decision.reviewerUserId !== userId ||
          context.ownerUserId === userId ||
          context.intent.expiresAt <= new Date() ||
          context.intent.totalMinor > instruction.maxAmountMinor ||
          !['CREATED', 'AWAITING_PAYMENT', 'PROCESSING'].includes(context.intent.status) ||
          decision.action !== 'PENDING_APPROVAL' ||
          !decision.settlementId ||
          state.currentReceiptId !== decision.receiptId ||
          !decision.receipt.submittedAt ||
          decision.receipt.mediaAsset.scanState !== 'CLEAN' ||
          !decision.receipt.mediaAsset.uploadCompletedAt ||
          decision.receipt.mediaAsset.deletedAt ||
          decision.receipt.mediaAsset.erasureStartedAt ||
          decision.inspection.receiptId !== decision.receiptId ||
          decision.inspection.reviewerUserId !== userId ||
          decision.inspection.sha256 !== decision.receipt.mediaAsset.sha256
        )
          throw manualConflict('RECONCILIATION_REVIEW_REQUIRED');
        await this.validateSettlement(
          decision.settlementId,
          userId,
          { ...context, instruction },
          tx,
        );
        await tx.moneyManualReview.update({
          where: { paymentIntentId },
          data: {
            reconciliationRequired: false,
            lastErrorCode: null,
            attemptCount: 0,
            nextAttemptAt: new Date(),
          },
        });
        return { paymentIntentId };
      },
    );
  }

  async notice(
    ownerUserId: string,
    paymentIntentId: string,
    decisionId: string,
    message: string,
    actorUserId: string,
    tx: PrismaTx,
  ): Promise<void> {
    await this.notifications.createForUser(
      {
        dedupeKey: `r30.decision:${decisionId}`,
        userId: ownerUserId,
        type: 'SYSTEM',
        title: 'Payment review / مراجعة الدفع',
        body: message,
        deepLink: `/provider/manual-payments/${paymentIntentId}`,
        actorUserId,
        metadata: { paymentIntentId, decisionId, mode: 'SANDBOX' },
      },
      tx,
    );
  }
}
