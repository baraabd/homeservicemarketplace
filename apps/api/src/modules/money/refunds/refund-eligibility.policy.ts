import { Inject, Injectable } from '@nestjs/common';
import { fromMoneyWire, type PaymentMethod } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { z } from 'zod';

import { AppError } from '../../../shared/errors/app-error';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import { unavailableMoneyPort } from '../ports/collection.port';
import type { MoneyRefundPolicyPort } from '../ports/refund.port';

export const REFUND_POLICY_SOURCE = Symbol('REFUND_POLICY_SOURCE');

export interface RefundPolicyScope {
  planVersionId: string;
  method: PaymentMethod;
  currency: string;
  mode: 'SANDBOX';
}

const version = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => value === value.trim());
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u);
const approvedPolicySchema = z
  .object({
    version,
    approvalReference: z.string().trim().min(1).max(200),
    mode: z.literal('SANDBOX'),
    planVersionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u),
    method: z.enum(['STRIPE', 'SHAM_CASH', 'SYRIATEL_CASH', 'CASH_OFFICE']),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    reasonCodes: z.array(reason).min(1).max(100),
    // Null is an explicit unlimited window, never a missing-field default.
    refundWindowSeconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    allowPartial: z.boolean(),
    requireRequesterReviewerSeparation: z.boolean(),
    requireOriginalReviewerSeparation: z.boolean(),
    // The evaluator supports these rules only when explicitly approved.
    // A different fee/tax/pro-rata model needs its own reviewed implementation.
    feeTreatment: z.literal('NO_DEDUCTION'),
    taxTreatment: z.literal('NO_ADJUSTMENT'),
    proRataTreatment: z.literal('NONE'),
    entitlementPolicyVersion: version,
  })
  .strict();

export type ApprovedRefundPolicy = Readonly<z.infer<typeof approvedPolicySchema>>;

/** The coordinator supplies a reviewed policy source. It must resolve through
 * the caller's transaction and retain immutable versions for result recovery.
 * A reference in a test fixture is synthetic, not commercial approval.
 */
export interface RefundPolicySourcePort {
  resolve(scope: RefundPolicyScope, tx: PrismaTx): Promise<ApprovedRefundPolicy | null>;
}

export class UnavailableRefundPolicySource implements RefundPolicySourcePort {
  async resolve(): Promise<null> {
    return null;
  }
}

type ReservationInput = Parameters<MoneyRefundPolicyPort['authorizeReservation']>[0];

function conflict(reasonCode: string): AppError {
  return new AppError('CONFLICT', 'The refund is not eligible under the recorded policy.', 409, {
    reason: reasonCode,
  });
}

/** Policy evaluation only: the existing R24 command owns the confirmation
 * lock, reservation capacity, immutable decision, audit and transaction.
 * No price, refund rule, entitlement consequence or live configuration is
 * inferred from the absence of approved policy. This class performs no writes.
 */
@Injectable()
export class RefundEligibilityPolicy implements MoneyRefundPolicyPort {
  constructor(
    @Inject(REFUND_POLICY_SOURCE) private readonly source: RefundPolicySourcePort,
    private readonly permissions: PermissionResolverService,
  ) {}

  async authorizeReservation(
    input: ReservationInput,
    tx: PrismaTx,
  ): Promise<{ policyVersion: string }> {
    let amount: ReturnType<typeof fromMoneyWire>;
    try {
      amount = fromMoneyWire(input.amount);
    } catch {
      throw new AppError('VALIDATION_ERROR', 'A canonical refund amount is required.', 400, {
        reason: 'MONEY_INVALID_AMOUNT',
      });
    }
    if (amount.amountMinor <= 0n || !reason.safeParse(input.reasonCode).success)
      throw new AppError('VALIDATION_ERROR', 'Invalid refund request.', 400, {
        reason: 'MONEY_INVALID_REFUND_REQUEST',
      });

    const request = await tx.moneyRefundRequest.findUnique({
      where: { id: input.refundRequestId },
      include: {
        paymentConfirmation: {
          include: {
            paymentIntent: { include: { binding: true } },
            ledgerTransaction: { include: { reversedBy: { select: { id: true } } } },
            period: { include: { subscription: true } },
          },
        },
      },
    });
    if (!request) throw new AppError('NOT_FOUND', 'Refund request not found.', 404);
    if (
      request.paymentConfirmationId !== input.paymentConfirmationId ||
      request.providerProfileId !== input.providerProfileId ||
      request.requestedByUserId !== input.requestedByUserId ||
      request.reasonCode !== input.reasonCode ||
      request.currency !== amount.currency ||
      request.amountMinor !== amount.amountMinor
    )
      throw conflict('MONEY_REFUND_REQUEST_MISMATCH');
    if (request.status !== 'PENDING_POLICY' || request.refundId !== null)
      throw conflict('MONEY_REFUND_REQUEST_ALREADY_DECIDED');

    const confirmation = request.paymentConfirmation;
    const intent = confirmation.paymentIntent;
    const binding = intent.binding;
    const posting = confirmation.ledgerTransaction;
    const period = confirmation.period;
    if (
      confirmation.id !== request.paymentConfirmationId ||
      intent.id !== confirmation.paymentIntentId ||
      intent.providerProfileId !== request.providerProfileId ||
      intent.status !== 'SUCCEEDED' ||
      confirmation.amountMinor <= 0n ||
      confirmation.amountMinor !== intent.totalMinor ||
      confirmation.currency !== request.currency ||
      intent.currency !== request.currency ||
      !binding ||
      binding.paymentIntentId !== intent.id ||
      binding.currency !== request.currency ||
      posting.id !== confirmation.ledgerTransactionId ||
      posting.status !== 'POSTED' ||
      posting.currency !== request.currency ||
      !period ||
      period.paymentConfirmationId !== confirmation.id ||
      period.subscription.providerProfileId !== request.providerProfileId ||
      period.subscription.planVersionId !== intent.planVersionId
    )
      throw conflict('MONEY_REFUND_ORIGINAL_OBLIGATION_INVALID');
    if (posting.reversedBy) throw conflict('MONEY_REFUND_ORIGINAL_REVERSED');
    if (binding.mode !== 'SANDBOX') throw unavailableMoneyPort('MONEY_REFUND_LIVE_POLICY_BLOCKED');

    const provider = await tx.providerProfile.findUnique({
      where: { id: request.providerProfileId },
      select: { id: true, userId: true, deletedAt: true, status: true },
    });
    if (
      !provider ||
      provider.userId !== request.requestedByUserId ||
      provider.deletedAt ||
      ['SUSPENDED', 'REJECTED'].includes(provider.status)
    )
      throw conflict('MONEY_REFUND_OWNER_MISMATCH');
    await this.requireActor(request.requestedByUserId, 'provider', 'money:refund:request:self', tx);
    await this.requireActor(input.reviewerUserId, 'admin', 'money:refund:review', tx);

    const scope: RefundPolicyScope = {
      planVersionId: intent.planVersionId,
      method: intent.method,
      currency: confirmation.currency,
      mode: 'SANDBOX',
    };
    const parsed = approvedPolicySchema.safeParse(await this.source.resolve(scope, tx));
    if (!parsed.success) throw unavailableMoneyPort('MONEY_REFUND_POLICY_UNAVAILABLE');
    const policy = parsed.data;
    if (
      policy.planVersionId !== scope.planVersionId ||
      policy.method !== scope.method ||
      policy.currency !== scope.currency
    )
      throw unavailableMoneyPort('MONEY_REFUND_POLICY_SCOPE_MISMATCH');
    if (
      (policy.requireRequesterReviewerSeparation &&
        request.requestedByUserId === input.reviewerUserId) ||
      (policy.requireOriginalReviewerSeparation &&
        confirmation.reviewerUserId === input.reviewerUserId)
    )
      throw conflict('MONEY_REFUND_ACTOR_SEPARATION_REQUIRED');
    if (!policy.reasonCodes.includes(request.reasonCode))
      throw conflict('MONEY_REFUND_REASON_NOT_APPROVED');
    if (!policy.allowPartial && request.amountMinor !== confirmation.amountMinor)
      throw conflict('MONEY_REFUND_PARTIAL_NOT_APPROVED');

    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
    if (!clock || !Number.isFinite(clock.now.getTime()))
      throw unavailableMoneyPort('MONEY_REFUND_CLOCK_UNAVAILABLE');
    const ageMs = BigInt(clock.now.getTime()) - BigInt(confirmation.confirmedAt.getTime());
    if (
      ageMs < 0n ||
      (policy.refundWindowSeconds !== null && ageMs > BigInt(policy.refundWindowSeconds) * 1_000n)
    )
      throw conflict('MONEY_REFUND_WINDOW_CLOSED');

    const exception = await tx.moneyReconciliationException.findFirst({
      where: {
        resolvedAt: null,
        OR: [
          { subjectType: 'PaymentConfirmation', subjectId: confirmation.id },
          { subjectType: 'LedgerTransaction', subjectId: posting.id },
          { subjectType: 'SubscriptionPeriod', subjectId: period.id },
        ],
      },
      select: { id: true },
    });
    if (exception) throw conflict('MONEY_REFUND_ORIGINAL_EXCEPTION');

    // The caller holds the original-confirmation lock across this read and
    // reservation. R24 and PostgreSQL repeat the cap as the write authority.
    const reserved = await tx.moneyRefund.aggregate({
      where: {
        paymentConfirmationId: confirmation.id,
        status: { in: ['RESERVED', 'DISPATCHED', 'SUCCEEDED'] },
      },
      _sum: { amountMinor: true },
    });
    if ((reserved._sum.amountMinor ?? 0n) + request.amountMinor > confirmation.amountMinor)
      throw conflict('MONEY_REFUND_RESERVATION_EXCEEDED');

    return { policyVersion: policy.version };
  }

  private async requireActor(
    userId: string,
    role: 'provider' | 'admin',
    permission: 'money:refund:request:self' | 'money:refund:review',
    tx: PrismaTx,
  ): Promise<void> {
    const current = await tx.user.findFirst({
      where: {
        id: userId,
        status: 'ACTIVE',
        isActive: true,
        deletedAt: null,
        userRoles: { some: { role: { name: role, deletedAt: null } } },
      },
      select: { id: true },
    });
    if (!current || !(await this.permissions.resolveFreshForUser(userId, tx)).has(permission))
      throw new AppError('FORBIDDEN', 'Current refund authority is required.', 403, {
        reason: 'MONEY_REFUND_AUTHORITY_REQUIRED',
      });
  }
}
