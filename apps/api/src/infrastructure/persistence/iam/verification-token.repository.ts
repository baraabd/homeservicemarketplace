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

  // Use the database clock at the conditional write, not a timestamp captured
  // before waiting for another transaction. Purpose and single-use are atomic.
  async consume(tokenHash: string, purpose: TokenPurpose, tx?: PrismaTx): Promise<VerificationToken | null> {
    const rows = await this.db(tx).$queryRaw<VerificationToken[]>`
      UPDATE "VerificationToken" SET "usedAt" = clock_timestamp()
      WHERE "tokenHash" = ${tokenHash} AND "purpose"::text = ${purpose}
        AND "usedAt" IS NULL AND "expiresAt" > clock_timestamp()
      RETURNING *`;
    return rows[0] ?? null;
  }

  invalidateAllForUser(userId: string, tx: PrismaTx): Promise<{ count: number }> {
    return tx.verificationToken.updateMany({
      where: { userId, usedAt: null }, data: { usedAt: new Date() },
    });
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

  async consumeByChallenge(
    challengeId: string,
    tokenHash: string,
    tx?: PrismaTx,
    maxAttempts = 5,
  ): Promise<VerificationToken | null> {
    const rows = await this.db(tx).$queryRaw<VerificationToken[]>`
      UPDATE "VerificationToken" SET "usedAt" = clock_timestamp()
      WHERE "challengeId" = ${challengeId} AND "tokenHash" = ${tokenHash}
        AND "usedAt" IS NULL AND "expiresAt" > clock_timestamp()
        AND "attemptCount" < ${maxAttempts}
        AND "purpose" IN ('REGISTRATION_OTP', 'LOGIN_OTP')
      RETURNING *`;
    return rows[0] ?? null;
  }

  // Callers with an interactive transaction must return a rejection verdict
  // and commit it before throwing. No extra pool connection is acquired while
  // holding the account lock; stale misses cannot change replaced challenges.
  async recordFailedAttempt(
    challengeId: string, expectedHash: string, maxAttempts: number, tx?: PrismaTx,
  ): Promise<VerificationToken | null> {
    const rows = await this.db(tx).$queryRaw<VerificationToken[]>`
      UPDATE "VerificationToken" SET "attemptCount" = "attemptCount" + 1
      WHERE "challengeId" = ${challengeId} AND "tokenHash" = ${expectedHash}
        AND "usedAt" IS NULL AND "expiresAt" > clock_timestamp()
        AND "attemptCount" < ${maxAttempts}
        AND "purpose" IN ('REGISTRATION_OTP', 'LOGIN_OTP')
      RETURNING *`;
    return rows[0] ?? null;
  }

  // One conditional write owns both rotation and its persistent resend limit.
  async rotateLiveChallenge(
    challengeId: string,
    expectedHash: string,
    data: { tokenHash: string; expiresAt: Date },
    limits: { attempts: number; resends: number },
    tx?: PrismaTx,
  ): Promise<boolean> {
    const rows = await this.db(tx).$queryRaw<Array<{ id: string }>>`
      UPDATE "VerificationToken"
      SET "tokenHash" = ${data.tokenHash}, "expiresAt" = ${data.expiresAt},
          "resendCount" = "resendCount" + 1
      WHERE "challengeId" = ${challengeId} AND "tokenHash" = ${expectedHash}
        AND "usedAt" IS NULL AND "expiresAt" > clock_timestamp()
        AND "attemptCount" < ${limits.attempts} AND "resendCount" < ${limits.resends}
        AND "purpose" IN ('REGISTRATION_OTP', 'LOGIN_OTP')
      RETURNING "id"`;
    return rows.length === 1;
  }
}
