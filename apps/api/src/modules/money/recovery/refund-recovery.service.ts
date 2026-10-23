import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  MONEY_CONTRACT_VERSION,
  canonicalJson,
  fromMoneyWire,
  toMoneyWire,
  type MoneyWire,
} from '@homeservicemarketplace/contracts';
import { AuditEventType, Prisma, type PrismaTx } from '@homeservicemarketplace/database';
import { z } from 'zod';

import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { AuditService } from '../../iam/audit/audit.service';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import {
  MoneyCommandService,
  type RefundRecoveryAuthorization,
} from '../application/money-command.service';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const key = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u);
const terminalObservation = z
  .object({
    status: z.enum(['SUCCEEDED', 'FAILED']),
    externalOperationId: z.string().min(1).max(200),
    refundId: id,
    paymentConfirmationId: id,
    adapterId: z.string().min(1).max(80),
    mode: z.enum(['SANDBOX', 'LIVE']),
    accountReference: z.string().min(1).max(200),
    amount: z.object({ amountMinor: z.string(), currency: z.string() }).strict(),
  })
  .strict();
const replay = z
  .object({
    contractVersion: z.literal(MONEY_CONTRACT_VERSION),
    paymentConfirmationId: id,
    expectedStateRevision: z.string().regex(/^[a-f0-9]{64}$/u),
    operation: z.enum(['QUERY', 'DISPATCH']),
    dryRun: z.boolean().default(true),
    approvalReference: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/u)
      .optional(),
  })
  .strict()
  .refine((input) => input.dryRun || input.approvalReference !== undefined);

type RecoveryRecord = Prisma.MoneyRefundGetPayload<{
  include: { dispatch: true; request: true };
}>;
export type RefundRecoveryOperation = 'QUERY' | 'DISPATCH';
export type RefundRecoveryState =
  | 'RESERVED'
  | 'PENDING'
  | 'AMBIGUOUS'
  | 'CONFIRMED_SUCCEEDED'
  | 'CONFIRMED_FAILED'
  | 'CANCELLED';
export type RefundRecoveryDiagnostic =
  | 'READY_FOR_DISPATCH'
  | 'QUERY_REQUIRED'
  | 'LOCAL_COMPLETION_REQUIRED'
  | 'TERMINAL'
  | 'CONFIRMATION_INCONSISTENT'
  | 'MONEY_REFUND_POLICY_UNAVAILABLE'
  | 'MONEY_REFUND_ADAPTER_UNAVAILABLE'
  | 'MONEY_CONFIGURATION_UNAVAILABLE';

export interface RefundRecoveryInspection {
  contractVersion: typeof MONEY_CONTRACT_VERSION;
  refundId: string;
  paymentConfirmationId: string;
  stateRevision: string;
  state: RefundRecoveryState;
  amount: MoneyWire;
  refundStatus: RecoveryRecord['status'];
  dispatchStatus: 'NOT_DISPATCHED' | 'PENDING' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED' | null;
  allowedOperations: RefundRecoveryOperation[];
  diagnosticCode: RefundRecoveryDiagnostic;
  reservationHeld: boolean;
  expiryPolicy: 'POLICY_BLOCKED';
  automaticReservationRelease: false;
}

export interface RefundRecoveryResult {
  contractVersion: typeof MONEY_CONTRACT_VERSION;
  dryRun: boolean;
  operation: RefundRecoveryOperation;
  outcome:
    | 'DRY_RUN'
    | 'ACCEPTED'
    | 'AMBIGUOUS'
    | 'CONFIRMED_SUCCEEDED'
    | 'CONFIRMED_FAILED'
    | 'POLICY_BLOCKED'
    | 'EXTERNAL_BLOCKED';
  inspection: RefundRecoveryInspection;
  diagnosticCode: RefundRecoveryDiagnostic;
}

const TX_OPTIONS = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead };
const BLOCKED_REASONS = new Set<RefundRecoveryDiagnostic>([
  'MONEY_REFUND_POLICY_UNAVAILABLE',
  'MONEY_REFUND_ADAPTER_UNAVAILABLE',
  'MONEY_CONFIGURATION_UNAVAILABLE',
]);
const SAFE_REASONS = new Set([
  'MONEY_REFUND_RECOVERY_INPUT_INVALID',
  'MONEY_REFUND_RECOVERY_SCOPE_NOT_FOUND',
  'MONEY_REFUND_RECOVERY_STALE_REVISION',
  'MONEY_REFUND_QUERY_REQUIRED',
  'MONEY_REFUND_NOT_DISPATCHED',
  'MONEY_REFUND_ALREADY_TERMINAL',
  'MONEY_INTERNAL_KEY_RESERVED',
  'MONEY_STORED_STATE_CONFLICT',
  'MONEY_REFUND_ORIGINAL_REVERSED',
  'MONEY_REFUND_ORIGINAL_EXCEPTION',
  'MONEY_REFUND_POSTING_MISMATCH',
  ...BLOCKED_REASONS,
]);

/** Operator-facing recovery over the existing durable R24 command authority.
 * The supplied approval is a bounded reference, not an authorization grant.
 * A new replay binds that reference and observed revision in the command's
 * immutable request; its fence/audit execute in the same command transaction.
 * Existing-command replays are reauthorized by MoneyCommandService and retain
 * their original approval, outbound identity and request. No financial mutation
 * or adapter-result assertion is exposed here.
 */
@Injectable()
export class RefundRecoveryService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly permissions: PermissionResolverService,
    private readonly audit: AuditService,
    private readonly commands: MoneyCommandService,
  ) {}

  async inspect(
    userId: string,
    refundId: string,
    paymentConfirmationId: string,
  ): Promise<RefundRecoveryInspection> {
    try {
      validate(id, userId);
      validate(id, refundId);
      validate(id, paymentConfirmationId);
      return await this.transactions.run(async (tx) => {
        await this.authorize(userId, 'money:review:read', tx);
        const row = await this.read(refundId, paymentConfirmationId, tx);
        await this.record(userId, row, 'REFUND_RECOVERY_INSPECT', tx);
        return project(row);
      }, TX_OPTIONS);
    } catch (error) {
      throw redacted(error);
    }
  }

  async replay(
    userId: string,
    idempotencyKey: string,
    refundId: string,
    input: unknown,
  ): Promise<RefundRecoveryResult> {
    try {
      validate(id, userId);
      validate(key, idempotencyKey);
      validate(id, refundId);
      const request = validate(replay, input);
      const inspect = () =>
        this.transactions.run(async (tx) => {
          await this.authorize(userId, 'money:refund:review', tx);
          return project(await this.read(refundId, request.paymentConfirmationId, tx));
        }, TX_OPTIONS);

      if (request.dryRun) {
        const inspection = await this.transactions.run(async (tx) => {
          await this.authorize(userId, 'money:refund:review', tx);
          const row = await this.read(refundId, request.paymentConfirmationId, tx);
          this.assertRevisionAndOperation(row, request);
          await this.record(userId, row, 'REFUND_RECOVERY_DRY_RUN', tx);
          return project(row);
        }, TX_OPTIONS);
        return {
          contractVersion: MONEY_CONTRACT_VERSION,
          dryRun: true,
          operation: request.operation,
          outcome: 'DRY_RUN',
          inspection,
          diagnosticCode: inspection.diagnosticCode,
        };
      }

      const authorization: RefundRecoveryAuthorization = {
        request: {
          paymentConfirmationId: request.paymentConfirmationId,
          expectedStateRevision: request.expectedStateRevision,
          approvalReference: request.approvalReference!,
        },
        assertCurrent: async (tx) => {
          // The command authority already holds confirmation then refund locks.
          // Lock the mutable transport row before computing the revision fence.
          await tx.$queryRaw`SELECT "id" FROM "MoneyDispatch" WHERE "refundId" = ${refundId} FOR UPDATE`;
          await this.authorize(userId, 'money:refund:review', tx);
          const row = await this.read(refundId, request.paymentConfirmationId, tx);
          this.assertRevisionAndOperation(row, request);
          await this.record(
            userId,
            row,
            `REFUND_RECOVERY_APPROVED_${request.operation}`,
            tx,
            digest(request.approvalReference!),
          );
        },
      };
      try {
        if (request.operation === 'QUERY')
          await this.commands.queryRefund(userId, idempotencyKey, refundId, authorization);
        else await this.commands.dispatchRefund(userId, idempotencyKey, refundId, authorization);
      } catch (error) {
        const reason = errorReason(error);
        if (
          error instanceof AppError &&
          error.code === 'DEPENDENCY_UNAVAILABLE' &&
          BLOCKED_REASONS.has(reason as RefundRecoveryDiagnostic)
        ) {
          return {
            contractVersion: MONEY_CONTRACT_VERSION,
            dryRun: false,
            operation: request.operation,
            outcome:
              reason === 'MONEY_REFUND_POLICY_UNAVAILABLE' ? 'POLICY_BLOCKED' : 'EXTERNAL_BLOCKED',
            inspection: await inspect(),
            diagnosticCode: reason as RefundRecoveryDiagnostic,
          };
        }
        throw error;
      }
      const inspection = await inspect();
      return {
        contractVersion: MONEY_CONTRACT_VERSION,
        dryRun: false,
        operation: request.operation,
        outcome: ['AMBIGUOUS', 'CONFIRMED_SUCCEEDED', 'CONFIRMED_FAILED'].includes(inspection.state)
          ? (inspection.state as 'AMBIGUOUS' | 'CONFIRMED_SUCCEEDED' | 'CONFIRMED_FAILED')
          : 'ACCEPTED',
        inspection,
        diagnosticCode: inspection.diagnosticCode,
      };
    } catch (error) {
      throw redacted(error);
    }
  }

  private async authorize(
    userId: string,
    capability: 'money:review:read' | 'money:refund:review',
    tx: PrismaTx,
  ): Promise<void> {
    if (!(await this.permissions.resolveFreshForUser(userId, tx)).has(capability))
      throw new AppError('FORBIDDEN', 'Fresh reviewer authority is required.', 403);
    const actor = await tx.user.findFirst({
      where: {
        id: userId,
        status: 'ACTIVE',
        isActive: true,
        deletedAt: null,
        userRoles: { some: { role: { name: 'admin', deletedAt: null } } },
      },
      select: { id: true },
    });
    if (!actor) throw new AppError('FORBIDDEN', 'Fresh reviewer authority is required.', 403);
  }

  private async read(refundId: string, paymentConfirmationId: string, tx: PrismaTx) {
    const row = await tx.moneyRefund.findFirst({
      where: { id: refundId, paymentConfirmationId },
      include: { dispatch: true, request: true },
    });
    if (!row)
      throw new AppError('NOT_FOUND', 'Refund recovery scope was not found.', 404, {
        reason: 'MONEY_REFUND_RECOVERY_SCOPE_NOT_FOUND',
      });
    return row;
  }

  private assertRevisionAndOperation(row: RecoveryRecord, request: z.infer<typeof replay>) {
    const inspection = project(row);
    if (inspection.stateRevision !== request.expectedStateRevision)
      throw new AppError('CONFLICT', 'Inspect the current recovery state before replay.', 409, {
        reason: 'MONEY_REFUND_RECOVERY_STALE_REVISION',
      });
    if (!inspection.allowedOperations.includes(request.operation))
      throw new AppError('CONFLICT', 'The requested recovery operation is not available.', 409, {
        reason: !['RESERVED', 'DISPATCHED'].includes(row.status)
          ? 'MONEY_REFUND_ALREADY_TERMINAL'
          : request.operation === 'DISPATCH'
            ? 'MONEY_REFUND_QUERY_REQUIRED'
            : 'MONEY_REFUND_NOT_DISPATCHED',
      });
  }

  private async record(
    userId: string,
    row: RecoveryRecord,
    action: string,
    tx: PrismaTx,
    approvalDigest?: string,
  ) {
    await this.audit.record(
      {
        type: AuditEventType.MONEY_COMMAND_ACCEPTED,
        userId,
        requestId: approvalDigest ? `r32_approval_${approvalDigest}` : undefined,
        metadata: {
          moneyAction: action,
          refundId: row.id,
          paymentConfirmationId: row.paymentConfirmationId,
          previousStatus: row.status,
          outcome: project(row).state,
        },
      },
      tx,
    );
  }
}

function project(row: RecoveryRecord): RefundRecoveryInspection {
  const dispatch = row.dispatch;
  const open = row.status === 'RESERVED' || row.status === 'DISPATCHED';
  let state: RefundRecoveryState = 'RESERVED';
  let diagnosticCode: RefundRecoveryDiagnostic = 'READY_FOR_DISPATCH';
  if (row.status === 'SUCCEEDED') {
    state = row.compensatingLedgerTransactionId ? 'CONFIRMED_SUCCEEDED' : 'AMBIGUOUS';
    diagnosticCode = row.compensatingLedgerTransactionId ? 'TERMINAL' : 'CONFIRMATION_INCONSISTENT';
  } else if (row.status === 'FAILED' || row.status === 'CANCELLED') {
    state = row.status === 'FAILED' ? 'CONFIRMED_FAILED' : 'CANCELLED';
    diagnosticCode = 'TERMINAL';
  } else if (
    dispatch &&
    ['UNKNOWN', 'PENDING'].includes(dispatch.status) &&
    hasScopedTerminalObservation(row)
  ) {
    state = 'AMBIGUOUS';
    diagnosticCode = 'LOCAL_COMPLETION_REQUIRED';
  } else if (dispatch?.status === 'SUCCEEDED' || dispatch?.status === 'FAILED') {
    state = 'AMBIGUOUS';
    diagnosticCode = 'CONFIRMATION_INCONSISTENT';
  } else if (dispatch?.status === 'UNKNOWN' || (row.status === 'DISPATCHED' && !dispatch)) {
    state = 'AMBIGUOUS';
    diagnosticCode = 'QUERY_REQUIRED';
  } else if (dispatch?.status === 'PENDING') {
    state = 'PENDING';
    diagnosticCode = 'QUERY_REQUIRED';
  }
  const untouched =
    row.status === 'RESERVED' && (!dispatch || dispatch.status === 'NOT_DISPATCHED');
  return {
    contractVersion: MONEY_CONTRACT_VERSION,
    refundId: row.id,
    paymentConfirmationId: row.paymentConfirmationId,
    stateRevision: digest(
      canonicalJson({
        refund: {
          id: row.id,
          paymentConfirmationId: row.paymentConfirmationId,
          amountMinor: row.amountMinor.toString(),
          currency: row.currency,
          status: row.status,
          updatedAt: row.updatedAt.toISOString(),
          compensation: row.compensatingLedgerTransactionId,
        },
        dispatch: dispatch
          ? {
              id: dispatch.id,
              status: dispatch.status,
              updatedAt: dispatch.updatedAt.toISOString(),
              claimId: dispatch.claimId,
              leaseUntil: dispatch.leaseUntil?.toISOString() ?? null,
              externalOperationId: dispatch.externalOperationId,
              observationDigest: digest(canonicalJson(dispatch.observation)),
            }
          : null,
        request: row.request
          ? {
              id: row.request.id,
              status: row.request.status,
              policyVersion: row.request.policyVersion,
              updatedAt: row.request.updatedAt.toISOString(),
            }
          : null,
      }),
    ),
    state,
    amount: toMoneyWire({ amountMinor: row.amountMinor, currency: row.currency }),
    refundStatus: row.status,
    dispatchStatus: dispatch?.status ?? null,
    allowedOperations: open
      ? [...(untouched ? ['DISPATCH' as const] : []), ...(dispatch ? ['QUERY' as const] : [])]
      : [],
    diagnosticCode,
    reservationHeld: open,
    expiryPolicy: 'POLICY_BLOCKED',
    automaticReservationRelease: false,
  };
}

function hasScopedTerminalObservation(row: RecoveryRecord): boolean {
  const parsed = terminalObservation.safeParse(row.dispatch?.observation);
  if (!parsed.success) return false;
  const value = parsed.data;
  if (value.refundId !== row.id || value.paymentConfirmationId !== row.paymentConfirmationId)
    return false;
  if (
    row.dispatch?.externalOperationId &&
    row.dispatch.externalOperationId !== value.externalOperationId
  )
    return false;
  try {
    const amount = fromMoneyWire(value.amount);
    return amount.amountMinor === row.amountMinor && amount.currency === row.currency;
  } catch {
    return false;
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validate<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new AppError('VALIDATION_ERROR', 'A bounded refund recovery request is required.', 400, {
      reason: 'MONEY_REFUND_RECOVERY_INPUT_INVALID',
    });
  return result.data;
}

function errorReason(error: unknown): string | undefined {
  if (!(error instanceof AppError) || !error.details || typeof error.details !== 'object') return;
  const reason = (error.details as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : undefined;
}

function redacted(error: unknown): AppError {
  if (error instanceof AppError) {
    const reason = errorReason(error);
    return new AppError(
      error.code,
      'Refund recovery could not complete the requested operation.',
      error.status,
      reason && SAFE_REASONS.has(reason) ? { reason } : undefined,
    );
  }
  return new AppError(
    'DEPENDENCY_UNAVAILABLE',
    'Refund recovery is temporarily unavailable.',
    503,
    {
      reason: 'MONEY_REFUND_RECOVERY_UNAVAILABLE',
    },
  );
}
