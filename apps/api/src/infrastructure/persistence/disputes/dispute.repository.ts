import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Sprint 6.3 refined — dispute persistence (priority + description).
//
// The Prisma client has Dispute / DisputeEvent models in the schema
// (see packages/database/prisma/schema.prisma) but generation of the
// typed client is blocked in this dev session by a Windows DLL lock.
// Casting `as unknown as { dispute: ... }` lets the repository
// compile against the current generated client and rely on a fresh
// `prisma generate` at deploy time. The migration in
// 20260502030000_add_dispute_priority_and_events creates the columns
// either way.

type DisputeStatus =
  | 'RESOLVED'
  | 'OPEN'
  | 'IN_REVIEW'
  | 'RESOLVED_REFUND'
  | 'RESOLVED_PARTIAL'
  | 'RESOLVED_DENIED'
  | 'CANCELLED';

type DisputePriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface DisputeRow {
  id: string;
  bookingId: string;
  openedById: string;
  status: DisputeStatus;
  priority: DisputePriority;
  reason: string;
  description: string | null;
  resolution: string | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface UpdateDisputeFields {
  status?: DisputeStatus;
  priority?: DisputePriority;
  description?: string | null;
}

@Injectable()
export class DisputeRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return (tx ?? this.prisma.client) as unknown as {
      dispute: {
        findFirst: (args: unknown) => Promise<DisputeRow | null>;
        findMany: (args: unknown) => Promise<DisputeRow[]>;
        create: (args: { data: Partial<DisputeRow> }) => Promise<DisputeRow>;
        update: (args: {
          where: { id: string; workspace?: { is: null } };
          data: Partial<DisputeRow>;
        }) => Promise<DisputeRow>;
      };
    };
  }

  list(
    args: {
      status?: DisputeStatus;
      priority?: DisputePriority;
      take: number;
      cursor?: string;
    },
    tx?: PrismaTx,
  ): Promise<DisputeRow[]> {
    return this.db(tx).dispute.findMany({
      where: {
        deletedAt: null,
        workspace: { is: null },
        ...(args.status ? { status: args.status } : {}),
        ...(args.priority ? { priority: args.priority } : {}),
      },
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  findById(id: string, tx?: PrismaTx): Promise<DisputeRow | null> {
    return this.db(tx).dispute.findFirst({
      where: { id, deletedAt: null, workspace: { is: null } },
    });
  }

  /**
   * R17-C — read a legacy ticket for a decision, holding its row locks.
   *
   * Without these locks two admins both read OPEN and both "resolve": the
   * second overwrites the first and every side effect is written twice. The
   * order is the one intake and the dispute workspace already use — Booking,
   * then the case — so no path takes the two in the opposite order.
   */
  async lockForDecision(id: string, tx: PrismaTx): Promise<DisputeRow | null> {
    const target = await tx.dispute.findFirst({
      where: { id, deletedAt: null, workspace: { is: null } },
      select: { bookingId: true },
    });
    if (!target) return null;
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Booking" WHERE "id" = ${target.bookingId} FOR UPDATE`,
    );
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Dispute" WHERE "id" = ${id} FOR UPDATE`);
    // Re-read under the lock: this is the state the decision is based on.
    return this.findById(id, tx);
  }

  /** The booking's two participants (a pooled profile may have no user), or null. */
  async bookingParticipants(
    bookingId: string,
    tx?: PrismaTx,
  ): Promise<{ seekerUserId: string; providerUserId: string | null } | null> {
    const booking = await (tx ?? this.prisma.client).booking.findFirst({
      where: { id: bookingId, deletedAt: null },
      select: { seekerUserId: true, provider: { select: { userId: true } } },
    });
    return booking
      ? { seekerUserId: booking.seekerUserId, providerUserId: booking.provider.userId }
      : null;
  }

  create(
    input: {
      bookingId: string;
      openedById: string;
      reason: string;
      description?: string | null;
      priority?: DisputePriority;
    },
    tx?: PrismaTx,
  ): Promise<DisputeRow> {
    return this.db(tx).dispute.create({
      data: {
        bookingId: input.bookingId,
        openedById: input.openedById,
        reason: input.reason,
        description: input.description ?? null,
        priority: input.priority ?? 'MEDIUM',
        status: 'OPEN',
      },
    });
  }

  update(id: string, input: UpdateDisputeFields, tx?: PrismaTx): Promise<DisputeRow> {
    const data: Partial<DisputeRow> = {};
    if (input.status !== undefined) data.status = input.status;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.description !== undefined) data.description = input.description;
    return this.db(tx).dispute.update({ where: { id, workspace: { is: null } }, data });
  }

  resolve(
    id: string,
    input: { status: DisputeStatus; resolution: string; resolvedById: string },
    tx?: PrismaTx,
  ): Promise<DisputeRow> {
    return this.db(tx).dispute.update({
      where: { id, workspace: { is: null } },
      data: {
        status: input.status,
        resolution: input.resolution,
        resolvedById: input.resolvedById,
        resolvedAt: new Date(),
      },
    });
  }
}
