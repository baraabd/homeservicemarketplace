import { Injectable } from '@nestjs/common';
import {
  MONEY_CONTRACT_VERSION,
  toMoneyWire,
  type FinancialProjectionV1,
  type MoneyAttemptStatusWireV1,
  type MoneyContractVersion,
  type MoneyRefundRequestWireV1,
  type PaymentIntentWireV1,
  type ReconciliationExceptionWireV1,
  type SubscriptionContract,
} from '@homeservicemarketplace/contracts';
import { Prisma, type PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import type { MoneyFinanceReadPort } from '../ports/finance-read.port';

export interface MoneyPageQuery {
  limit?: number;
  cursor?: string;
  currency?: string;
}

export interface MoneyPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type MoneySubscriptionRead = SubscriptionContract & {
  contractVersion: MoneyContractVersion;
};

export interface MoneyUsageRead extends MoneyPage<{ entitlementKey: string; used: number }> {
  contractVersion: MoneyContractVersion;
  subscriptionId: string;
}

type PageQuery = MoneyPageQuery & { limit: number };
type CursorScope = { resource: string; owner: string; currency: string | null };
type Anchor = { id: string; createdAt: Date };
type CreatedBefore = {
  OR?: ({ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } })[];
};

const INTENT_SELECT = {
  id: true,
  providerProfileId: true,
  planVersionId: true,
  method: true,
  status: true,
  currency: true,
  subtotalMinor: true,
  discountMinor: true,
  totalMinor: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.MoneyPaymentIntentSelect;

const SUBSCRIPTION_SELECT = {
  id: true,
  providerProfileId: true,
  planVersionId: true,
  status: true,
  createdAt: true,
  planVersion: { select: { currency: true } },
  periods: {
    where: { paymentConfirmation: { ledgerTransaction: { status: 'POSTED' } } },
    orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { startsAt: true, endsAt: true },
  },
} satisfies Prisma.ProviderSubscriptionSelect;

const REFUND_REQUEST_SELECT = {
  id: true,
  paymentConfirmationId: true,
  amountMinor: true,
  currency: true,
  reasonCode: true,
  status: true,
  refundId: true,
  createdAt: true,
} satisfies Prisma.MoneyRefundRequestSelect;

const EXCEPTION_SELECT = {
  id: true,
  kind: true,
  subjectType: true,
  subjectId: true,
  detectedAt: true,
  resolvedAt: true,
} satisfies Prisma.MoneyReconciliationExceptionSelect;

const EXCEPTION_SUBJECTS: readonly ReconciliationExceptionWireV1['subjectType'][] = [
  'PaymentConfirmation',
  'LedgerTransaction',
  'Refund',
  'SubscriptionPeriod',
];

/** Read-only projections of the existing money authorities.
 * Never returns command digests, account bindings, evidence, transport payloads
 * or booking estimates. Each public entry resolves current database grants.
 */
@Injectable()
export class MoneyQueryService implements MoneyFinanceReadPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionResolverService,
    private readonly transactions: TransactionRunner,
  ) {}

  async intent(userId: string, id: string): Promise<PaymentIntentWireV1> {
    const providerProfileId = await this.owner(userId);
    const row = await this.prisma.client.moneyPaymentIntent.findFirst({
      where: { ...this.intentOwner(userId, providerProfileId), id: resourceId(id) },
      select: INTENT_SELECT,
    });
    if (!row) throw notFound();
    return intentWire(row);
  }

  async listIntents(
    userId: string,
    input: MoneyPageQuery = {},
  ): Promise<MoneyPage<PaymentIntentWireV1>> {
    const providerProfileId = await this.owner(userId);
    const query = pageQuery(input);
    return this.intentPage(
      query,
      { ...this.intentOwner(userId, providerProfileId), ...currencyWhere(query.currency) },
      cursorScope('intents', providerProfileId, query.currency),
    );
  }

  async attempt(userId: string, id: string): Promise<MoneyAttemptStatusWireV1> {
    // Attempt and dispatch can change in the same confirmation commit.
    // Keep their projection and current authority in one snapshot.
    return this.transactions.run(
      async (tx) => {
        const providerProfileId = await this.owner(userId, tx);
        const row = await tx.moneyPaymentAttempt.findFirst({
          where: {
            id: resourceId(id),
            paymentIntent: this.intentOwner(userId, providerProfileId),
          },
          select: {
            id: true,
            paymentIntentId: true,
            attemptNo: true,
            status: true,
            externalAttemptId: true,
            createdAt: true,
            dispatch: { select: { status: true } },
          },
        });
        if (!row) throw notFound();
        return {
          contractVersion: MONEY_CONTRACT_VERSION,
          id: row.id,
          paymentIntentId: row.paymentIntentId,
          attemptNo: row.attemptNo,
          status: row.status,
          externalAttemptId: row.externalAttemptId,
          createdAt: row.createdAt.toISOString(),
          dispatchStatus: row.dispatch?.status ?? null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async subscriptions(
    userId: string,
    input: MoneyPageQuery = {},
  ): Promise<MoneyPage<MoneySubscriptionRead>> {
    const providerProfileId = await this.owner(userId);
    const query = pageQuery(input);
    const where: Prisma.ProviderSubscriptionWhereInput = {
      ...this.intentOwner(userId, providerProfileId),
      ...(query.currency ? { planVersion: { currency: query.currency } } : {}),
    };
    return datedPage(
      query,
      cursorScope('subscriptions', providerProfileId, query.currency),
      (id) =>
        this.prisma.client.providerSubscription.findFirst({
          where: { AND: [where, { id }] },
          select: { id: true, createdAt: true },
        }),
      (before, take) =>
        this.prisma.client.providerSubscription.findMany({
          where: { AND: [where, before] },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: SUBSCRIPTION_SELECT,
        }),
      subscriptionWire,
    );
  }

  async subscription(userId: string, id: string): Promise<MoneySubscriptionRead> {
    const providerProfileId = await this.owner(userId);
    const row = await this.prisma.client.providerSubscription.findFirst({
      where: { ...this.intentOwner(userId, providerProfileId), id: resourceId(id) },
      select: SUBSCRIPTION_SELECT,
    });
    if (!row) throw notFound();
    return subscriptionWire(row);
  }

  async usage(
    userId: string,
    subscriptionId: string,
    input: MoneyPageQuery = {},
  ): Promise<MoneyUsageRead> {
    const providerProfileId = await this.owner(userId);
    const query = pageQuery(input);
    const subscription = await this.prisma.client.providerSubscription.findFirst({
      where: {
        ...this.intentOwner(userId, providerProfileId),
        id: resourceId(subscriptionId),
      },
      select: { id: true, planVersion: { select: { currency: true } } },
    });
    if (!subscription) throw notFound();
    if (query.currency && query.currency !== subscription.planVersion.currency)
      throw invalid('The currency does not match this subscription.');
    const scope = cursorScope(
      `usage:${subscription.id}`,
      providerProfileId,
      subscription.planVersion.currency,
    );
    const usageOwner = {
      subscriptionId: subscription.id,
      subscription: this.intentOwner(userId, providerProfileId),
    };
    const key = query.cursor ? decodeCursor(query.cursor, scope) : null;
    if (key) {
      const anchor = await this.prisma.client.moneyEntitlementUsage.findFirst({
        where: { ...usageOwner, entitlementKey: key },
        select: { entitlementKey: true },
      });
      if (!anchor) throw invalidCursor();
    }
    // Page groups, not usage events: one entitlement never straddles pages.
    // R19's unique (subscription, entitlement, usageKey) is the dedupe authority.
    const found = await this.prisma.client.moneyEntitlementUsage.groupBy({
      by: ['entitlementKey'],
      where: {
        ...usageOwner,
        ...(key ? { entitlementKey: { gt: key } } : {}),
      },
      orderBy: { entitlementKey: 'asc' },
      take: query.limit + 1,
      _count: { _all: true },
    });
    const rows = found.slice(0, query.limit);
    return {
      contractVersion: MONEY_CONTRACT_VERSION,
      subscriptionId: subscription.id,
      items: rows.map((row) => {
        if (!Number.isSafeInteger(row._count._all) || row._count._all < 0)
          throw invalidStoredValue();
        return { entitlementKey: row.entitlementKey, used: row._count._all };
      }),
      nextCursor:
        found.length > query.limit
          ? encodeCursor(rows[rows.length - 1].entitlementKey, scope)
          : null,
    };
  }

  async refundRequest(userId: string, id: string): Promise<MoneyRefundRequestWireV1> {
    const providerProfileId = await this.owner(userId);
    const row = await this.prisma.client.moneyRefundRequest.findFirst({
      where: { id: resourceId(id), ...this.intentOwner(userId, providerProfileId) },
      select: REFUND_REQUEST_SELECT,
    });
    if (!row) throw notFound();
    return refundRequestWire(row);
  }

  async listRefundRequests(
    userId: string,
    input: MoneyPageQuery = {},
  ): Promise<MoneyPage<MoneyRefundRequestWireV1>> {
    const providerProfileId = await this.owner(userId);
    const query = pageQuery(input);
    return this.refundRequestPage(
      query,
      { ...this.intentOwner(userId, providerProfileId), ...currencyWhere(query.currency) },
      cursorScope('refund-requests', providerProfileId, query.currency),
    );
  }

  async reviewIntents(
    userId: string,
    input: MoneyPageQuery = {},
  ): Promise<MoneyPage<PaymentIntentWireV1>> {
    await this.reviewAuthority(userId);
    const query = pageQuery(input);
    return this.intentPage(
      query,
      currencyWhere(query.currency),
      cursorScope('review-intents', userId, query.currency),
    );
  }

  async reviewRefundRequests(
    userId: string,
    input: MoneyPageQuery = {},
  ): Promise<MoneyPage<MoneyRefundRequestWireV1>> {
    await this.reviewAuthority(userId);
    const query = pageQuery(input);
    return this.refundRequestPage(
      query,
      currencyWhere(query.currency),
      cursorScope('review-refund-requests', userId, query.currency),
    );
  }

  async reviewFinancials(
    userId: string,
    input: { currency?: string; asOf?: string } = {},
  ): Promise<FinancialProjectionV1> {
    // Both totals and the fresh grant read see one database snapshot.
    return this.transactions.run(
      async (tx) => {
        await this.reviewAuthority(userId, tx);
        const currency = checkedCurrency(input.currency);
        const asOf = projectionDate(input.asOf);
        const posted = {
          status: 'POSTED' as const,
          bookingId: null,
          postedAt: { lte: asOf },
        };
        const [captured, refunded] = await Promise.all([
          tx.ledgerEntry.groupBy({
            by: ['currency'],
            where: {
              side: 'CREDIT',
              ...currencyWhere(currency),
              transaction: {
                ...posted,
                moneyConfirmation: { is: { confirmedAt: { lte: asOf } } },
              },
            },
            _sum: { amountMinor: true },
          }),
          tx.ledgerEntry.groupBy({
            by: ['currency'],
            where: {
              side: 'CREDIT',
              ...currencyWhere(currency),
              transaction: {
                ...posted,
                moneyRefundCompensation: {
                  is: {
                    status: 'SUCCEEDED',
                    updatedAt: { lte: asOf },
                    paymentConfirmation: {
                      confirmedAt: { lte: asOf },
                      ledgerTransaction: posted,
                    },
                  },
                },
              },
            },
            _sum: { amountMinor: true },
          }),
        ]);
        const totals = new Map<string, { captured: bigint; refunded: bigint }>();
        if (currency) totals.set(currency, { captured: 0n, refunded: 0n });
        for (const [kind, rows] of [
          ['captured', captured],
          ['refunded', refunded],
        ] as const) {
          for (const row of rows) {
            const total = totals.get(row.currency) ?? { captured: 0n, refunded: 0n };
            total[kind] = row._sum.amountMinor ?? 0n;
            totals.set(row.currency, total);
          }
        }
        return {
          contractVersion: MONEY_CONTRACT_VERSION,
          source: 'LEDGER',
          totals: [...totals.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([currency, total]) => ({
              currency,
              captured: storedMoney(total.captured, currency),
              refunded: storedMoney(total.refunded, currency),
            })),
          asOf: asOf.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async reviewExceptions(
    userId: string,
    input: MoneyPageQuery = {},
  ): Promise<MoneyPage<ReconciliationExceptionWireV1>> {
    await this.reviewAuthority(userId);
    const query = pageQuery(input);
    // R19 exceptions have heterogeneous subject IDs and no currency column.
    // Refusing an unsupported filter prevents an apparently scoped full list.
    if (query.currency) throw invalid('Currency filtering is not supported for exceptions.');
    const scope = cursorScope('review-exceptions', userId);
    let before: Prisma.MoneyReconciliationExceptionWhereInput = {};
    if (query.cursor) {
      const id = decodeCursor(query.cursor, scope);
      const anchor = await this.prisma.client.moneyReconciliationException.findUnique({
        where: { id },
        select: { id: true, detectedAt: true },
      });
      if (!anchor) throw invalidCursor();
      before = {
        OR: [
          { detectedAt: { lt: anchor.detectedAt } },
          { detectedAt: anchor.detectedAt, id: { lt: anchor.id } },
        ],
      };
    }
    const found = await this.prisma.client.moneyReconciliationException.findMany({
      where: before,
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: EXCEPTION_SELECT,
    });
    const rows = found.slice(0, query.limit);
    return {
      items: rows.map((row) => {
        if (!EXCEPTION_SUBJECTS.includes(row.subjectType as never)) throw invalidStoredValue();
        return {
          contractVersion: MONEY_CONTRACT_VERSION,
          id: row.id,
          kind: row.kind,
          subjectType: row.subjectType as ReconciliationExceptionWireV1['subjectType'],
          subjectId: row.subjectId,
          detectedAt: row.detectedAt.toISOString(),
          resolvedAt: row.resolvedAt?.toISOString() ?? null,
        };
      }),
      nextCursor: found.length > query.limit ? encodeCursor(rows[rows.length - 1].id, scope) : null,
    };
  }

  financialProjection(
    userId: string,
    input: { currency: string; asOf: string },
  ): Promise<FinancialProjectionV1> {
    return this.reviewFinancials(userId, input);
  }

  exceptions(
    userId: string,
    input: { limit?: number; cursor?: string },
  ): Promise<MoneyPage<ReconciliationExceptionWireV1>> {
    return this.reviewExceptions(userId, input);
  }

  private async owner(userId: string, tx?: PrismaTx): Promise<string> {
    const rights = tx
      ? await this.permissions.resolveFreshForUser(userId, tx)
      : await this.permissions.resolveFreshForUser(userId);
    if (!rights.has('money:read:self')) throw forbidden();
    await this.requireCurrentRole(userId, 'provider', tx);
    const provider = await (tx ?? this.prisma.client).providerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (!provider) throw notFound();
    return provider.id;
  }

  private intentOwner(userId: string, providerProfileId: string) {
    return { providerProfileId, providerProfile: { userId, deletedAt: null } };
  }

  private async reviewAuthority(userId: string, tx?: PrismaTx): Promise<void> {
    const rights = tx
      ? await this.permissions.resolveFreshForUser(userId, tx)
      : await this.permissions.resolveFreshForUser(userId);
    if (!rights.has('money:review:read')) throw forbidden();
    await this.requireCurrentRole(userId, 'admin', tx);
  }

  private async requireCurrentRole(
    userId: string,
    role: 'provider' | 'admin',
    tx?: PrismaTx,
  ): Promise<void> {
    // JWT roles can outlive membership. A separately granted money capability
    // never substitutes for the current provider/reviewer base role.
    const user = await (tx ?? this.prisma.client).user.findFirst({
      where: {
        id: userId,
        status: 'ACTIVE',
        isActive: true,
        deletedAt: null,
        userRoles: { some: { role: { name: role, deletedAt: null } } },
      },
      select: { id: true },
    });
    if (!user) throw forbidden();
  }

  private intentPage(
    query: PageQuery,
    where: Prisma.MoneyPaymentIntentWhereInput,
    scope: CursorScope,
  ): Promise<MoneyPage<PaymentIntentWireV1>> {
    return datedPage(
      query,
      scope,
      (id) =>
        this.prisma.client.moneyPaymentIntent.findFirst({
          where: { AND: [where, { id }] },
          select: { id: true, createdAt: true },
        }),
      (before, take) =>
        this.prisma.client.moneyPaymentIntent.findMany({
          where: { AND: [where, before] },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: INTENT_SELECT,
        }),
      intentWire,
    );
  }

  private refundRequestPage(
    query: PageQuery,
    where: Prisma.MoneyRefundRequestWhereInput,
    scope: CursorScope,
  ): Promise<MoneyPage<MoneyRefundRequestWireV1>> {
    return datedPage(
      query,
      scope,
      (id) =>
        this.prisma.client.moneyRefundRequest.findFirst({
          where: { AND: [where, { id }] },
          select: { id: true, createdAt: true },
        }),
      (before, take) =>
        this.prisma.client.moneyRefundRequest.findMany({
          where: { AND: [where, before] },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
          select: REFUND_REQUEST_SELECT,
        }),
      refundRequestWire,
    );
  }
}

function intentWire(
  row: Prisma.MoneyPaymentIntentGetPayload<{ select: typeof INTENT_SELECT }>,
): PaymentIntentWireV1 {
  return {
    contractVersion: MONEY_CONTRACT_VERSION,
    id: row.id,
    providerProfileId: row.providerProfileId,
    planVersionId: row.planVersionId,
    method: row.method,
    status: row.status,
    subtotal: storedMoney(row.subtotalMinor, row.currency),
    discount: storedMoney(row.discountMinor, row.currency),
    total: storedMoney(row.totalMinor, row.currency),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function subscriptionWire(
  row: Prisma.ProviderSubscriptionGetPayload<{ select: typeof SUBSCRIPTION_SELECT }>,
): MoneySubscriptionRead {
  return {
    contractVersion: MONEY_CONTRACT_VERSION,
    id: row.id,
    providerProfileId: row.providerProfileId,
    planVersionId: row.planVersionId,
    status: row.status,
    startsAt: row.periods[0]?.startsAt.toISOString() ?? null,
    endsAt: row.periods[0]?.endsAt.toISOString() ?? null,
  };
}

function refundRequestWire(
  row: Prisma.MoneyRefundRequestGetPayload<{ select: typeof REFUND_REQUEST_SELECT }>,
): MoneyRefundRequestWireV1 {
  return {
    contractVersion: MONEY_CONTRACT_VERSION,
    id: row.id,
    paymentConfirmationId: row.paymentConfirmationId,
    amount: storedMoney(row.amountMinor, row.currency),
    reasonCode: row.reasonCode,
    status: row.status,
    refundId: row.refundId,
  };
}

async function datedPage<Row extends Anchor, Wire>(
  query: PageQuery,
  scope: CursorScope,
  findCursor: (id: string) => Promise<Anchor | null>,
  findRows: (before: CreatedBefore, take: number) => Promise<Row[]>,
  project: (row: Row) => Wire,
): Promise<MoneyPage<Wire>> {
  let before: CreatedBefore = {};
  if (query.cursor) {
    const anchor = await findCursor(decodeCursor(query.cursor, scope));
    if (!anchor) throw invalidCursor();
    before = {
      OR: [
        { createdAt: { lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { lt: anchor.id } },
      ],
    };
  }
  const found = await findRows(before, query.limit + 1);
  const rows = found.slice(0, query.limit);
  return {
    items: rows.map(project),
    nextCursor: found.length > query.limit ? encodeCursor(rows[rows.length - 1].id, scope) : null,
  };
}

function pageQuery(input: MoneyPageQuery): PageQuery {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw invalid('The page limit must be an integer between 1 and 50.');
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== 'string' || input.cursor.length === 0 || input.cursor.length > 2048)
  )
    throw invalidCursor();
  return { limit, cursor: input.cursor, currency: checkedCurrency(input.currency) };
}

function checkedCurrency(currency: string | undefined): string | undefined {
  if (currency !== undefined && (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)))
    throw invalid('Currency must contain three uppercase letters.');
  return currency;
}

function currencyWhere(currency?: string): { currency?: string } {
  return currency ? { currency } : {};
}

function cursorScope(resource: string, owner: string, currency?: string): CursorScope {
  return { resource, owner, currency: currency ?? null };
}

function encodeCursor(id: string, scope: CursorScope): string {
  return Buffer.from(JSON.stringify({ version: 1, scope, id }), 'utf8').toString('base64url');
}

function decodeCursor(value: string, scope: CursorScope): string {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidCursor();
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      version?: unknown;
      scope?: unknown;
      id?: unknown;
    };
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Object.keys(parsed).sort().join(',') !== 'id,scope,version' ||
      parsed.version !== 1 ||
      JSON.stringify(parsed.scope) !== JSON.stringify(scope) ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0 ||
      parsed.id.length > 256 ||
      encodeCursor(parsed.id, scope) !== value
    )
      throw invalidCursor();
    return parsed.id;
  } catch {
    throw invalidCursor();
  }
}

function projectionDate(value?: string): Date {
  const now = new Date();
  if (value === undefined) return now;
  const date = new Date(value);
  if (
    typeof value !== 'string' ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== value ||
    date > now
  )
    throw invalid('The projection timestamp must be a valid past or present ISO timestamp.');
  return date;
}

function resourceId(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256)
    throw invalid('The resource identifier is invalid.');
  return value;
}

function storedMoney(amountMinor: bigint, currency: string) {
  try {
    return toMoneyWire({ amountMinor, currency });
  } catch {
    // A malformed/overflowed stored projection is never rounded or leaked.
    throw invalidStoredValue();
  }
}

function forbidden(): AppError {
  return new AppError('FORBIDDEN', 'You cannot read this money resource.', 403);
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Money resource not found.', 404);
}

function invalid(message: string): AppError {
  return new AppError('VALIDATION_ERROR', message, 400);
}

function invalidCursor(): AppError {
  return invalid('The cursor is invalid for this resource, owner or currency.');
}

function invalidStoredValue(): AppError {
  return new AppError('INTERNAL_ERROR', 'The stored money projection cannot be represented.', 500);
}
