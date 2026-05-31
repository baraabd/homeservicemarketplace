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
import {
  BookingEventType,
  BookingStatus,
  NotificationResourceType,
  NotificationType,
} from '@homeservicemarketplace/database';
import type { BookingEvent, ProviderProfile } from '@homeservicemarketplace/database';

import {
  BookingRepository,
  type BookingWithRelations,
} from '../../infrastructure/persistence/bookings/booking.repository';
import { BookingEventRepository } from '../../infrastructure/persistence/bookings/booking-event.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeEventsPublisher } from '../realtime/realtime-events.publisher';
import type { BookingStatusChangedRealtimePayload } from '@homeservicemarketplace/contracts';

const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class BookingsService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly events: BookingEventRepository,
    private readonly notifications: NotificationsService,
    private readonly tx: TransactionRunner,
    // Sprint 7.x — realtime fan-out on seeker-initiated booking
    // transitions (today: cancel). Injected via the `@Global`
    // RealtimeModule; failures are swallowed by the publisher so a
    // bus outage cannot roll back the REST mutation.
    private readonly realtime: RealtimeEventsPublisher,
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
    const committed = await this.tx.run(async (tx) => {
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

      // Sprint 7.x — notify the PROVIDER (non-actor recipient) that
      // the seeker cancelled. The seeker self-notification that
      // previously fired here was removed per the Sprint 7.6 anti-
      // echo rule: the seeker just performed the action and sees an
      // in-screen confirmation; persisting a notification for them
      // produced an echo in their drawer. Audit history of the
      // transition still lives in BookingEvent.
      //
      // Only fan out when the provider has a linked userId — older
      // detached seed profiles have no surface to deliver to.
      const providerUserId = existing.provider.userId;
      if (providerUserId) {
        await this.notifications.createForUser(
          {
            userId: providerUserId,
            type: NotificationType.BOOKING_CANCELLED,
            title: 'Booking cancelled',
            // Body intentionally vague — never leak why or who.
            body: 'The seeker cancelled the booking.',
            resourceType: NotificationResourceType.BOOKING,
            resourceId: bookingId,
            deepLink: `/provider/bookings/${bookingId}`,
            metadata: {
              bookingId,
              requestId: existing.requestId,
              cancelledBy: 'seeker',
              // Sprint 7.x — explicit `to` so the provider-side
              // frontend status-normalizer can derive the lifecycle
              // status from this notification.created event without
              // needing the paired booking.status_changed.
              from: existing.status,
              to: BookingStatus.CANCELLED,
            },
            actorUserId: seekerUserId,
          },
          tx,
        );
      }

      const reloaded = await this.bookings.findOwned(bookingId, seekerUserId, tx);
      if (!reloaded) {
        throw new AppError('NOT_FOUND', 'Booking not found.', 404);
      }
      return {
        reloaded,
        prevStatus: existing.status,
        providerUserId,
      };
    });

    // Sprint 7.x — POST-COMMIT realtime fan-out. Mirrors the typed
    // payload used by the provider-side lifecycle service so a
    // single client dispatcher case handles every booking transition
    // regardless of who initiated it.
    //
    //   - Seeker recipient → cache invalidation only (anti-echo
    //     silences UX since they're the actor).
    //   - Provider recipient → cache invalidation + UX feedback
    //     (toast + sound), gated by the side-effects bridge against
    //     the envelope's `actorUserId`.
    const payload: BookingStatusChangedRealtimePayload = {
      bookingId: committed.reloaded.id,
      requestId: committed.reloaded.requestId,
      bidId: committed.reloaded.bidId,
      from: committed.prevStatus,
      to: committed.reloaded.status,
      actorUserId: seekerUserId,
      actorRole: 'SEEKER',
    };
    const actorMeta = { actorUserId: seekerUserId };
    this.realtime.publishFor(seekerUserId, 'booking.status_changed', payload, actorMeta);
    if (committed.providerUserId) {
      this.realtime.publishFor(
        committed.providerUserId,
        'booking.status_changed',
        payload,
        actorMeta,
      );
    }

    return toDetail(committed.reloaded);
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
    // Sprint 7.12 — surface the parent request's createdAt so the
    // booking-side JobDetailView "Posted" step shows the original
    // post time. The eager-loaded `request` relation already carries
    // it; no extra query.
    requestCreatedAt: row.request.createdAt.toISOString(),
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
