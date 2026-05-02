import { Injectable } from '@nestjs/common';
import type {
  Prisma,
  PrismaTx,
  ProviderProfile,
  ProviderAvailability,
  ProviderProfileServiceCategory,
  ProviderProfileStatus,
  ServiceCategory,
} from '@homeservicemarketplace/database';

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

// Sprint 5 slice 5.1 introduces a real provider sign-up path; the upgrade
// service writes new ProviderProfile rows linked to the upgrading user.
// `id` is left to Prisma's cuid default — only the userId is required to
// pin the row to its session.
export interface CreateProviderProfileInput {
  userId: string;
  displayName: string;
  initials: string;
  // Optional status override. Defaults to the column default (DRAFT) when
  // omitted. The /v1/me/provider/upgrade service explicitly passes
  // ACTIVE for the local/dev auto-approval flow; production will tighten
  // to PENDING_REVIEW once admin moderation lands.
  status?: ProviderProfileStatus;
}

// PATCH /v1/me/provider/profile body. Every field is optional so the
// caller can send a partial PATCH. `null` clears an optional column;
// `undefined` leaves it untouched.
export interface UpdateProviderProfileInput {
  displayName?: string;
  bio?: string | null;
  headline?: string | null;
  phoneNumber?: string | null;
  serviceAreaCity?: string | null;
  serviceAreaCountry?: string | null;
  serviceAreaLat?: number | null;
  serviceAreaLng?: number | null;
  serviceAreaRadiusKm?: number | null;
}

// Returned by the read paths so the service layer can hand the controller
// a single denormalised row + its category links without a second query.
export type ProviderProfileWithCategories = ProviderProfile & {
  serviceCategories: (ProviderProfileServiceCategory & {
    serviceCategory: ServiceCategory;
  })[];
};

const PROFILE_INCLUDE = {
  serviceCategories: { include: { serviceCategory: true } },
} as const;

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

  // Single source of truth for "the provider profile attached to this
  // user". The `userId` index is unique so only one row can ever match;
  // soft-deleted rows are filtered out so a re-upgrade after delete will
  // create a fresh record (currently unreachable — provider profiles
  // are never soft-deleted in slice 5.1 — but the filter is consistent
  // with the rest of the persistence layer).
  findByUserId(userId: string, tx?: PrismaTx): Promise<ProviderProfile | null> {
    return this.db(tx).providerProfile.findFirst({
      where: { userId, deletedAt: null },
    });
  }

  findByUserIdWithCategories(
    userId: string,
    tx?: PrismaTx,
  ): Promise<ProviderProfileWithCategories | null> {
    return this.db(tx).providerProfile.findFirst({
      where: { userId, deletedAt: null },
      include: PROFILE_INCLUDE,
    }) as Promise<ProviderProfileWithCategories | null>;
  }

  findByIdWithCategories(id: string, tx?: PrismaTx): Promise<ProviderProfileWithCategories | null> {
    return this.db(tx).providerProfile.findFirst({
      where: { id, deletedAt: null },
      include: PROFILE_INCLUDE,
    }) as Promise<ProviderProfileWithCategories | null>;
  }

  // Used by /upgrade. The service layer guarantees no row exists for the
  // user before calling — we keep the create simple and let the
  // userId-unique index catch a race-condition retry.
  createForUser(input: CreateProviderProfileInput, tx?: PrismaTx): Promise<ProviderProfile> {
    return this.db(tx).providerProfile.create({
      data: {
        userId: input.userId,
        displayName: input.displayName,
        initials: input.initials,
        // availability defaults to OFFLINE in the schema — be explicit
        // here so the row's intent is obvious from the application
        // layer too.
        availability: 'OFFLINE',
        ...(input.status ? { status: input.status } : {}),
      },
    });
  }

  // Used by an admin moderation surface (out of scope for this slice;
  // shipped now so the field has a single repository owner). Bypasses
  // `availability` — operators flip status, providers flip availability.
  updateStatusById(
    id: string,
    status: ProviderProfileStatus,
    tx?: PrismaTx,
  ): Promise<ProviderProfile> {
    return this.db(tx).providerProfile.update({
      where: { id, deletedAt: null },
      data: { status },
    });
  }

  updateById(
    id: string,
    input: UpdateProviderProfileInput,
    tx?: PrismaTx,
  ): Promise<ProviderProfile> {
    const data: Prisma.ProviderProfileUpdateInput = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.bio !== undefined) data.bio = input.bio;
    if (input.headline !== undefined) data.headline = input.headline;
    if (input.phoneNumber !== undefined) data.phoneNumber = input.phoneNumber;
    if (input.serviceAreaCity !== undefined) data.serviceAreaCity = input.serviceAreaCity;
    if (input.serviceAreaCountry !== undefined) data.serviceAreaCountry = input.serviceAreaCountry;
    if (input.serviceAreaLat !== undefined) data.serviceAreaLat = input.serviceAreaLat;
    if (input.serviceAreaLng !== undefined) data.serviceAreaLng = input.serviceAreaLng;
    if (input.serviceAreaRadiusKm !== undefined)
      data.serviceAreaRadiusKm = input.serviceAreaRadiusKm;
    return this.db(tx).providerProfile.update({
      where: { id, deletedAt: null },
      data,
    });
  }

  updateAvailabilityById(
    id: string,
    availability: ProviderAvailability,
    tx?: PrismaTx,
  ): Promise<ProviderProfile> {
    return this.db(tx).providerProfile.update({
      where: { id, deletedAt: null },
      data: { availability },
    });
  }

  // Replaces the provider's full set of service categories. Set
  // semantics — sending an empty array clears all categories. Done as
  // delete-all-then-create-many inside the caller's transaction so the
  // join table is never partially updated.
  async replaceServiceCategories(
    providerProfileId: string,
    categoryIds: string[],
    tx?: PrismaTx,
  ): Promise<void> {
    const db = this.db(tx);
    await db.providerProfileServiceCategory.deleteMany({ where: { providerProfileId } });
    if (categoryIds.length === 0) return;
    await db.providerProfileServiceCategory.createMany({
      data: categoryIds.map((serviceCategoryId) => ({
        providerProfileId,
        serviceCategoryId,
      })),
    });
  }

  // Sprint 6.2: cursor-paginated list for admin verification queue.
  // Eager-loads the linked user (id + email) so the admin row can
  // map the profile back to the account.
  listForAdmin(
    args: { status?: ProviderProfileStatus; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<(ProviderProfile & { user: { id: string; email: string } | null })[]> {
    return this.db(tx).providerProfile.findMany({
      where: {
        deletedAt: null,
        ...(args.status ? { status: args.status } : {}),
      },
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { user: { select: { id: true, email: true } } },
    }) as Promise<(ProviderProfile & { user: { id: string; email: string } | null })[]>;
  }

  findByIdForAdmin(
    id: string,
    tx?: PrismaTx,
  ): Promise<(ProviderProfile & { user: { id: string; email: string } | null }) | null> {
    return this.db(tx).providerProfile.findFirst({
      where: { id, deletedAt: null },
      include: { user: { select: { id: true, email: true } } },
    }) as Promise<(ProviderProfile & { user: { id: string; email: string } | null }) | null>;
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
