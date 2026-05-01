import { Injectable } from '@nestjs/common';
import { Prisma } from '@homeservicemarketplace/database';
import type { BookingEvent, BookingEventType, PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateBookingEventInput {
  bookingId: string;
  actorUserId: string | null;
  type: BookingEventType;
  metadata?: Prisma.InputJsonValue | null;
}

// Append-only timeline of state changes against a booking. Always
// written inside the same transaction as the underlying state
// transition (BOOKING_CREATED inside accept-bid, BOOKING_CANCELLED
// inside cancel-booking) so the timeline can never disagree with
// the booking row.
@Injectable()
export class BookingEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  create(input: CreateBookingEventInput, tx?: PrismaTx): Promise<BookingEvent> {
    return this.db(tx).bookingEvent.create({
      data: {
        bookingId: input.bookingId,
        actorUserId: input.actorUserId,
        type: input.type,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  }

  // Chronological order — oldest first — so a render-as-list call site
  // shows the booking's history from created → status changes →
  // cancelled / completed. Documented in the contract too so reverse-
  // order consumers know to re-sort instead of relying on
  // implementation order.
  listForBooking(bookingId: string, tx?: PrismaTx): Promise<BookingEvent[]> {
    return this.db(tx).bookingEvent.findMany({
      where: { bookingId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
