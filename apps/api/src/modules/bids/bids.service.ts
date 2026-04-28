import { Injectable } from '@nestjs/common';
import type {
  AcceptBidResponse,
  BidListResponse,
  BidSummary,
  BookingSummary,
  ListBidsQuery,
  ProviderBidSummary,
} from '@homeservicemarketplace/contracts';
import { ServiceRequestEventType, ServiceRequestStatus } from '@homeservicemarketplace/database';
import type { Booking } from '@homeservicemarketplace/database';

import {
  BidRepository,
  type BidWithProvider,
  type BidSortKey as RepoSortKey,
} from '../../infrastructure/persistence/bids/bid.repository';
import { BookingRepository } from '../../infrastructure/persistence/bookings/booking.repository';
import { ServiceRequestRepository } from '../../infrastructure/persistence/requests/service-request.repository';
import { ServiceRequestEventRepository } from '../../infrastructure/persistence/requests/service-request-event.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';

@Injectable()
export class BidsService {
  constructor(
    private readonly bids: BidRepository,
    private readonly requests: ServiceRequestRepository,
    private readonly bookings: BookingRepository,
    private readonly events: ServiceRequestEventRepository,
    private readonly tx: TransactionRunner,
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

  // ─── accept-bid ─────────────────────────────────────────────────────────────
  // Accepts ONE bid on the Seeker's request inside a single transaction:
  //   1. ownership + state guards (request still OPEN_FOR_BIDS, bid still
  //      PENDING and belongs to this request)
  //   2. flip the chosen bid PENDING → ACCEPTED (conditional update is
  //      the optimistic-concurrency lock)
  //   3. flip every sibling PENDING bid on the same request to REJECTED
  //      so the bid feed never shows "still pending" rows next to a booked
  //      request and so a future race cannot create two ACCEPTED bids
  //   4. flip the request OPEN_FOR_BIDS → BID_ACCEPTED (also conditional)
  //   5. create the Booking row (one-per-bid invariant pinned by the DB
  //      unique index on bookings.bidId)
  //   6. write a REQUEST_UPDATED event with { acceptedBidId, bookingId }
  //      so the timeline reflects the lifecycle change without needing a
  //      dedicated event type yet
  //
  // Any failure in steps 2–6 rolls the whole thing back, so the system
  // can never end up with an accepted bid + no booking, or a booking
  // with no event row, or two accepted bids.
  async accept(seekerUserId: string, requestId: string, bidId: string): Promise<AcceptBidResponse> {
    const result = await this.tx.run(async (tx) => {
      // 1a. Request must exist + be owned + still OPEN_FOR_BIDS.
      const request = await this.requests.findOwned(requestId, seekerUserId, tx);
      if (!request) {
        throw new AppError('NOT_FOUND', 'Request not found.', 404);
      }
      if (request.status === ServiceRequestStatus.CANCELLED) {
        throw new AppError('CONFLICT', 'This request has been cancelled.', 409);
      }
      if (request.status !== ServiceRequestStatus.OPEN_FOR_BIDS) {
        throw new AppError('CONFLICT', 'A bid has already been accepted for this request.', 409);
      }

      // 1b. Bid must exist on THIS request, not be soft-deleted, and
      //     still be PENDING. findOwned filters by requestId so a
      //     bid that belongs to a different request surfaces as 404.
      const bid = await this.bids.findOwned(requestId, bidId, tx);
      if (!bid) {
        throw new AppError('NOT_FOUND', 'Bid not found.', 404);
      }
      if (bid.status === 'ACCEPTED') {
        throw new AppError('CONFLICT', 'This bid has already been accepted.', 409);
      }
      if (bid.status !== 'PENDING') {
        throw new AppError('CONFLICT', 'This bid is no longer accept-able.', 409);
      }

      // 2. Flip the chosen bid PENDING → ACCEPTED.
      const flipped = await this.bids.setStatusIf(bidId, 'PENDING', 'ACCEPTED', tx);
      if (flipped.count === 0) {
        // Concurrent writer beat us to it — be honest about the race.
        throw new AppError('CONFLICT', 'This bid is no longer accept-able.', 409);
      }

      // 3. Reject every sibling PENDING bid on the same request.
      await this.bids.rejectSiblings(requestId, bidId, tx);

      // 4. Flip the request OPEN_FOR_BIDS → BID_ACCEPTED. This is the
      //    second optimistic lock — if the request was concurrently
      //    cancelled / accepted on another worker, count will be 0.
      const reqFlip = await this.requests.setStatusOwned(
        requestId,
        seekerUserId,
        [ServiceRequestStatus.OPEN_FOR_BIDS],
        ServiceRequestStatus.BID_ACCEPTED,
        tx,
      );
      if (reqFlip.count === 0) {
        throw new AppError('CONFLICT', 'A bid has already been accepted for this request.', 409);
      }

      // 5. Create the booking. Snapshots `priceAmount` and `currency`
      //    from the bid so a future Provider edit cannot mutate the
      //    booked amount.
      const booking = await this.bookings.create(
        {
          requestId,
          bidId,
          seekerUserId,
          providerId: bid.providerId,
          priceAmount: bid.amount,
          currency: bid.currency,
          scheduledAt: request.scheduledAt,
        },
        tx,
      );

      // 6. Append the timeline event. REQUEST_UPDATED carries the
      //    transition payload; a dedicated REQUEST_BOOKED event type
      //    can replace this in slice 2.3 without a forced migration.
      await this.events.create(
        {
          requestId,
          actorUserId: seekerUserId,
          type: ServiceRequestEventType.REQUEST_UPDATED,
          metadata: { acceptedBidId: bidId, bookingId: booking.id },
        },
        tx,
      );

      // 7. Re-read the bid for the response so the caller sees the
      //    final ACCEPTED state plus the eager-loaded provider summary.
      const reloaded = await this.bids.findOwned(requestId, bidId, tx);
      if (!reloaded) {
        throw new AppError('NOT_FOUND', 'Bid not found.', 404);
      }
      return { bid: reloaded, booking };
    });

    return {
      bid: toSummary(result.bid),
      booking: toBookingSummary(result.booking),
      requestStatus: ServiceRequestStatus.BID_ACCEPTED,
    };
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

function toBookingSummary(row: Booking): BookingSummary {
  return {
    id: row.id,
    requestId: row.requestId,
    bidId: row.bidId,
    status: row.status,
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    priceAmount: row.priceAmount,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  };
}
