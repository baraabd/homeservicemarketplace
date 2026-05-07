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

  // Sprint 6.6: admin-side cursor-paginated read. Filters: optional
  // `type` (exact match against AuditEventType) and optional `userId`
  // (the actor). Soft-deleted users still surface their events so
  // the audit history is preserved.
  list(
    args: { type?: string; userId?: string; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<AuditEvent[]> {
    return this.db(tx).auditEvent.findMany({
      where: {
        ...(args.type ? { type: args.type as AuditEventType } : {}),
        ...(args.userId ? { userId: args.userId } : {}),
      },
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  // Sprint 6.2: provider-scoped audit history. Uses Prisma's JSON
  // `path` filter to match metadata.providerProfileId (the key all
  // verification mutations write — see admin-verification.service.ts).
  // Cursor-paginated by [createdAt desc, id desc] like list().
  listForProviderProfile(
    args: { providerProfileId: string; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<AuditEvent[]> {
    return this.db(tx).auditEvent.findMany({
      where: {
        metadata: {
          path: ['providerProfileId'],
          equals: args.providerProfileId,
        },
      },
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
