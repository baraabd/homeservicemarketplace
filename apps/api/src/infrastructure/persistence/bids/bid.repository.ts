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
