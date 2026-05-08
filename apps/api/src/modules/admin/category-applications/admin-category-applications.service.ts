import { Injectable } from '@nestjs/common';
import type {
  ListPendingCategoriesQuery,
  ListPendingCategoriesResponse,
  PendingCategorySummary,
  ReviewCategoryApplicationRequest,
} from '@homeservicemarketplace/contracts';

import {
  ProviderCategoryApplicationRepository,
  type ProviderCategoryApplicationWithJoins,
} from '../../../infrastructure/persistence/services/provider-category-application.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';

const DEFAULT_PAGE_SIZE = 20;

// Sprint 7.x — Admin category-application moderation.
//
// The provider-side `apply for a category` flow writes a PENDING
// ProviderCategoryApplication row that the admin queue picks up here.
// Admin reviews resolve to either APPROVED (mirror into the
// ProviderProfileServiceCategory join table so the public profile
// picks up the skill immediately) or REJECTED (status flipped, no
// join-table mutation; the row stays as audit history).
//
// Atomicity: APPROVE must flip the status AND mirror the join-row in
// one transaction. A half-applied state (status=APPROVED but no join
// row) would silently strand the provider — the public profile would
// never expose the skill. The transaction also covers the
// already-attached idempotent retry, so two parallel APPROVE calls
// can't double-write the join row.
@Injectable()
export class AdminCategoryApplicationsService {
  constructor(
    private readonly applications: ProviderCategoryApplicationRepository,
    private readonly tx: TransactionRunner,
  ) {}

  async list(query: ListPendingCategoriesQuery): Promise<ListPendingCategoriesResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    // Default to PENDING — that's the operator's queue. The same
    // endpoint serves APPROVED / REJECTED for the audit-history views.
    const status = query.status ?? 'PENDING';
    const rows = await this.applications.listForAdmin({
      status,
      take: take + 1, // +1 to detect a next page
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items = page.map(toSummary);
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async review(
    applicationId: string,
    input: ReviewCategoryApplicationRequest,
  ): Promise<PendingCategorySummary> {
    const result = await this.tx.run(async (tx) => {
      const existing = await this.applications.findByIdForAdmin(applicationId, tx);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Category application not found.', 404);
      }
      // Double-review guard. Once APPROVED or REJECTED the row is the
      // historical record of that decision; a second admin attempting
      // to flip it back must use a fresh application instead, so the
      // audit trail stays linear.
      if (existing.status !== 'PENDING') {
        throw new AppError('CONFLICT', 'This application has already been reviewed.', 409);
      }

      if (input.action === 'APPROVE') {
        // Mirror the join row FIRST so a Prisma error on the unique
        // (providerProfileId, serviceCategoryId) constraint surfaces
        // before we flip the status. `ensureProviderHasCategory` is
        // idempotent (skipDuplicates), covering the case where the
        // provider was already attached via PATCH /me/provider/profile
        // categoryIds in parallel.
        await this.applications.ensureProviderHasCategory(
          existing.providerProfileId,
          existing.serviceCategoryId,
          tx,
        );
        return this.applications.updateStatus(applicationId, 'APPROVED', tx);
      }

      // REJECT — no join-table mutation. The row stays so a future
      // re-apply can show prior context.
      return this.applications.updateStatus(applicationId, 'REJECTED', tx);
    });
    return toSummary(result);
  }
}

// Persistence row → wire DTO.
function toSummary(row: ProviderCategoryApplicationWithJoins): PendingCategorySummary {
  return {
    id: row.id,
    providerProfileId: row.providerProfileId,
    providerDisplayName: row.providerProfile.displayName,
    serviceCategoryId: row.serviceCategoryId,
    serviceCategorySlug: row.serviceCategory.slug,
    serviceCategoryLabelEn: row.serviceCategory.labelEn,
    serviceCategoryLabelAr: row.serviceCategory.labelAr,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
