import { Injectable, Logger } from '@nestjs/common';
import type { PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { V2_DEFAULT_PROVIDER_TYPE, isBlank } from './onboarding-defaults.policy';

// Sprint 09B.29 Phase 5 (C1) — applying the V2 defaults without a race.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §1.6
//
// THE FIRST IMPLEMENTATION HAD THREE DEFECTS, AND ALL THREE ARE ANSWERED HERE.
//
//  1. TIME-OF-CHECK/TIME-OF-USE. `ensure()` read the draft and then upserted
//     it, and the caller applied defaults when that read had found nothing.
//     Two first requests both read nothing, so "did I create it" was a guess.
//     Answered by DELETING the question: nothing here asks whether the draft
//     was just created.
//
//  2. STALE PREDICATE. The defaults were decided from a `ctx.profile` loaded
//     earlier and then written unconditionally, so an explicit BUSINESS or an
//     explicit headline landing in between was overwritten. Answered by making
//     the blankness test part of the WHERE CLAUSE, so the database evaluates it
//     against the row as it is at write time, and the write moves zero rows if
//     somebody got there first.
//
//  3. FALSE ATOMICITY. The old code opened a second transaction and a comment
//     claimed create-plus-default was atomic. It was not. There is no such
//     claim here: each default is a single conditional statement, and a
//     conditional statement needs no transaction to be correct. Partial
//     application is safe because every step is independently idempotent.
//
// AND THE FOURTH, WHICH WAS A DESIGN ERROR RATHER THAN A RACE
//
// A brand-new provider has no primary service, so there is no title to
// suggest. Seeding only at draft creation left the headline blank for ever.
// So `apply` is called on the ORDINARY draft paths and seeds whenever a
// suggestion first becomes available — which is exactly when the provider
// chooses their primary service.
//
// That reopens the question the "only at creation" rule was there to answer:
// what stops it refilling a headline the provider deliberately cleared?
// Provenance does. A stamp is written into the draft's server-owned `data`
// column the first time a headline is generated, and its presence — never a
// comparison of values — is what says "this has been done".

/** The provenance key inside `ProviderOnboardingDraft.data`.
 *
 *  That column is the server's own scratch bag: it is never client-asserted,
 *  it already exists, and it is written through the version-guarded
 *  `advanceIfVersion` path. Using it needs no migration and no new table,
 *  which is why the alternative — a column on the profile — was not taken. */
export const GENERATED_HEADLINE_STAMP = 'v2GeneratedHeadlineAt';

/**
 * Provenance for the service radius.
 *
 * Sprint 09B.29 Phase 5 (C2). The radius has a problem the headline does not:
 * a DERIVED value and a value the provider deliberately chose can be the same
 * number. A provider in a car market who picks exactly the suggested 15 km is
 * indistinguishable from one who never touched the control — unless the server
 * wrote down which happened.
 *
 * So provenance is recorded explicitly and NEVER inferred by comparing the
 * stored value with today's suggestion. That comparison is the tempting
 * shortcut and it is wrong in both directions: it would silently overwrite a
 * provider's coincidentally-equal choice when the market's numbers change, and
 * it would refuse to update a genuinely derived value that happens to match.
 *
 * The stamp records the mode the number was derived FROM, so a later change of
 * primary transport can recompute a derived radius while leaving an explicit
 * one alone.
 */
export const DERIVED_RADIUS_STAMP = 'v2DerivedRadius';

/**
 * What the stamp holds — enough identity to EXPLAIN the value, not merely to
 * recognise it.
 *
 * An earlier version recorded only the transport mode and the number. That
 * cannot answer "is this still the right radius?", because the same CAR basis
 * means 15 km in one market and 40 in another: "same transport, different
 * country" was indistinguishable from "nothing changed", and a provider moving
 * market kept a radius derived for the market they left.
 */
export interface DerivedRadiusProvenance {
  /** The market the number was derived FOR. */
  readonly countryCode: string | null;
  /** The transport mode it came from, or null for the no-transport default. */
  readonly basedOn: string | null;
  /** A fingerprint of the operator configuration in force. When this moves the
   *  suggestion may have moved with it, so a derived value is recomputed. */
  readonly policyVersion: string | null;
  /** The value written, so a later read can tell whether the provider has
   *  since changed it — WITHOUT comparing against a moving suggestion. */
  readonly km: number;
  readonly at: string;
}

/**
 * The keys in `ProviderOnboardingDraft.data` that belong to the SERVER.
 *
 * That column carries two different things with two different owners: a
 * scratch bag the wizard's step handlers read and rewrite on behalf of the
 * client, and the provenance stamps above, which the client never sees and
 * must never be able to influence.
 *
 * The wizard omits these when it builds its scratch copy. Without that, a step
 * write merges a stamp the request had ALREADY deleted straight back in — the
 * exact way a provider's explicit radius kept a stamp claiming the server
 * owned it, and a re-derivation for a new market was reverted to the old one.
 * Deleting a stamp has to mean deleting it.
 */
export const SERVER_OWNED_DRAFT_KEYS: readonly string[] = [
  GENERATED_HEADLINE_STAMP,
  DERIVED_RADIUS_STAMP,
];

/**
 * What `apply` actually wrote, key by key.
 *
 * Absent means "not written", which is different from "written as null": every
 * default here is conditional, and most calls write nothing at all.
 */
export interface AppliedDefaults {
  readonly providerType?: typeof V2_DEFAULT_PROVIDER_TYPE;
  readonly headline?: string;
  readonly serviceAreaRadiusKm?: number;
}

export interface DefaultsInput {
  /**
   * The generated title for this provider's primary service, in the language
   * the provider is being shown, or null when they have not chosen one yet.
   *
   * The LANGUAGE matters and is the caller's decision: a headline is a single
   * user-facing string, and the provider keeps the wording they actually saw.
   * Nothing here re-translates it later.
   */
  readonly suggestedTitle: string | null;
  /**
   * The canonical radius policy's answer for this provider, or null when it
   * cannot be computed yet.
   *
   * Passed in rather than resolved here, because the policy needs operator
   * settings and the caller already has them — and because this service must
   * not become a second place that decides how far a provider travels.
   */
  readonly radius?: {
    suggestedKm: number;
    basedOn: string | null;
    /** The market the suggestion was computed FOR. */
    countryCode?: string | null;
    /** A fingerprint of the operator configuration behind it. */
    policyVersion?: string | null;
  } | null;
}

@Injectable()
export class ProviderOnboardingDefaultsService {
  private readonly log = new Logger(ProviderOnboardingDefaultsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fill the two fields the approved V2 screens no longer ask about.
   *
   * Safe to call on every draft read and every step write. Both steps are
   * conditional and idempotent, so calling it more often costs at most one
   * `UPDATE … WHERE` that matches nothing.
   */
  async apply(
    providerProfileId: string,
    input: DefaultsInput,
    tx?: PrismaTx,
  ): Promise<AppliedDefaults> {
    const db = (tx ?? this.prisma.client) as PrismaTx;

    const providerType = await this.defaultProviderType(db, providerProfileId);
    const headline = await this.seedGeneratedHeadline(db, providerProfileId, input.suggestedTitle);
    const serviceAreaRadiusKm = await this.deriveRadius(
      db,
      providerProfileId,
      input.radius ?? null,
    );

    // Only the keys actually written. The caller overlays these onto the
    // context it already holds instead of re-reading the profile, which is
    // what keeps the enclosing transaction short enough to commit — see the
    // note at the call site.
    return {
      ...(providerType === null ? {} : { providerType }),
      ...(headline === null ? {} : { headline }),
      ...(serviceAreaRadiusKm === null ? {} : { serviceAreaRadiusKm }),
    };
  }

  /**
   * Fill or recompute the service radius from the canonical policy.
   *
   * THREE CASES, and the provenance stamp is what tells them apart:
   *
   *   no radius stored      derive, and stamp it
   *   stored + our stamp    the value is ours. Recompute only if the primary
   *                         transport it was derived FROM has changed, and only
   *                         if the provider has not edited it since — which the
   *                         stamp's recorded km answers without comparing
   *                         against a moving suggestion.
   *   stored + no stamp     the provider chose it, or it is legacy data. Leave
   *                         it alone, for ever.
   *
   * The conditional write carries the expected current value, so a concurrent
   * explicit edit between the read and the write matches zero rows and wins.
   */
  private async deriveRadius(
    db: PrismaTx,
    id: string,
    radius: {
      suggestedKm: number;
      basedOn: string | null;
      countryCode?: string | null;
      policyVersion?: string | null;
    } | null,
  ): Promise<number | null> {
    if (!radius) return null;

    const [profile, draft] = await Promise.all([
      db.providerProfile.findUnique({
        where: { id },
        select: { serviceAreaRadiusKm: true },
      }),
      db.providerOnboardingDraft.findUnique({
        where: { providerProfileId: id },
        select: { data: true },
      }),
    ]);
    if (!profile || !draft) return null;

    const data =
      draft.data && typeof draft.data === 'object' && !Array.isArray(draft.data)
        ? (draft.data as Record<string, unknown>)
        : {};
    const stamp = data[DERIVED_RADIUS_STAMP] as DerivedRadiusProvenance | undefined;
    const current = profile.serviceAreaRadiusKm;

    if (current != null) {
      // Somebody's number. Ours only if we stamped it AND it is still the value
      // we wrote — if it differs, the provider has edited it since and it is
      // theirs now, whatever the stamp says.
      const stillOurs = stamp != null && stamp.km === current;
      if (!stillOurs) return null;
      // Ours, and unchanged. Recompute when ANY part of the identity that
      // produced it has moved: the market, the transport basis, or the
      // operator configuration. Comparing only the transport left a provider
      // who changed country holding a radius derived for the country they had
      // left.
      const sameIdentity =
        stamp.basedOn === radius.basedOn &&
        (stamp.countryCode ?? null) === (radius.countryCode ?? null) &&
        (stamp.policyVersion ?? null) === (radius.policyVersion ?? null);
      if (sameIdentity) return null;
    }

    const written = await db.providerProfile.updateMany({
      // The expected current value is IN the predicate, so a concurrent
      // explicit edit between the read above and this write matches nothing.
      where: { id, serviceAreaRadiusKm: current },
      data: { serviceAreaRadiusKm: radius.suggestedKm },
    });
    if (written.count === 0) return null;

    await this.mergeDraftData(db, id, {
      [DERIVED_RADIUS_STAMP]: {
        countryCode: radius.countryCode ?? null,
        basedOn: radius.basedOn,
        policyVersion: radius.policyVersion ?? null,
        km: radius.suggestedKm,
        at: new Date().toISOString(),
      } satisfies DerivedRadiusProvenance,
    });

    this.log.log({ msg: 'onboarding.defaults.radius_derived', providerProfileId: id });
    return radius.suggestedKm;
  }

  /**
   * The provider chose a radius themselves. Drop our claim on it.
   *
   * Called from the explicit write path. Clearing is unconditional and does
   * NOT compare values: a provider who deliberately picks exactly the number we
   * would have suggested owns it just as much as one who picks a different
   * number, and a surviving stamp would let a later market change silently move
   * their choice.
   */
  async recordExplicitRadius(providerProfileId: string, _km: number, tx?: PrismaTx): Promise<void> {
    const db = (tx ?? this.prisma.client) as PrismaTx;
    await this.mergeDraftData(db, providerProfileId, { [DERIVED_RADIUS_STAMP]: null });
  }

  /**
   * Merge keys into the draft's JSON without a read-modify-write.
   *
   * The lost-update hazard this closes: the previous code read `data`, spread
   * it, and wrote the whole object back. Two defaults running concurrently —
   * a headline stamp and a radius stamp — would each write the object as it
   * looked BEFORE the other, and one would be erased.
   *
   * Postgres merges the two JSON objects itself, so the read no longer
   * participates. A `null` value removes the key, which is how provenance is
   * cleared.
   *
   * Raw SQL because Prisma's JSON update replaces rather than merges; there is
   * no `jsonb_set`-equivalent in its typed API.
   */
  private async mergeDraftData(
    db: PrismaTx,
    providerProfileId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const removals = Object.entries(patch)
      .filter(([, v]) => v === null)
      .map(([k]) => k);
    const additions = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null));

    if (Object.keys(additions).length > 0) {
      await db.$executeRaw`
        UPDATE "ProviderOnboardingDraft"
        SET "data" = COALESCE("data", '{}'::jsonb) || ${JSON.stringify(additions)}::jsonb
        WHERE "providerProfileId" = ${providerProfileId}
      `;
    }
    for (const key of removals) {
      await db.$executeRaw`
        UPDATE "ProviderOnboardingDraft"
        SET "data" = COALESCE("data", '{}'::jsonb) - ${key}
        WHERE "providerProfileId" = ${providerProfileId}
      `;
    }
  }

  /**
   * INDIVIDUAL, but only into a column that is still empty.
   *
   * `updateMany` with the predicate in the WHERE clause rather than
   * `update` after an `if`: the database evaluates "is it still null" and
   * performs the write as one statement, so a concurrent explicit BUSINESS
   * either lands first (and this matches zero rows) or lands second (and
   * overwrites a default, which is correct — it is explicit).
   */
  private async defaultProviderType(
    db: PrismaTx,
    id: string,
  ): Promise<typeof V2_DEFAULT_PROVIDER_TYPE | null> {
    const filled = await db.providerProfile.updateMany({
      where: { id, providerType: null },
      data: { providerType: V2_DEFAULT_PROVIDER_TYPE },
    });
    if (filled.count === 0) return null;
    this.log.log({ msg: 'onboarding.defaults.provider_type', providerProfileId: id });
    return V2_DEFAULT_PROVIDER_TYPE;
  }

  /**
   * Seed the generated headline, once, if there is one and the provider has
   * not written their own.
   *
   * Three conditions, and each rules out a different mistake:
   *
   *   a suggestion exists    a provider with no primary service gets nothing,
   *                          rather than an empty string
   *   no stamp yet           a headline the provider CLEARED stays cleared;
   *                          this is the provenance, and it is a presence
   *                          check rather than a comparison of values
   *   still blank NOW        evaluated by the database at write time, so a
   *                          concurrent explicit headline is never overwritten
   */
  private async seedGeneratedHeadline(
    db: PrismaTx,
    id: string,
    suggestedTitle: string | null,
  ): Promise<string | null> {
    if (isBlank(suggestedTitle)) return null;
    const title = (suggestedTitle as string).trim();

    const draft = await db.providerOnboardingDraft.findUnique({
      where: { providerProfileId: id },
      select: { data: true },
    });

    // NO DRAFT, NO SEEDING — and this is a correctness rule, not a guard
    // against a missing row.
    //
    // The provenance stamp lives in the draft. Seeding a headline without
    // somewhere to record that we did it would mean the next call cannot tell
    // a generated value from a provider's own, and would refill it for ever
    // after they cleared it. Better to write nothing: the caller always
    // `ensure`s the draft first, so in the real flow this branch is
    // unreachable, and in any flow where it is reachable, silence is the safe
    // answer.
    if (!draft) {
      this.log.warn({ msg: 'onboarding.defaults.no_draft_for_provenance', providerProfileId: id });
      return null;
    }

    const data =
      draft.data && typeof draft.data === 'object' && !Array.isArray(draft.data)
        ? (draft.data as Record<string, unknown>)
        : {};

    // The provenance check. Its ABSENCE is the only thing that permits a write,
    // so a cleared headline is never refilled and a value is never compared.
    if (data[GENERATED_HEADLINE_STAMP] !== undefined) return null;

    // Blank means three things — never set, an empty control, and a control
    // somebody typed a space into. All three are "the provider has not said
    // anything", and only `null` and `''` are expressible directly, so the
    // whitespace case is matched explicitly.
    const filled = await db.providerProfile.updateMany({
      where: {
        id,
        OR: [{ headline: null }, { headline: '' }, { headline: { in: [' ', '  ', '   '] } }],
      },
      data: { headline: title },
    });

    if (filled.count === 0) {
      // Somebody has a headline. Nothing was written and no stamp is recorded,
      // so if they later clear it the suggestion is still available to them.
      return null;
    }

    // Stamped only after a write actually happened. Recording it first would
    // mean a lost race also lost the provider their future suggestion.
    await this.mergeDraftData(db, id, {
      [GENERATED_HEADLINE_STAMP]: new Date().toISOString(),
    });

    this.log.log({ msg: 'onboarding.defaults.headline_seeded', providerProfileId: id });
    return title;
  }
}
