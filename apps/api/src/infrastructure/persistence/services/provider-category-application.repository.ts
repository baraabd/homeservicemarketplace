import { Injectable } from '@nestjs/common';
import type {
  PrismaTx,
  ProviderCategoryApplication,
  ProviderCategoryApplicationStatus,
  ServiceCategory,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Repository for ProviderCategoryApplication rows.
//
// Used by:
//   - admin/category-applications — list pending + review (approve/reject)
//   - provider/profile (future) — list a provider's own applications
//
// All admin-facing reads carry the join contexts the queue UI needs to
// render a row without a second round-trip:
//   - providerProfile.{id, displayName, userId} so the queue is scannable
//     by name
//   - serviceCategory.{id, slug, labelEn, labelAr} so the chip renders
//     directly
//
// Mutations are surface-tight: the only state transition exposed is
// `updateStatus`. A double-review guard lives in the service layer (we
// don't want to overwrite an APPROVED row through this method).
export type ProviderCategoryApplicationWithJoins = ProviderCategoryApplication & {
  providerProfile: { id: string; displayName: string; userId: string | null };
  serviceCategory: {
    id: string;
    slug: string;
    labelEn: string;
    labelAr: string;
  };
};

// The provider's own view. Carries the category (for the chip) and nothing
// about the provider — a provider reading their own applications already knows
// who they are.
export type ProviderCategoryApplicationWithCategory = ProviderCategoryApplication & {
  serviceCategory: ServiceCategory;
};

const ADMIN_INCLUDE = {
  providerProfile: { select: { id: true, displayName: true, userId: true } },
  serviceCategory: { select: { id: true, slug: true, labelEn: true, labelAr: true } },
} as const;

@Injectable()
export class ProviderCategoryApplicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  // Cursor-paginated. Default ordering is `createdAt DESC, id DESC` — the
  // queue surfaces the freshest applications first; the secondary id sort
  // makes the cursor monotonic when two rows share a millisecond.
  listForAdmin(
    args: { status?: ProviderCategoryApplicationStatus; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<ProviderCategoryApplicationWithJoins[]> {
    return this.db(tx).providerCategoryApplication.findMany({
      where: {
        ...(args.status ? { status: args.status } : {}),
      },
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: ADMIN_INCLUDE,
    }) as Promise<ProviderCategoryApplicationWithJoins[]>;
  }

  findByIdForAdmin(
    id: string,
    tx?: PrismaTx,
  ): Promise<ProviderCategoryApplicationWithJoins | null> {
    return this.db(tx).providerCategoryApplication.findUnique({
      where: { id },
      include: ADMIN_INCLUDE,
    }) as Promise<ProviderCategoryApplicationWithJoins | null>;
  }

  // Atomic status flip. `updatedAt` is bumped automatically by the
  // schema-level `@updatedAt`; the service layer uses the returned
  // row's timestamps to populate the response.
  updateStatus(
    id: string,
    status: ProviderCategoryApplicationStatus,
    tx?: PrismaTx,
  ): Promise<ProviderCategoryApplicationWithJoins> {
    return this.db(tx).providerCategoryApplication.update({
      where: { id },
      data: { status },
      include: ADMIN_INCLUDE,
    }) as Promise<ProviderCategoryApplicationWithJoins>;
  }

  // ── provider-scoped reads and writes (Sprint 2) ────────────────────────
  //
  // Every method below takes providerProfileId as its FIRST argument and
  // filters on it, rather than accepting an application id and checking
  // ownership afterwards. Ownership is therefore part of the query, not a
  // separate step a caller can forget: a provider asking for someone else's
  // application gets an empty result from the database, not a row plus a
  // reminder to check who it belongs to.

  // The provider's whole application history, newest first. Superseded rows
  // are included — the provider should be able to see why a duplicate
  // application of theirs is not holding a queue slot.
  listForProvider(
    providerProfileId: string,
    args: { status?: ProviderCategoryApplicationStatus } = {},
    tx?: PrismaTx,
  ): Promise<ProviderCategoryApplicationWithCategory[]> {
    return this.db(tx).providerCategoryApplication.findMany({
      where: {
        providerProfileId,
        ...(args.status ? { status: args.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { serviceCategory: true },
    }) as Promise<ProviderCategoryApplicationWithCategory[]>;
  }

  // The one application currently occupying this provider's pending slot for
  // this category, if any.
  //
  // The predicate matches the partial unique index
  // `provider_category_application_one_pending_uniq` exactly. That is not a
  // coincidence to preserve casually: this read exists to turn what would
  // otherwise be a raw unique-violation into a friendly 409, so if the two
  // predicates drift, the friendly path stops covering the constraint and
  // providers start seeing 500s instead.
  findLivePending(
    providerProfileId: string,
    serviceCategoryId: string,
    tx?: PrismaTx,
  ): Promise<ProviderCategoryApplication | null> {
    return this.db(tx).providerCategoryApplication.findFirst({
      where: { providerProfileId, serviceCategoryId, status: 'PENDING', supersededAt: null },
    });
  }

  createPending(
    providerProfileId: string,
    serviceCategoryId: string,
    tx?: PrismaTx,
  ): Promise<ProviderCategoryApplicationWithCategory> {
    return this.db(tx).providerCategoryApplication.create({
      // `status` is not accepted from anywhere — a new application is PENDING
      // by definition, and the column default is the only thing that sets it.
      data: { providerProfileId, serviceCategoryId },
      include: { serviceCategory: true },
    }) as Promise<ProviderCategoryApplicationWithCategory>;
  }

  // Idempotent join-row insert. Used when an application is APPROVED to
  // mirror the row into ProviderProfileServiceCategory so the provider's
  // public profile picks up the skill immediately. `skipDuplicates`
  // covers the legitimate retry case where the provider was already
  // attached via PATCH /v1/me/provider/profile categoryIds in parallel.
  async ensureProviderHasCategory(
    providerProfileId: string,
    serviceCategoryId: string,
    tx?: PrismaTx,
  ): Promise<void> {
    await this.db(tx).providerProfileServiceCategory.createMany({
      data: [{ providerProfileId, serviceCategoryId }],
      skipDuplicates: true,
    });
  }
}
