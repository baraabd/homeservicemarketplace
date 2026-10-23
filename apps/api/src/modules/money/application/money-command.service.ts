import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  canonicalJson,
  MONEY_CONTRACT_VERSION,
  fromMoneyWire,
  toMoneyWire,
  type MoneyApiCapability,
  type MoneyCommandAcceptedV1,
  type MoneyPurchaseRequestV1,
  type MoneyRefundRequestV1,
  type MoneyRefundRequestWireV1,
  type PaymentIntentWireV1,
  type QuoteWireV1,
  type RefundWireV1,
  type SubscriptionActivationResultV1,
} from '@homeservicemarketplace/contracts';
import {
  AuditEventType,
  Prisma,
  type MoneyDispatch,
  type MoneyExternalEvent,
  type MoneyPaymentIntent,
  type MoneyRefund,
  type PrismaTx,
} from '@homeservicemarketplace/database';
import { z } from 'zod';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { AuditService } from '../../iam/audit/audit.service';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import { SubscriptionActivationService } from '../domain/subscription-activation.service';
import { LedgerService } from '../ledger/ledger.service';
import { MoneyQuoteService } from '../money-application';
import { MoneyDomainError } from '../money-domain';
import {
  MONEY_ACTIVATION_PARTICIPANT,
  type MoneyActivationParticipantPort,
} from '../ports/activation.port';
import {
  MONEY_CATALOG,
  MONEY_COLLECTION_ADAPTER,
  MONEY_CONFIGURATION,
  MONEY_RECEIPT_ACCEPTANCE,
  unavailableMoneyPort,
  type MoneyBindingConfiguration,
  type MoneyCatalogFactory,
  type MoneyCollectionAdapterPort,
  type MoneyConfigurationPort,
  type MoneyExternalEventInput,
  type MoneyReceiptAcceptancePort,
  type MoneyTransportBinding,
  type NormalizedMoneyExternalEvent,
} from '../ports/collection.port';
import {
  MONEY_REFUND_ADAPTER,
  MONEY_REFUND_POLICY,
  type MoneyRefundAdapterPort,
  type MoneyRefundObservation,
  type MoneyRefundPolicyPort,
} from '../ports/refund.port';

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const externalIdSchema = z.string().min(1).max(200);
const adapterIdSchema = z.string().min(1).max(80);
const configurationVersionSchema = z.string().min(1).max(100);
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/u);
const versionSchema = z.literal(MONEY_CONTRACT_VERSION);
const amountSchema = z.object({ amountMinor: z.string(), currency: z.string() }).strict();
const purchaseSchema = z
  .object({
    contractVersion: versionSchema,
    planVersionId: idSchema,
    method: z.enum(['STRIPE', 'SHAM_CASH', 'SYRIATEL_CASH', 'CASH_OFFICE']),
    couponCode: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
const refundRequestSchema = z
  .object({
    contractVersion: versionSchema,
    paymentConfirmationId: idSchema,
    amount: amountSchema,
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  })
  .strict();
const receiptSchema = z
  .object({
    contractVersion: versionSchema,
    paymentIntentId: idSchema,
    receiptMediaAssetId: idSchema,
  })
  .strict();
const observationSchema = z
  .object({
    status: z.enum(['PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED']),
    externalOperationId: externalIdSchema.nullable(),
  })
  .strict();
const eventSchema = z
  .object({
    contractVersion: versionSchema,
    adapterId: adapterIdSchema,
    mode: z.enum(['SANDBOX', 'LIVE']),
    accountReference: externalIdSchema,
    externalEventId: externalIdSchema,
    externalConfirmationId: externalIdSchema,
    externalOperationId: externalIdSchema.nullable(),
    paymentIntentId: idSchema,
    paymentAttemptId: idSchema.nullable(),
    source: z.enum(['PROVIDER_WEBHOOK', 'MANUAL_REVIEW']),
    amount: amountSchema,
    confirmedAt: z.string().datetime({ offset: true }),
    receiptMediaAssetId: idSchema.nullable(),
    reviewerUserId: idSchema.nullable(),
  })
  .strict();
const refundObservationSchema = observationSchema.extend({
  refundId: idSchema,
  paymentConfirmationId: idSchema,
  adapterId: adapterIdSchema,
  mode: z.enum(['SANDBOX', 'LIVE']),
  accountReference: externalIdSchema,
  amount: amountSchema,
});
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };
const DISPATCH_LEASE_MS = 30_000;
type Actor = { userId: string; system?: never } | { system: string; userId?: never };
type CommandResult<T> = { value: T; authority: unknown };
type StoredResult<T> = CommandResult<T> & { request: unknown };

function invalid(reason = 'MONEY_INVALID_COMMAND'): AppError {
  return new AppError('VALIDATION_ERROR', 'Invalid money command.', 400, { reason });
}
function conflict(reason = 'MONEY_IDEMPOTENCY_CONFLICT'): AppError {
  return new AppError('CONFLICT', 'The money command conflicts with stored state.', 409, {
    reason,
  });
}
function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Money resource not found.', 404);
}
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}
function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
function json(value: unknown): Prisma.InputJsonValue {
  // Wire snapshots contain only JSON values; never return the private envelope.
  canonicalJson(value);
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function money(value: unknown): { amountMinor: bigint; currency: string } {
  try {
    return fromMoneyWire(value);
  } catch {
    throw invalid('MONEY_INVALID_AMOUNT');
  }
}
export function moneyCommandDigest(
  actor: Actor,
  action: string,
  request: unknown,
  authority: unknown,
): string {
  return hash({ contractVersion: MONEY_CONTRACT_VERSION, actor, action, request, authority });
}
export function validateMoneyPurchase(input: unknown): MoneyPurchaseRequestV1 {
  const value = parse(purchaseSchema, input);
  // Class-transformed DTOs emit optional fields as own undefined properties.
  // The durable fingerprint accepts only canonical JSON, so omit absent data.
  return {
    contractVersion: value.contractVersion,
    planVersionId: value.planVersionId,
    method: value.method,
    ...(value.couponCode ? { couponCode: value.couponCode.toUpperCase() } : {}),
  };
}
function intentWire(row: MoneyPaymentIntent): PaymentIntentWireV1 {
  return {
    contractVersion: MONEY_CONTRACT_VERSION,
    id: row.id,
    providerProfileId: row.providerProfileId,
    planVersionId: row.planVersionId,
    method: row.method,
    status: row.status,
    subtotal: toMoneyWire({ amountMinor: row.subtotalMinor, currency: row.currency }),
    discount: toMoneyWire({ amountMinor: row.discountMinor, currency: row.currency }),
    total: toMoneyWire({ amountMinor: row.totalMinor, currency: row.currency }),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
function refundWire(row: MoneyRefund): RefundWireV1 {
  return {
    contractVersion: MONEY_CONTRACT_VERSION,
    id: row.id,
    paymentConfirmationId: row.paymentConfirmationId,
    amount: toMoneyWire({ amountMinor: row.amountMinor, currency: row.currency }),
    status: row.status,
    externalRefundId: row.externalRefundId,
    compensatingLedgerTransactionId: row.compensatingLedgerTransactionId,
  };
}
function accepted(
  commandId: string,
  resourceType: MoneyCommandAcceptedV1['resourceType'],
  resourceId: string,
): MoneyCommandAcceptedV1 {
  return {
    contractVersion: MONEY_CONTRACT_VERSION,
    commandId,
    resourceType,
    resourceId,
    status: 'ACCEPTED',
  };
}

/** R24 transaction owner. All financial writes reuse R19/R15 authorities.
 * Network transport is invoked only after durable command/dispatch commit.
 * Internal event/result methods are not HTTP authority or browser callbacks.
 */
@Injectable()
export class MoneyCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRunner,
    private readonly permissions: PermissionResolverService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly activation: SubscriptionActivationService,
    @Inject(MONEY_CONFIGURATION) private readonly configuration: MoneyConfigurationPort,
    @Inject(MONEY_CATALOG) private readonly catalog: MoneyCatalogFactory,
    @Inject(MONEY_COLLECTION_ADAPTER) private readonly collection: MoneyCollectionAdapterPort,
    @Inject(MONEY_RECEIPT_ACCEPTANCE) private readonly receipts: MoneyReceiptAcceptancePort,
    @Inject(MONEY_ACTIVATION_PARTICIPANT)
    private readonly participant: MoneyActivationParticipantPort,
    @Inject(MONEY_REFUND_POLICY) private readonly refundPolicy: MoneyRefundPolicyPort,
    @Inject(MONEY_REFUND_ADAPTER) private readonly refunds: MoneyRefundAdapterPort,
  ) {}

  async quote(userId: string, key: string, input: MoneyPurchaseRequestV1): Promise<QuoteWireV1> {
    const request = validateMoneyPurchase(input);
    return this.userCommand(
      userId,
      key,
      'QUOTE',
      'money:purchase:self',
      request,
      (tx) => this.provider(userId, tx),
      async (tx) => {
        const provider = await this.provider(userId, tx);
        const { quote, binding } = await this.calculateQuote(provider.id, request, tx);
        return { value: quote, authority: { providerProfileId: provider.id, quote, binding } };
      },
    );
  }

  async createIntent(
    userId: string,
    key: string,
    input: MoneyPurchaseRequestV1,
  ): Promise<PaymentIntentWireV1> {
    const request = validateMoneyPurchase(input);
    return this.userCommand(
      userId,
      key,
      'CREATE_INTENT',
      'money:purchase:self',
      request,
      (tx) => this.provider(userId, tx),
      async (tx) => {
        const provider = await this.provider(userId, tx);
        const { quote, binding } = await this.calculateQuote(provider.id, request, tx);
        const authority = { providerProfileId: provider.id, quote, binding };
        const total = money(quote.total);
        if (total.amountMinor === 0n) throw invalid('MONEY_ZERO_TOTAL_POLICY_BLOCKED');
        const row = await tx.moneyPaymentIntent.create({
          data: {
            providerProfileId: provider.id,
            planVersionId: request.planVersionId,
            method: request.method,
            currency: total.currency,
            subtotalMinor: money(quote.subtotal).amountMinor,
            discountMinor: money(quote.discount).amountMinor,
            totalMinor: total.amountMinor,
            couponId: quote.couponId,
            expiresAt: new Date(quote.expiresAt),
            idempotencyKey: key,
            requestDigest: moneyCommandDigest({ userId }, 'CREATE_INTENT', request, authority),
          },
        });
        await tx.moneyIntentBinding.create({
          data: {
            paymentIntentId: row.id,
            adapterId: binding.adapterId,
            mode: binding.mode,
            accountReference: binding.accountReference,
            debitAccountId: binding.debitAccountId,
            creditAccountId: binding.creditAccountId,
            configVersion: binding.configVersion,
            currency: binding.currency,
          },
        });
        return { value: intentWire(row), authority };
      },
    );
  }

  async startCollection(
    userId: string,
    key: string,
    paymentIntentId: string,
  ): Promise<MoneyCommandAcceptedV1> {
    const request = { paymentIntentId: parse(idSchema, paymentIntentId) };
    const result = await this.userCommand(
      userId,
      key,
      'START_COLLECTION',
      'money:purchase:self',
      request,
      (tx) => this.ownedIntent(userId, paymentIntentId, tx),
      async (tx, commandId) => {
        await this.lockIntent(paymentIntentId, tx);
        const intent = await this.ownedIntent(userId, paymentIntentId, tx);
        if (
          !['CREATED', 'AWAITING_PAYMENT', 'PROCESSING'].includes(intent.status) ||
          intent.expiresAt <= new Date()
        )
          throw conflict('MONEY_INTENT_NOT_COLLECTIBLE');
        if (
          await tx.moneyPaymentAttempt.findFirst({ where: { paymentIntentId, status: 'STARTED' } })
        )
          throw conflict('MONEY_ATTEMPT_REQUIRES_RESUME');
        const binding = await this.binding(intent, tx);
        await this.requireConfiguredBinding(binding, tx);
        if (!this.collection.isConfigured(binding))
          throw unavailableMoneyPort('MONEY_COLLECTION_UNAVAILABLE');
        const last = await tx.moneyPaymentAttempt.findFirst({
          where: { paymentIntentId },
          orderBy: { attemptNo: 'desc' },
        });
        const attempt = await tx.moneyPaymentAttempt.create({
          data: { paymentIntentId, attemptNo: (last?.attemptNo ?? 0) + 1 },
        });
        if (intent.status !== 'PROCESSING')
          await tx.moneyPaymentIntent.update({
            where: { id: intent.id },
            data: { status: 'PROCESSING' },
          });
        await tx.moneyDispatch.create({
          data: {
            kind: 'COLLECTION',
            commandId,
            paymentAttemptId: attempt.id,
            paymentIntentId,
            providerIdempotencyKey: `r24_collect_${hash(attempt.id)}`,
          },
        });
        return {
          value: accepted(commandId, 'COLLECTION', attempt.id),
          authority: {
            binding,
            amount: toMoneyWire({ amountMinor: intent.totalMinor, currency: intent.currency }),
          },
        };
      },
    );
    await this.dispatchCollection(result.resourceId);
    return result;
  }

  async resumeCollection(
    userId: string,
    key: string,
    paymentAttemptId: string,
  ): Promise<MoneyCommandAcceptedV1> {
    const request = { paymentAttemptId: parse(idSchema, paymentAttemptId) };
    const result = await this.userCommand(
      userId,
      key,
      'RESUME_COLLECTION',
      'money:purchase:self',
      request,
      (tx) => this.ownedAttempt(userId, paymentAttemptId, tx),
      async (tx, commandId) => {
        const attempt = await this.ownedAttempt(userId, paymentAttemptId, tx);
        await this.lockIntent(attempt.paymentIntentId, tx);
        const current = await this.ownedAttempt(userId, paymentAttemptId, tx);
        if (current.status !== 'STARTED') throw conflict('MONEY_ATTEMPT_TERMINAL');
        const dispatch = await tx.moneyDispatch.findUnique({ where: { paymentAttemptId } });
        if (!dispatch) throw notFound();
        const intent = await this.ownedIntent(userId, attempt.paymentIntentId, tx);
        const binding = await this.binding(intent, tx);
        await this.requireConfiguredBinding(binding, tx);
        if (!this.collection.isConfigured(binding))
          throw unavailableMoneyPort('MONEY_COLLECTION_UNAVAILABLE');
        return {
          value: accepted(commandId, 'COLLECTION', paymentAttemptId),
          authority: {
            binding,
            amount: toMoneyWire({ amountMinor: intent.totalMinor, currency: intent.currency }),
            dispatchId: dispatch.id,
          },
        };
      },
    );
    await this.dispatchCollection(paymentAttemptId);
    return result;
  }

  async cancelIntent(
    userId: string,
    key: string,
    paymentIntentId: string,
  ): Promise<PaymentIntentWireV1> {
    const request = { paymentIntentId: parse(idSchema, paymentIntentId) };
    return this.userCommand(
      userId,
      key,
      'CANCEL_INTENT',
      'money:purchase:self',
      request,
      (tx) => this.ownedIntent(userId, paymentIntentId, tx),
      async (tx) => {
        await this.lockIntent(paymentIntentId, tx);
        const intent = await this.ownedIntent(userId, paymentIntentId, tx);
        if (
          !['CREATED', 'AWAITING_PAYMENT'].includes(intent.status) ||
          (await tx.moneyPaymentAttempt.findFirst({
            where: { paymentIntentId, status: 'STARTED' },
          }))
        )
          throw conflict('MONEY_INTENT_NOT_CANCELLABLE');
        const row = await tx.moneyPaymentIntent.update({
          where: { id: paymentIntentId },
          data: { status: 'CANCELLED' },
        });
        return {
          value: intentWire(row),
          authority: {
            amount: toMoneyWire({ amountMinor: intent.totalMinor, currency: intent.currency }),
            binding: await this.binding(intent, tx),
          },
        };
      },
    );
  }

  async acceptReceipt(
    userId: string,
    key: string,
    input: {
      contractVersion: typeof MONEY_CONTRACT_VERSION;
      paymentIntentId: string;
      receiptMediaAssetId: string;
    },
  ): Promise<MoneyCommandAcceptedV1> {
    const request = parse(receiptSchema, input);
    return this.userCommand(
      userId,
      key,
      'ACCEPT_RECEIPT',
      'money:receipt:review',
      request,
      (tx) => this.requireReceipt(request.paymentIntentId, request.receiptMediaAssetId, tx),
      async (tx, commandId) => {
        await this.lockIntent(request.paymentIntentId, tx);
        const { intent, ownerUserId } = await this.requireReceipt(
          request.paymentIntentId,
          request.receiptMediaAssetId,
          tx,
        );
        if (
          intent.method === 'STRIPE' ||
          !['CREATED', 'AWAITING_PAYMENT', 'PROCESSING'].includes(intent.status)
        )
          throw conflict('MONEY_RECEIPT_NOT_ACCEPTABLE');
        const binding = await this.binding(intent, tx);
        await this.requireConfiguredBinding(binding, tx);
        if (!this.receipts.isConfigured(binding))
          throw unavailableMoneyPort('MONEY_RECEIPT_UNAVAILABLE');
        const event = this.normalizedEvent(
          await this.receipts.accept(
            {
              binding,
              paymentIntentId: intent.id,
              receiptMediaAssetId: request.receiptMediaAssetId,
              ownerUserId,
              reviewerUserId: userId,
              idempotencyKey: key,
            },
            tx,
          ),
        );
        if (
          event.source !== 'MANUAL_REVIEW' ||
          event.reviewerUserId !== userId ||
          event.receiptMediaAssetId !== request.receiptMediaAssetId ||
          event.paymentIntentId !== intent.id
        )
          throw conflict('MONEY_BINDING_MISMATCH');
        await this.checkEventBinding(event, tx);
        if (intent.status !== 'PROCESSING')
          await tx.moneyPaymentIntent.update({
            where: { id: intent.id },
            data: { status: 'PROCESSING' },
          });
        const stored = await this.storeEvent(event, tx);
        return { value: accepted(commandId, 'RECEIPT', stored.id), authority: event };
      },
    );
  }

  async requestRefund(
    userId: string,
    key: string,
    input: MoneyRefundRequestV1,
  ): Promise<MoneyRefundRequestWireV1> {
    const raw = parse(refundRequestSchema, input);
    const amount = money(raw.amount);
    if (amount.amountMinor <= 0n) throw invalid('MONEY_INVALID_AMOUNT');
    const request = { ...raw, amount: toMoneyWire(amount) };
    return this.userCommand(
      userId,
      key,
      'REQUEST_REFUND',
      'money:refund:request:self',
      request,
      (tx) => this.ownedConfirmation(userId, request.paymentConfirmationId, tx),
      async (tx, commandId) => {
        await this.lockConfirmation(request.paymentConfirmationId, tx);
        const confirmation = await this.ownedConfirmation(
          userId,
          request.paymentConfirmationId,
          tx,
        );
        if (
          confirmation.currency !== amount.currency ||
          amount.amountMinor > confirmation.amountMinor
        )
          throw invalid('MONEY_REFUND_AMOUNT_MISMATCH');
        const intent = await this.ownedIntent(userId, confirmation.paymentIntentId, tx);
        const row = await tx.moneyRefundRequest.create({
          data: {
            commandId,
            providerProfileId: intent.providerProfileId,
            requestedByUserId: userId,
            paymentConfirmationId: confirmation.id,
            amountMinor: amount.amountMinor,
            currency: amount.currency,
            reasonCode: request.reasonCode,
          },
        });
        return {
          value: {
            contractVersion: MONEY_CONTRACT_VERSION,
            id: row.id,
            paymentConfirmationId: confirmation.id,
            amount: request.amount,
            reasonCode: row.reasonCode,
            status: 'PENDING_POLICY' as const,
            refundId: null,
          },
          authority: {
            confirmationId: confirmation.id,
            amount: toMoneyWire({
              amountMinor: confirmation.amountMinor,
              currency: confirmation.currency,
            }),
            binding: await this.binding(intent, tx),
          },
        };
      },
    );
  }

  async reserveRefund(userId: string, key: string, refundRequestId: string): Promise<RefundWireV1> {
    const request = { refundRequestId: parse(idSchema, refundRequestId) };
    return this.userCommand(
      userId,
      key,
      'RESERVE_REFUND',
      'money:refund:review',
      request,
      async (tx) => {
        if (!(await tx.moneyRefundRequest.findUnique({ where: { id: refundRequestId } })))
          throw notFound();
      },
      async (tx) => {
        const initial = await tx.moneyRefundRequest.findUniqueOrThrow({
          where: { id: refundRequestId },
        });
        await this.lockConfirmation(initial.paymentConfirmationId, tx);
        await tx.$queryRaw`SELECT "id" FROM "MoneyRefundRequest" WHERE "id" = ${refundRequestId} FOR UPDATE`;
        const pending = await tx.moneyRefundRequest.findUniqueOrThrow({
          where: { id: refundRequestId },
        });
        if (pending.status !== 'PENDING_POLICY' || pending.refundId)
          throw conflict('MONEY_REFUND_REQUEST_ALREADY_DECIDED');
        const approval = parse(
          z.object({ policyVersion: configurationVersionSchema }).strict(),
          await this.refundPolicy.authorizeReservation(
            {
              refundRequestId,
              paymentConfirmationId: pending.paymentConfirmationId,
              providerProfileId: pending.providerProfileId,
              requestedByUserId: pending.requestedByUserId,
              reviewerUserId: userId,
              amount: toMoneyWire({ amountMinor: pending.amountMinor, currency: pending.currency }),
              reasonCode: pending.reasonCode,
            },
            tx,
          ),
        );
        const confirmation = await tx.moneyPaymentConfirmation.findUniqueOrThrow({
          where: { id: pending.paymentConfirmationId },
        });
        const committed = await tx.moneyRefund.aggregate({
          where: {
            paymentConfirmationId: confirmation.id,
            status: { in: ['RESERVED', 'DISPATCHED', 'SUCCEEDED'] },
          },
          _sum: { amountMinor: true },
        });
        if (
          pending.currency !== confirmation.currency ||
          (committed._sum.amountMinor ?? 0n) + pending.amountMinor > confirmation.amountMinor
        )
          throw conflict('MONEY_REFUND_RESERVATION_EXCEEDED');
        const intent = await tx.moneyPaymentIntent.findUniqueOrThrow({
          where: { id: confirmation.paymentIntentId },
        });
        const authority = {
          amount: toMoneyWire({ amountMinor: pending.amountMinor, currency: pending.currency }),
          binding: await this.binding(intent, tx),
          policyVersion: approval.policyVersion,
        };
        const refund = await tx.moneyRefund.create({
          data: {
            paymentConfirmationId: pending.paymentConfirmationId,
            amountMinor: pending.amountMinor,
            currency: pending.currency,
            reasonCode: pending.reasonCode,
            idempotencyKey: key,
            requestDigest: moneyCommandDigest({ userId }, 'RESERVE_REFUND', request, authority),
          },
        });
        await tx.moneyRefundRequest.update({
          where: { id: pending.id },
          data: {
            status: 'AUTHORIZED',
            policyVersion: approval.policyVersion,
            refundId: refund.id,
          },
        });
        return { value: refundWire(refund), authority };
      },
    );
  }

  async dispatchRefund(
    userId: string,
    key: string,
    refundId: string,
  ): Promise<MoneyCommandAcceptedV1> {
    return this.refundTransportCommand(userId, key, refundId, false);
  }

  async queryRefund(
    userId: string,
    key: string,
    refundId: string,
  ): Promise<MoneyCommandAcceptedV1> {
    return this.refundTransportCommand(userId, key, refundId, true);
  }

  /** Internal only: normalize through the configured adapter before durable receipt. */
  async acceptExternalEvent(
    input: MoneyExternalEventInput,
  ): Promise<{ eventId: string; status: 'RECEIVED' | 'PROCESSED' }> {
    if (input.mode !== 'SANDBOX') throw unavailableMoneyPort('MONEY_LIVE_DISABLED');
    const event = this.normalizedEvent(
      await this.collection.validateAndNormalizeExternalEvent(input),
    );
    if (
      event.source !== 'PROVIDER_WEBHOOK' ||
      event.adapterId !== input.adapterId ||
      event.mode !== input.mode ||
      event.accountReference !== input.accountReference
    )
      throw conflict('MONEY_BINDING_MISMATCH');
    const key = `r24_event_${hash([event.adapterId, event.mode, event.accountReference, event.externalEventId])}`;
    return this.command(
      { system: 'money.external-event' },
      key,
      'ACCEPT_EXTERNAL_EVENT',
      event,
      (tx) => this.checkEventBinding(event, tx),
      async (tx) => {
        const stored = await this.storeEvent(event, tx);
        return { value: { eventId: stored.id, status: stored.status }, authority: event };
      },
    );
  }

  async processExternalEvent(eventId: string): Promise<SubscriptionActivationResultV1> {
    parse(idSchema, eventId);
    const key = `r24_process_${hash(eventId)}`;
    return this.command(
      { system: 'money.external-event' },
      key,
      'PROCESS_EXTERNAL_EVENT',
      { eventId },
      async (tx) => {
        const event = await tx.moneyExternalEvent.findUnique({ where: { id: eventId } });
        if (!event) throw notFound();
        await this.checkEventBinding(this.eventView(event), tx);
        if (event.source === 'MANUAL_REVIEW')
          await this.authorize(event.reviewerUserId!, 'money:receipt:review', tx);
      },
      async (tx) => {
        const initial = await tx.moneyExternalEvent.findUniqueOrThrow({ where: { id: eventId } });
        await this.lockIntent(initial.paymentIntentId, tx);
        await tx.$queryRaw`SELECT "id" FROM "MoneyExternalEvent" WHERE "id" = ${eventId} FOR UPDATE`;
        const event = await tx.moneyExternalEvent.findUniqueOrThrow({ where: { id: eventId } });
        if (event.status === 'PROCESSED') throw conflict('MONEY_EVENT_ALREADY_PROCESSED');
        const normalized = this.eventView(event);
        const { intent, binding } = await this.checkEventBinding(normalized, tx);
        if (event.source === 'MANUAL_REVIEW') {
          if (this.receipts.finalizeConfirmation) {
            // R30 revalidates the inspected revision, fresh reviewer, independent
            // settlement and unique claim in this same financial transaction.
            await this.receipts.finalizeConfirmation(normalized, tx);
          } else {
            const receipt = await tx.mediaAsset.findUnique({
              where: { id: event.receiptMediaAssetId! },
              select: { purpose: true },
            });
            if (receipt?.purpose === 'FINANCIAL_RECEIPT')
              throw unavailableMoneyPort('MONEY_RECEIPT_UNAVAILABLE');
          }
        }
        // Delivery identity and economic identity have different lifetimes.
        // Distinct valid deliveries of one confirmation reuse R19's authority.
        const confirmationIdentity = [
          event.adapterId,
          event.mode,
          event.accountReference,
          event.externalConfirmationId,
        ];
        const result = await this.activation.confirmAndActivate(
          {
            idempotencyKey: `r24_confirmation_${hash(confirmationIdentity)}`,
            paymentIntentId: intent.id,
            source: event.source,
            externalConfirmationId: `r24c_${hash(confirmationIdentity)}`,
            amountMinor: event.amountMinor,
            currency: event.currency,
            confirmedAt: event.confirmedAt,
            receiptMediaAssetId: event.receiptMediaAssetId,
            reviewerUserId: event.reviewerUserId,
            ledgerAccounts: {
              debitAccountId: binding.debitAccountId,
              creditAccountId: binding.creditAccountId,
            },
          },
          tx,
        );
        if (result.replayed) {
          const prior = await tx.moneyExternalEvent.findFirst({
            where: {
              id: { not: event.id },
              status: 'PROCESSED',
              paymentIntentId: intent.id,
              adapterId: event.adapterId,
              mode: event.mode,
              accountReference: event.accountReference,
              externalConfirmationId: event.externalConfirmationId,
              source: event.source,
            },
          });
          const completed = prior?.response as Partial<SubscriptionActivationResultV1> | null;
          // An R19 replay alone could predate R24's transaction participant.
          // Only a committed R24 event proves that activation also completed.
          if (
            !completed ||
            completed.paymentConfirmationId !== result.paymentConfirmationId ||
            completed.subscriptionId !== result.subscriptionId ||
            completed.subscriptionPeriodId !== result.subscriptionPeriodId ||
            completed.ledgerTransactionId !== result.ledgerTransactionId
          )
            throw conflict('MONEY_CONFIRMATION_RECONCILIATION_REQUIRED');
        } else {
          if (!this.participant.isConfigured())
            throw unavailableMoneyPort('MONEY_ACTIVATION_UNAVAILABLE');
          await this.participant.activatePeriod(
            {
              providerProfileId: intent.providerProfileId,
              planVersionId: intent.planVersionId,
              paymentConfirmationId: result.paymentConfirmationId,
              subscriptionId: result.subscriptionId,
              subscriptionPeriodId: result.subscriptionPeriodId,
              periodStartsAt: result.periodStartsAt,
              periodEndsAt: result.periodEndsAt,
            },
            tx,
          );
        }
        if (event.paymentAttemptId) {
          await tx.moneyPaymentAttempt.update({
            where: { id: event.paymentAttemptId },
            data: {
              status: 'SUCCEEDED',
              ...(event.externalOperationId
                ? {
                    externalAttemptId: `r24a_${hash([binding.adapterId, binding.mode, binding.accountReference, event.externalOperationId])}`,
                  }
                : {}),
            },
          });
          await tx.moneyDispatch.updateMany({
            where: {
              paymentAttemptId: event.paymentAttemptId,
              status: { in: ['NOT_DISPATCHED', 'PENDING', 'UNKNOWN'] },
            },
            data: {
              status: 'SUCCEEDED',
              externalOperationId: event.externalOperationId,
              claimId: null,
              leaseUntil: null,
            },
          });
        }
        await tx.moneyExternalEvent.update({
          where: { id: event.id },
          data: { status: 'PROCESSED', response: json(result), processedAt: new Date() },
        });
        await this.audit.record(
          {
            type: AuditEventType.MONEY_EXTERNAL_EVENT_PROCESSED,
            metadata: {
              moneyExternalEventId: event.id,
              paymentIntentId: intent.id,
              paymentConfirmationId: result.paymentConfirmationId,
              subscriptionId: result.subscriptionId,
              subscriptionPeriodId: result.subscriptionPeriodId,
              actorSystem: 'money.external-event',
            },
          },
          tx,
        );
        return { value: result, authority: normalized };
      },
    );
  }

  /** Internal result of the configured refund adapter; never an HTTP command. */
  async recordRefundResult(
    dispatchId: string,
    input: MoneyRefundObservation,
  ): Promise<RefundWireV1> {
    parse(idSchema, dispatchId);
    const observed = this.refundObservation(input);
    if (!['SUCCEEDED', 'FAILED'].includes(observed.status) || !observed.externalOperationId)
      throw invalid('MONEY_REFUND_NOT_TERMINAL');
    const key = `r24_refund_result_${hash([dispatchId, observed.externalOperationId])}`;
    return this.command(
      { system: 'money.refund-result' },
      key,
      'RECORD_REFUND_RESULT',
      { dispatchId, observed },
      (tx) => this.checkRefundObservation(dispatchId, observed, tx),
      async (tx) => {
        const { refund: initial } = await this.checkRefundObservation(dispatchId, observed, tx);
        await this.lockConfirmation(initial.paymentConfirmationId, tx);
        await tx.$queryRaw`SELECT "id" FROM "MoneyRefund" WHERE "id" = ${initial.id} FOR UPDATE`;
        const { refund, dispatch, binding } = await this.checkRefundObservation(
          dispatchId,
          observed,
          tx,
        );
        if (
          refund.status === 'SUCCEEDED' ||
          refund.status === 'FAILED' ||
          refund.status === 'CANCELLED'
        )
          throw conflict('MONEY_REFUND_ALREADY_TERMINAL');
        if (refund.status === 'RESERVED')
          await tx.moneyRefund.update({ where: { id: refund.id }, data: { status: 'DISPATCHED' } });
        let postingId: string | null = null;
        if (observed.status === 'SUCCEEDED') {
          const confirmation = await tx.moneyPaymentConfirmation.findUniqueOrThrow({
            where: { id: refund.paymentConfirmationId },
          });
          const original = await tx.ledgerEntry.findMany({
            where: { transactionId: confirmation.ledgerTransactionId },
            orderBy: { lineNo: 'asc' },
          });
          // R19 confirmations post precisely these two accounts. Refuse an
          // unexpected historical layout rather than inventing an allocation.
          if (
            original.length !== 2 ||
            !original.some(
              (line) =>
                line.side === 'DEBIT' &&
                line.accountId === binding.debitAccountId &&
                line.amountMinor === confirmation.amountMinor,
            ) ||
            !original.some(
              (line) =>
                line.side === 'CREDIT' &&
                line.accountId === binding.creditAccountId &&
                line.amountMinor === confirmation.amountMinor,
            )
          )
            throw conflict('MONEY_REFUND_POSTING_MISMATCH');
          const posting = await this.ledger.post(
            { kind: 'SYSTEM', system: 'money.refund-result' },
            {
              idempotencyKey: `r24_compensate_${hash(refund.id)}`,
              currency: refund.currency,
              description: `Subscription refund ${refund.id}`,
              externalReference: `money.refund:${refund.id}`,
              lines: original.map((line) => ({
                accountId: line.accountId,
                side: line.side === 'DEBIT' ? ('CREDIT' as const) : ('DEBIT' as const),
                amountMinor: refund.amountMinor,
              })),
            },
            tx,
          );
          if (posting.replayed) throw conflict('MONEY_REFUND_COMPENSATION_ORPHAN');
          postingId = posting.transaction.id;
        }
        const row = await tx.moneyRefund.update({
          where: { id: refund.id },
          data: {
            status: observed.status as 'SUCCEEDED' | 'FAILED',
            externalRefundId: `r24r_${hash([binding.adapterId, binding.mode, binding.accountReference, observed.externalOperationId])}`,
            compensatingLedgerTransactionId: postingId,
          },
        });
        await tx.moneyDispatch.update({
          where: { id: dispatch.id },
          data: {
            status: observed.status as 'SUCCEEDED' | 'FAILED',
            externalOperationId: observed.externalOperationId,
            observation: json(observed),
            claimId: null,
            leaseUntil: null,
          },
        });
        await this.audit.record(
          {
            type: AuditEventType.MONEY_REFUND_RESULT_RECORDED,
            metadata: {
              refundId: row.id,
              paymentConfirmationId: row.paymentConfirmationId,
              ledgerTransactionId: postingId,
              actorSystem: 'money.refund-result',
            },
          },
          tx,
        );
        return {
          value: refundWire(row),
          authority: {
            binding,
            amount: toMoneyWire({ amountMinor: row.amountMinor, currency: row.currency }),
          },
        };
      },
    );
  }

  private async userCommand<T>(
    userId: string,
    key: string,
    action: string,
    capability: MoneyApiCapability,
    request: unknown,
    check: (tx: PrismaTx) => Promise<unknown>,
    execute: (tx: PrismaTx, commandId: string) => Promise<CommandResult<T>>,
  ): Promise<T> {
    parse(idSchema, userId);
    parse(keySchema, key);
    if (
      ['r24_event_', 'r24_process_', 'r24_refund_result_'].some((prefix) => key.startsWith(prefix))
    )
      throw invalid('MONEY_INTERNAL_KEY_RESERVED');
    return this.command(
      { userId },
      key,
      action,
      request,
      async (tx) => {
        await this.authorize(userId, capability, tx);
        await check(tx);
      },
      execute,
    );
  }

  private async command<T>(
    actor: Actor,
    key: string,
    action: string,
    request: unknown,
    check: (tx: PrismaTx) => Promise<unknown>,
    execute: (tx: PrismaTx, commandId: string) => Promise<CommandResult<T>>,
  ): Promise<T> {
    parse(keySchema, key);
    canonicalJson(request);
    try {
      return await this.transactions.run(async (tx) => {
        await check(tx); // Fresh authorization and ownership also precede replay.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`r24.money.command:${key}`}, 0))`;
        const previous = await tx.moneyCommand.findUnique({ where: { idempotencyKey: key } });
        if (previous) {
          const stored = previous.response as unknown as StoredResult<T>;
          if (
            previous.actorUserId !== (actor.userId ?? null) ||
            previous.actorSystem !== (actor.system ?? null) ||
            previous.action !== action ||
            previous.contractVersion !== MONEY_CONTRACT_VERSION ||
            !stored ||
            !Object.hasOwn(stored, 'value') ||
            canonicalJson(stored.request) !== canonicalJson(request) ||
            moneyCommandDigest(actor, action, request, stored.authority) !== previous.requestDigest
          )
            throw conflict();
          return stored.value;
        }
        const commandId = randomUUID();
        const result = await execute(tx, commandId);
        await tx.moneyCommand.create({
          data: {
            id: commandId,
            idempotencyKey: key,
            actorUserId: actor.userId ?? null,
            actorSystem: actor.system ?? null,
            action,
            contractVersion: MONEY_CONTRACT_VERSION,
            requestDigest: moneyCommandDigest(actor, action, request, result.authority),
            response: json({ ...result, request }),
          },
        });
        await this.audit.record(
          {
            type: AuditEventType.MONEY_COMMAND_ACCEPTED,
            userId: actor.userId ?? null,
            metadata: {
              moneyCommandId: commandId,
              moneyAction: action,
              actorSystem: actor.system ?? null,
            },
          },
          tx,
        );
        return result.value;
      }, TX_OPTIONS);
    } catch (error) {
      if (error instanceof MoneyDomainError) throw invalid(error.code);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2004'].includes(error.code)
      )
        throw conflict('MONEY_STORED_STATE_CONFLICT');
      throw error;
    }
  }

  private async authorize(
    userId: string,
    capability: MoneyApiCapability,
    tx: PrismaTx,
  ): Promise<void> {
    if (!(await this.permissions.resolveFreshForUser(userId, tx)).has(capability))
      throw new AppError('FORBIDDEN', 'Money capability is required.', 403);
    const user = await tx.user.findFirst({
      where: {
        id: userId,
        status: 'ACTIVE',
        isActive: true,
        deletedAt: null,
        userRoles: {
          some: {
            role: {
              name: capability.endsWith(':self') ? 'provider' : 'admin',
              deletedAt: null,
            },
          },
        },
      },
      select: { id: true },
    });
    if (!user) throw new AppError('FORBIDDEN', 'Money capability is required.', 403);
  }

  private async provider(userId: string, tx: PrismaTx) {
    const provider = await tx.providerProfile.findUnique({ where: { userId } });
    if (!provider || provider.deletedAt || ['SUSPENDED', 'REJECTED'].includes(provider.status))
      throw notFound();
    return provider;
  }
  private async ownedIntent(userId: string, id: string, tx: PrismaTx) {
    const provider = await this.provider(userId, tx);
    const intent = await tx.moneyPaymentIntent.findFirst({
      where: { id, providerProfileId: provider.id },
    });
    if (!intent) throw notFound();
    return intent;
  }
  private async ownedAttempt(userId: string, id: string, tx: PrismaTx) {
    const attempt = await tx.moneyPaymentAttempt.findUnique({ where: { id } });
    if (!attempt) throw notFound();
    await this.ownedIntent(userId, attempt.paymentIntentId, tx);
    return attempt;
  }
  private async ownedConfirmation(userId: string, id: string, tx: PrismaTx) {
    const confirmation = await tx.moneyPaymentConfirmation.findUnique({ where: { id } });
    if (!confirmation) throw notFound();
    await this.ownedIntent(userId, confirmation.paymentIntentId, tx);
    return confirmation;
  }
  private async lockIntent(id: string, tx: PrismaTx): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "MoneyPaymentIntent" WHERE "id" = ${id} FOR UPDATE`;
  }
  private async lockConfirmation(id: string, tx: PrismaTx): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "MoneyPaymentConfirmation" WHERE "id" = ${id} FOR UPDATE`;
  }

  private async calculateQuote(
    providerProfileId: string,
    request: MoneyPurchaseRequestV1,
    tx: PrismaTx,
  ): Promise<{ quote: QuoteWireV1; binding: MoneyBindingConfiguration }> {
    const binding = await this.configuration.resolve(
      { planVersionId: request.planVersionId, method: request.method },
      tx,
    );
    if (!binding) throw unavailableMoneyPort('MONEY_CONFIGURATION_UNAVAILABLE');
    this.validateBinding(binding);
    if (
      binding.planVersionId !== request.planVersionId ||
      binding.method !== request.method ||
      !Number.isInteger(binding.quoteTtlSeconds) ||
      binding.quoteTtlSeconds <= 0 ||
      binding.quoteTtlSeconds > 86_400
    )
      throw conflict('MONEY_BINDING_MISMATCH');
    if (!this.collection.isConfigured(binding))
      throw unavailableMoneyPort('MONEY_COLLECTION_UNAVAILABLE');
    const calculated = await new MoneyQuoteService(this.catalog.forTransaction(tx)).quote({
      providerProfileId,
      planVersionId: request.planVersionId,
      paymentMethod: request.method,
      couponCode: request.couponCode,
    });
    if (calculated.currency !== binding.currency) throw conflict('MONEY_BINDING_MISMATCH');
    const quote: QuoteWireV1 = {
      contractVersion: MONEY_CONTRACT_VERSION,
      planVersionId: request.planVersionId,
      paymentMethod: request.method,
      subtotal: toMoneyWire({
        amountMinor: calculated.subtotalMinor,
        currency: calculated.currency,
      }),
      discount: toMoneyWire({
        amountMinor: calculated.discountMinor,
        currency: calculated.currency,
      }),
      total: toMoneyWire({ amountMinor: calculated.totalMinor, currency: calculated.currency }),
      couponId: calculated.couponId,
      expiresAt: new Date(Date.now() + binding.quoteTtlSeconds * 1000).toISOString(),
    };
    return { quote, binding };
  }
  private validateBinding(binding: MoneyTransportBinding): void {
    if (binding.mode !== 'SANDBOX') throw unavailableMoneyPort('MONEY_LIVE_DISABLED');
    parse(adapterIdSchema, binding.adapterId);
    parse(externalIdSchema, binding.accountReference);
    parse(configurationVersionSchema, binding.configVersion);
    for (const value of [binding.planVersionId, binding.debitAccountId, binding.creditAccountId])
      parse(idSchema, value);
    if (!/^[A-Z]{3}$/u.test(binding.currency) || binding.debitAccountId === binding.creditAccountId)
      throw conflict('MONEY_BINDING_MISMATCH');
  }
  private async binding(intent: MoneyPaymentIntent, tx: PrismaTx): Promise<MoneyTransportBinding> {
    const row = await tx.moneyIntentBinding.findUnique({ where: { paymentIntentId: intent.id } });
    if (!row) throw unavailableMoneyPort('MONEY_CONFIGURATION_UNAVAILABLE');
    const binding: MoneyTransportBinding = {
      planVersionId: intent.planVersionId,
      method: intent.method,
      currency: row.currency,
      adapterId: row.adapterId,
      mode: row.mode,
      accountReference: row.accountReference,
      debitAccountId: row.debitAccountId,
      creditAccountId: row.creditAccountId,
      configVersion: row.configVersion,
    };
    this.validateBinding(binding);
    if (binding.currency !== intent.currency) throw conflict('MONEY_BINDING_MISMATCH');
    return binding;
  }
  private async requireConfiguredBinding(
    binding: MoneyTransportBinding,
    tx: PrismaTx,
  ): Promise<void> {
    const configured = this.configuration.resolveBinding
      ? await this.configuration.resolveBinding(binding, tx)
      : await this.configuration.resolve(
          { planVersionId: binding.planVersionId, method: binding.method },
          tx,
        );
    if (!configured) throw unavailableMoneyPort('MONEY_CONFIGURATION_UNAVAILABLE');
    this.validateBinding(configured);
    for (const key of Object.keys(binding) as Array<keyof MoneyTransportBinding>)
      if (binding[key] !== configured[key]) throw conflict('MONEY_BINDING_MISMATCH');
  }

  private normalizedEvent(input: unknown): NormalizedMoneyExternalEvent {
    const parsed = parse(eventSchema, input);
    const amount = money(parsed.amount);
    if (amount.amountMinor <= 0n || parsed.mode !== 'SANDBOX')
      throw invalid('MONEY_BINDING_MISMATCH');
    const manual = parsed.source === 'MANUAL_REVIEW';
    if (
      manual
        ? !parsed.receiptMediaAssetId ||
          !parsed.reviewerUserId ||
          parsed.externalOperationId !== null
        : parsed.receiptMediaAssetId !== null ||
          parsed.reviewerUserId !== null ||
          !parsed.paymentAttemptId ||
          !parsed.externalOperationId
    )
      throw invalid('MONEY_EVENT_EVIDENCE_MISMATCH');
    return {
      ...parsed,
      amount: toMoneyWire(amount),
      confirmedAt: new Date(parsed.confirmedAt).toISOString(),
    };
  }
  private eventView(row: MoneyExternalEvent): NormalizedMoneyExternalEvent {
    return {
      contractVersion: MONEY_CONTRACT_VERSION,
      adapterId: row.adapterId,
      mode: row.mode,
      accountReference: row.accountReference,
      externalEventId: row.externalEventId,
      externalConfirmationId: row.externalConfirmationId,
      externalOperationId: row.externalOperationId,
      paymentIntentId: row.paymentIntentId,
      paymentAttemptId: row.paymentAttemptId,
      source: row.source,
      amount: toMoneyWire({ amountMinor: row.amountMinor, currency: row.currency }),
      confirmedAt: row.confirmedAt.toISOString(),
      receiptMediaAssetId: row.receiptMediaAssetId,
      reviewerUserId: row.reviewerUserId,
    };
  }
  private async checkEventBinding(event: NormalizedMoneyExternalEvent, tx: PrismaTx) {
    const intent = await tx.moneyPaymentIntent.findUnique({ where: { id: event.paymentIntentId } });
    if (!intent) throw notFound();
    const binding = await this.binding(intent, tx);
    const amount = money(event.amount);
    if (
      binding.adapterId !== event.adapterId ||
      binding.mode !== event.mode ||
      binding.accountReference !== event.accountReference ||
      intent.currency !== amount.currency ||
      intent.totalMinor !== amount.amountMinor ||
      event.source !== (intent.method === 'STRIPE' ? 'PROVIDER_WEBHOOK' : 'MANUAL_REVIEW')
    )
      throw conflict('MONEY_BINDING_MISMATCH');
    if (event.paymentAttemptId) {
      const attempt = await tx.moneyPaymentAttempt.findUnique({
        where: { id: event.paymentAttemptId },
      });
      if (
        !attempt ||
        attempt.paymentIntentId !== intent.id ||
        !['STARTED', 'SUCCEEDED'].includes(attempt.status)
      )
        throw conflict('MONEY_EVENT_ATTEMPT_MISMATCH');
      const dispatch = await tx.moneyDispatch.findUnique({
        where: { paymentAttemptId: attempt.id },
      });
      if (
        !dispatch ||
        dispatch.kind !== 'COLLECTION' ||
        dispatch.paymentIntentId !== intent.id ||
        (dispatch.externalOperationId && dispatch.externalOperationId !== event.externalOperationId)
      )
        throw conflict('MONEY_EXTERNAL_ID_MISMATCH');
    }
    if (event.source === 'MANUAL_REVIEW') {
      await this.requireReceipt(intent.id, event.receiptMediaAssetId!, tx);
    }
    return { intent, binding };
  }
  private async storeEvent(event: NormalizedMoneyExternalEvent, tx: PrismaTx) {
    const requestDigest = hash(event);
    const where = {
      adapterId: event.adapterId,
      mode: event.mode,
      accountReference: event.accountReference,
      externalEventId: event.externalEventId,
    };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`r24.money.event:${hash(where)}`}, 0))`;
    const previous = await tx.moneyExternalEvent.findFirst({ where });
    if (previous) {
      if (previous.requestDigest !== requestDigest) throw conflict();
      return previous;
    }
    const amount = money(event.amount);
    return tx.moneyExternalEvent.create({
      data: {
        ...where,
        externalConfirmationId: event.externalConfirmationId,
        externalOperationId: event.externalOperationId,
        paymentIntentId: event.paymentIntentId,
        paymentAttemptId: event.paymentAttemptId,
        source: event.source,
        amountMinor: amount.amountMinor,
        currency: amount.currency,
        confirmedAt: new Date(event.confirmedAt),
        receiptMediaAssetId: event.receiptMediaAssetId,
        reviewerUserId: event.reviewerUserId,
        requestDigest,
      },
    });
  }
  private async requireReceipt(paymentIntentId: string, receiptMediaAssetId: string, tx: PrismaTx) {
    const intent = await tx.moneyPaymentIntent.findUnique({ where: { id: paymentIntentId } });
    if (!intent) throw notFound();
    const provider = await tx.providerProfile.findUnique({
      where: { id: intent.providerProfileId },
    });
    const receipt = await tx.mediaAsset.findUnique({ where: { id: receiptMediaAssetId } });
    if (
      !provider?.userId ||
      !receipt ||
      receipt.ownerUserId !== provider.userId ||
      receipt.visibility !== 'RESTRICTED' ||
      receipt.scanState !== 'CLEAN' ||
      !receipt.uploadCompletedAt ||
      !receipt.sha256 ||
      receipt.deletedAt ||
      receipt.erasureStartedAt
    )
      throw notFound();
    return { intent, ownerUserId: provider.userId };
  }

  private async claimDispatch(
    id: string,
  ): Promise<{ dispatch: MoneyDispatch; claimId: string } | null> {
    const claimId = randomUUID();
    return this.transactions.run(async (tx) => {
      const now = new Date();
      const result = await tx.moneyDispatch.updateMany({
        where: {
          id,
          status: { in: ['NOT_DISPATCHED', 'PENDING', 'UNKNOWN'] },
          OR: [{ claimId: null }, { leaseUntil: { lte: now } }],
        },
        data: {
          status: 'PENDING',
          claimId,
          leaseUntil: new Date(now.getTime() + DISPATCH_LEASE_MS),
        },
      });
      return result.count === 1
        ? { dispatch: await tx.moneyDispatch.findUniqueOrThrow({ where: { id } }), claimId }
        : null;
    }, TX_OPTIONS);
  }
  private async observeUnknown(id: string, claimId: string): Promise<void> {
    await this.prisma.client.moneyDispatch.updateMany({
      where: { id, claimId, status: { in: ['PENDING', 'UNKNOWN'] } },
      data: {
        status: 'UNKNOWN',
        claimId: null,
        leaseUntil: null,
      },
    });
  }
  private async dispatchCollection(paymentAttemptId: string): Promise<void> {
    const row = await this.prisma.client.moneyDispatch.findUnique({ where: { paymentAttemptId } });
    if (!row) throw notFound();
    const claimed = await this.claimDispatch(row.id);
    if (!claimed) return;
    try {
      const context = await this.transactions.run(async (tx) => {
        const intent = await tx.moneyPaymentIntent.findUniqueOrThrow({
          where: { id: row.paymentIntentId },
        });
        const binding = await this.binding(intent, tx);
        await this.requireConfiguredBinding(binding, tx);
        if (!this.collection.isConfigured(binding))
          throw unavailableMoneyPort('MONEY_COLLECTION_UNAVAILABLE');
        return { intent, binding };
      }, TX_OPTIONS);
      const observation = parse(
        observationSchema,
        await this.collection.createOrResume({
          binding: context.binding,
          paymentIntentId: row.paymentIntentId,
          paymentAttemptId,
          providerIdempotencyKey: claimed.dispatch.providerIdempotencyKey,
          amount: toMoneyWire({
            amountMinor: context.intent.totalMinor,
            currency: context.intent.currency,
          }),
          externalOperationId: claimed.dispatch.externalOperationId,
        }),
      );
      if (
        (claimed.dispatch.externalOperationId &&
          observation.externalOperationId !== claimed.dispatch.externalOperationId) ||
        (['SUCCEEDED', 'FAILED'].includes(observation.status) && !observation.externalOperationId)
      )
        throw conflict('MONEY_EXTERNAL_ID_MISMATCH');
      await this.transactions.run(async (tx) => {
        // Match authoritative event processing's intent-first lock order.
        // A late observation must neither deadlock nor overwrite confirmation.
        await this.lockIntent(row.paymentIntentId, tx);
        const status = observation.status === 'SUCCEEDED' ? 'PENDING' : observation.status;
        const updated = await tx.moneyDispatch.updateMany({
          where: { id: row.id, claimId: claimed.claimId, status: { in: ['PENDING', 'UNKNOWN'] } },
          data: {
            status,
            externalOperationId: observation.externalOperationId,
            observation: json(observation),
            claimId: null,
            leaseUntil: null,
          },
        });
        if (updated.count === 1)
          await tx.moneyPaymentAttempt.update({
            where: { id: paymentAttemptId },
            data: {
              ...(observation.status === 'FAILED' ? { status: 'FAILED' as const } : {}),
              ...(observation.externalOperationId
                ? {
                    externalAttemptId: `r24a_${hash([context.binding.adapterId, context.binding.mode, context.binding.accountReference, observation.externalOperationId])}`,
                  }
                : {}),
            },
          });
      }, TX_OPTIONS);
    } catch {
      // A timeout, invalid adapter response or crash never proves failure.
      // Do not persist raw provider errors; the same durable key stays usable.
      await this.observeUnknown(row.id, claimed.claimId);
    }
  }

  private async refundTransportCommand(
    userId: string,
    key: string,
    refundId: string,
    queryOnly: boolean,
  ): Promise<MoneyCommandAcceptedV1> {
    const request = { refundId: parse(idSchema, refundId) };
    const value = await this.userCommand(
      userId,
      key,
      queryOnly ? 'QUERY_REFUND' : 'DISPATCH_REFUND',
      'money:refund:review',
      request,
      async (tx) => {
        if (!(await tx.moneyRefund.findUnique({ where: { id: refundId } }))) throw notFound();
      },
      async (tx, commandId) => {
        const initial = await tx.moneyRefund.findUniqueOrThrow({ where: { id: refundId } });
        await this.lockConfirmation(initial.paymentConfirmationId, tx);
        await tx.$queryRaw`SELECT "id" FROM "MoneyRefund" WHERE "id" = ${refundId} FOR UPDATE`;
        const refund = await tx.moneyRefund.findUniqueOrThrow({ where: { id: refundId } });
        if (!['RESERVED', 'DISPATCHED'].includes(refund.status))
          throw conflict('MONEY_REFUND_ALREADY_TERMINAL');
        const confirmation = await tx.moneyPaymentConfirmation.findUniqueOrThrow({
          where: { id: refund.paymentConfirmationId },
        });
        const intent = await tx.moneyPaymentIntent.findUniqueOrThrow({
          where: { id: confirmation.paymentIntentId },
        });
        const binding = await this.binding(intent, tx);
        let dispatch = await tx.moneyDispatch.findUnique({ where: { refundId } });
        if (!dispatch && queryOnly) throw conflict('MONEY_REFUND_NOT_DISPATCHED');
        // Already verified terminal evidence can finish locally through an
        // adapter outage. Fresh reviewer authority and binding still apply.
        if (!this.terminalRefundObservation(dispatch?.observation)) {
          await this.requireConfiguredBinding(binding, tx);
          if (!this.refunds.isConfigured(binding))
            throw unavailableMoneyPort('MONEY_REFUND_ADAPTER_UNAVAILABLE');
        }
        if (!dispatch)
          dispatch = await tx.moneyDispatch.create({
            data: {
              kind: 'REFUND',
              commandId,
              refundId,
              paymentIntentId: intent.id,
              providerIdempotencyKey: `r24_refund_${hash(refund.id)}`,
            },
          });
        return {
          value: accepted(commandId, 'REFUND', refund.id),
          authority: {
            dispatchId: dispatch.id,
            binding,
            amount: toMoneyWire({ amountMinor: refund.amountMinor, currency: refund.currency }),
          },
        };
      },
    );
    await this.dispatchRefundOperation(refundId, queryOnly);
    return value;
  }
  private refundObservation(input: unknown): MoneyRefundObservation {
    const observed = parse(refundObservationSchema, input);
    if (['SUCCEEDED', 'FAILED'].includes(observed.status) && !observed.externalOperationId)
      throw invalid('MONEY_REFUND_NOT_TERMINAL');
    return { ...observed, amount: toMoneyWire(money(observed.amount)) };
  }
  private terminalRefundObservation(
    input: Prisma.JsonValue | undefined,
  ): MoneyRefundObservation | null {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      !['SUCCEEDED', 'FAILED'].includes(String(input.status))
    )
      return null;
    return this.refundObservation(input);
  }
  private async checkRefundObservation(
    dispatchId: string,
    observed: MoneyRefundObservation,
    tx: PrismaTx,
  ) {
    const dispatch = await tx.moneyDispatch.findUnique({ where: { id: dispatchId } });
    if (!dispatch || dispatch.kind !== 'REFUND' || dispatch.refundId !== observed.refundId)
      throw conflict('MONEY_BINDING_MISMATCH');
    const refund = await tx.moneyRefund.findUniqueOrThrow({ where: { id: observed.refundId } });
    const confirmation = await tx.moneyPaymentConfirmation.findUniqueOrThrow({
      where: { id: refund.paymentConfirmationId },
    });
    const intent = await tx.moneyPaymentIntent.findUniqueOrThrow({
      where: { id: confirmation.paymentIntentId },
    });
    const binding = await this.binding(intent, tx);
    const amount = money(observed.amount);
    if (
      dispatch.paymentIntentId !== intent.id ||
      observed.paymentConfirmationId !== confirmation.id ||
      observed.adapterId !== binding.adapterId ||
      observed.mode !== binding.mode ||
      observed.accountReference !== binding.accountReference ||
      amount.amountMinor !== refund.amountMinor ||
      amount.currency !== refund.currency ||
      (dispatch.externalOperationId &&
        observed.externalOperationId !== dispatch.externalOperationId)
    )
      throw conflict('MONEY_BINDING_MISMATCH');
    const terminal = this.terminalRefundObservation(dispatch.observation);
    if (
      terminal &&
      ['SUCCEEDED', 'FAILED'].includes(observed.status) &&
      hash(terminal) !== hash(observed)
    )
      throw conflict('MONEY_REFUND_OUTCOME_CONFLICT');
    return { dispatch, refund, binding };
  }
  private async persistRefundObservation(
    dispatchId: string,
    claimId: string,
    observed: MoneyRefundObservation,
  ): Promise<MoneyRefundObservation> {
    return this.transactions.run(async (tx) => {
      // No financial resource locks are acquired while holding this row.
      // Persist verified transport evidence before a separate compensation tx.
      await tx.$queryRaw`SELECT "id" FROM "MoneyDispatch" WHERE "id" = ${dispatchId} FOR UPDATE`;
      const { dispatch } = await this.checkRefundObservation(dispatchId, observed, tx);
      const terminal = this.terminalRefundObservation(dispatch.observation);
      if (terminal) return terminal; // A late PENDING/UNKNOWN reply cannot erase it.
      if (observed.status === 'SUCCEEDED' || observed.status === 'FAILED') {
        if (!['PENDING', 'UNKNOWN'].includes(dispatch.status))
          throw conflict('MONEY_REFUND_ALREADY_TERMINAL');
        await tx.moneyDispatch.update({
          where: { id: dispatchId },
          data: {
            externalOperationId: observed.externalOperationId,
            observation: json(observed),
          },
        });
      } else {
        await tx.moneyDispatch.updateMany({
          where: { id: dispatchId, claimId, status: { in: ['PENDING', 'UNKNOWN'] } },
          data: {
            status: observed.status,
            externalOperationId: observed.externalOperationId,
            observation: json(observed),
            claimId: null,
            leaseUntil: null,
          },
        });
      }
      return observed;
    }, TX_OPTIONS);
  }
  private async dispatchRefundOperation(refundId: string, queryOnly: boolean): Promise<void> {
    const row = await this.prisma.client.moneyDispatch.findUnique({ where: { refundId } });
    if (!row) throw notFound();
    const claimed = await this.claimDispatch(row.id);
    if (!claimed) return;
    try {
      const recovered = this.terminalRefundObservation(claimed.dispatch.observation);
      if (recovered) {
        await this.recordRefundResult(row.id, recovered);
        return;
      }
      const context = await this.transactions.run(async (tx) => {
        const refund = await tx.moneyRefund.findUniqueOrThrow({ where: { id: refundId } });
        const confirmation = await tx.moneyPaymentConfirmation.findUniqueOrThrow({
          where: { id: refund.paymentConfirmationId },
        });
        const intent = await tx.moneyPaymentIntent.findUniqueOrThrow({
          where: { id: confirmation.paymentIntentId },
        });
        const binding = await this.binding(intent, tx);
        await this.requireConfiguredBinding(binding, tx);
        if (!this.refunds.isConfigured(binding))
          throw unavailableMoneyPort('MONEY_REFUND_ADAPTER_UNAVAILABLE');
        return { refund, binding };
      }, TX_OPTIONS);
      const command = {
        binding: context.binding,
        refundId,
        paymentConfirmationId: context.refund.paymentConfirmationId,
        providerIdempotencyKey: claimed.dispatch.providerIdempotencyKey,
        amount: toMoneyWire({
          amountMinor: context.refund.amountMinor,
          currency: context.refund.currency,
        }),
        externalOperationId: claimed.dispatch.externalOperationId,
      };
      const observed = await this.persistRefundObservation(
        row.id,
        claimed.claimId,
        this.refundObservation(
          await (queryOnly ? this.refunds.query(command) : this.refunds.submit(command)),
        ),
      );
      if (observed.status === 'SUCCEEDED' || observed.status === 'FAILED') {
        await this.recordRefundResult(row.id, observed);
      }
    } catch {
      await this.observeUnknown(row.id, claimed.claimId);
    }
  }
}
