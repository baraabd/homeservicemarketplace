import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  canonicalJson,
  MONEY_CONTRACT_VERSION,
  type PaymentConfirmationSource,
  type SubscriptionActivationResultV1,
} from '@homeservicemarketplace/contracts';
import { Prisma, type PrismaTx } from '@homeservicemarketplace/database';

import { OutboxRepository } from '../../../infrastructure/outbox/outbox.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { LedgerService, type LedgerActor } from '../ledger/ledger.service';
import { nextSubscriptionEnd, normalizeCurrency } from '../money-domain';

// R19 — the one transaction boundary for an authoritative payment
// confirmation (ADR 0014 decisions 6 and 9):
//
//   lock the intent → replay or refuse by idempotency key → intent SUCCEEDED
//   → exactly one ledger posting → the confirmation row → the subscription
//   (created or renewed) → exactly one period → coupon redemption → one
//   post-commit outbox event → commit.
//
// Everything commits together or not at all, in the caller's transaction when
// one is passed. Nothing here calls a network service; rail adapters (later
// waves) verify a webhook or a receipt review BEFORE calling this, outside any
// database lock. There is no live caller: nothing in the application invokes
// this yet, and no HTTP route exists.
//
// Not decided, so never defaulted: which ledger accounts a subscription
// payment posts to (account purposes), and whether a zero-total purchase
// activates. The caller names both accounts; a zero total is refused.

export const ACTIVATION_SYSTEM_ACTOR: LedgerActor = {
  kind: 'SYSTEM',
  system: 'money.subscription-activation',
};
/** Pending outbox registration (r19 shared change request CR-002). */
export const SUBSCRIPTION_ACTIVATED_EVENT = 'money.subscription.activated.v1';

export interface ConfirmAndActivateCommand {
  idempotencyKey: string;
  paymentIntentId: string;
  source: PaymentConfirmationSource;
  externalConfirmationId: string;
  amountMinor: bigint;
  currency: string;
  confirmedAt: Date;
  receiptMediaAssetId?: string | null;
  reviewerUserId?: string | null;
  /** Renew this subscription; omit to start a new one. */
  subscriptionId?: string | null;
  /** Account purposes are a pending decision; the caller supplies both. */
  ledgerAccounts: { debitAccountId: string; creditAccountId: string };
}

const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/u;
const SOURCES = new Set<PaymentConfirmationSource>(['PROVIDER_WEBHOOK', 'MANUAL_REVIEW']);
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

function invalid(message: string): AppError {
  return new AppError('VALIDATION_ERROR', message, 400);
}

function digestOf(command: ConfirmAndActivateCommand): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        op: 'confirm-and-activate',
        contract: MONEY_CONTRACT_VERSION,
        paymentIntentId: command.paymentIntentId,
        source: command.source,
        externalConfirmationId: command.externalConfirmationId,
        amountMinor: command.amountMinor,
        currency: command.currency,
        confirmedAt: command.confirmedAt.toISOString(),
        receiptMediaAssetId: command.receiptMediaAssetId ?? null,
        reviewerUserId: command.reviewerUserId ?? null,
        subscriptionId: command.subscriptionId ?? null,
        debitAccountId: command.ledgerAccounts.debitAccountId,
        creditAccountId: command.ledgerAccounts.creditAccountId,
      }),
    )
    .digest('hex');
}

/** The ledger key derived from the confirmation key: one posting per confirmation. */
export function ledgerKeyFor(idempotencyKey: string): string {
  return `r19c_${createHash('sha256').update(idempotencyKey).digest('hex')}`;
}

function validate(command: ConfirmAndActivateCommand): ConfirmAndActivateCommand {
  if (!KEY_RE.test(command.idempotencyKey ?? ''))
    throw invalid('A valid idempotency key is required.');
  if (!SOURCES.has(command.source)) throw invalid('Unknown confirmation source.');
  const external = command.externalConfirmationId;
  if (typeof external !== 'string' || external.length < 1 || external.length > 200) {
    throw invalid('An external confirmation id is required.');
  }
  if (typeof command.amountMinor !== 'bigint' || command.amountMinor < 0n) {
    throw invalid('The confirmed amount must be non-negative bigint minor units.');
  }
  if (command.amountMinor === 0n) {
    // POLICY_BLOCKED: free or fully discounted activations are not decided.
    throw invalid('A zero-total confirmation is not supported.');
  }
  if (!(command.confirmedAt instanceof Date) || !Number.isFinite(command.confirmedAt.getTime())) {
    throw invalid('A valid confirmation time is required.');
  }
  const manual = command.source === 'MANUAL_REVIEW';
  if (manual !== Boolean(command.receiptMediaAssetId && command.reviewerUserId)) {
    throw invalid('A manual confirmation names its receipt and reviewer; a webhook names neither.');
  }
  if (!manual && (command.receiptMediaAssetId || command.reviewerUserId)) {
    throw invalid('A manual confirmation names its receipt and reviewer; a webhook names neither.');
  }
  const accounts = command.ledgerAccounts;
  if (
    !accounts?.debitAccountId ||
    !accounts.creditAccountId ||
    accounts.debitAccountId === accounts.creditAccountId
  ) {
    throw invalid('Two distinct ledger accounts are required.');
  }
  return { ...command, currency: normalizeCurrency(command.currency) };
}

@Injectable()
export class SubscriptionActivationService {
  constructor(
    private readonly tx: TransactionRunner,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxRepository,
  ) {}

  async confirmAndActivate(
    input: ConfirmAndActivateCommand,
    callerTx?: PrismaTx,
  ): Promise<SubscriptionActivationResultV1> {
    const command = validate(input);
    const digest = digestOf(command);
    if (callerTx) return this.execute(command, digest, callerTx);
    try {
      return await this.tx.run((tx) => this.execute(command, digest, tx), TX_OPTIONS);
    } catch (error) {
      // Two identical commands raced past the intent lock's read of each
      // other's key: the loser rolled back on a unique violation. Replay the
      // committed winner; any other unique violation is a real conflict.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.tx.run((tx) => this.execute(command, digest, tx), TX_OPTIONS);
      }
      throw error;
    }
  }

  private async execute(
    command: ConfirmAndActivateCommand,
    digest: string,
    tx: PrismaTx,
  ): Promise<SubscriptionActivationResultV1> {
    // One confirmation at a time per intent.
    const [intent] = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        totalMinor: bigint;
        currency: string;
        providerProfileId: string;
        planVersionId: string;
        couponId: string | null;
      }>
    >`SELECT "id", "status"::text AS "status", "totalMinor", "currency", "providerProfileId", "planVersionId", "couponId"
        FROM "MoneyPaymentIntent" WHERE "id" = ${command.paymentIntentId} FOR UPDATE`;
    if (!intent) throw new AppError('NOT_FOUND', 'Payment intent not found.', 404);

    const stored = await tx.moneyPaymentConfirmation.findUnique({
      where: { idempotencyKey: command.idempotencyKey },
      include: { period: { include: { subscription: true } } },
    });
    if (stored) {
      if (stored.requestDigest !== digest) {
        throw new AppError(
          'CONFLICT',
          'This idempotency key was used for a different confirmation.',
          409,
        );
      }
      return this.view(stored, true);
    }
    if (intent.status === 'SUCCEEDED') {
      throw new AppError('CONFLICT', 'This payment intent is already confirmed.', 409);
    }
    if (intent.status !== 'PROCESSING') {
      throw new AppError('CONFLICT', `A ${intent.status} payment intent cannot be confirmed.`, 409);
    }
    if (intent.currency !== command.currency || intent.totalMinor !== command.amountMinor) {
      throw invalid('The confirmed amount must equal the payment intent total in its currency.');
    }

    await tx.moneyPaymentIntent.update({ where: { id: intent.id }, data: { status: 'SUCCEEDED' } });

    const posting = await this.ledger.post(
      ACTIVATION_SYSTEM_ACTOR,
      {
        idempotencyKey: ledgerKeyFor(command.idempotencyKey),
        currency: command.currency,
        description: `Subscription payment ${intent.id}`,
        externalReference: `${command.source}:${command.externalConfirmationId}`,
        lines: [
          {
            accountId: command.ledgerAccounts.debitAccountId,
            side: 'DEBIT',
            amountMinor: command.amountMinor,
          },
          {
            accountId: command.ledgerAccounts.creditAccountId,
            side: 'CREDIT',
            amountMinor: command.amountMinor,
          },
        ],
      },
      tx,
    );
    if (posting.replayed) {
      // A posting under this confirmation's key exists without its
      // confirmation row: that is a reconciliation exception, not a retry.
      throw new AppError(
        'CONFLICT',
        'A ledger posting already exists for this confirmation key.',
        409,
      );
    }

    const confirmation = await tx.moneyPaymentConfirmation.create({
      data: {
        paymentIntentId: intent.id,
        source: command.source,
        externalConfirmationId: command.externalConfirmationId,
        amountMinor: command.amountMinor,
        currency: command.currency,
        confirmedAt: command.confirmedAt,
        receiptMediaAssetId: command.receiptMediaAssetId ?? null,
        reviewerUserId: command.reviewerUserId ?? null,
        idempotencyKey: command.idempotencyKey,
        requestDigest: digest,
        ledgerTransactionId: posting.transaction.id,
      },
    });

    const plan = await tx.subscriptionPlanVersion.findUniqueOrThrow({
      where: { id: intent.planVersionId },
    });
    let subscriptionId = command.subscriptionId ?? null;
    let startsAt = command.confirmedAt;
    if (subscriptionId) {
      const subscription = await tx.providerSubscription.findUnique({
        where: { id: subscriptionId },
      });
      if (!subscription) throw new AppError('NOT_FOUND', 'Subscription not found.', 404);
      if (!['PENDING_PAYMENT', 'ACTIVE', 'SUSPENDED'].includes(subscription.status)) {
        throw new AppError(
          'CONFLICT',
          `A ${subscription.status} subscription cannot be renewed.`,
          409,
        );
      }
      const last = await tx.subscriptionPeriod.findFirst({
        where: { subscriptionId },
        orderBy: { endsAt: 'desc' },
      });
      if (last && last.endsAt > startsAt) startsAt = last.endsAt;
    } else {
      subscriptionId = (
        await tx.providerSubscription.create({
          data: {
            providerProfileId: intent.providerProfileId,
            planVersionId: intent.planVersionId,
          },
        })
      ).id;
    }
    const period = await tx.subscriptionPeriod.create({
      data: {
        subscriptionId,
        paymentConfirmationId: confirmation.id,
        startsAt,
        endsAt: nextSubscriptionEnd(startsAt, plan.billingInterval),
      },
    });
    const subscription = await tx.providerSubscription.update({
      where: { id: subscriptionId },
      data: { status: 'ACTIVE' },
    });
    if (intent.couponId) {
      await tx.moneyCouponRedemption.create({
        data: {
          couponId: intent.couponId,
          paymentIntentId: intent.id,
          providerProfileId: intent.providerProfileId,
        },
      });
    }
    await this.outbox.enqueue(
      {
        aggregateType: 'ProviderSubscription',
        aggregateId: subscription.id,
        eventType: SUBSCRIPTION_ACTIVATED_EVENT,
        // Identifiers only: no amount, receipt or provider data in the payload.
        payload: {
          contractVersion: MONEY_CONTRACT_VERSION,
          paymentConfirmationId: confirmation.id,
          subscriptionId: subscription.id,
          subscriptionPeriodId: period.id,
        },
        dedupeKey: `${SUBSCRIPTION_ACTIVATED_EVENT}:${confirmation.id}`,
      },
      tx,
    );
    return this.view({ ...confirmation, period: { ...period, subscription } }, false);
  }

  private view(
    confirmation: {
      id: string;
      ledgerTransactionId: string;
      period: {
        id: string;
        startsAt: Date;
        endsAt: Date;
        subscription: { id: string; status: string };
      } | null;
    },
    replayed: boolean,
  ): SubscriptionActivationResultV1 {
    const period = confirmation.period;
    if (!period) {
      // A confirmation without its period can only come from direct SQL.
      throw new AppError('INTERNAL_ERROR', 'Confirmation has no subscription period.', 500);
    }
    return {
      contractVersion: MONEY_CONTRACT_VERSION,
      paymentConfirmationId: confirmation.id,
      subscriptionId: period.subscription.id,
      subscriptionPeriodId: period.id,
      ledgerTransactionId: confirmation.ledgerTransactionId,
      periodStartsAt: period.startsAt.toISOString(),
      periodEndsAt: period.endsAt.toISOString(),
      status: period.subscription.status as SubscriptionActivationResultV1['status'],
      replayed,
    };
  }
}
