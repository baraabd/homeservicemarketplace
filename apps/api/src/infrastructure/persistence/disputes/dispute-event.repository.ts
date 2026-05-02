import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Sprint 6.3 refined — DisputeEvent persistence.
//
// Each row is a single transition in the dispute's verification
// timeline. Same DLL-lock workaround as the Dispute repo: cast to a
// minimal typed shape so the repo compiles against the cached
// generated client until `prisma generate` runs cleanly.

export type DisputeEventType =
  | 'OPENED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'DESCRIPTION_UPDATED'
  | 'RESOLVED'
  | 'COMMENTED';

export interface DisputeEventRow {
  id: string;
  disputeId: string;
  actorUserId: string | null;
  type: DisputeEventType;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  message: string | null;
  createdAt: Date;
}

export interface CreateDisputeEventInput {
  disputeId: string;
  actorUserId: string | null;
  type: DisputeEventType;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  message?: string | null;
}

@Injectable()
export class DisputeEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return (tx ?? this.prisma.client) as unknown as {
      disputeEvent: {
        findMany: (args: unknown) => Promise<DisputeEventRow[]>;
        create: (args: { data: Partial<DisputeEventRow> }) => Promise<DisputeEventRow>;
      };
    };
  }

  create(input: CreateDisputeEventInput, tx?: PrismaTx): Promise<DisputeEventRow> {
    return this.db(tx).disputeEvent.create({
      data: {
        disputeId: input.disputeId,
        actorUserId: input.actorUserId,
        type: input.type,
        before: input.before ?? null,
        after: input.after ?? null,
        message: input.message ?? null,
      },
    });
  }

  // Most-recent-first list of events for a single dispute. Bounded by
  // `take` so the detail endpoint never streams the full history; an
  // operator who needs the full timeline can paginate via a future
  // cursor route.
  listForDispute(disputeId: string, take: number, tx?: PrismaTx): Promise<DisputeEventRow[]> {
    return this.db(tx).disputeEvent.findMany({
      where: { disputeId },
      take,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
