import { Injectable } from '@nestjs/common';
import type {
  AddressSnapshot,
  ListProviderBookingsQuery,
  ListProviderBookingsResponse,
  ProviderBookingDetail,
  ProviderBookingMutationResponse,
  ProviderBookingTimelineResponse,
  ProviderBookingSummary,
} from '@homeservicemarketplace/contracts';
import {
  BookingEventType,
  BookingStatus,
  NotificationResourceType,
  NotificationType,
} from '@homeservicemarketplace/database';

import { BookingEventRepository } from '../../../infrastructure/persistence/bookings/booking-event.repository';
import {
  BookingRepository,
  type BookingWithProviderRelations,
} from '../../../infrastructure/persistence/bookings/booking.repository';
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { NotificationsService } from '../../notifications/notifications.service';

const DEFAULT_PAGE_SIZE = 50;

// Provider booking lifecycle (Sprint 5 slice 5.4).
//
// Routes (all class-level guards Jwt + Roles + ProviderActiveGuard;
// mutations additionally use CsrfGuard):
//
//   GET  /v1/me/provider/bookings                      — list mine
//   GET  /v1/me/provider/bookings/:id                  — detail
//   GET  /v1/me/provider/bookings/:id/timeline         — audit
//   POST /v1/me/provider/bookings/:id/start            — SCHEDULED → IN_PROGRESS
//   POST /v1/me/provider/bookings/:id/complete         — IN_PROGRESS → COMPLETED
//   POST /v1/me/provider/bookings/:id/cancel           — SCHEDULED → CANCELLED
//
// Each transition runs inside one transaction so the booking row, the
// timeline event, and the seeker notification land atomically.
@Injectable()
export class ProviderBookingsService {
  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly bookings: BookingRepository,
    private readonly events: BookingEventRepository,
    private readonly notifications: NotificationsService,
    private readonly tx: TransactionRunner,
  ) {}

  async list(
    providerUserId: string,
    query: ListProviderBookingsQuery,
  ): Promise<ListProviderBookingsResponse> {
    const profile = await this.providers.findByUserId(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.bookings.listForProvider({
      providerId: profile.id,
      status: query.status,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items: ProviderBookingSummary[] = page.map(toSummary);
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async detail(providerUserId: string, bookingId: string): Promise<ProviderBookingDetail> {
    const profile = await this.providers.findByUserId(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const row = await this.bookings.findOwnedByProvider(bookingId, profile.id);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Booking not found.', 404);
    }
    return toDetail(row);
  }

  async timeline(
    providerUserId: string,
    bookingId: string,
  ): Promise<ProviderBookingTimelineResponse> {
    const profile = await this.providers.findByUserId(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const owned = await this.bookings.findOwnedByProvider(bookingId, profile.id);
    if (!owned) {
      throw new AppError('NOT_FOUND', 'Booking not found.', 404);
    }
    const rows = await this.events.listForBooking(bookingId);
    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async start(providerUserId: string, bookingId: string): Promise<ProviderBookingMutationResponse> {
    return this.transition(
      providerUserId,
      bookingId,
      [BookingStatus.SCHEDULED],
      BookingStatus.IN_PROGRESS,
      BookingEventType.BOOKING_STATUS_CHANGED,
      // No notification on start — matches typical marketplace UX
      // where the provider arriving is signalled via the conversation
      // surface, not a push notification.
      null,
      'Cannot start a booking that is not scheduled.',
    );
  }

  async complete(
    providerUserId: string,
    bookingId: string,
  ): Promise<ProviderBookingMutationResponse> {
    return this.transition(
      providerUserId,
      bookingId,
      [BookingStatus.IN_PROGRESS],
      BookingStatus.COMPLETED,
      BookingEventType.BOOKING_STATUS_CHANGED,
      {
        type: NotificationType.BOOKING_COMPLETED,
        title: 'Booking completed',
        body: (booking) => `${booking.provider.displayName} marked your booking as completed.`,
      },
      'Only an in-progress booking can be marked complete.',
    );
  }

  async cancel(
    providerUserId: string,
    bookingId: string,
  ): Promise<ProviderBookingMutationResponse> {
    return this.transition(
      providerUserId,
      bookingId,
      [BookingStatus.SCHEDULED],
      BookingStatus.CANCELLED,
      BookingEventType.BOOKING_CANCELLED,
      {
        type: NotificationType.BOOKING_CANCELLED,
        title: 'Booking cancelled',
        body: (booking) => `${booking.provider.displayName} cancelled the booking.`,
      },
      'Only a scheduled booking can be cancelled.',
    );
  }

  // ─── helpers ─────────────────────────────────────────────────────────────────
  private async transition(
    providerUserId: string,
    bookingId: string,
    from: BookingStatus[],
    to: BookingStatus,
    eventType: BookingEventType,
    notify: null | {
      type: NotificationType;
      title: string;
      body: (booking: BookingWithProviderRelations) => string;
    },
    invalidStateMsg: string,
  ): Promise<ProviderBookingMutationResponse> {
    const result = await this.tx.run(async (tx) => {
      const profile = await this.providers.findByUserId(providerUserId, tx);
      if (!profile) {
        throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
      }
      const existing = await this.bookings.findOwnedByProvider(bookingId, profile.id, tx);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Booking not found.', 404);
      }
      if (!from.includes(existing.status)) {
        throw new AppError('CONFLICT', invalidStateMsg, 409);
      }
      const flipped = await this.bookings.setStatusOwnedByProvider(
        bookingId,
        profile.id,
        from,
        to,
        tx,
      );
      if (flipped.count === 0) {
        // Concurrent writer beat us — be honest.
        throw new AppError('CONFLICT', invalidStateMsg, 409);
      }
      await this.events.create(
        {
          bookingId,
          actorUserId: providerUserId,
          type: eventType,
          metadata: { from: existing.status, to },
        },
        tx,
      );
      if (notify) {
        await this.notifications.createForUser(
          {
            userId: existing.seekerUserId,
            type: notify.type,
            title: notify.title,
            body: notify.body(existing),
            resourceType: NotificationResourceType.BOOKING,
            resourceId: bookingId,
            deepLink: `/home/bookings/${bookingId}`,
            metadata: { requestId: existing.requestId, providerId: profile.id },
          },
          tx,
        );
      }
      const reloaded = await this.bookings.findOwnedByProvider(bookingId, profile.id, tx);
      if (!reloaded) {
        throw new AppError('NOT_FOUND', 'Booking not found.', 404);
      }
      return reloaded;
    });
    return { booking: toDetail(result) };
  }
}

function toSummary(row: BookingWithProviderRelations): ProviderBookingSummary {
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
    bidNote: row.bid.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    service: {
      categorySlug: row.request.category?.slug ?? null,
      categoryLabelEn: row.request.category?.labelEn ?? null,
      categoryLabelAr: row.request.category?.labelAr ?? null,
      customServiceText: row.request.customServiceText,
    },
    seeker: {
      firstName: row.seeker.firstName,
      city: snapshot.city,
    },
    addressSnapshot: snapshot,
  };
}

function toDetail(row: BookingWithProviderRelations): ProviderBookingDetail {
  return {
    ...toSummary(row),
    description: row.request.description,
  };
}
