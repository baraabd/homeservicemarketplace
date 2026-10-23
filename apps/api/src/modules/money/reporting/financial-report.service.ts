import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCIAL_RECORD_KINDS,
  FINANCIAL_REPORT_VERSION,
  MONEY_CONTRACT_VERSION,
  toMoneyWire,
  type FinancialOperationsCapabilitiesV1,
  type FinancialOperationsSummaryV1,
  type FinancialRecordDetailV1,
  type FinancialRecordKind,
  type FinancialRecordsPageV1,
  type FinancialRecordsQueryV1,
  type FinancialRecordV1,
  type FinancialReconciliationDetailV1,
  type FinancialReconciliationPageV1,
  type FinancialReconciliationStatusV1,
  type FinancialReportProvenanceV1,
  type ReconciliationExceptionWireV1,
} from '@homeservicemarketplace/contracts';
import { Prisma, type PrismaTx } from '@homeservicemarketplace/database';

import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import { MoneyQueryService } from '../application/money-query.service';

export type FinancialReadAudience = 'ADMIN' | 'PROVIDER';
export const FINANCIAL_RECONCILIATION_STATUS = Symbol('FINANCIAL_RECONCILIATION_STATUS');

/** R34 can supply checked run provenance after coordinated integration. */
export interface FinancialReconciliationStatusPort {
  status(): Promise<FinancialReconciliationStatusV1>;
}

@Injectable()
export class UnavailableFinancialReconciliationStatus implements FinancialReconciliationStatusPort {
  async status(): Promise<FinancialReconciliationStatusV1> {
    return {
      state: 'UNAVAILABLE',
      lastSuccessAt: null,
      runId: null,
      reason: 'R34_INTEGRATION_PENDING',
    };
  }
}

const POSTING_SELECT = {
  status: true,
  currency: true,
  bookingId: true,
  postedAt: true,
} satisfies Prisma.LedgerTransactionSelect;
const CONFIRMATION_SELECT = {
  id: true,
  paymentIntentId: true,
  amountMinor: true,
  currency: true,
  ledgerTransactionId: true,
  ledgerTransaction: { select: POSTING_SELECT },
} satisfies Prisma.MoneyPaymentConfirmationSelect;
const INTENT_SELECT = {
  id: true,
  providerProfileId: true,
  status: true,
  totalMinor: true,
  currency: true,
  createdAt: true,
  confirmation: { select: CONFIRMATION_SELECT },
} satisfies Prisma.MoneyPaymentIntentSelect;
const ATTEMPT_SELECT = {
  id: true,
  status: true,
  createdAt: true,
  paymentIntentId: true,
  paymentIntent: {
    select: {
      providerProfileId: true,
      totalMinor: true,
      currency: true,
      confirmation: { select: CONFIRMATION_SELECT },
    },
  },
  dispatch: { select: { status: true } },
} satisfies Prisma.MoneyPaymentAttemptSelect;
const REQUEST_SELECT = {
  id: true,
  status: true,
  amountMinor: true,
  currency: true,
  createdAt: true,
  providerProfileId: true,
  paymentConfirmationId: true,
  reasonCode: true,
  paymentConfirmation: { select: { paymentIntentId: true } },
} satisfies Prisma.MoneyRefundRequestSelect;
const REFUND_SELECT = {
  id: true,
  status: true,
  amountMinor: true,
  currency: true,
  createdAt: true,
  paymentConfirmationId: true,
  compensatingLedgerTransactionId: true,
  compensatingLedgerTxn: { select: POSTING_SELECT },
  paymentConfirmation: {
    select: {
      ...CONFIRMATION_SELECT,
      paymentIntent: { select: { providerProfileId: true } },
    },
  },
  dispatch: { select: { status: true } },
} satisfies Prisma.MoneyRefundSelect;
const SUBSCRIPTION_SELECT = {
  id: true,
  providerProfileId: true,
  status: true,
  createdAt: true,
} satisfies Prisma.ProviderSubscriptionSelect;
const PERIOD_SELECT = {
  subscriptionId: true,
  startsAt: true,
  endsAt: true,
  paymentConfirmation: { select: CONFIRMATION_SELECT },
} satisfies Prisma.SubscriptionPeriodSelect;
const EXCEPTION_SELECT = {
  id: true,
  kind: true,
  subjectType: true,
  subjectId: true,
  detectedAt: true,
  resolvedAt: true,
} satisfies Prisma.MoneyReconciliationExceptionSelect;

type Confirmation = Prisma.MoneyPaymentConfirmationGetPayload<{
  select: typeof CONFIRMATION_SELECT;
}>;
type Posting = Prisma.LedgerTransactionGetPayload<{ select: typeof POSTING_SELECT }>;
type PageInput = Required<Pick<FinancialRecordsQueryV1, 'kind' | 'limit'>> &
  Pick<FinancialRecordsQueryV1, 'cursor' | 'currency'>;
type Anchor = { id: string; createdAt: Date };
type Before = { OR?: ({ createdAt: { lt: Date } } | { createdAt: Date; id: { lt: string } })[] };
type Scope = {
  kind: FinancialRecordKind;
  actor: string;
  audience: FinancialReadAudience;
  currency: string | null;
};

/** Read-only operational projections. No posting, refund command, evidence or
 * booking-price query is reachable here. Current authority is read again in
 * the same snapshot as every list/detail; all relation fan-outs are bounded.
 */
@Injectable()
export class FinancialReportService {
  constructor(
    private readonly permissions: PermissionResolverService,
    private readonly transactions: TransactionRunner,
    private readonly queries: MoneyQueryService,
    @Inject(FINANCIAL_RECONCILIATION_STATUS)
    private readonly reconciliationStatus: FinancialReconciliationStatusPort,
  ) {}

  async records(
    userId: string,
    audience: FinancialReadAudience,
    input: FinancialRecordsQueryV1 = {},
  ): Promise<FinancialRecordsPageV1> {
    const query = pageInput(input);
    return this.transactions.run(
      async (tx) => {
        const providerProfileId = await this.authorize(tx, userId, audience);
        const scope: Scope = {
          kind: query.kind,
          actor: userId,
          audience,
          currency: query.currency ?? null,
        };
        const owner = providerProfileId
          ? { providerProfileId, providerProfile: { userId, deletedAt: null } }
          : {};
        const currency = query.currency ? { currency: query.currency } : {};
        const envelope = pageEnvelope(query.kind);
        if (query.kind === 'SETTLEMENT') {
          if (query.cursor) throw invalidCursor();
          return {
            ...envelope,
            items: [],
            nextCursor: null,
            availability: { state: 'UNAVAILABLE', reason: 'SETTLEMENT_SOURCE_UNAVAILABLE' },
          };
        }
        switch (query.kind) {
          case 'PAYMENT': {
            const where = { ...owner, ...currency };
            return {
              ...envelope,
              ...(await page(
                query,
                scope,
                (id) =>
                  tx.moneyPaymentIntent.findFirst({
                    where: { ...where, id },
                    select: { id: true, createdAt: true },
                  }),
                (before, take) =>
                  tx.moneyPaymentIntent.findMany({
                    where: { AND: [where, before] },
                    select: INTENT_SELECT,
                    orderBy: order(),
                    take,
                  }),
                (rows) => paymentRecords(tx, rows),
              )),
            };
          }
          case 'ATTEMPT': {
            const where = { paymentIntent: { ...owner, ...currency } };
            return {
              ...envelope,
              ...(await page(
                query,
                scope,
                (id) =>
                  tx.moneyPaymentAttempt.findFirst({
                    where: { ...where, id },
                    select: { id: true, createdAt: true },
                  }),
                (before, take) =>
                  tx.moneyPaymentAttempt.findMany({
                    where: { AND: [where, before] },
                    select: ATTEMPT_SELECT,
                    orderBy: order(),
                    take,
                  }),
                (rows) => rows.map(attemptRecord),
              )),
            };
          }
          case 'REFUND_REQUEST': {
            const where = { ...owner, ...currency };
            return {
              ...envelope,
              ...(await page(
                query,
                scope,
                (id) =>
                  tx.moneyRefundRequest.findFirst({
                    where: { ...where, id },
                    select: { id: true, createdAt: true },
                  }),
                (before, take) =>
                  tx.moneyRefundRequest.findMany({
                    where: { AND: [where, before] },
                    select: REQUEST_SELECT,
                    orderBy: order(),
                    take,
                  }),
                (rows) => rows.map(requestRecord),
              )),
            };
          }
          case 'REFUND': {
            const where = { ...currency, paymentConfirmation: { paymentIntent: owner } };
            return {
              ...envelope,
              ...(await page(
                query,
                scope,
                (id) =>
                  tx.moneyRefund.findFirst({
                    where: { ...where, id },
                    select: { id: true, createdAt: true },
                  }),
                (before, take) =>
                  tx.moneyRefund.findMany({
                    where: { AND: [where, before] },
                    select: REFUND_SELECT,
                    orderBy: order(),
                    take,
                  }),
                (rows) => rows.map(refundRecord),
              )),
            };
          }
          case 'SUBSCRIPTION': {
            const where = {
              ...owner,
              ...(query.currency ? { planVersion: { currency: query.currency } } : {}),
            };
            return {
              ...envelope,
              ...(await page(
                query,
                scope,
                (id) =>
                  tx.providerSubscription.findFirst({
                    where: { ...where, id },
                    select: { id: true, createdAt: true },
                  }),
                (before, take) =>
                  tx.providerSubscription.findMany({
                    where: { AND: [where, before] },
                    select: SUBSCRIPTION_SELECT,
                    orderBy: order(),
                    take,
                  }),
                (rows) => subscriptionRecords(tx, rows),
              )),
            };
          }
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async detail(
    userId: string,
    audience: FinancialReadAudience,
    kind: string,
    id: string,
  ): Promise<FinancialRecordDetailV1> {
    const resource = checkedKind(kind);
    checkedId(id);
    return this.transactions.run(
      async (tx) => {
        const providerProfileId = await this.authorize(tx, userId, audience);
        const owner = providerProfileId
          ? { providerProfileId, providerProfile: { userId, deletedAt: null } }
          : {};
        let projected: FinancialRecordV1 | null = null;
        switch (resource) {
          case 'PAYMENT': {
            const row = await tx.moneyPaymentIntent.findFirst({
              where: { ...owner, id },
              select: INTENT_SELECT,
            });
            if (row) [projected] = await paymentRecords(tx, [row]);
            break;
          }
          case 'ATTEMPT': {
            const row = await tx.moneyPaymentAttempt.findFirst({
              where: { id, paymentIntent: owner },
              select: ATTEMPT_SELECT,
            });
            if (row) projected = attemptRecord(row);
            break;
          }
          case 'REFUND_REQUEST': {
            const row = await tx.moneyRefundRequest.findFirst({
              where: { ...owner, id },
              select: REQUEST_SELECT,
            });
            if (row) projected = requestRecord(row);
            break;
          }
          case 'REFUND': {
            const row = await tx.moneyRefund.findFirst({
              where: { id, paymentConfirmation: { paymentIntent: owner } },
              select: REFUND_SELECT,
            });
            if (row) projected = refundRecord(row);
            break;
          }
          case 'SUBSCRIPTION': {
            const row = await tx.providerSubscription.findFirst({
              where: { ...owner, id },
              select: SUBSCRIPTION_SELECT,
            });
            if (row) [projected] = await subscriptionRecords(tx, [row]);
            break;
          }
          case 'SETTLEMENT':
            throw new AppError(
              'DEPENDENCY_UNAVAILABLE',
              'Settlement history is unavailable.',
              503,
              { reason: 'SETTLEMENT_SOURCE_UNAVAILABLE' },
            );
        }
        if (!projected) throw notFound();
        return {
          ...version(),
          record: projected,
          provenance: provenance(),
          capabilities: unavailableCapabilities(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async summary(userId: string, currency?: string): Promise<FinancialOperationsSummaryV1> {
    checkedCurrency(currency);
    // R24 remains the sole registered ledger projection authority. Its own
    // asOf is carried intact; mutable pending obligations have a separately
    // named snapshot, never a pretend atomic net balance.
    const ledger = await this.queries.reviewFinancials(userId, { currency });
    return this.transactions.run(
      async (tx) => {
        await this.authorize(tx, userId, 'ADMIN');
        const pendingAsOf = new Date().toISOString();
        // Prisma's relation filters cannot express the latest attempt per intent.
        // One parameterized LATERAL join caps that relation at one row. Amounts
        // aggregate as numeric text, never JS numbers; wire overflow fails closed.
        const pending = await tx.$queryRaw<
          { currency: string; pending: string; unknown: string }[]
        >(Prisma.sql`
        SELECT i."currency",
          COALESCE(SUM(i."totalMinor") FILTER (WHERE d."status" IS DISTINCT FROM 'UNKNOWN'), 0)::text AS pending,
          COALESCE(SUM(i."totalMinor") FILTER (WHERE d."status" = 'UNKNOWN'), 0)::text AS unknown
        FROM "MoneyPaymentIntent" i
        JOIN LATERAL (
          SELECT a."id", a."status" FROM "MoneyPaymentAttempt" a
          WHERE a."paymentIntentId" = i."id" ORDER BY a."attemptNo" DESC LIMIT 1
        ) a ON true
        LEFT JOIN "MoneyDispatch" d ON d."paymentAttemptId" = a."id"
        WHERE a."status" = 'STARTED'
          AND i."status" IN ('CREATED', 'AWAITING_PAYMENT', 'PROCESSING')
          AND NOT EXISTS (SELECT 1 FROM "MoneyPaymentConfirmation" c WHERE c."paymentIntentId" = i."id")
          AND (${currency ?? null}::text IS NULL OR i."currency" = ${currency ?? null}::text)
        GROUP BY i."currency" ORDER BY i."currency"
      `);
        const requests = await tx.$queryRaw<{ currency: string; requested: string }[]>(Prisma.sql`
        SELECT r."currency", COALESCE(SUM(r."amountMinor"), 0)::text AS requested
        FROM "MoneyRefundRequest" r LEFT JOIN "MoneyRefund" f ON f."id" = r."refundId"
        WHERE r."status" IN ('PENDING_POLICY', 'AUTHORIZED')
          AND (f."id" IS NULL OR f."status" IN ('RESERVED', 'DISPATCHED'))
          AND (${currency ?? null}::text IS NULL OR r."currency" = ${currency ?? null}::text)
        GROUP BY r."currency" ORDER BY r."currency"
      `);
        const totals = new Map<string, { pending: bigint; unknown: bigint; requested: bigint }>();
        for (const row of pending)
          totals.set(row.currency, {
            pending: exactAggregate(row.pending),
            unknown: exactAggregate(row.unknown),
            requested: 0n,
          });
        for (const row of requests) {
          const value = totals.get(row.currency) ?? { pending: 0n, unknown: 0n, requested: 0n };
          value.requested = exactAggregate(row.requested);
          totals.set(row.currency, value);
        }
        return {
          ...version(),
          ledger,
          pendingTotals: [...totals.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([currency, amount]) => ({
              currency,
              pending: money(amount.pending, currency),
              unknown: money(amount.unknown, currency),
              refundsRequested: money(amount.requested, currency),
            })),
          pendingAsOf,
          provenance: provenance(),
          reconciliation: await this.checkedReconciliationStatus(),
          capabilities: unavailableCapabilities(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async reconciliation(
    userId: string,
    input: { limit?: number; cursor?: string } = {},
  ): Promise<FinancialReconciliationPageV1> {
    const result = await this.queries.reviewExceptions(userId, input);
    // Exceptions may exist even without an available run history. They do not
    // establish zero differences or a successful reconciliation.
    const status = await this.checkedReconciliationStatus();
    return {
      ...version(),
      ...result,
      status,
      provenance: provenance(),
      capabilities: unavailableCapabilities(),
    };
  }

  async exception(userId: string, id: string): Promise<FinancialReconciliationDetailV1> {
    checkedId(id);
    return this.transactions.run(
      async (tx) => {
        await this.authorize(tx, userId, 'ADMIN');
        const row = await tx.moneyReconciliationException.findUnique({
          where: { id },
          select: EXCEPTION_SELECT,
        });
        if (!row) throw notFound();
        const allowedSubjects: ReconciliationExceptionWireV1['subjectType'][] = [
          'PaymentConfirmation',
          'LedgerTransaction',
          'Refund',
          'SubscriptionPeriod',
        ];
        if (
          !allowedSubjects.includes(row.subjectType as ReconciliationExceptionWireV1['subjectType'])
        )
          throw invalidStoredValue();
        return {
          ...version(),
          exception: {
            contractVersion: MONEY_CONTRACT_VERSION,
            id: row.id,
            kind: row.kind,
            subjectType: row.subjectType as ReconciliationExceptionWireV1['subjectType'],
            subjectId: row.subjectId,
            detectedAt: row.detectedAt.toISOString(),
            resolvedAt: row.resolvedAt?.toISOString() ?? null,
          },
          allowedActions: [],
          provenance: provenance(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async authorize(
    tx: PrismaTx,
    userId: string,
    audience: FinancialReadAudience,
  ): Promise<string | null> {
    if (audience !== 'ADMIN' && audience !== 'PROVIDER') throw forbidden();
    const rights = await this.permissions.resolveFreshForUser(userId, tx);
    const role = audience === 'ADMIN' ? 'admin' : 'provider';
    if (!rights.has(audience === 'ADMIN' ? 'money:review:read' : 'money:read:self'))
      throw forbidden();
    const user = await tx.user.findFirst({
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
    if (audience === 'ADMIN') return null;
    const provider = await tx.providerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (!provider) throw notFound();
    return provider.id;
  }

  private async checkedReconciliationStatus(): Promise<FinancialReconciliationStatusV1> {
    const status = await this.reconciliationStatus.status();
    if (!status || !['NOT_RUN', 'AVAILABLE', 'UNAVAILABLE', 'FAILED'].includes(status.state))
      throw invalidStoredValue();
    if (status.lastSuccessAt !== null && !validDate(status.lastSuccessAt))
      throw invalidStoredValue();
    if (status.state === 'AVAILABLE' && (!status.lastSuccessAt || !status.runId))
      throw invalidStoredValue();
    if (status.state === 'NOT_RUN' && (status.lastSuccessAt !== null || status.runId !== null))
      throw invalidStoredValue();
    return {
      state: status.state,
      lastSuccessAt: status.lastSuccessAt,
      runId: status.runId,
      reason: status.reason,
    };
  }
}

function paymentRecord(
  row: Prisma.MoneyPaymentIntentGetPayload<{ select: typeof INTENT_SELECT }>,
  dispatchStatus: FinancialRecordV1['dispatchStatus'],
): FinancialRecordV1 {
  const state =
    row.confirmation &&
    (row.confirmation.paymentIntentId !== row.id ||
      row.confirmation.amountMinor !== row.totalMinor ||
      row.confirmation.currency !== row.currency)
      ? 'INCONSISTENT'
      : confirmationState(row.confirmation);
  return {
    ...recordBase(row.id, 'PAYMENT', row.status, row.createdAt, row.providerProfileId),
    amount: money(row.totalMinor, row.currency),
    amountMeaning: state === 'CONFIRMED' ? 'CONFIRMED_COLLECTION' : 'INTENT_TOTAL',
    paymentIntentId: row.id,
    paymentConfirmationId: row.confirmation?.id ?? null,
    ledgerTransactionId: state === 'CONFIRMED' ? row.confirmation!.ledgerTransactionId : null,
    confirmationState:
      state === 'UNCONFIRMED' && row.status === 'SUCCEEDED' ? 'INCONSISTENT' : state,
    dispatchStatus,
  };
}
/** Prisma's nested take:1 uses in-memory pagination with its query relation
 * strategy. A SQL LATERAL limit instead bounds fetched attempts to one per
 * already authorized page row, including when an intent has many retries. */
async function paymentRecords(
  tx: PrismaTx,
  rows: Prisma.MoneyPaymentIntentGetPayload<{ select: typeof INTENT_SELECT }>[],
): Promise<FinancialRecordV1[]> {
  if (!rows.length) return [];
  const latest = await tx.$queryRaw<
    { paymentIntentId: string; status: FinancialRecordV1['dispatchStatus'] }[]
  >(Prisma.sql`
    SELECT i."id" AS "paymentIntentId", d."status"
    FROM "MoneyPaymentIntent" i
    LEFT JOIN LATERAL (
      SELECT a."id" FROM "MoneyPaymentAttempt" a
      WHERE a."paymentIntentId" = i."id" ORDER BY a."attemptNo" DESC LIMIT 1
    ) a ON true
    LEFT JOIN "MoneyDispatch" d ON d."paymentAttemptId" = a."id"
    WHERE i."id" IN (${Prisma.join(rows.map((row) => row.id))})
  `);
  const status = new Map(latest.map((row) => [row.paymentIntentId, row.status]));
  return rows.map((row) => paymentRecord(row, status.get(row.id) ?? null));
}
function attemptRecord(
  row: Prisma.MoneyPaymentAttemptGetPayload<{ select: typeof ATTEMPT_SELECT }>,
): FinancialRecordV1 {
  return {
    ...recordBase(
      row.id,
      'ATTEMPT',
      row.status,
      row.createdAt,
      row.paymentIntent.providerProfileId,
    ),
    amount: money(row.paymentIntent.totalMinor, row.paymentIntent.currency),
    amountMeaning: 'ATTEMPT_TOTAL',
    paymentIntentId: row.paymentIntentId,
    // An attempt's transport result cannot claim the intent's later confirmation.
    confirmationState: 'NOT_APPLICABLE',
    dispatchStatus: row.dispatch?.status ?? null,
  };
}
function requestRecord(
  row: Prisma.MoneyRefundRequestGetPayload<{ select: typeof REQUEST_SELECT }>,
): FinancialRecordV1 {
  if (!/^[A-Z][A-Z0-9_]{1,63}$/u.test(row.reasonCode)) throw invalidStoredValue();
  return {
    ...recordBase(row.id, 'REFUND_REQUEST', row.status, row.createdAt, row.providerProfileId),
    amount: money(row.amountMinor, row.currency),
    amountMeaning: 'REFUND_REQUESTED',
    paymentIntentId: row.paymentConfirmation.paymentIntentId,
    paymentConfirmationId: row.paymentConfirmationId,
    publicReasonCode: row.reasonCode,
  };
}
function refundRecord(
  row: Prisma.MoneyRefundGetPayload<{ select: typeof REFUND_SELECT }>,
): FinancialRecordV1 {
  const confirmed =
    row.status === 'SUCCEEDED' &&
    posted(row.compensatingLedgerTxn, row.currency) &&
    confirmationState(row.paymentConfirmation) === 'CONFIRMED';
  return {
    ...recordBase(
      row.id,
      'REFUND',
      row.status,
      row.createdAt,
      row.paymentConfirmation.paymentIntent.providerProfileId,
    ),
    amount: money(row.amountMinor, row.currency),
    amountMeaning: confirmed ? 'CONFIRMED_REFUND' : 'REFUND_RESERVED',
    paymentIntentId: row.paymentConfirmation.paymentIntentId,
    paymentConfirmationId: row.paymentConfirmationId,
    ledgerTransactionId: confirmed ? row.compensatingLedgerTransactionId : null,
    confirmationState: confirmed
      ? 'CONFIRMED'
      : row.status === 'SUCCEEDED'
        ? 'INCONSISTENT'
        : 'UNCONFIRMED',
    dispatchStatus: row.dispatch?.status ?? null,
  };
}
function subscriptionRecord(
  row: Prisma.ProviderSubscriptionGetPayload<{ select: typeof SUBSCRIPTION_SELECT }>,
  period?: Prisma.SubscriptionPeriodGetPayload<{ select: typeof PERIOD_SELECT }>,
): FinancialRecordV1 {
  const state = confirmationState(period?.paymentConfirmation ?? null);
  const confirmation = state === 'CONFIRMED' ? period!.paymentConfirmation : null;
  return {
    ...recordBase(row.id, 'SUBSCRIPTION', row.status, row.createdAt, row.providerProfileId),
    amount: confirmation ? money(confirmation.amountMinor, confirmation.currency) : null,
    amountMeaning: confirmation ? 'CONFIRMED_SUBSCRIPTION_PERIOD' : 'UNAVAILABLE',
    paymentIntentId: confirmation?.paymentIntentId ?? null,
    paymentConfirmationId: confirmation?.id ?? null,
    ledgerTransactionId: confirmation?.ledgerTransactionId ?? null,
    confirmationState: state,
    period: confirmation
      ? { startsAt: period!.startsAt.toISOString(), endsAt: period!.endsAt.toISOString() }
      : null,
  };
}
async function subscriptionRecords(
  tx: PrismaTx,
  rows: Prisma.ProviderSubscriptionGetPayload<{ select: typeof SUBSCRIPTION_SELECT }>[],
): Promise<FinancialRecordV1[]> {
  if (!rows.length) return [];
  // Bound period IDs in PostgreSQL before fetching their one-to-one proof
  // records. Neither old periods nor their confirmation histories fan out.
  const latest = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p."id" FROM "ProviderSubscription" s
    JOIN LATERAL (
      SELECT p."id" FROM "SubscriptionPeriod" p
      JOIN "MoneyPaymentConfirmation" c ON c."id" = p."paymentConfirmationId"
      JOIN "LedgerTransaction" l ON l."id" = c."ledgerTransactionId"
      WHERE p."subscriptionId" = s."id" AND l."status" = 'POSTED'
      ORDER BY p."startsAt" DESC, p."id" DESC LIMIT 1
    ) p ON true
    WHERE s."id" IN (${Prisma.join(rows.map((row) => row.id))})
  `);
  const periods = latest.length
    ? await tx.subscriptionPeriod.findMany({
        where: { id: { in: latest.map((period) => period.id) } },
        select: PERIOD_SELECT,
        take: rows.length,
      })
    : [];
  const bySubscription = new Map(periods.map((period) => [period.subscriptionId, period]));
  return rows.map((row) => subscriptionRecord(row, bySubscription.get(row.id)));
}
function recordBase(
  id: string,
  kind: FinancialRecordV1['kind'],
  status: string,
  createdAt: Date,
  providerProfileId: string,
): FinancialRecordV1 {
  return {
    id,
    kind,
    status,
    amount: null,
    amountMeaning: 'UNAVAILABLE',
    createdAt: createdAt.toISOString(),
    providerProfileId,
    paymentIntentId: null,
    paymentConfirmationId: null,
    ledgerTransactionId: null,
    confirmationState: 'NOT_APPLICABLE',
    dispatchStatus: null,
    period: null,
    publicReasonCode: null,
  };
}
function posted(value: Posting | null, currency: string): boolean {
  return (
    value?.status === 'POSTED' &&
    value.currency === currency &&
    value.bookingId === null &&
    value.postedAt !== null
  );
}
function confirmationState(value: Confirmation | null): FinancialRecordV1['confirmationState'] {
  return !value
    ? 'UNCONFIRMED'
    : posted(value.ledgerTransaction, value.currency)
      ? 'CONFIRMED'
      : 'INCONSISTENT';
}
function version() {
  return { contractVersion: MONEY_CONTRACT_VERSION, reportVersion: FINANCIAL_REPORT_VERSION };
}
function provenance(): FinancialReportProvenanceV1 {
  return {
    readAt: new Date().toISOString(),
    source: 'AUTHORITATIVE_PERSISTENCE',
    cache: 'NO_STORE',
  };
}
function pageEnvelope(kind: FinancialRecordKind) {
  return {
    ...version(),
    kind,
    provenance: provenance(),
    availability: { state: 'AVAILABLE' as const, reason: null },
  };
}
function unavailableCapabilities(): FinancialOperationsCapabilitiesV1 {
  return {
    refund: { available: false, reason: 'R32_INTEGRATION_PENDING', href: null },
    receiptReview: { available: false, reason: 'R30_INTEGRATION_PENDING', href: null },
    myPlan: { available: false, reason: 'R31_INTEGRATION_PENDING', href: null },
    reconciliationActions: { available: false, reason: 'R34_INTEGRATION_PENDING', href: null },
  };
}
function order() {
  return [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
}
function checkedKind(value: unknown): FinancialRecordKind {
  if (typeof value !== 'string' || !(FINANCIAL_RECORD_KINDS as readonly string[]).includes(value))
    throw invalid('The financial record kind is invalid.');
  return value as FinancialRecordKind;
}
function checkedCurrency(value?: string): void {
  if (value !== undefined && (typeof value !== 'string' || !/^[A-Z]{3}$/u.test(value)))
    throw invalid('Currency must contain three uppercase letters.');
}
function checkedId(value: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256)
    throw invalid('The resource identifier is invalid.');
}
function pageInput(input: FinancialRecordsQueryV1): PageInput {
  const kind = checkedKind(input.kind ?? 'PAYMENT');
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw invalid('The page limit must be an integer between 1 and 50.');
  checkedCurrency(input.currency);
  if (
    input.cursor !== undefined &&
    (typeof input.cursor !== 'string' || input.cursor.length < 1 || input.cursor.length > 2048)
  )
    throw invalidCursor();
  return { kind, limit, cursor: input.cursor, currency: input.currency };
}
function encodeCursor(id: string, scope: Scope): string {
  return Buffer.from(JSON.stringify({ version: 1, scope, id }), 'utf8').toString('base64url');
}
function decodeCursor(value: string, scope: Scope): string {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw invalidCursor();
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      id?: unknown;
      scope?: unknown;
      version?: unknown;
    };
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Object.keys(parsed).sort().join(',') !== 'id,scope,version' ||
      parsed.version !== 1 ||
      JSON.stringify(parsed.scope) !== JSON.stringify(scope) ||
      typeof parsed.id !== 'string'
    )
      throw invalidCursor();
    checkedId(parsed.id);
    if (encodeCursor(parsed.id, scope) !== value) throw invalidCursor();
    return parsed.id;
  } catch {
    throw invalidCursor();
  }
}
async function page<Row extends Anchor>(
  query: PageInput,
  scope: Scope,
  findAnchor: (id: string) => Promise<Anchor | null>,
  findRows: (before: Before, take: number) => Promise<Row[]>,
  project: (rows: Row[]) => FinancialRecordV1[] | Promise<FinancialRecordV1[]>,
) {
  let before: Before = {};
  if (query.cursor) {
    const anchor = await findAnchor(decodeCursor(query.cursor, scope));
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
    items: await project(rows),
    nextCursor: found.length > query.limit ? encodeCursor(rows[rows.length - 1].id, scope) : null,
  };
}
function money(amountMinor: bigint, currency: string) {
  try {
    return toMoneyWire({ amountMinor, currency });
  } catch {
    throw invalidStoredValue();
  }
}
function exactAggregate(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value)) throw invalidStoredValue();
  return BigInt(value);
}
function validDate(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function invalid(message: string): AppError {
  return new AppError('VALIDATION_ERROR', message, 400);
}
function invalidCursor(): AppError {
  return invalid('The cursor is invalid for this resource, actor or currency.');
}
function forbidden(): AppError {
  return new AppError('FORBIDDEN', 'You cannot read this financial resource.', 403);
}
function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Financial resource not found.', 404);
}
function invalidStoredValue(): AppError {
  return new AppError(
    'INTERNAL_ERROR',
    'The stored financial projection cannot be represented.',
    500,
  );
}
