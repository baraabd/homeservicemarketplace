import { Injectable } from '@nestjs/common';
import type {
  GetProviderProfileResponse,
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
import { ProviderProfileRepository } from '../../infrastructure/persistence/bids/provider-profile.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import { toProviderProfileSummary as toSummary } from './provider-profile.mapper';

const PROVIDER_ROLE_NAME = 'provider';

// Sprint 7.x — city centroid fallback table.
//
// When the provider sets `serviceAreaCity` without explicit lat/lng,
// the provider feed and the LiveJobs map default to a globally-relevant
// fallback (Riyadh) regardless of where the provider actually works.
// That ships a wrong-feeling default to providers in cities the
// platform serves heavily (Aleppo today, Damascus shortly).
//
// Solution: a small hand-curated map keyed by lowercased-trimmed city
// name. When the update payload touches the city and we don't already
// have coords (neither in the patch NOR on the existing row), we fill
// them from this table so every market's UX defaults to its own
// centroid. Coordinates are city-level (no district precision); the
// `available-requests` filter still matches on `cityKey` exactly, so
// these fallbacks affect map centering only — not the matching key.
//
// Lower-bound principle: only cities the seed / known operators
// already use. Adding a city here is fine; over-listing risks pretending
// we serve markets we don't yet, and the lookup is O(n) by design so
// a wrong entry stays cheap to remove.
const CITY_CENTROIDS: Readonly<Record<string, [number, number]>> = {
  riyadh: [24.7136, 46.6753],
  jeddah: [21.4858, 39.1925],
  aleppo: [36.2012, 37.1612],
  damascus: [33.5138, 36.2765],
  gothenburg: [57.7089, 11.9746],
};

function lookupCityCentroid(city: string): [number, number] | null {
  const key = city.trim().toLowerCase();
  return CITY_CENTROIDS[key] ?? null;
}

// Phase 4 — the status /upgrade stamps onto a freshly created
// ProviderProfile.
//
// History of this line, because both previous values were wrong in different
// directions:
//   ACTIVE          — auto-approved every self-upgraded provider, which made
//                     ProviderActiveGuard a no-op.
//   PENDING_REVIEW  — no longer auto-approves, but puts an EMPTY profile into
//                     the admin review queue the instant someone clicks
//                     "become a provider". Reviewers then look at a row with
//                     no headline, no bio, no service area, and no categories,
//                     and PENDING_REVIEW stops meaning "a complete application
//                     was submitted".
//
// An upgrade is not an application. It grants the provider role and opens a
// DRAFT profile the provider fills in; PENDING_REVIEW is reached only through
// the explicit POST /v1/me/provider/submit-for-review, which enforces the
// completeness policy first. No other call-site touches the column.
const UPGRADE_DEFAULT_STATUS: ProviderProfileStatus = 'DRAFT';

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

      // Phase 4 — a submitted application is LOCKED while it sits in the
      // review queue.
      //
      // The alternative the spec allows (edit silently returns it to DRAFT)
      // was rejected: it makes the provider's application vanish from the
      // queue without telling them, and lets someone change what a reviewer is
      // currently looking at. Blocking is visible and reversible — the
      // provider withdraws, edits, resubmits.
      if (profile.status === 'PENDING_REVIEW') {
        throw new AppError(
          'CONFLICT',
          'Your application is being reviewed and cannot be edited. Withdraw it first if you need to make changes.',
          409,
        );
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

      // Sprint 7.x — auto-fill `serviceAreaLat/Lng` from a hand-curated
      // city centroid table when the patch touches `serviceAreaCity`
      // without explicit coords AND the row doesn't already carry coords
      // (so we never overwrite a more-precise lat/lng a previous patch
      // attached). Keeps the LiveJobs map and any future map-centric UI
      // defaulting to a centroid in the provider's actual market instead
      // of the platform-wide Riyadh fallback baked into the frontend.
      const incomingCity =
        typeof input.serviceAreaCity === 'string' ? input.serviceAreaCity.trim() : null;
      const omittedLatLng =
        input.serviceAreaLat === undefined && input.serviceAreaLng === undefined;
      const profileMissingLatLng =
        profile.serviceAreaLat === null || profile.serviceAreaLng === null;
      let resolvedLat: number | null | undefined = input.serviceAreaLat;
      let resolvedLng: number | null | undefined = input.serviceAreaLng;
      if (incomingCity && incomingCity.length > 0 && omittedLatLng && profileMissingLatLng) {
        const centroid = lookupCityCentroid(incomingCity);
        if (centroid) {
          resolvedLat = centroid[0];
          resolvedLng = centroid[1];
        }
      }

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
            serviceAreaLat: resolvedLat,
            serviceAreaLng: resolvedLng,
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
