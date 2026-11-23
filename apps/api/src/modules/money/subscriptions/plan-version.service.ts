import { Inject, Injectable } from '@nestjs/common';
import {
  MONEY_CONTRACT_VERSION,
  toMoneyWire,
  type BillingInterval,
  type MoneyPlanVersionWireV1,
  type PlanEntitlementContract,
} from '@homeservicemarketplace/contracts';
import {
  Prisma,
  type PrismaTx,
  type SubscriptionPlanVersion,
} from '@homeservicemarketplace/database';

import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import {
  parsePlanEntitlements,
  SUBSCRIPTION_CLOCK,
  subscriptionNow,
  type SubscriptionClock,
} from '../entitlements/entitlement-policy';

export interface ApprovedPlanVersionInput {
  planKey: string;
  version: number;
  billingInterval: BillingInterval;
  priceMinor: bigint;
  currency: string;
  entitlements: readonly PlanEntitlementContract[];
  /** Trusted composition supplies an owner-approved commercial decision.
   * No HTTP route accepts this authority and no production default exists. */
  approvalReference: string;
}

@Injectable()
export class PlanVersionService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly permissions: PermissionResolverService,
    @Inject(SUBSCRIPTION_CLOCK) private readonly clock: SubscriptionClock,
  ) {}

  async owner(userId: string, tx: PrismaTx): Promise<string> {
    if (!(await this.permissions.resolveFreshForUser(userId, tx)).has('money:read:self')) {
      throw forbidden();
    }
    const user = await tx.user.findFirst({
      where: {
        id: userId,
        status: 'ACTIVE',
        isActive: true,
        deletedAt: null,
        userRoles: { some: { role: { name: 'provider', deletedAt: null } } },
      },
      select: { id: true },
    });
    if (!user) throw forbidden();
    const provider = await tx.providerProfile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    });
    if (!provider) throw new AppError('NOT_FOUND', 'Provider subscription account not found.', 404);
    return provider.id;
  }

  listForUser(userId: string, input: { limit?: number; cursor?: string } = {}) {
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      throw invalid('Invalid page size.');
    if (input.cursor !== undefined && !/^[A-Za-z0-9_-]{1,2048}$/u.test(input.cursor)) {
      throw invalid('Invalid plan cursor.');
    }
    return this.transactions.run(
      async (tx) => {
        const owner = await this.owner(userId, tx);
        const now = subscriptionNow(this.clock);
        let after: string | undefined;
        if (input.cursor) {
          try {
            const parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as {
              owner?: unknown;
              id?: unknown;
              version?: unknown;
            };
            if (
              Object.keys(parsed).sort().join(',') !== 'id,owner,version' ||
              parsed.version !== 1 ||
              parsed.owner !== owner ||
              typeof parsed.id !== 'string' ||
              !/^[A-Za-z0-9_-]{1,64}$/u.test(parsed.id) ||
              cursor(owner, parsed.id) !== input.cursor
            )
              throw invalid('Invalid plan cursor.');
            const anchor = await tx.subscriptionPlanVersion.findFirst({
              where: { id: parsed.id, publishedAt: { lte: now } },
              select: { id: true },
            });
            if (!anchor) throw invalid('Invalid plan cursor.');
            after = parsed.id;
          } catch {
            throw invalid('Invalid plan cursor.');
          }
        }
        const rows = await tx.subscriptionPlanVersion.findMany({
          where: {
            retiredAt: null,
            publishedAt: { lte: now },
            ...(after ? { id: { gt: after } } : {}),
          },
          orderBy: { id: 'asc' },
          take: limit + 1,
        });
        const items = rows.slice(0, limit);
        return {
          contractVersion: MONEY_CONTRACT_VERSION,
          items: items.map(planVersionWire),
          nextCursor: rows.length > limit ? cursor(owner, items[items.length - 1].id) : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** Add a new immutable commercial version. Never updates bought terms.
   * Caller owns the transaction, policy authorization and audit context. */
  async publishApprovedVersion(
    input: ApprovedPlanVersionInput,
    tx: PrismaTx,
  ): Promise<MoneyPlanVersionWireV1> {
    if (!input.approvalReference?.trim() || input.approvalReference.length > 200) {
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'An approved commercial policy is required.',
        503,
        { reason: 'SUBSCRIPTION_COMMERCIAL_POLICY_UNAPPROVED' },
      );
    }
    if (
      !/^[a-z0-9][a-z0-9-]{1,63}$/u.test(input.planKey) ||
      !Number.isSafeInteger(input.version) ||
      input.version < 1 ||
      !['MONTHLY', 'ANNUAL'].includes(input.billingInterval) ||
      typeof input.priceMinor !== 'bigint' ||
      input.priceMinor < 0n ||
      input.priceMinor > 9223372036854775807n ||
      !/^[A-Z]{3}$/u.test(input.currency)
    ) {
      throw invalid('Invalid approved plan version.');
    }
    const entitlements = parsePlanEntitlements(input.entitlements);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`r31-plan:${input.planKey}`}, 0))`;
    const latest = await tx.subscriptionPlanVersion.findFirst({
      where: { planKey: input.planKey },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    if (latest && input.version <= latest.version) {
      throw new AppError(
        'CONFLICT',
        'A new commercial version must have a newer version number.',
        409,
      );
    }
    const row = await tx.subscriptionPlanVersion.create({
      data: {
        planKey: input.planKey,
        version: input.version,
        billingInterval: input.billingInterval,
        priceMinor: input.priceMinor,
        currency: input.currency,
        entitlements: entitlements as unknown as Prisma.InputJsonValue,
        publishedAt: subscriptionNow(this.clock),
      },
    });
    return planVersionWire(row);
  }
}

export function planVersionWire(row: SubscriptionPlanVersion): MoneyPlanVersionWireV1 {
  return {
    contractVersion: MONEY_CONTRACT_VERSION,
    id: row.id,
    planKey: row.planKey,
    version: row.version,
    billingInterval: row.billingInterval,
    price: toMoneyWire({ amountMinor: row.priceMinor, currency: row.currency }),
    entitlements: parsePlanEntitlements(row.entitlements),
    publishedAt: row.publishedAt.toISOString(),
    retiredAt: row.retiredAt?.toISOString() ?? null,
  };
}

function cursor(owner: string, id: string): string {
  return Buffer.from(JSON.stringify({ version: 1, owner, id }), 'utf8').toString('base64url');
}
function forbidden(): AppError {
  return new AppError('FORBIDDEN', 'You cannot access this subscription account.', 403);
}
function invalid(message: string): AppError {
  return new AppError('VALIDATION_ERROR', message, 400);
}
