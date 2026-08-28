import { Injectable, Logger } from '@nestjs/common';
import { ADMIN_SETTINGS_SCHEMA } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../../../../infrastructure/prisma/prisma.service';
import { PlatformSettingRepository } from '../../../../../infrastructure/persistence/settings/platform-setting.repository';
import { AuditService } from '../../../../iam/audit/audit.service';
import { parseExpansionLadder, type ExpansionTier } from './expansion-policy-payload';
import {
  resolveServiceAreaExpansion,
  type ExpansionDecision,
  type ExpansionOverride,
} from './expansion-resolver';
import type { ExpansionSignals } from './expansion-signals';
import { RESPONSE_SAMPLE_SIZE, medianResponseMinutes } from './response-time';

// Sprint 9B.20 — everything the pure resolver is not allowed to do.
//
// docs/sprint-09b20/EARNED_SERVICE_AREA.md
//
// This service reads settings, reads the live ladder, counts the signals, and
// records what happened. It owns NO rules: what a ladder may say lives in
// expansion-policy-payload.ts and who qualifies lives in expansion-resolver.ts.
// Keeping them out of here is what lets the whole rule set be tested without a
// database, and stops a second copy of a rule appearing next to the query that
// feeds it.
//
// READS DO NOT WRITE. `describe()` resolves and returns; it never persists.
// The stored ProviderServiceAreaExpansion row is a RECORD of the last decision
// and the home of the manual override — it is not the source of truth, and a
// GET that quietly rewrote it would make the read non-idempotent and put a
// write on the provider's page-load path. The row is refreshed by `record()`,
// which the wizard calls on the two step writes that can change the answer.

export const EXPANSION_ENABLED_SETTING = 'provider_service_area_expansion_enabled';
export const EXPANSION_MAX_SETTING = 'provider_service_area_expansion_max_km';

/** What the service needs about a provider before it counts anything. Passed
 *  in rather than re-read, because every caller already has the profile. */
export interface ExpansionSubject {
  providerProfileId: string;
  /** Null for a profile not linked to a user account. Needed to attribute a
   *  cancellation to the person who made it. */
  userId: string | null;
  countryCode: string | null;
  currentRadiusKm: number | null;
  verificationState: ExpansionSignals['verificationState'];
  standingState: ExpansionSignals['standingState'];
  /** The legacy status column — see ExpansionSignals.legacyStatus. */
  legacyStatus: ExpansionSignals['legacyStatus'];
  availability: ExpansionSignals['availability'];
  completedJobs: number;
  ratingAvg: number;
  reviewCount: number;
}

@Injectable()
export class ProviderServiceAreaExpansionService {
  private readonly logger = new Logger(ProviderServiceAreaExpansionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * The decision, without touching anything.
   *
   * `baseMaxKm` comes from the caller's radius policy (Sprint 9B.19) so the two
   * ceilings are resolved from one answer rather than two lookups that can
   * disagree.
   */
  async describe(
    subject: ExpansionSubject,
    baseMaxKm: number,
    now: Date,
    tx?: PrismaTx,
  ): Promise<ExpansionDecision> {
    const enabled = await this.booleanSetting(EXPANSION_ENABLED_SETTING, tx);

    // Short-circuit BEFORE any of the counting queries. With the feature off
    // this must cost nothing and observe nothing: an eligibility system that
    // profiles every provider while switched off is still profiling them.
    if (!enabled) {
      return resolveServiceAreaExpansion({
        enabled: false,
        baseMaxKm,
        absoluteMaxKm: baseMaxKm,
        currentRadiusKm: subject.currentRadiusKm,
        policy: null,
        signals: emptySignals(subject),
        override: null,
        now,
      });
    }

    const [absoluteMaxKm, policy, override, signals] = await Promise.all([
      this.numberSetting(EXPANSION_MAX_SETTING, tx),
      this.liveLadder(subject.countryCode, now, tx),
      this.override(subject.providerProfileId, tx),
      this.gatherSignals(subject, tx),
    ]);

    return resolveServiceAreaExpansion({
      enabled: true,
      baseMaxKm,
      absoluteMaxKm,
      currentRadiusKm: subject.currentRadiusKm,
      policy,
      signals,
      override,
      now,
    });
  }

  /**
   * Resolve, then bring the stored record into line and audit any tier change.
   *
   * Called from write paths only. Idempotent: an evaluation that changes
   * nothing writes nothing and audits nothing, so re-saving the same step does
   * not fill the timeline with events that describe no change.
   */
  async evaluate(
    subject: ExpansionSubject,
    baseMaxKm: number,
    now: Date,
    tx?: PrismaTx,
  ): Promise<ExpansionDecision> {
    const decision = await this.describe(subject, baseMaxKm, now, tx);
    await this.record(subject, decision, now, tx);
    return decision;
  }

  /**
   * Bring the stored record into line with a decision already resolved, and
   * audit the change if there is one.
   *
   * Separate from evaluate() so the wizard — which has just resolved a
   * decision while rebuilding its context — does not resolve a second one to
   * persist the first.
   *
   * The stored row is a RECORD, never an input to eligibility (the one
   * exception is the manual override, which is not derived from anything). So
   * a row that has gone stale — because a provider completed a job somewhere
   * this code never runs — changes nothing about what they are granted. It
   * only means the audit trail names the last change we observed rather than
   * the last change there was.
   */
  async record(
    subject: ExpansionSubject,
    decision: ExpansionDecision,
    now: Date,
    tx?: PrismaTx,
  ): Promise<void> {
    if (!decision.enabled) return;

    const db = (tx ?? this.prisma.client) as PrismaTx;
    const existing = await db.providerServiceAreaExpansion.findUnique({
      where: { providerProfileId: subject.providerProfileId },
      select: { tierKey: true, earnedMaxKm: true, policyVersion: true },
    });

    const tierKey = decision.currentTier?.key ?? null;
    const earnedMaxKm = decision.currentTier?.maxKm ?? null;
    const unchanged =
      existing !== null &&
      existing.tierKey === tierKey &&
      existing.earnedMaxKm === earnedMaxKm &&
      existing.policyVersion === decision.policyVersion;
    if (unchanged) return;

    // A row is created only once a decision has actually been made about this
    // provider. Absent means "never evaluated", which is a different fact from
    // "evaluated and holds nothing", and reports need to be able to tell them
    // apart.
    await db.providerServiceAreaExpansion.upsert({
      where: { providerProfileId: subject.providerProfileId },
      create: {
        providerProfileId: subject.providerProfileId,
        policyVersion: decision.policyVersion,
        tierKey,
        earnedMaxKm,
        evaluatedAt: now,
      },
      update: {
        policyVersion: decision.policyVersion,
        tierKey,
        earnedMaxKm,
        evaluatedAt: now,
      },
    });

    await this.audit.record(
      {
        type: 'SERVICE_AREA_EXPANSION_TIER_CHANGED',
        userId: subject.userId,
        metadata: {
          providerProfileId: subject.providerProfileId,
          policyVersion: decision.policyVersion,
          tierKey,
          previousTierKey: existing?.tierKey ?? null,
          earnedMaxKm,
          previousEarnedMaxKm: existing?.earnedMaxKm ?? null,
        },
      },
      tx,
    );
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * The ladder in force for a market, most specific first.
   *
   * A country ladder wins over the global default; with neither, there is no
   * policy and the standard bounds apply. The one-live-per-market index makes
   * "the" live ladder well defined — without it two rows could tie and the
   * answer would depend on which one the query returned first, which is the
   * non-determinism this feature must not have.
   */
  private async liveLadder(
    countryCode: string | null,
    now: Date,
    tx?: PrismaTx,
  ): Promise<{ version: string; tiers: readonly ExpansionTier[] } | null> {
    const db = (tx ?? this.prisma.client) as PrismaTx;
    const rows = await db.serviceAreaExpansionPolicy.findMany({
      where: {
        retiredAt: null,
        publishedAt: { lte: now },
        // OR rather than `in: [code, null]` — Prisma's `in` cannot carry a
        // NULL, and SQL's IN would not match one anyway.
        ...(countryCode === null
          ? { country: null }
          : { OR: [{ country: countryCode }, { country: null }] }),
      },
      select: { version: true, country: true, tiers: true },
    });
    if (rows.length === 0) return null;

    const chosen =
      rows.find((r) => r.country !== null && r.country === countryCode) ??
      rows.find((r) => r.country === null);
    if (chosen === undefined) return null;

    // Re-validated on READ against the CURRENT ceilings, because a ladder
    // published under a higher `provider_service_area_expansion_max_km` must
    // not keep granting more than the operator now allows. A ladder that no
    // longer parses is treated as no ladder — the standard bounds — rather
    // than as a crash on the provider's onboarding screen.
    const [absoluteMaxKm, baseMaxKm] = await Promise.all([
      this.numberSetting(EXPANSION_MAX_SETTING, tx),
      this.numberSetting('provider_service_radius_max_km', tx),
    ]);
    try {
      const tiers = parseExpansionLadder(chosen.tiers, { absoluteMaxKm, baseMaxKm });
      return { version: chosen.version, tiers };
    } catch (err) {
      this.logger.error({
        msg: 'service_area_expansion.ladder.unreadable',
        version: chosen.version,
        err: (err as Error).message,
      });
      return null;
    }
  }

  private async override(
    providerProfileId: string,
    tx?: PrismaTx,
  ): Promise<ExpansionOverride | null> {
    const db = (tx ?? this.prisma.client) as PrismaTx;
    const row = await db.providerServiceAreaExpansion.findUnique({
      where: { providerProfileId },
      select: { overrideMaxKm: true, overrideExpiresAt: true },
    });
    if (row === null || row.overrideMaxKm === null) return null;
    // Expiry is decided by the resolver, not here: it is a rule, and rules
    // live where they can be tested without a database.
    return { maxKm: row.overrideMaxKm, expiresAt: row.overrideExpiresAt };
  }

  /**
   * Count the signals.
   *
   * Four queries in parallel, each bounded. None of them reads anything the
   * provider wrote about themselves — see expansion-signals.ts.
   */
  private async gatherSignals(subject: ExpansionSubject, tx?: PrismaTx): Promise<ExpansionSignals> {
    const db = (tx ?? this.prisma.client) as PrismaTx;
    const providerId = subject.providerProfileId;

    const [terminalBookings, cancelledByProvider, openComplaints, bids] = await Promise.all([
      db.booking.count({
        where: { providerId, deletedAt: null, status: { in: ['COMPLETED', 'CANCELLED'] } },
      }),
      // Attributed by ACTOR, not by status. A seeker changing their mind ends
      // a booking as CANCELLED too, and counting that against the provider
      // would build a metric that penalises taking work at all.
      subject.userId === null
        ? Promise.resolve(0)
        : db.bookingEvent.count({
            where: {
              type: 'BOOKING_CANCELLED',
              actorUserId: subject.userId,
              booking: { providerId, deletedAt: null },
            },
          }),
      db.dispute.count({
        where: { status: 'OPEN', deletedAt: null, booking: { providerId, deletedAt: null } },
      }),
      db.bid.findMany({
        where: { providerId, deletedAt: null },
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        take: RESPONSE_SAMPLE_SIZE,
        select: { submittedAt: true, request: { select: { createdAt: true } } },
      }),
    ]);

    const { median, sampleSize } = medianResponseMinutes(
      bids.map((b) => ({ requestCreatedAt: b.request.createdAt, bidSubmittedAt: b.submittedAt })),
    );

    return {
      verificationState: subject.verificationState,
      standingState: subject.standingState,
      legacyStatus: subject.legacyStatus,
      availability: subject.availability,
      completedJobs: subject.completedJobs,
      ratingAvg: subject.ratingAvg,
      reviewCount: subject.reviewCount,
      cancelledByProvider,
      terminalBookings,
      openComplaints,
      medianResponseMinutes: median,
      respondedRequests: sampleSize,
    };
  }

  // ── Settings ─────────────────────────────────────────────────────────────

  private async booleanSetting(key: string, tx?: PrismaTx): Promise<boolean> {
    const row = await this.settings.findByKey(key, tx);
    if (typeof row?.value === 'boolean') return row.value;
    return defaultSetting(key) === true;
  }

  private async numberSetting(key: string, tx?: PrismaTx): Promise<number> {
    const row = await this.settings.findByKey(key, tx);
    if (typeof row?.value === 'number' && Number.isFinite(row.value)) return row.value;
    const fallback = defaultSetting(key);
    return typeof fallback === 'number' ? fallback : 0;
  }
}

/** Signals with nothing counted. Used only on the disabled path, where the
 *  resolver returns before reading any of them. */
function emptySignals(subject: ExpansionSubject): ExpansionSignals {
  return {
    verificationState: subject.verificationState,
    standingState: subject.standingState,
    legacyStatus: subject.legacyStatus,
    availability: subject.availability,
    completedJobs: subject.completedJobs,
    ratingAvg: subject.ratingAvg,
    reviewCount: subject.reviewCount,
    cancelledByProvider: 0,
    terminalBookings: 0,
    openComplaints: 0,
    medianResponseMinutes: null,
    respondedRequests: 0,
  };
}

/** The schema default for a key, so this service and the admin screen agree on
 *  what an absent row means. A literal here instead would let the two drift the
 *  moment someone edits the schema. */
function defaultSetting(key: string): unknown {
  return ADMIN_SETTINGS_SCHEMA.find((f) => f.key === key)?.default;
}
