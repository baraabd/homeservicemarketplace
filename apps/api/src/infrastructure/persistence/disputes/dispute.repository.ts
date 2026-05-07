import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '@homeservicemarketplace/database';

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
        update: (args: { where: { id: string }; data: Partial<DisputeRow> }) => Promise<DisputeRow>;
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
        ...(args.status ? { status: args.status } : {}),
        ...(args.priority ? { priority: args.priority } : {}),
      },
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  findById(id: string, tx?: PrismaTx): Promise<DisputeRow | null> {
    return this.db(tx).dispute.findFirst({ where: { id, deletedAt: null } });
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
    return this.db(tx).dispute.update({ where: { id }, data });
  }

  resolve(
    id: string,
    input: { status: DisputeStatus; resolution: string; resolvedById: string },
    tx?: PrismaTx,
  ): Promise<DisputeRow> {
    return this.db(tx).dispute.update({
      where: { id },
      data: {
        status: input.status,
        resolution: input.resolution,
        resolvedById: input.resolvedById,
        resolvedAt: new Date(),
      },
    });
  }
}
