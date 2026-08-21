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
  // Live PENDING category applications, eager-loaded so every provider-profile
  // response can carry `pendingCategories`.
  //
  // It hangs off the shared include rather than being fetched separately by
  // whichever endpoint remembers to, because "the profile shows what's pending"
  // is a property of the profile read-model, not of one route. Attaching it
  // here means GET, PATCH, availability, and the onboarding responses all
  // report the same thing without four chances to diverge.
  categoryApplications: { serviceCategory: ServiceCategory }[];
};

const PROFILE_INCLUDE = {
  serviceCategories: { include: { serviceCategory: true } },
  // "Live pending" is narrower than status=PENDING: a superseded row is still
  // PENDING (no admin ever decided it) but it lost its slot to an identical
  // earlier application, so showing it would put two identical chips on the
  // provider's Skills screen. Same predicate as the partial unique index in
  // 20260822091000_sprint02_one_pending_category_application.
  categoryApplications: {
    where: { status: 'PENDING', supersededAt: null },
    include: { serviceCategory: true },
    orderBy: { createdAt: 'asc' },
  },
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

  // Sprint 7.x — list provider profiles that should receive a
  // notification when a seeker creates a new service request.
  // Eligibility mirrors the rules in `AvailableRequestsService.list`
  // strict mode so a provider only gets a notification for a request
  // that ALSO surfaces in their available-requests feed — no surprise
  // notifications without a matching feed entry.
  //
  // Filters (all must be true):
  //   - status = ACTIVE (DRAFT / PENDING_REVIEW / SUSPENDED / REJECTED
  //     do not receive notifications)
  //   - deletedAt IS NULL
  //   - userId IS NOT NULL (older detached seed rows are skipped —
  //     no userId means no surface to deliver to)
  //   - userId != excludeSeekerUserId (a provider who also happens
  //     to be the request's seeker on the same account must NEVER
  //     receive a notification for their own request)
  //   - profile has the request's categoryId in serviceCategories
  //     (when categoryId is non-null; null-category requests are
  //     custom-text only and do not target by category)
  //   - profile.serviceAreaCity (lowercase-trimmed) === cityKey
  //
  // Selecting only the userId keeps the projection narrow — the
  // notification fan-out doesn't need any other field, and a
  // narrow select is the privacy-safe default.
  listEligibleUserIdsForRequest(
    args: { categoryId: string | null; cityKey: string; excludeSeekerUserId: string },
    tx?: PrismaTx,
  ): Promise<{ userId: string }[]> {
    return this.db(tx).providerProfile.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        userId: { not: null, notIn: [args.excludeSeekerUserId] },
        // Case-insensitive city match: serviceAreaCity is stored in
        // display casing, so the comparison is done via Prisma's
        // `mode: 'insensitive'` filter on the equality.
        serviceAreaCity: { equals: args.cityKey, mode: 'insensitive' },
        ...(args.categoryId
          ? {
              serviceCategories: { some: { serviceCategoryId: args.categoryId } },
            }
          : {}),
      },
      select: { userId: true },
    }) as Promise<{ userId: string }[]>;
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

  // Used by an admin moderation surface. Bypasses `availability` — operators
  // flip status, providers flip availability.
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

  // Phase 4 — provider-initiated submission for review.
  //
  // Scoped to `status: 'DRAFT'` so the DRAFT → PENDING_REVIEW edge is atomic:
  // two concurrent submissions produce exactly one winner, and a profile an
  // admin has since suspended or rejected cannot be dragged back into the
  // queue by a stale client. Returns the affected row count; the caller treats
  // 0 as "not in a submittable state".
  async submitForReviewIfDraft(id: string, tx?: PrismaTx): Promise<number> {
    const result = await this.db(tx).providerProfile.updateMany({
      where: { id, status: 'DRAFT', deletedAt: null },
      data: {
        status: 'PENDING_REVIEW',
        submittedForReviewAt: new Date(),
        // A resubmission clears the previous rejection so the provider is not
        // shown a stale reason while their new application is queued.
        rejectionReason: null,
      },
    });
    return result.count;
  }

  // Phase 4 — provider withdraws their own queued application.
  //
  // The counterpart to the edit lock: because a PENDING_REVIEW profile cannot
  // be edited, the provider needs a visible way OUT of the queue. Scoped to
  // PENDING_REVIEW so it can never pull an already-approved or already-rejected
  // profile backwards.
  async withdrawFromReviewIfPending(id: string, tx?: PrismaTx): Promise<number> {
    const result = await this.db(tx).providerProfile.updateMany({
      where: { id, status: 'PENDING_REVIEW', deletedAt: null },
      data: { status: 'DRAFT', submittedForReviewAt: null },
    });
    return result.count;
  }

  // Phase 4 — admin decision on a submitted application.
  //
  // Scoped to the statuses each decision is legal from, so the state machine
  // is enforced by the WRITE rather than by a read-then-write that can race:
  //   DRAFT | PENDING_REVIEW | SUSPENDED  → REJECTED
  //   PENDING_REVIEW | SUSPENDED          → ACTIVE
  //   ACTIVE                              → SUSPENDED
  async decideIfInStatus(
    id: string,
    input: {
      from: ProviderProfileStatus[];
      to: ProviderProfileStatus;
      reviewedByUserId: string;
      rejectionReason: string | null;
    },
    tx?: PrismaTx,
  ): Promise<number> {
    const result = await this.db(tx).providerProfile.updateMany({
      where: { id, status: { in: input.from }, deletedAt: null },
      data: {
        status: input.to,
        reviewedAt: new Date(),
        reviewedByUserId: input.reviewedByUserId,
        rejectionReason: input.rejectionReason,
      },
    });
    return result.count;
  }

  // Sprint 6.2 — admin-facing review notes upsert. Takes the new
  // notes string verbatim (the controller's DTO already trimmed +
  // length-checked) and persists it on the row. An empty string is
  // stored as-is so the operator can clear the notes back to "".
  updateReviewNotesById(id: string, notes: string, tx?: PrismaTx): Promise<ProviderProfile> {
    return this.db(tx).providerProfile.update({
      where: { id, deletedAt: null },
      data: { reviewNotes: notes },
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
  // Sprint 2 — detach approved skills. REMOVAL ONLY, by design.
  //
  // This replaces `replaceServiceCategories`, which took the desired final set
  // and made it so. That primitive was the whole of the self-grant defect: the
  // profile PATCH handed it a client-supplied `categoryIds` array, so any
  // provider could award themselves any active category and appear in that
  // category's match results immediately, with no application and no admin
  // ever involved. The moderation queue sat beside it, unused and unenforced.
  //
  // Deleting the primitive rather than adding a check above it is deliberate.
  // A guarded write is only as good as every future caller remembering the
  // guard; a repository that has no method capable of granting a skill cannot
  // be talked into granting one. The only path that inserts into this join
  // table is now the admin approval in
  // AdminCategoryApplicationsService.review.
  //
  // No-ops on an empty list, and on ids the provider does not hold — removal is
  // idempotent so a double-submit from a flaky connection is not an error.
  async removeServiceCategories(
    providerProfileId: string,
    categoryIds: string[],
    tx?: PrismaTx,
  ): Promise<number> {
    if (categoryIds.length === 0) return 0;
    const { count } = await this.db(tx).providerProfileServiceCategory.deleteMany({
      where: { providerProfileId, serviceCategoryId: { in: categoryIds } },
    });
    return count;
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
