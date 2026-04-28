import { Injectable } from '@nestjs/common';
import type {
  AddressSnapshot,
  BookingDetail,
  BookingListItem,
  BookingListResponse,
  BookingTimelineEvent,
  BookingTimelineResponse,
  ListBookingsQuery,
  ProviderBidSummary,
} from '@homeservicemarketplace/contracts';
import { BookingEventType, BookingStatus } from '@homeservicemarketplace/database';
import type { BookingEvent, ProviderProfile } from '@homeservicemarketplace/database';

import {
  BookingRepository,
  type BookingWithRelations,
} from '../../infrastructure/persistence/bookings/booking.repository';
import { BookingEventRepository } from '../../infrastructure/persistence/bookings/booking-event.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';

const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class BookingsService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly events: BookingEventRepository,
    private readonly tx: TransactionRunner,
  ) {}

  // ─── list ──────────────────────────────────────────────────────────────────
  async list(seekerUserId: string, query: ListBookingsQuery): Promise<BookingListResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.bookings.listForSeeker({
      seekerUserId,
      status: query.status,
      take: take + 1, // fetch one extra to detect a next page
      cursor: query.cursor,
    });
    const items = rows.slice(0, take).map(toListItem);
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  // ─── detail ────────────────────────────────────────────────────────────────
  // Ownership check via the composite where in findOwned: a foreign
  // bookingId surfaces as 404, identical to "doesn't exist" — no
  // distinction between "not yours" and "not found" so an attacker
  // cannot enumerate other seekers' bookings.
  async detail(seekerUserId: string, bookingId: string): Promise<BookingDetail> {
    const row = await this.bookings.findOwned(bookingId, seekerUserId);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Booking not found.', 404);
    }
    return toDetail(row);
  }

  // ─── timeline ──────────────────────────────────────────────────────────────
  async timeline(seekerUserId: string, bookingId: string): Promise<BookingTimelineResponse> {
    // Ownership check first — never reveal the existence of someone
    // else's booking through the timeline endpoint.
    const owned = await this.bookings.findOwned(bookingId, seekerUserId);
    if (!owned) {
      throw new AppError('NOT_FOUND', 'Booking not found.', 404);
    }
    const rows = await this.events.listForBooking(bookingId);
    return { items: rows.map(toTimelineEvent) };
  }

  // ─── cancel ────────────────────────────────────────────────────────────────
  // SCHEDULED → CANCELLED inside one transaction. IN_PROGRESS / COMPLETED
  // are NOT cancellable here — those flows ship with the Provider /
  // tracking slices. Already-CANCELLED returns 409 so the client knows
  // the transition didn't actually fire.
  //
  // The parent ServiceRequest's status is intentionally NOT auto-reverted
  // back to OPEN_FOR_BIDS — re-opening for new bids is an explicit
  // user action that belongs to a future "cancel + repost" flow. Keeping
  // the request at BID_ACCEPTED preserves the original transition record.
  async cancel(seekerUserId: string, bookingId: string): Promise<BookingDetail> {
    const updated = await this.tx.run(async (tx) => {
      const existing = await this.bookings.findOwned(bookingId, seekerUserId, tx);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Booking not found.', 404);
      }
      if (existing.status === BookingStatus.CANCELLED) {
        throw new AppError('CONFLICT', 'Booking is already cancelled.', 409);
      }
      if (existing.status !== BookingStatus.SCHEDULED) {
        throw new AppError('CONFLICT', 'This booking can no longer be cancelled.', 409);
      }
      const result = await this.bookings.setStatusOwned(
        bookingId,
        seekerUserId,
        [BookingStatus.SCHEDULED],
        BookingStatus.CANCELLED,
        tx,
      );
      if (result.count === 0) {
        // Race: another worker flipped the status between findOwned
        // and setStatusOwned. Be honest about the race.
        throw new AppError('CONFLICT', 'This booking can no longer be cancelled.', 409);
      }
      await this.events.create(
        {
          bookingId,
          actorUserId: seekerUserId,
          type: BookingEventType.BOOKING_CANCELLED,
        },
        tx,
      );
      const reloaded = await this.bookings.findOwned(bookingId, seekerUserId, tx);
      if (!reloaded) {
        throw new AppError('NOT_FOUND', 'Booking not found.', 404);
      }
      return reloaded;
    });
    return toDetail(updated);
  }
}

// ─── DTO mappers ──────────────────────────────────────────────────────────────

function toListItem(row: BookingWithRelations): BookingListItem {
  const snapshot = row.request.addressSnapshot as unknown as AddressSnapshot;
  return {
    id: row.id,
    requestId: row.requestId,
    bidId: row.bidId,
    status: row.status,
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    priceAmount: row.priceAmount,
    currency: row.currency,
    pricingType: row.bid.pricingType,
    createdAt: row.createdAt.toISOString(),
    service: {
      categorySlug: row.request.category?.slug ?? null,
      categoryLabelEn: row.request.category?.labelEn ?? null,
      categoryLabelAr: row.request.category?.labelAr ?? null,
      customServiceText: row.request.customServiceText,
    },
    provider: toProviderSummary(row.provider),
    addressSnapshot: snapshot,
  };
}

function toDetail(row: BookingWithRelations): BookingDetail {
  return {
    ...toListItem(row),
    updatedAt: row.updatedAt.toISOString(),
    description: row.request.description,
    bidNote: row.bid.note,
  };
}

function toProviderSummary(p: ProviderProfile): ProviderBidSummary {
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

function toTimelineEvent(row: BookingEvent): BookingTimelineEvent {
  return {
    id: row.id,
    type: row.type,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
