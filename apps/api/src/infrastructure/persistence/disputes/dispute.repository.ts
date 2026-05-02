import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Sprint 6.3: dispute persistence.
//
// The Prisma client has Dispute / PlatformSetting models in the
// schema (see packages/database/prisma/schema.prisma) but generation
// of the typed client is blocked in this dev session by a Windows
// DLL lock. Casting `as unknown as { dispute: ... }` lets the
// repository compile against the current generated client and rely
// on a fresh `prisma generate` at deploy time. The migration in
// 20260502010000_add_disputes_and_settings creates the underlying
// table either way.
type DisputeStatus =
  | 'OPEN'
  | 'IN_REVIEW'
  | 'RESOLVED_REFUND'
  | 'RESOLVED_PARTIAL'
  | 'RESOLVED_DENIED'
  | 'CANCELLED';

export interface DisputeRow {
  id: string;
  bookingId: string;
  openedById: string;
  status: DisputeStatus;
  reason: string;
  resolution: string | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
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
    args: { status?: DisputeStatus; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<DisputeRow[]> {
    return this.db(tx).dispute.findMany({
      where: {
        deletedAt: null,
        ...(args.status ? { status: args.status } : {}),
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
    input: { bookingId: string; openedById: string; reason: string },
    tx?: PrismaTx,
  ): Promise<DisputeRow> {
    return this.db(tx).dispute.create({
      data: {
        bookingId: input.bookingId,
        openedById: input.openedById,
        reason: input.reason,
        status: 'OPEN',
      },
    });
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
