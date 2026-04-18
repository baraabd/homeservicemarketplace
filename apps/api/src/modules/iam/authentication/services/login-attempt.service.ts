import { Injectable } from '@nestjs/common';
import type { PrismaTx, User } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../../../config/app-config.service';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';

// Tracks consecutive failed logins per user and flips User.lockedUntil once
// the threshold is crossed. Runs inside the caller's transaction so success
// (reset) and failure (increment) are durable against concurrent logins.
@Injectable()
export class LoginAttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  isLocked(user: Pick<User, 'lockedUntil'>): boolean {
    return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
  }

  // Call on successful credential verification. Clears counters.
  async recordSuccess(userId: string, tx?: PrismaTx): Promise<void> {
    await (tx ?? this.prisma.client).user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  // Call on every failed attempt. Returns whether the user is now locked.
  async recordFailure(userId: string, tx?: PrismaTx): Promise<{ locked: boolean }> {
    const threshold = this.config.get('AUTH_LOCKOUT_THRESHOLD');
    const minutes = this.config.get('AUTH_LOCKOUT_MINUTES');
    const db = tx ?? this.prisma.client;
    const updated = await db.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount >= threshold) {
      await db.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + minutes * 60 * 1000) },
      });
      return { locked: true };
    }
    return { locked: false };
  }
}
