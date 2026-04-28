import { Injectable } from '@nestjs/common';
import type {
  BidListResponse,
  BidSummary,
  ListBidsQuery,
  ProviderBidSummary,
} from '@homeservicemarketplace/contracts';

import {
  BidRepository,
  type BidWithProvider,
  type BidSortKey as RepoSortKey,
} from '../../infrastructure/persistence/bids/bid.repository';
import { ServiceRequestRepository } from '../../infrastructure/persistence/requests/service-request.repository';
import { AppError } from '../../shared/errors/app-error';

@Injectable()
export class BidsService {
  constructor(
    private readonly bids: BidRepository,
    private readonly requests: ServiceRequestRepository,
  ) {}

  // List active bids on a Seeker-owned request. Ownership is checked
  // FIRST so a foreign request id never leaks the existence of any
  // bids — the response is identical to "request does not exist"
  // (NOT_FOUND) for both "not yours" and "doesn't exist".
  async listForRequest(
    seekerUserId: string,
    requestId: string,
    query: ListBidsQuery = {},
  ): Promise<BidListResponse> {
    await this.assertRequestOwned(seekerUserId, requestId);
    const rows = await this.bids.listForRequest({
      requestId,
      sort: (query.sort ?? 'recommended') as RepoSortKey,
    });
    return {
      items: rows.map(toSummary),
      // Slice 2.1 returns all bids in one envelope; pagination is a
      // future concern.
      nextCursor: null,
    };
  }

  // Optional safe detail endpoint — same ownership contract as list.
  async detail(seekerUserId: string, requestId: string, bidId: string): Promise<BidSummary> {
    await this.assertRequestOwned(seekerUserId, requestId);
    const row = await this.bids.findOwned(requestId, bidId);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Bid not found.', 404);
    }
    return toSummary(row);
  }

  private async assertRequestOwned(seekerUserId: string, requestId: string): Promise<void> {
    const owned = await this.requests.findOwned(requestId, seekerUserId);
    if (!owned) {
      throw new AppError('NOT_FOUND', 'Request not found.', 404);
    }
  }
}

// Persistence row → wire DTO. Drops infra-only fields and re-shapes
// the bundled provider into the lightweight summary the BidsScreen
// renders. Provider userId / contact info are NEVER included.
function toSummary(row: BidWithProvider): BidSummary {
  return {
    id: row.id,
    requestId: row.requestId,
    amount: row.amount,
    currency: row.currency,
    pricingType: row.pricingType,
    note: row.note,
    status: row.status,
    responseTimeMinutes: row.responseTimeMinutes,
    badge: row.badge,
    submittedAt: row.submittedAt.toISOString(),
    provider: toProviderSummary(row.provider),
  };
}

function toProviderSummary(p: BidWithProvider['provider']): ProviderBidSummary {
  return {
    id: p.id,
    displayName: p.displayName,
    initials: p.initials,
    avatarUrl: p.avatarUrl,
    ratingAvg: p.ratingAvg,
    reviewCount: p.reviewCount,
    completedJobs: p.completedJobs,
    verified: p.verified,
    topPro: p.topPro,
  };
}
