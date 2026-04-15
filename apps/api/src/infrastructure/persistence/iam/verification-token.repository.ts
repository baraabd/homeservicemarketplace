import { Injectable } from '@nestjs/common';
import type { PrismaTx, TokenPurpose, VerificationToken } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateVerificationTokenInput {
  userId: string;
  tokenHash: string;
  purpose: TokenPurpose;
  expiresAt: Date;
}

@Injectable()
export class VerificationTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  create(input: CreateVerificationTokenInput, tx?: PrismaTx): Promise<VerificationToken> {
    return this.db(tx).verificationToken.create({ data: input });
  }

  findByHash(tokenHash: string, tx?: PrismaTx): Promise<VerificationToken | null> {
    return this.db(tx).verificationToken.findUnique({ where: { tokenHash } });
  }

  // Atomic consume: mark the token used only if it has not been used yet.
  // Returns the row if the mark succeeded, null otherwise (replay / already used).
  async consume(tokenHash: string, tx?: PrismaTx): Promise<VerificationToken | null> {
    const result = await this.db(tx).verificationToken.updateMany({
      where: { tokenHash, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (result.count === 0) return null;
    return this.findByHash(tokenHash, tx);
  }

  // Invalidate any outstanding tokens of a purpose for a user. Used when
  // re-issuing: prevents multiple live reset codes from coexisting.
  invalidateOutstanding(
    userId: string,
    purpose: TokenPurpose,
    tx?: PrismaTx,
  ): Promise<{ count: number }> {
    return this.db(tx).verificationToken.updateMany({
      where: { userId, purpose, usedAt: null },
      data: { usedAt: new Date() },
    });
  }
}
