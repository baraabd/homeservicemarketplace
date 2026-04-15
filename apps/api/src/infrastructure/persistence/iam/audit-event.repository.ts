import { Injectable } from '@nestjs/common';
import type { AuditEvent, AuditEventType, PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface WriteAuditEventInput {
  userId: string | null;
  type: AuditEventType;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

@Injectable()
export class AuditEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  write(input: WriteAuditEventInput, tx?: PrismaTx): Promise<AuditEvent> {
    return this.db(tx).auditEvent.create({
      data: {
        userId: input.userId,
        type: input.type,
        metadata: input.metadata as object,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        requestId: input.requestId,
      },
    });
  }
}
