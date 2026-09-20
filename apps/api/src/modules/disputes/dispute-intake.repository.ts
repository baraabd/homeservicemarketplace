import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaTx } from '@homeservicemarketplace/database';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { INTAKE_ID_PREFIX } from './dispute-intake.policy';

const bookingSelect = {
  id: true,
  status: true,
  seekerUserId: true,
  scheduledAt: true,
  createdAt: true,
  provider: { select: { userId: true } },
  request: { select: { category: { select: { labelEn: true, labelAr: true } } } },
} satisfies Prisma.BookingSelect;
export type IntakeBooking = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;
const caseInclude = {
  workspace: { select: { state: true } },
  booking: { select: bookingSelect },
} satisfies Prisma.DisputeInclude;
export type IntakeCase = Prisma.DisputeGetPayload<{ include: typeof caseInclude }>;

function participantBookingWhere(actorUserId: string): Prisma.BookingWhereInput {
  return {
    deletedAt: null,
    OR: [{ seekerUserId: actorUserId }, { provider: { userId: actorUserId } }],
  };
}

@Injectable()
export class DisputeIntakeRepository {
  constructor(private readonly prisma: PrismaService) {}
  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  ownedBooking(id: string, actorUserId: string, tx?: PrismaTx): Promise<IntakeBooking | null> {
    return this.db(tx).booking.findFirst({
      where: { id, ...participantBookingWhere(actorUserId) },
      select: bookingSelect,
    });
  }
  listBookings(actorUserId: string, take: number, cursor?: string) {
    return this.db().booking.findMany({
      where: participantBookingWhere(actorUserId),
      select: bookingSelect,
      take,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
  async lockBooking(id: string, tx: PrismaTx): Promise<void> {
    // The caller first proves participation, then re-reads it after this lock.
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Booking" WHERE "id" = ${id} FOR UPDATE`);
  }
  async terminalAt(booking: IntakeBooking, tx?: PrismaTx): Promise<Date | null> {
    if (booking.status !== 'COMPLETED' && booking.status !== 'CANCELLED') return null;
    const event = await this.db(tx).bookingEvent.findFirst({
      where: {
        bookingId: booking.id,
        ...(booking.status === 'COMPLETED'
          ? {
              type: 'BOOKING_STATUS_CHANGED' as const,
              metadata: { path: ['to'], equals: 'COMPLETED' },
            }
          : { type: 'BOOKING_CANCELLED' as const }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true },
    });
    return event?.createdAt ?? null;
  }
  activeCase(bookingId: string, tx?: PrismaTx) {
    return this.db(tx).dispute.findFirst({
      where: { bookingId, deletedAt: null, status: { in: ['OPEN', 'IN_REVIEW'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: caseInclude,
    });
  }
  byIntent(id: string, tx: PrismaTx) {
    // Includes a tombstone to avoid silently reusing a retired intent id.
    return tx.dispute.findUnique({ where: { id }, include: caseInclude });
  }
  ownedCase(id: string, actorUserId: string, tx?: PrismaTx): Promise<IntakeCase | null> {
    if (!id.startsWith(INTAKE_ID_PREFIX)) return Promise.resolve(null);
    return this.db(tx).dispute.findFirst({
      where: { id, deletedAt: null, booking: participantBookingWhere(actorUserId) },
      include: caseInclude,
    });
  }
  list(actorUserId: string, take: number, cursor?: string) {
    return this.db().dispute.findMany({
      where: {
        id: { startsWith: INTAKE_ID_PREFIX },
        deletedAt: null,
        booking: participantBookingWhere(actorUserId),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: caseInclude,
    });
  }
  receipt(id: string, tx?: PrismaTx) {
    return this.db(tx).disputeEvent.findFirst({
      where: { disputeId: id, type: 'OPENED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  publicEvents(id: string, tx?: PrismaTx) {
    return this.db(tx).disputeEvent.findMany({
      // An explicit projection: never select before/after/message/actor identity.
      where: { disputeId: id, type: { in: ['OPENED', 'STATUS_CHANGED', 'RESOLVED'] } },
      select: { id: true, type: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 101,
    });
  }
}
