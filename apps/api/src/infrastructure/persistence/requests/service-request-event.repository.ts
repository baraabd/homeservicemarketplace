import { Injectable } from '@nestjs/common';
import { Prisma } from '@homeservicemarketplace/database';
import type {
  PrismaTx,
  ServiceRequestEvent,
  ServiceRequestEventType,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateServiceRequestEventInput {
  requestId: string;
  actorUserId: string | null;
  type: ServiceRequestEventType;
  metadata?: Prisma.InputJsonValue | null;
}

// Append-only timeline of state changes against a service request.
// Always written inside the same transaction as the underlying request
// state transition so the timeline can never disagree with the request.
@Injectable()
export class ServiceRequestEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  create(input: CreateServiceRequestEventInput, tx?: PrismaTx): Promise<ServiceRequestEvent> {
    return this.db(tx).serviceRequestEvent.create({
      data: {
        requestId: input.requestId,
        actorUserId: input.actorUserId,
        type: input.type,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  }

  // Chronological order — oldest first — so a render-as-list call site
  // shows the request's history from posted → updated → cancelled /
  // reopened. Documented in the contract too so reverse-order consumers
  // know to re-sort instead of relying on implementation order.
  listForRequest(requestId: string, tx?: PrismaTx): Promise<ServiceRequestEvent[]> {
    return this.db(tx).serviceRequestEvent.findMany({
      where: { requestId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
