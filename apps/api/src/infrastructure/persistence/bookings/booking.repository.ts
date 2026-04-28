import { Injectable } from '@nestjs/common';
import type { Booking, BookingStatus, PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateBookingInput {
  requestId: string;
  bidId: string;
  seekerUserId: string;
  providerId: string;
  priceAmount: number;
  currency: string;
  scheduledAt?: Date | null;
  status?: BookingStatus;
}

// Booking persistence. Slice 2.2 only uses `create` (called from inside
// the accept-bid transaction). Find / list / status-update belong to
// future slices when the bookings tab + cancellation flows ship.
@Injectable()
export class BookingRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  create(input: CreateBookingInput, tx?: PrismaTx): Promise<Booking> {
    return this.db(tx).booking.create({
      data: {
        request: { connect: { id: input.requestId } },
        bid: { connect: { id: input.bidId } },
        seeker: { connect: { id: input.seekerUserId } },
        provider: { connect: { id: input.providerId } },
        priceAmount: input.priceAmount,
        currency: input.currency,
        scheduledAt: input.scheduledAt ?? null,
        ...(input.status ? { status: input.status } : {}),
      },
    });
  }

  // Findone-by-bid is exposed because the accept-bid invariant
  // (one-booking-per-bid) is enforced both at the DB unique index and
  // through this find — the service uses it as a defensive pre-check
  // in the rare case the unique index throws and we want to convert
  // the violation into a stable CONFLICT response.
  findByBidId(bidId: string, tx?: PrismaTx): Promise<Booking | null> {
    return this.db(tx).booking.findUnique({ where: { bidId } });
  }
}
