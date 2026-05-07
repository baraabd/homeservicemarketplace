import { Injectable } from '@nestjs/common';
import type {
  ListMyBidsQuery,
  ListMyBidsResponse,
  MyBidSummary,
  SubmitBidRequest,
  SubmitBidResponse,
  WithdrawBidResponse,
} from '@homeservicemarketplace/contracts';
import {
  NotificationResourceType,
  NotificationType,
  ServiceRequestEventType,
  ServiceRequestStatus,
} from '@homeservicemarketplace/database';
import type { Bid } from '@homeservicemarketplace/database';

import { BidRepository } from '../../../infrastructure/persistence/bids/bid.repository';
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { ServiceRequestRepository } from '../../../infrastructure/persistence/requests/service-request.repository';
import { ServiceRequestEventRepository } from '../../../infrastructure/persistence/requests/service-request-event.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { NotificationsService } from '../../notifications/notifications.service';

const DEFAULT_PAGE_SIZE = 20;

// Provider bids module (Sprint 5 slice 5.3).
//
// Routes:
//   POST /v1/me/provider/bids          — submit a new PENDING bid
//   GET  /v1/me/provider/bids          — list my bids (any status)
//   POST /v1/me/provider/bids/:id/withdraw — flip own PENDING bid → WITHDRAWN
//
// Every method derives `providerUserId` from the authenticated session;
// the wire never carries providerId. The submit + withdraw transitions
// run inside one transaction so the bid row, the request timeline
// event, and the seeker's notification land atomically (or all roll
// back).
@Injectable()
export class ProviderBidsService {
  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly bids: BidRepository,
    private readonly requests: ServiceRequestRepository,
    private readonly events: ServiceRequestEventRepository,
    private readonly notifications: NotificationsService,
    private readonly tx: TransactionRunner,
  ) {}

  // ─── submit ──────────────────────────────────────────────────────────────────
  async submit(providerUserId: string, input: SubmitBidRequest): Promise<SubmitBidResponse> {
    const result = await this.tx.run(async (tx) => {
      const profile = await this.providers.findByUserId(providerUserId, tx);
      if (!profile) {
        // Defensive: ProviderActiveGuard already proved a profile
        // exists. A concurrent soft-delete is the only path here.
        throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
      }

      const request = await this.requests.findById(input.requestId, tx);
      if (!request) {
        throw new AppError('NOT_FOUND', 'Request not found.', 404);
      }
      if (request.status !== ServiceRequestStatus.OPEN_FOR_BIDS) {
        throw new AppError('CONFLICT', 'This request is no longer accepting bids.', 409);
      }
      if (request.seekerUserId === providerUserId) {
        // A provider should not be able to bid on their own request,
        // even if they happen to also be a seeker on the same account.
        throw new AppError('VALIDATION_ERROR', 'You cannot bid on your own request.', 400);
      }

      // One-active-bid invariant. Withdrawn bids do not count — the
      // provider may resubmit a fresh PENDING bid after withdrawing.
      const existing = await this.bids.findActiveBidForRequest(profile.id, input.requestId, tx);
      if (existing) {
        throw new AppError('CONFLICT', 'You already have an active bid on this request.', 409);
      }

      const created = await this.bids.createForProvider(
        {
          requestId: input.requestId,
          providerId: profile.id,
          amount: input.amount,
          pricingType: input.pricingType,
          note: input.note ?? null,
          responseTimeMinutes: input.responseTimeMinutes ?? null,
        },
        tx,
      );

      // Append a request-timeline event so the seeker's bid feed and
      // request timeline reflect the new bid without any guesswork.
      await this.events.create(
        {
          requestId: input.requestId,
          actorUserId: providerUserId,
          type: ServiceRequestEventType.REQUEST_UPDATED,
          metadata: { newBidId: created.id, providerId: profile.id },
        },
        tx,
      );

      // Notify the seeker that a new bid arrived. Body uses provider's
      // displayName — never the providerUserId.
      await this.notifications.createForUser(
        {
          userId: request.seekerUserId,
          type: NotificationType.BID_RECEIVED,
          title: 'New bid received',
          body: `${profile.displayName} bid on your request.`,
          resourceType: NotificationResourceType.BID,
          resourceId: created.id,
          deepLink: `/home/requests/${input.requestId}/bids/${created.id}`,
          metadata: { requestId: input.requestId, providerId: profile.id },
        },
        tx,
      );

      return { bid: created, requestId: input.requestId };
    });

    return {
      bid: await this.composeMyBidSummary(result.bid, result.requestId),
    };
  }

  // ─── list mine ──────────────────────────────────────────────────────────────
  async list(providerUserId: string, query: ListMyBidsQuery): Promise<ListMyBidsResponse> {
    const profile = await this.providers.findByUserId(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.bids.listForProvider({
      providerId: profile.id,
      status: query.status,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items: MyBidSummary[] = page.map((row) => myBidSummaryFromListRow(row));
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  // ─── withdraw ────────────────────────────────────────────────────────────────
  async withdraw(providerUserId: string, bidId: string): Promise<WithdrawBidResponse> {
    const result = await this.tx.run(async (tx) => {
      const profile = await this.providers.findByUserId(providerUserId, tx);
      if (!profile) {
        throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
      }
      const owned = await this.bids.findOwnedByProvider(profile.id, bidId, tx);
      if (!owned) {
        throw new AppError('NOT_FOUND', 'Bid not found.', 404);
      }
      if (owned.status === 'WITHDRAWN') {
        throw new AppError('CONFLICT', 'Bid already withdrawn.', 409);
      }
      if (owned.status !== 'PENDING') {
        // ACCEPTED / REJECTED bids are terminal — withdrawing them
        // would either undo a confirmed booking (too risky) or silently
        // mutate a rejected record.
        throw new AppError('CONFLICT', 'Only pending bids can be withdrawn.', 409);
      }
      const flipped = await this.bids.setStatusIf(bidId, 'PENDING', 'WITHDRAWN', tx);
      if (flipped.count === 0) {
        // Concurrent writer beat us — be honest.
        throw new AppError('CONFLICT', 'Bid is no longer withdraw-able.', 409);
      }
      // Reload the (now WITHDRAWN) bid so the response shows the final
      // state. We also need the request id for the timeline event.
      const reloaded = await this.bids.findOwnedByProvider(profile.id, bidId, tx);
      if (!reloaded) {
        throw new AppError('NOT_FOUND', 'Bid not found.', 404);
      }
      await this.events.create(
        {
          requestId: reloaded.requestId,
          actorUserId: providerUserId,
          type: ServiceRequestEventType.REQUEST_UPDATED,
          metadata: { withdrawnBidId: bidId, providerId: profile.id },
        },
        tx,
      );
      return reloaded;
    });
    return {
      bid: await this.composeMyBidSummary(result, result.requestId),
    };
  }

  // ─── helpers ────────────────────────────────────────────────────────────────
  // Compose the wire DTO from a freshly-created or reloaded bid +
  // its request id. We re-fetch the request through the repository so
  // the response shape matches what `list` returns (same query plan,
  // same denormalisation).
  private async composeMyBidSummary(bid: Bid, requestId: string): Promise<MyBidSummary> {
    const request = await this.requests.findById(requestId);
    if (!request) {
      // Concurrent delete; surface a clean error rather than half-shaped DTO.
      throw new AppError('INTERNAL_ERROR', 'Failed to load request for bid response.', 500);
    }
    const snapshot = (request.addressSnapshot ?? {}) as { city?: string; country?: string };
    return {
      id: bid.id,
      amount: bid.amount,
      currency: bid.currency,
      pricingType: bid.pricingType,
      note: bid.note,
      status: bid.status,
      responseTimeMinutes: bid.responseTimeMinutes,
      submittedAt: bid.submittedAt.toISOString(),
      request: {
        id: request.id,
        category: request.category
          ? {
              id: request.category.id,
              slug: request.category.slug,
              labelEn: request.category.labelEn,
              labelAr: request.category.labelAr,
            }
          : null,
        customServiceText: request.customServiceText,
        description: request.description,
        city: snapshot.city ?? '',
        country: snapshot.country ?? '',
      },
    };
  }
}

// Map the eager-loaded list row to the wire DTO. Kept as a free
// function so the `list` path can map without an additional async hop.
function myBidSummaryFromListRow(
  row: Awaited<ReturnType<BidRepository['listForProvider']>>[number],
): MyBidSummary {
  const snapshot = (row.request.addressSnapshot ?? {}) as { city?: string; country?: string };
  return {
    id: row.id,
    amount: row.amount,
    currency: row.currency,
    pricingType: row.pricingType,
    note: row.note,
    status: row.status,
    responseTimeMinutes: row.responseTimeMinutes,
    submittedAt: row.submittedAt.toISOString(),
    request: {
      id: row.request.id,
      category: row.request.category
        ? {
            id: row.request.category.id,
            slug: row.request.category.slug,
            labelEn: row.request.category.labelEn,
            labelAr: row.request.category.labelAr,
          }
        : null,
      customServiceText: row.request.customServiceText,
      description: row.request.description,
      city: snapshot.city ?? '',
      country: snapshot.country ?? '',
    },
  };
}
