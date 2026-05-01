import { Injectable } from '@nestjs/common';
import type {
  GetProviderProfileResponse,
  ProviderProfileSummary,
  ProviderServiceCategoryRef,
  UpdateProviderAvailabilityRequest,
  UpdateProviderAvailabilityResponse,
  UpdateProviderProfileRequest,
  UpdateProviderProfileResponse,
  UpgradeToProviderResponse,
} from '@homeservicemarketplace/contracts';
import type {
  ProviderAvailability,
  ProviderProfileStatus,
  User,
} from '@homeservicemarketplace/database';

import { ServiceCategoryRepository } from '../../infrastructure/persistence/services/service-category.repository';
import { RoleRepository } from '../../infrastructure/persistence/iam/role.repository';
import { UserRepository } from '../../infrastructure/persistence/iam/user.repository';
import {
  ProviderProfileRepository,
  type ProviderProfileWithCategories,
} from '../../infrastructure/persistence/bids/provider-profile.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';

const PROVIDER_ROLE_NAME = 'provider';

// Sprint 5.1.2: the status the upgrade service stamps onto a freshly
// created ProviderProfile. The schema default is DRAFT (safe-by-default
// for any direct INSERT). The /upgrade flow explicitly stamps ACTIVE
// here for local/dev so the onboarding UX drops the user straight into
// the live Provider shell. Production will flip this single constant to
// `'PENDING_REVIEW'` once the admin moderation surface ships — no other
// call-site touches the column.
const UPGRADE_DEFAULT_STATUS: ProviderProfileStatus = 'ACTIVE';

// Provider profile service. Drives the four endpoints in slice 5.1:
//   POST  /v1/me/provider/upgrade     — deliberate role + profile creation
//   GET   /v1/me/provider/profile     — read
//   PATCH /v1/me/provider/profile     — write profile + (optional) skills
//   PATCH /v1/me/provider/availability — single-field write
//
// Every method that returns a profile maps it through `toSummary` so the
// wire shape never includes denormalised infra columns (`userId`,
// timestamps in raw form, soft-delete columns) and so a future change to
// the Prisma schema cannot accidentally leak.
@Injectable()
export class ProviderService {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly providers: ProviderProfileRepository,
    private readonly categories: ServiceCategoryRepository,
    private readonly tx: TransactionRunner,
  ) {}

  // ─── upgrade ───────────────────────────────────────────────────────────────
  // Idempotent. Inside one transaction:
  //   1. resolve the seeded `provider` role (fail loudly if absent —
  //      operator must run `pnpm seed`).
  //   2. assign the role to the user (upsert; second call is a no-op).
  //   3. create a ProviderProfile keyed to the user if none exists, with
  //      derived display name + initials.
  //   4. return the (with-categories) summary.
  async upgrade(userId: string): Promise<UpgradeToProviderResponse> {
    const result = await this.tx.run(async (tx) => {
      const user = await this.users.findById(userId, tx);
      if (!user) {
        // Should be unreachable — JwtAuthGuard already validated the
        // session — but defend against a concurrent soft-delete.
        throw new AppError('NOT_FOUND', 'User not found.', 404);
      }

      const providerRole = await this.roles.findByName(PROVIDER_ROLE_NAME, tx);
      if (!providerRole) {
        // Seed not applied. We cannot self-heal this — the role row is
        // a curated catalog entry — so we surface a clean internal
        // error rather than silently succeeding.
        throw new AppError(
          'INTERNAL_ERROR',
          'Provider role is not configured. Run the database seed.',
          500,
        );
      }

      await this.users.assignRole(userId, providerRole.id, tx);

      const existing = await this.providers.findByUserIdWithCategories(userId, tx);
      if (existing) {
        return existing;
      }

      const created = await this.providers.createForUser(
        {
          userId,
          displayName: deriveDisplayName(user),
          initials: deriveInitials(user),
          status: UPGRADE_DEFAULT_STATUS,
        },
        tx,
      );
      const fresh = await this.providers.findByIdWithCategories(created.id, tx);
      // The findById right after the create cannot return null in the
      // same transaction — but if Prisma surprises us, we'd rather throw
      // a clean error than render a half-built summary.
      if (!fresh) throw new AppError('INTERNAL_ERROR', 'Failed to load provider profile.', 500);
      return fresh;
    });

    return { profile: toSummary(result) };
  }

  // ─── get ───────────────────────────────────────────────────────────────────
  async get(userId: string): Promise<GetProviderProfileResponse> {
    const profile = await this.providers.findByUserIdWithCategories(userId);
    if (!profile) {
      // RolesGuard already returned 403 for non-providers — this 404
      // covers the corner case where a user has the `provider` role
      // attached but the profile row is missing (manual DB edit, or a
      // future role-without-profile flow). The frontend treats it as
      // "needs upgrade".
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    return { profile: toSummary(profile) };
  }

  // ─── update profile ────────────────────────────────────────────────────────
  // Inside one $transaction so the profile-row UPDATE and the join-table
  // REPLACE either both succeed or both roll back. categoryIds, when
  // present, are validated against the active service-catalog before any
  // write — an unknown / inactive id surfaces as a single 400 with the
  // first offending id, never a Prisma FK violation.
  async update(
    userId: string,
    input: UpdateProviderProfileRequest,
  ): Promise<UpdateProviderProfileResponse> {
    const result = await this.tx.run(async (tx) => {
      const profile = await this.providers.findByUserIdWithCategories(userId, tx);
      if (!profile) {
        throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
      }

      if (input.categoryIds !== undefined) {
        await this.assertCategoryIdsValid(input.categoryIds, tx);
      }

      const profileFieldsTouched =
        input.displayName !== undefined ||
        input.bio !== undefined ||
        input.headline !== undefined ||
        input.phoneNumber !== undefined ||
        input.serviceAreaCity !== undefined ||
        input.serviceAreaCountry !== undefined ||
        input.serviceAreaLat !== undefined ||
        input.serviceAreaLng !== undefined ||
        input.serviceAreaRadiusKm !== undefined;

      if (profileFieldsTouched) {
        await this.providers.updateById(
          profile.id,
          {
            displayName: input.displayName,
            bio: input.bio,
            headline: input.headline,
            phoneNumber: input.phoneNumber,
            serviceAreaCity: input.serviceAreaCity,
            serviceAreaCountry: input.serviceAreaCountry,
            serviceAreaLat: input.serviceAreaLat,
            serviceAreaLng: input.serviceAreaLng,
            serviceAreaRadiusKm: input.serviceAreaRadiusKm,
          },
          tx,
        );
      }

      if (input.categoryIds !== undefined) {
        await this.providers.replaceServiceCategories(profile.id, input.categoryIds, tx);
      }

      const fresh = await this.providers.findByIdWithCategories(profile.id, tx);
      if (!fresh) throw new AppError('INTERNAL_ERROR', 'Failed to reload provider profile.', 500);
      return fresh;
    });

    return { profile: toSummary(result) };
  }

  // ─── update availability ───────────────────────────────────────────────────
  async updateAvailability(
    userId: string,
    input: UpdateProviderAvailabilityRequest,
  ): Promise<UpdateProviderAvailabilityResponse> {
    const result = await this.tx.run(async (tx) => {
      const profile = await this.providers.findByUserId(userId, tx);
      if (!profile) {
        throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
      }
      await this.providers.updateAvailabilityById(
        profile.id,
        input.availability as ProviderAvailability,
        tx,
      );
      const fresh = await this.providers.findByIdWithCategories(profile.id, tx);
      if (!fresh) throw new AppError('INTERNAL_ERROR', 'Failed to reload provider profile.', 500);
      return fresh;
    });
    return { profile: toSummary(result) };
  }

  // ─── helpers ───────────────────────────────────────────────────────────────
  private async assertCategoryIdsValid(
    categoryIds: string[],
    tx: Parameters<TransactionRunner['run']>[0] extends (tx: infer T) => unknown ? T : never,
  ): Promise<void> {
    // Empty array clears all skills — that's allowed.
    if (categoryIds.length === 0) return;
    for (const id of categoryIds) {
      // The DTO already enforces `IsString` + dedup; we still need to
      // confirm each one points at an active, non-deleted category.
      const found = await this.categories.findById(id, tx);
      if (!found || !found.isActive) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Service category "${id}" not found or inactive.`,
          400,
        );
      }
    }
  }
}

// ─── DTO mapper ──────────────────────────────────────────────────────────────
function toSummary(row: ProviderProfileWithCategories): ProviderProfileSummary {
  const categories: ProviderServiceCategoryRef[] = row.serviceCategories.map((link) => ({
    id: link.serviceCategory.id,
    slug: link.serviceCategory.slug,
    labelEn: link.serviceCategory.labelEn,
    labelAr: link.serviceCategory.labelAr,
    icon: link.serviceCategory.icon,
  }));
  return {
    id: row.id,
    displayName: row.displayName,
    initials: row.initials,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
    headline: row.headline,
    phoneNumber: row.phoneNumber,
    ratingAvg: row.ratingAvg,
    reviewCount: row.reviewCount,
    completedJobs: row.completedJobs,
    verified: row.verified,
    topPro: row.topPro,
    availability: row.availability,
    status: row.status,
    serviceAreaCity: row.serviceAreaCity,
    serviceAreaCountry: row.serviceAreaCountry,
    serviceAreaLat: row.serviceAreaLat,
    serviceAreaLng: row.serviceAreaLng,
    serviceAreaRadiusKm: row.serviceAreaRadiusKm,
    serviceCategories: categories,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Match the existing seeker / auth derivers so a user who upgrades sees
// the same identity strings the Seeker app shows. Provider can later
// edit the displayName via PATCH.
function deriveDisplayName(user: User): string {
  const first = (user.firstName ?? '').trim();
  const last = (user.lastName ?? '').trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  const local = (user.email ?? '').split('@')[0]?.trim();
  return local && local.length > 0 ? local : '';
}

function deriveInitials(user: User): string {
  const first = (user.firstName ?? '').trim();
  const last = (user.lastName ?? '').trim();
  if (first && last) return (first[0]! + last[0]!).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  if (last) return last.slice(0, 2).toUpperCase();
  const local = (user.email ?? '').split('@')[0]?.trim() ?? '';
  return local.slice(0, 2).toUpperCase();
}
