import { Injectable } from '@nestjs/common';
import type {
  Bid,
  BidStatus,
  Prisma,
  PrismaTx,
  ProviderProfile,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Row shape returned by the listing/detail finders. The provider
// summary is eager-loaded because every BidsScreen render needs it
// and a separate query per bid would be N+1.
export type BidWithProvider = Bid & { provider: ProviderProfile };

export type BidSortKey = 'recommended' | 'price' | 'rating' | 'submittedAt';

export interface ListBidsArgs {
  requestId: string;
  status?: BidStatus;
  sort?: BidSortKey;
}

export interface CreateBidInput {
  // Slice 2.1 doesn't expose this through any HTTP surface — the seed
  // script is the only call site. Keeping the shape aligned with the
  // future Provider write surface so slice 2.2 can reuse it.
  requestId: string;
  providerId: string;
  amount: number;
  currency?: string;
  pricingType: 'HOURLY' | 'FIXED';
  note?: string | null;
  responseTimeMinutes?: number | null;
  badge?: 'BEST_MATCH' | 'BEST_VALUE' | 'FASTEST' | null;
  // Override `submittedAt` so the seed script can produce a stable
  // sort across re-runs. Defaults to now() when omitted.
  submittedAt?: Date;
}

@Injectable()
export class BidRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  // List bids for a request. Always filters soft-deleted rows; status
  // filter is optional so future call sites can ask for "all but
  // WITHDRAWN" by passing a specific status. Sort orderings are
  // pinned here so the BidsScreen sort tabs and any backend caller
  // see identical ordering.
  listForRequest(args: ListBidsArgs, tx?: PrismaTx): Promise<BidWithProvider[]> {
    const where: Prisma.BidWhereInput = {
      requestId: args.requestId,
      deletedAt: null,
      ...(args.status ? { status: args.status } : {}),
    };
    const orderBy = orderByForSort(args.sort);
    return this.db(tx).bid.findMany({
      where,
      orderBy,
      include: { provider: true },
    });
  }

  findOwned(requestId: string, bidId: string, tx?: PrismaTx): Promise<BidWithProvider | null> {
    return this.db(tx).bid.findFirst({
      where: { id: bidId, requestId, deletedAt: null },
      include: { provider: true },
    });
  }

  // Active-bid count per request. Returns a Map keyed by requestId.
  // PENDING + ACCEPTED only (rejected / withdrawn don't contribute to
  // a feed's competition signal). Used by the available-jobs feed.
  async countActiveByRequestIds(requestIds: string[], tx?: PrismaTx): Promise<Map<string, number>> {
    if (requestIds.length === 0) return new Map();
    const rows = await this.db(tx).bid.groupBy({
      by: ['requestId'],
      where: {
        requestId: { in: requestIds },
        deletedAt: null,
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
      _count: { _all: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.requestId, r._count._all);
    return map;
  }

  // Returns the set of requestIds in `requestIds` for which the given
  // provider already has a non-WITHDRAWN, non-deleted bid. Used by the
  // available-jobs feed to compute the `hasOwnBid` flag in a single
  // query rather than N+1.
  async findRequestIdsBidByProvider(
    providerId: string,
    requestIds: string[],
    tx?: PrismaTx,
  ): Promise<Set<string>> {
    if (requestIds.length === 0) return new Set();
    const rows = await this.db(tx).bid.findMany({
      where: {
        providerId,
        requestId: { in: requestIds },
        deletedAt: null,
        status: { not: 'WITHDRAWN' },
      },
      select: { requestId: true },
    });
    return new Set(rows.map((r) => r.requestId));
  }

  // The provider's existing non-WITHDRAWN bid on a specific request,
  // if any. Used by the submit-bid path to enforce the
  // one-active-bid-per-(provider, request) invariant before insert —
  // the database has no partial-unique index on this and Prisma can't
  // express it, so the application layer is the gate.
  findActiveBidForRequest(
    providerId: string,
    requestId: string,
    tx?: PrismaTx,
  ): Promise<Bid | null> {
    return this.db(tx).bid.findFirst({
      where: {
        providerId,
        requestId,
        deletedAt: null,
        status: { not: 'WITHDRAWN' },
      },
    });
  }

  // The provider's bid by id, scoped to provider. Returns null when
  // the bid doesn't exist OR doesn't belong to the calling provider —
  // ownership-vs-existence is intentionally not distinguishable on the
  // wire (both surface as 404).
  findOwnedByProvider(
    providerId: string,
    bidId: string,
    tx?: PrismaTx,
  ): Promise<BidWithProvider | null> {
    return this.db(tx).bid.findFirst({
      where: { id: bidId, providerId, deletedAt: null },
      include: { provider: true },
    });
  }

  // Provider-side cursor-paginated listing. Includes the linked
  // ServiceRequest (with category) so the my-bids screen renders
  // without an extra round-trip per row.
  listForProvider(
    args: {
      providerId: string;
      status?: BidStatus;
      take: number;
      cursor?: string;
    },
    tx?: PrismaTx,
  ): Promise<
    (BidWithProvider & {
      request: {
        id: string;
        categoryId: string | null;
        customServiceText: string | null;
        description: string | null;
        addressSnapshot: Prisma.JsonValue;
        category: { id: string; slug: string; labelEn: string; labelAr: string } | null;
      };
    })[]
  > {
    const where: Prisma.BidWhereInput = {
      providerId: args.providerId,
      deletedAt: null,
      ...(args.status ? { status: args.status } : {}),
    };
    return this.db(tx).bid.findMany({
      where,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      include: {
        provider: true,
        request: {
          select: {
            id: true,
            categoryId: true,
            customServiceText: true,
            description: true,
            addressSnapshot: true,
            category: {
              select: { id: true, slug: true, labelEn: true, labelAr: true },
            },
          },
        },
      },
    }) as Promise<
      (BidWithProvider & {
        request: {
          id: string;
          categoryId: string | null;
          customServiceText: string | null;
          description: string | null;
          addressSnapshot: Prisma.JsonValue;
          category: { id: string; slug: string; labelEn: string; labelAr: string } | null;
        };
      })[]
    >;
  }

  // Insert a new PENDING bid. Caller is responsible for validating
  // request ownership / state and the one-active-bid invariant; the
  // repository is a thin write helper.
  createForProvider(
    input: {
      requestId: string;
      providerId: string;
      amount: number;
      currency?: string;
      pricingType: 'HOURLY' | 'FIXED';
      note?: string | null;
      responseTimeMinutes?: number | null;
    },
    tx?: PrismaTx,
  ): Promise<Bid> {
    return this.db(tx).bid.create({
      data: {
        requestId: input.requestId,
        providerId: input.providerId,
        amount: input.amount,
        currency: input.currency ?? 'USD',
        pricingType: input.pricingType,
        note: input.note ?? null,
        responseTimeMinutes: input.responseTimeMinutes ?? null,
        // PENDING is the default; be explicit so the intent is obvious
        // when reading the call site.
        status: 'PENDING',
      },
    });
  }

  // Status-flip helper used by accept-bid (slice 2.2). Conditional on
  // the current status being `from` so concurrent writers cannot both
  // promote the same bid — only one wins, the loser sees count: 0
  // and the service maps that to a CONFLICT response.
  setStatusIf(
    bidId: string,
    from: BidStatus,
    to: BidStatus,
    tx?: PrismaTx,
  ): Promise<Prisma.BatchPayload> {
    return this.db(tx).bid.updateMany({
      where: { id: bidId, status: from, deletedAt: null },
      data: { status: to },
    });
  }

  // Bulk-flip every other PENDING bid on a request to REJECTED — the
  // sibling-rejection step in the accept-bid transaction. The
  // exclude-id clause skips the just-accepted bid.
  rejectSiblings(
    requestId: string,
    exceptBidId: string,
    tx?: PrismaTx,
  ): Promise<Prisma.BatchPayload> {
    return this.db(tx).bid.updateMany({
      where: {
        requestId,
        deletedAt: null,
        status: 'PENDING',
        id: { not: exceptBidId },
      },
      data: { status: 'REJECTED' },
    });
  }

  // Used by the dev seed only in slice 2.1. Idempotent at the (requestId,
  // providerId) level so re-running the seed doesn't accumulate
  // duplicate bids; relies on the application-layer one-active-bid
  // invariant rather than a partial unique index (Prisma can't reflect
  // partial uniques into schema.prisma without drift).
  async upsertSeedBid(input: CreateBidInput, tx?: PrismaTx): Promise<Bid> {
    const existing = await this.db(tx).bid.findFirst({
      where: {
        requestId: input.requestId,
        providerId: input.providerId,
        deletedAt: null,
      },
    });
    const data = {
      amount: input.amount,
      currency: input.currency ?? 'USD',
      pricingType: input.pricingType,
      note: input.note ?? null,
      responseTimeMinutes: input.responseTimeMinutes ?? null,
      badge: input.badge ?? null,
      ...(input.submittedAt ? { submittedAt: input.submittedAt } : {}),
    };
    if (existing) {
      return this.db(tx).bid.update({ where: { id: existing.id }, data });
    }
    return this.db(tx).bid.create({
      data: {
        request: { connect: { id: input.requestId } },
        provider: { connect: { id: input.providerId } },
        ...data,
      },
    });
  }
}

// Sort → orderBy mapping. `recommended` puts badged bids first then
// orders by ratingAvg desc + amount asc; `price` is amount asc;
// `rating` is ratingAvg desc; `submittedAt` is newest first. Pinned
// here so a unit test can lock the ordering against the contract
// without spinning up Prisma.
export function orderByForSort(sort: BidSortKey | undefined): Prisma.BidOrderByWithRelationInput[] {
  switch (sort) {
    case 'price':
      return [{ amount: 'asc' }, { id: 'asc' }];
    case 'rating':
      return [{ provider: { ratingAvg: 'desc' } }, { id: 'asc' }];
    case 'submittedAt':
      return [{ submittedAt: 'desc' }, { id: 'desc' }];
    case 'recommended':
    default:
      // Badged bids first (BidBadge values sort lexicographically
      // BEST_MATCH < BEST_VALUE < FASTEST so we use desc to put
      // null last), then highest-rated, then cheapest, then a stable
      // id tiebreak.
      return [
        { badge: 'asc' },
        { provider: { ratingAvg: 'desc' } },
        { amount: 'asc' },
        { id: 'asc' },
      ];
  }
}
