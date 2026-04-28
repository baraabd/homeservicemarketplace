import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaTx, ProviderProfile } from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface UpsertProviderProfileInput {
  // Upsert key — typically the slug-style external id used by the
  // dev seed and (later) the Provider sign-up flow. Slice 2.1 only
  // uses this from the seed script.
  id: string;
  userId?: string | null;
  displayName: string;
  initials: string;
  avatarUrl?: string | null;
  ratingAvg?: number;
  reviewCount?: number;
  completedJobs?: number;
  verified?: boolean;
  topPro?: boolean;
}

// Provider read-model persistence. Slice-2.1 surface is read-only from
// the API; writes only happen via the seed script.
@Injectable()
export class ProviderProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  findById(id: string, tx?: PrismaTx): Promise<ProviderProfile | null> {
    return this.db(tx).providerProfile.findFirst({
      where: { id, deletedAt: null },
    });
  }

  upsert(input: UpsertProviderProfileInput, tx?: PrismaTx): Promise<ProviderProfile> {
    const data: Prisma.ProviderProfileCreateInput = {
      id: input.id,
      displayName: input.displayName,
      initials: input.initials,
      avatarUrl: input.avatarUrl ?? null,
      ratingAvg: input.ratingAvg ?? 0,
      reviewCount: input.reviewCount ?? 0,
      completedJobs: input.completedJobs ?? 0,
      verified: input.verified ?? false,
      topPro: input.topPro ?? false,
      ...(input.userId ? { user: { connect: { id: input.userId } } } : {}),
    };
    return this.db(tx).providerProfile.upsert({
      where: { id: input.id },
      update: {
        displayName: data.displayName,
        initials: data.initials,
        avatarUrl: data.avatarUrl,
        ratingAvg: data.ratingAvg,
        reviewCount: data.reviewCount,
        completedJobs: data.completedJobs,
        verified: data.verified,
        topPro: data.topPro,
      },
      create: data,
    });
  }
}
