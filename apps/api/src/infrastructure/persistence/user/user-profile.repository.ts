import { Injectable } from '@nestjs/common';
import type { PrismaTx, UserProfile } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface UpsertUserProfileInput {
  avatarUrl?: string | null;
  phoneNumber?: string | null;
  bio?: string | null;
}

@Injectable()
export class UserProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  findByUserId(userId: string, tx?: PrismaTx): Promise<UserProfile | null> {
    return this.db(tx).userProfile.findUnique({ where: { userId } });
  }

  // Upsert keeps the "lazy create on first GET" path idempotent without a
  // read-then-write race — the userId unique index guarantees a single row.
  upsert(userId: string, input: UpsertUserProfileInput, tx?: PrismaTx): Promise<UserProfile> {
    return this.db(tx).userProfile.upsert({
      where: { userId },
      create: { userId, ...input },
      update: input,
    });
  }
}
