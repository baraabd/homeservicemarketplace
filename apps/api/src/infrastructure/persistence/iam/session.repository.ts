import { Injectable } from '@nestjs/common';
import type { ClientKind, PrismaTx, Session } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateSessionInput {
  userId: string;
  familyId: string;
  parentJti: string | null;
  currentJti: string;
  tokenHash: string;
  ipAddress: string;
  userAgent: string;
  clientKind: ClientKind;
  expiresAt: Date;
}

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  create(input: CreateSessionInput, tx?: PrismaTx): Promise<Session> {
    return this.db(tx).session.create({ data: input });
  }

  findByTokenHash(tokenHash: string, tx?: PrismaTx): Promise<Session | null> {
    return this.db(tx).session.findUnique({ where: { tokenHash } });
  }

  findById(id: string, tx?: PrismaTx): Promise<Session | null> {
    return this.db(tx).session.findUnique({ where: { id } });
  }

  listActiveByUser(userId: string, tx?: PrismaTx): Promise<Session[]> {
    return this.db(tx).session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  // Atomic rotate: only proceeds if the source row is still non-revoked.
  // Returns the affected row count; caller treats 0 as a replay.
  async markRevokedIfActive(id: string, tx?: PrismaTx): Promise<number> {
    const result = await this.db(tx).session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  revokeFamily(familyId: string, tx?: PrismaTx): Promise<{ count: number }> {
    return this.db(tx).session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string, tx?: PrismaTx): Promise<{ count: number }> {
    return this.db(tx).session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeById(id: string, tx?: PrismaTx): Promise<{ count: number }> {
    return this.db(tx).session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  touchLastUsed(id: string, tx?: PrismaTx): Promise<Session> {
    return this.db(tx).session.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
