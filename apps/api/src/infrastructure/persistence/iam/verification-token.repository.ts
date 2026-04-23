import { Injectable } from '@nestjs/common';
import type { PrismaTx, TokenPurpose, VerificationToken } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateVerificationTokenInput {
  userId: string;
  tokenHash: string;
  purpose: TokenPurpose;
  expiresAt: Date;
  // OTP-only. Link tokens leave these null.
  challengeId?: string | null;
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

  // --- OTP-specific helpers ----------------------------------------------

  findByChallengeId(challengeId: string, tx?: PrismaTx): Promise<VerificationToken | null> {
    return this.db(tx).verificationToken.findUnique({ where: { challengeId } });
  }

  // Atomic "did the attempt match the expected hash?" check. Only flips
  // usedAt when the supplied hash matches AND the row is still live. Also
  // increments attemptCount regardless — the caller inspects the return
  // value to decide if this was a hit or a miss and whether to lock out
  // the challenge.
  async consumeByChallenge(
    challengeId: string,
    tokenHash: string,
    tx?: PrismaTx,
  ): Promise<VerificationToken | null> {
    const result = await this.db(tx).verificationToken.updateMany({
      where: { challengeId, tokenHash, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (result.count === 0) return null;
    return this.findByChallengeId(challengeId, tx);
  }

  incrementAttempt(challengeId: string, tx?: PrismaTx): Promise<VerificationToken> {
    return this.db(tx).verificationToken.update({
      where: { challengeId },
      data: { attemptCount: { increment: 1 } },
    });
  }

  incrementResend(challengeId: string, tx?: PrismaTx): Promise<VerificationToken> {
    return this.db(tx).verificationToken.update({
      where: { challengeId },
      data: { resendCount: { increment: 1 } },
    });
  }

  // Rotate: replace the tokenHash + expiresAt for an existing challenge in
  // place, so the challengeId the client already holds stays valid while
  // the underlying code changes. Also invalidates any earlier outstanding
  // OTP tokens for the user+purpose to guarantee only one live code.
  rotateChallenge(
    challengeId: string,
    data: { tokenHash: string; expiresAt: Date },
    tx?: PrismaTx,
  ): Promise<VerificationToken> {
    return this.db(tx).verificationToken.update({
      where: { challengeId },
      data: { tokenHash: data.tokenHash, expiresAt: data.expiresAt },
    });
  }
}
