import { Injectable } from '@nestjs/common';
import type { PrismaTx, TokenPurpose } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../../../config/app-config.service';
import { VerificationTokenRepository } from '../../../../infrastructure/persistence/iam/verification-token.repository';
import { TokenService } from './token.service';
import { lockAuthAccount } from '../../../../infrastructure/persistence/iam/auth-account-lock';

export interface IssuedVerificationToken {
  raw: string;
  expiresAt: Date;
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly repo: VerificationTokenRepository,
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
  ) {}

  async issue(
    userId: string,
    purpose: TokenPurpose,
    tx?: PrismaTx,
  ): Promise<IssuedVerificationToken> {
    if (tx) await lockAuthAccount(tx, userId);
    // Invalidate any outstanding token of the same purpose first — only one
    // live reset / verify link at a time per user.
    await this.repo.invalidateOutstanding(userId, purpose, tx);

    const { raw, hash } = this.tokens.mintOpaqueToken(32);
    const expiresAt = this.computeExpiry(purpose);
    await this.repo.create({ userId, tokenHash: hash, purpose, expiresAt }, tx);
    return { raw, expiresAt };
  }

  // Returns the userId if the token was valid AND was atomically marked used.
  // Returns null on any failure mode; callers must not branch on the specific
  // reason (anti-enumeration).
  async consume(raw: string, purpose: TokenPurpose, tx?: PrismaTx): Promise<string | null> {
    if (!raw || raw.length < 8) return null;
    const hash = this.tokens.hashOpaqueToken(raw);
    const row = await this.repo.findByHash(hash, tx);
    if (!row) return null;
    if (row.purpose !== purpose) return null;
    if (row.usedAt !== null) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;

    if (tx) await lockAuthAccount(tx, row.userId);
    const consumed = await this.repo.consume(hash, purpose, tx);
    if (!consumed) return null;
    return consumed.userId;
  }

  revokeOutstandingForUser(userId: string, tx: PrismaTx): Promise<{ count: number }> {
    return this.repo.invalidateAllForUser(userId, tx);
  }

  private computeExpiry(purpose: TokenPurpose): Date {
    const now = Date.now();
    if (purpose === 'EMAIL_VERIFICATION') {
      return new Date(now + this.config.get('EMAIL_VERIFICATION_TTL_HOURS') * 60 * 60 * 1000);
    }
    return new Date(now + this.config.get('PASSWORD_RESET_TTL_MINUTES') * 60 * 1000);
  }
}
