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
import { AdminAuditService } from '../admin-audit.service';

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
    private readonly audit: AdminAuditService,
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

  // `adminUserId` is the reviewing admin, taken from their session by the
  // controller. It is the subject of the audit record — "who decided this" is
  // the question the record exists to answer, and it is unanswerable if the
  // actor is not threaded through.
  async review(
    adminUserId: string,
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
        const approved = await this.applications.updateStatus(applicationId, 'APPROVED', tx);
        await this.recordDecision(adminUserId, 'ADMIN_CATEGORY_APPLICATION_APPROVED', approved, tx);
        return approved;
      }

      // REJECT — no join-table mutation. The row stays so a future
      // re-apply can show prior context.
      const rejected = await this.applications.updateStatus(applicationId, 'REJECTED', tx);
      await this.recordDecision(adminUserId, 'ADMIN_CATEGORY_APPLICATION_REJECTED', rejected, tx);
      return rejected;
    });
    return toSummary(result);
  }

  // Inside the caller's transaction, always.
  //
  // Granting someone a skill and recording that you granted it are one act,
  // and the audit trail is the only durable answer to "who let this provider
  // into this category". Writing it after the transaction commits would mean
  // any failure in between leaves a provider newly able to bid in a category
  // with nothing on record — which is precisely the state this sprint exists
  // to make impossible. So it commits with the decision or not at all.
  private async recordDecision(
    adminUserId: string,
    type: 'ADMIN_CATEGORY_APPLICATION_APPROVED' | 'ADMIN_CATEGORY_APPLICATION_REJECTED',
    row: ProviderCategoryApplicationWithJoins,
    tx: Parameters<Parameters<TransactionRunner['run']>[0]>[0],
  ): Promise<void> {
    await this.audit.record(
      {
        adminUserId,
        type,
        metadata: {
          applicationId: row.id,
          providerProfileId: row.providerProfileId,
          serviceCategoryId: row.serviceCategoryId,
          categorySlug: row.serviceCategory.slug,
          previousStatus: 'PENDING',
          newStatus: row.status,
        },
      },
      tx,
    );
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
