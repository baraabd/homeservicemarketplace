import { Injectable } from '@nestjs/common';
import type {
  ApplyForCategoryRequest,
  ApplyForCategoryResponse,
  ListMyCategoryApplicationsQuery,
  ListMyCategoryApplicationsResponse,
  ProviderCategoryApplicationSummary,
} from '@homeservicemarketplace/contracts';
import { Prisma } from '@homeservicemarketplace/database';

import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import {
  ProviderCategoryApplicationRepository,
  type ProviderCategoryApplicationWithCategory,
} from '../../../infrastructure/persistence/services/provider-category-application.repository';
import { ServiceCategoryRepository } from '../../../infrastructure/persistence/services/service-category.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { AuditService } from '../../iam/audit/audit.service';

// Sprint 2 — the provider half of skill moderation.
//
// A provider ASKS for a category here; an admin GRANTS it in
// AdminCategoryApplicationsService. Those are the only two operations that
// exist, and they live on opposite sides of an authorization boundary on
// purpose. Before this sprint the asking step was optional: PATCH
// /v1/me/provider/profile accepted a categoryIds array and wrote it straight
// into the join table, so a provider could grant themselves any active
// category and start receiving matched jobs in it immediately. The moderation
// queue existed and was simply never on the path.
//
// Ownership here is structural rather than checked. Every method resolves the
// provider profile from the SESSION user id and then passes that profile id
// into repository methods that filter on it. No route accepts a
// providerProfileId, so there is no identifier for a caller to substitute.
@Injectable()
export class ProviderCategoriesService {
  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly applications: ProviderCategoryApplicationRepository,
    private readonly categories: ServiceCategoryRepository,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  // POST /v1/me/provider/categories/applications
  async apply(userId: string, input: ApplyForCategoryRequest): Promise<ApplyForCategoryResponse> {
    const created = await this.tx
      .run(async (tx) => {
        const profile = await this.providers.findByUserIdWithCategories(userId, tx);
        if (!profile) {
          throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
        }

        const category = await this.resolveCategory(input, tx);

        // Already granted. Returning 409 rather than quietly creating a second
        // application keeps the admin queue free of work that cannot change
        // anything.
        const alreadyApproved = profile.serviceCategories.some(
          (link) => link.serviceCategoryId === category.id,
        );
        if (alreadyApproved) {
          throw new AppError('CONFLICT', 'You already offer this service category.', 409);
        }

        // Friendly path for the common case. The database enforces the same rule
        // via a partial unique index, but a caller who simply pressed the button
        // twice deserves a clear 409 rather than a constraint violation.
        const pending = await this.applications.findLivePending(profile.id, category.id, tx);
        if (pending) {
          throw new AppError(
            'CONFLICT',
            'You already have a pending application for this service category.',
            409,
          );
        }

        const application = await this.applications.createPending(profile.id, category.id, tx);

        // In the same transaction as the insert: an application that exists with
        // no record of who asked for it is exactly the gap the audit trail is
        // meant to close, and a fire-and-forget write reintroduces it on every
        // failed commit.
        await this.audit.record(
          {
            type: 'PROVIDER_CATEGORY_APPLIED',
            userId,
            metadata: {
              applicationId: application.id,
              providerProfileId: profile.id,
              serviceCategoryId: category.id,
              categorySlug: category.slug,
            },
          },
          tx,
        );

        return application;
      })
      .catch((err: unknown) => {
        // The concurrency case: two applications for the same category racing
        // each other. Both pass the findLivePending check — READ COMMITTED does
        // not prevent that — and the partial unique index rejects the loser.
        // Presenting that as the same 409 the sequential path returns is what
        // makes the race invisible to the client instead of a 500.
        if (isDuplicatePendingApplication(err)) {
          throw new AppError(
            'CONFLICT',
            'You already have a pending application for this service category.',
            409,
          );
        }
        throw err;
      });

    return { application: toApplicationSummary(created) };
  }

  // GET /v1/me/provider/categories/applications
  async listMine(
    userId: string,
    query: ListMyCategoryApplicationsQuery,
  ): Promise<ListMyCategoryApplicationsResponse> {
    const profile = await this.providers.findByUserId(userId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const rows = await this.applications.listForProvider(profile.id, { status: query.status });
    return { items: rows.map(toApplicationSummary) };
  }

  // Either a category id or its slug may be sent; id wins when both are
  // present. An unknown or inactive category is a 400 rather than a 404: the
  // request is malformed with respect to the live catalog, and distinguishing
  // "no such category" from "category exists but is retired" would tell an
  // unauthenticated-adjacent caller more about the catalog than they need.
  private async resolveCategory(
    input: ApplyForCategoryRequest,
    tx: Parameters<Parameters<TransactionRunner['run']>[0]>[0],
  ) {
    const { categoryId, categorySlug } = input;
    if (!categoryId && !categorySlug) {
      throw new AppError('VALIDATION_ERROR', 'Provide either categoryId or categorySlug.', 400);
    }
    const found = categoryId
      ? await this.categories.findById(categoryId, tx)
      : await this.categories.findBySlug(categorySlug!, tx);

    if (!found || !found.isActive || found.deletedAt !== null) {
      throw new AppError(
        'VALIDATION_ERROR',
        'That service category was not found or is not currently available.',
        400,
      );
    }
    return found;
  }
}

export function toApplicationSummary(
  row: ProviderCategoryApplicationWithCategory,
): ProviderCategoryApplicationSummary {
  return {
    id: row.id,
    status: row.status,
    category: {
      id: row.serviceCategory.id,
      slug: row.serviceCategory.slug,
      labelEn: row.serviceCategory.labelEn,
      labelAr: row.serviceCategory.labelAr,
      icon: row.serviceCategory.icon,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    supersededAt: row.supersededAt ? row.supersededAt.toISOString() : null,
  };
}

// True when the error is `provider_category_application_one_pending_uniq`
// firing. Matched on Prisma's stable P2002 code plus the index name from
// 20260822091000, so an unrelated unique violation elsewhere in the
// transaction is never misreported as "you already applied".
function isDuplicatePendingApplication(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = (err.meta as { target?: string | string[] } | undefined)?.target;
  if (typeof target === 'string') {
    return target.includes('provider_category_application_one_pending');
  }
  if (Array.isArray(target)) {
    return target.some((t) => t.includes('provider_category_application_one_pending'));
  }
  // Some engine versions omit the constraint name for partial indexes. This
  // service's only unique-constrained insert is the application row, so a
  // P2002 reaching here with no target can only be that index.
  return true;
}
