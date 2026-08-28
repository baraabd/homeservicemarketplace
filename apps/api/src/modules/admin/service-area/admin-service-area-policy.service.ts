import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { PlatformSettingRepository } from '../../../infrastructure/persistence/settings/platform-setting.repository';
import { AuditService } from '../../iam/audit/audit.service';
import {
  ExpansionPayloadError,
  parseExpansionLadder,
} from '../../provider/onboarding/service-area/expansion/expansion-policy-payload';
import { EXPANSION_MAX_SETTING } from '../../provider/onboarding/service-area/expansion/provider-service-area-expansion.service';
import {
  PolicyLifecycleError,
  assertNoLiveOverlap,
  assertPublishable,
  assertRetirable,
  assertVersionFormat,
  isLiveAt,
  type PolicyScopeRow,
} from '../../provider/verification/policy/policy-lifecycle';
import { AppError } from '../../../shared/errors/app-error';
import { ADMIN_SETTINGS_SCHEMA } from '@homeservicemarketplace/contracts';

// Sprint 9B.20 — publishing and retiring service-area expansion ladders, and
// granting the manual overrides that are the appeal path.
//
// docs/sprint-09b20/EARNED_SERVICE_AREA.md
//
// This service ORCHESTRATES and owns no rules. What may be published lives in
// expansion-policy-payload.ts; WHEN it may be published lives in the
// verification module's policy-lifecycle.ts, reused verbatim rather than
// copied — the version format, the back-dating refusal, the retire-once rule
// and the overlap check are the same questions here as there, and a second
// implementation of them would drift.
//
// Ladders are APPEND-ONLY: publish and retire are the only mutations. There is
// deliberately no update path, because editing a version would change what a
// provider was judged against after they were judged.

export interface PublishLadderInput {
  version: string;
  /** ISO 3166-1 alpha-2, or null for the global default. */
  country: string | null;
  tiers: unknown;
  /** Defaults to now. May be scheduled forward, never back. */
  publishedAt?: Date;
}

export interface LadderSummary {
  version: string;
  country: string | null;
  tiers: Prisma.JsonValue;
  publishedAt: string;
  retiredAt: string | null;
  publishedByUserId: string | null;
  isLive: boolean;
}

export interface SetOverrideInput {
  providerProfileId: string;
  maxKm: number;
  reason: string;
  /** Null = until revoked. */
  expiresAt: Date | null;
}

export interface OverrideSummary {
  providerProfileId: string;
  overrideMaxKm: number | null;
  overrideReason: string | null;
  overrideByUserId: string | null;
  overrideAt: string | null;
  overrideExpiresAt: string | null;
}

@Injectable()
export class AdminServiceAreaPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
    private readonly settings: PlatformSettingRepository,
  ) {}

  async publish(adminUserId: string, input: PublishLadderInput): Promise<LadderSummary> {
    const now = new Date();
    const publishedAt = input.publishedAt ?? now;

    // ── rules, before any write ──────────────────────────────────────────
    try {
      assertVersionFormat(input.version);
      assertPublishable({ publishedAt }, now);
    } catch (err) {
      throw toAppError(err);
    }

    const [absoluteMaxKm, baseMaxKm] = await Promise.all([
      this.numberSetting(EXPANSION_MAX_SETTING),
      this.numberSetting('provider_service_radius_max_km'),
    ]);

    let tiers;
    try {
      tiers = parseExpansionLadder(input.tiers, { absoluteMaxKm, baseMaxKm });
    } catch (err) {
      throw toAppError(err);
    }

    // Scope is country-only here, so the reused overlap check is fed nulls for
    // the two axes a verification policy has and this one does not. That is
    // the whole adaptation: sameScope() then reduces to comparing countries.
    const candidate: PolicyScopeRow = {
      version: input.version,
      country: input.country,
      providerType: null,
      categoryId: null,
      publishedAt,
      retiredAt: null,
    };

    // A read-then-write, so it LOSES a race. It is still worth doing: it turns
    // the common mistake into a sentence an admin can act on, while the partial
    // unique index guarantees the rule under concurrency.
    const existing = await this.prisma.client.serviceAreaExpansionPolicy.findMany({
      select: { version: true, country: true, publishedAt: true, retiredAt: true },
    });
    try {
      assertNoLiveOverlap(
        candidate,
        existing.map((p) => ({ ...p, providerType: null, categoryId: null })),
        now,
      );
    } catch (err) {
      throw toAppError(err);
    }

    return this.tx.run(async (trx: PrismaTx) => {
      let row;
      try {
        row = await trx.serviceAreaExpansionPolicy.create({
          data: {
            version: input.version,
            country: input.country,
            tiers: { tiers } as unknown as Prisma.InputJsonValue,
            publishedAt,
            publishedByUserId: adminUserId,
          },
        });
      } catch (err) {
        throw translateWriteError(err);
      }

      // In the SAME transaction. A publication that commits without its audit
      // row is an unattributable change to how far every provider in a market
      // may travel.
      await this.audit.record(
        {
          type: 'SERVICE_AREA_POLICY_PUBLISHED',
          userId: adminUserId,
          metadata: { policyVersion: input.version, country: input.country },
        },
        trx,
      );

      return toSummary(row, new Date());
    });
  }

  async retire(adminUserId: string, version: string): Promise<LadderSummary> {
    try {
      assertVersionFormat(version);
    } catch (err) {
      throw toAppError(err);
    }

    const found = await this.prisma.client.serviceAreaExpansionPolicy.findUnique({
      where: { version },
    });
    if (!found) {
      throw new AppError('NOT_FOUND', `No service-area expansion policy named ${version}.`, 404);
    }

    const now = new Date();
    try {
      assertRetirable({ ...found, providerType: null, categoryId: null }, now);
    } catch (err) {
      throw toAppError(err);
    }

    return this.tx.run(async (trx: PrismaTx) => {
      // The WHERE clause IS the concurrency guard: "still un-retired" is
      // exactly the precondition. Two admins retiring at once means one UPDATE
      // matches zero rows and gets a 409 instead of a silent success.
      const { count } = await trx.serviceAreaExpansionPolicy.updateMany({
        where: { version, retiredAt: null },
        data: { retiredAt: now },
      });
      if (count === 0) {
        throw new AppError(
          'CONFLICT',
          `Policy ${version} was retired by someone else. Reload to see the current state.`,
          409,
        );
      }

      await this.audit.record(
        {
          type: 'SERVICE_AREA_POLICY_RETIRED',
          userId: adminUserId,
          metadata: { policyVersion: version, country: found.country },
        },
        trx,
      );

      return toSummary({ ...found, retiredAt: now }, now);
    });
  }

  async list(): Promise<{ policies: LadderSummary[] }> {
    const rows = await this.prisma.client.serviceAreaExpansionPolicy.findMany({
      orderBy: [{ publishedAt: 'desc' }, { version: 'desc' }],
    });
    const now = new Date();
    return { policies: rows.map((r) => toSummary(r, now)) };
  }

  // ── The appeal path ───────────────────────────────────────────────────────

  /**
   * Grant one provider a ceiling by hand.
   *
   * The escape hatch for everything the ladder gets wrong: a market too sparse
   * to have a policy, a provider the signals describe badly, a denial that was
   * correct by the rules and wrong in fact. It raises a ceiling like any other
   * expansion — it never widens what the provider actually travels — and it is
   * still bounded by the configured absolute ceiling, because an operator's
   * slip should not be able to put someone's feed across a country either.
   *
   * A reason is REQUIRED, at the DTO, here, and in a CHECK constraint. An
   * override with no stated reason is an unattributable change to someone's
   * reach, and the person who has to explain it later is never the person who
   * made it.
   */
  async setOverride(adminUserId: string, input: SetOverrideInput): Promise<OverrideSummary> {
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new AppError(
        'VALIDATION_ERROR',
        'A manual service-area override needs a reason.',
        400,
        { reason: 'REASON_REQUIRED' },
      );
    }

    const absoluteMaxKm = await this.numberSetting(EXPANSION_MAX_SETTING);
    if (input.maxKm > absoluteMaxKm) {
      throw new AppError(
        'VALIDATION_ERROR',
        `An override cannot exceed the configured expansion ceiling of ${absoluteMaxKm} km.`,
        400,
        { reason: 'ABOVE_CEILING' },
      );
    }

    const profile = await this.prisma.client.providerProfile.findUnique({
      where: { id: input.providerProfileId },
      select: { id: true, userId: true },
    });
    if (!profile) {
      throw new AppError('NOT_FOUND', 'No such provider profile.', 404);
    }

    const now = new Date();
    return this.tx.run(async (trx: PrismaTx) => {
      const row = await trx.providerServiceAreaExpansion.upsert({
        where: { providerProfileId: input.providerProfileId },
        create: {
          providerProfileId: input.providerProfileId,
          overrideMaxKm: input.maxKm,
          overrideReason: reason,
          overrideByUserId: adminUserId,
          overrideAt: now,
          overrideExpiresAt: input.expiresAt,
        },
        update: {
          overrideMaxKm: input.maxKm,
          overrideReason: reason,
          overrideByUserId: adminUserId,
          overrideAt: now,
          overrideExpiresAt: input.expiresAt,
        },
      });

      await this.audit.record(
        {
          type: 'SERVICE_AREA_EXPANSION_OVERRIDE_SET',
          userId: adminUserId,
          metadata: {
            providerProfileId: input.providerProfileId,
            overrideMaxKm: input.maxKm,
            overrideExpiresAt: input.expiresAt?.toISOString() ?? null,
            reason,
          },
        },
        trx,
      );

      return toOverrideSummary(row);
    });
  }

  async clearOverride(adminUserId: string, providerProfileId: string): Promise<OverrideSummary> {
    return this.tx.run(async (trx: PrismaTx) => {
      // updateMany rather than update: clearing an override that is already
      // clear is not an error, and a 404 for "the thing you wanted gone is
      // gone" is a worse answer than the state itself.
      const { count } = await trx.providerServiceAreaExpansion.updateMany({
        where: { providerProfileId, overrideMaxKm: { not: null } },
        data: {
          overrideMaxKm: null,
          overrideReason: null,
          overrideByUserId: null,
          overrideAt: null,
          overrideExpiresAt: null,
        },
      });

      if (count > 0) {
        await this.audit.record(
          {
            type: 'SERVICE_AREA_EXPANSION_OVERRIDE_CLEARED',
            userId: adminUserId,
            metadata: { providerProfileId },
          },
          trx,
        );
      }

      const row = await trx.providerServiceAreaExpansion.findUnique({
        where: { providerProfileId },
      });
      return row === null
        ? {
            providerProfileId,
            overrideMaxKm: null,
            overrideReason: null,
            overrideByUserId: null,
            overrideAt: null,
            overrideExpiresAt: null,
          }
        : toOverrideSummary(row);
    });
  }

  private async numberSetting(key: string): Promise<number> {
    const row = await this.settings.findByKey(key);
    if (typeof row?.value === 'number' && Number.isFinite(row.value)) return row.value;
    const fallback = ADMIN_SETTINGS_SCHEMA.find((f) => f.key === key)?.default;
    return typeof fallback === 'number' ? fallback : 0;
  }
}

/** Domain errors carry a code the API contract already knows; anything else is
 *  a bug and must not be dressed up as a client error. */
function toAppError(err: unknown): AppError {
  if (err instanceof ExpansionPayloadError) {
    return new AppError('VALIDATION_ERROR', err.message, 400, { reason: err.code });
  }
  if (err instanceof PolicyLifecycleError) {
    const status = err.code === 'OVERLAPPING_POLICY' || err.code === 'ALREADY_RETIRED' ? 409 : 400;
    return new AppError(status === 409 ? 'CONFLICT' : 'VALIDATION_ERROR', err.message, status, {
      reason: err.code,
    });
  }
  if (err instanceof AppError) return err;
  throw err;
}

/**
 * The partial unique index is the real guarantee, so its violation has to reach
 * the client as the SAME stable error the pre-check produces. A P2002 leaking
 * through would be both unhelpful and a small disclosure of schema shape.
 */
function translateWriteError(err: unknown): AppError {
  const code = (err as { code?: string })?.code;
  if (code === 'P2002') {
    return new AppError(
      'CONFLICT',
      'A live expansion policy already covers this market. Retire it before publishing a replacement.',
      409,
      { reason: 'OVERLAPPING_POLICY' },
    );
  }
  if (err instanceof AppError) return err;
  throw err;
}

function toSummary(
  row: {
    version: string;
    country: string | null;
    tiers: Prisma.JsonValue;
    publishedAt: Date;
    retiredAt: Date | null;
    publishedByUserId: string | null;
  },
  now: Date,
): LadderSummary {
  return {
    version: row.version,
    country: row.country,
    tiers: row.tiers,
    publishedAt: row.publishedAt.toISOString(),
    retiredAt: row.retiredAt?.toISOString() ?? null,
    publishedByUserId: row.publishedByUserId,
    isLive: isLiveAt({ ...row, providerType: null, categoryId: null }, now),
  };
}

function toOverrideSummary(row: {
  providerProfileId: string;
  overrideMaxKm: number | null;
  overrideReason: string | null;
  overrideByUserId: string | null;
  overrideAt: Date | null;
  overrideExpiresAt: Date | null;
}): OverrideSummary {
  return {
    providerProfileId: row.providerProfileId,
    overrideMaxKm: row.overrideMaxKm,
    overrideReason: row.overrideReason,
    overrideByUserId: row.overrideByUserId,
    overrideAt: row.overrideAt?.toISOString() ?? null,
    overrideExpiresAt: row.overrideExpiresAt?.toISOString() ?? null,
  };
}
