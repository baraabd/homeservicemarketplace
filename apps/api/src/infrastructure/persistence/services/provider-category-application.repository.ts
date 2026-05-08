import { Injectable } from '@nestjs/common';
import type {
  PrismaTx,
  ProviderCategoryApplication,
  ProviderCategoryApplicationStatus,
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
