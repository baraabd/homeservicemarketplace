import { Injectable } from '@nestjs/common';
import type { PrismaTx, UserProfile } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Editable profile fields the user owns: phone / city / bio / avatar.
// firstName / lastName / email live on User and are updated through
// UserRepository.update — kept separate so the auth surface and the
// editable profile surface stay decoupled.
export interface UpsertUserProfileInput {
  userId: string;
  phoneNumber?: string | null;
  city?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
}

@Injectable()
export class UserProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  // Single source of truth for "the seeker's editable profile row".
  // Returns null when the user has never had a profile row written —
  // the service treats that the same as an all-null profile.
  findByUserId(userId: string, tx?: PrismaTx): Promise<UserProfile | null> {
    return this.db(tx).userProfile.findUnique({ where: { userId } });
  }

  // Upsert keyed on userId. The first PATCH against a user without a
  // profile row writes a new one; subsequent PATCHes update in place.
  // Only the fields that were supplied are written — fields the
  // service didn't pass keep their existing value (or remain null on
  // the create path).
  upsertByUserId(input: UpsertUserProfileInput, tx?: PrismaTx): Promise<UserProfile> {
    const update: Record<string, string | null> = {};
    if (input.phoneNumber !== undefined) update.phoneNumber = input.phoneNumber;
    if (input.city !== undefined) update.city = input.city;
    if (input.bio !== undefined) update.bio = input.bio;
    if (input.avatarUrl !== undefined) update.avatarUrl = input.avatarUrl;

    return this.db(tx).userProfile.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        phoneNumber: input.phoneNumber ?? null,
        city: input.city ?? null,
        bio: input.bio ?? null,
        avatarUrl: input.avatarUrl ?? null,
      },
      update,
    });
  }
}
