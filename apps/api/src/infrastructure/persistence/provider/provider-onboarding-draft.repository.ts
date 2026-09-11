import { Injectable } from '@nestjs/common';
import type {
  City,
  District,
  EquipmentCatalogItem,
  Neighborhood,
  Prisma,
  PrismaTx,
  ProviderAvailabilityInterval,
  ProviderEquipment,
  ProviderOnboardingDraft,
  ProviderServiceArea,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Sprint 8 — persistence for the onboarding wizard.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// The draft row is NOT where the answers live. Committed values go straight
// into typed columns on ProviderProfile and its relations the moment they
// validate, which is what makes resume trivial: the wizard reads the profile,
// not a replay log. This row carries the four things the profile cannot say —
// where the provider is in the flow, which steps the SERVER accepted, the
// optimistic-concurrency token, and the policy version the draft is pinned to.

/** Everything the wizard reads in one query. Loaded together because the
 *  wizard renders the whole application on every screen (the sidebar shows
 *  every step's state), so fetching per-step would be N round-trips to render
 *  one page. */
export type ProviderOnboardingRelations = {
  availabilityIntervals: ProviderAvailabilityInterval[];
  equipment: (ProviderEquipment & { equipmentItem: EquipmentCatalogItem })[];
  serviceAreas: (ProviderServiceArea & {
    city: City | null;
    district: District | null;
    neighborhood: Neighborhood | null;
  })[];
  onboardingDraft: ProviderOnboardingDraft | null;
};

const RELATIONS_INCLUDE = {
  availabilityIntervals: {
    orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
  },
  equipment: { include: { equipmentItem: true } },
  serviceAreas: { include: { city: true, district: true, neighborhood: true } },
  onboardingDraft: true,
} satisfies Prisma.ProviderProfileInclude;

@Injectable()
export class ProviderOnboardingDraftRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  /** The wizard's read. Ordered deterministically so two loads of an unchanged
   *  application produce byte-identical responses — otherwise the client's
   *  unsaved-change detection fires on the server reshuffling a list. */
  loadRelations(
    providerProfileId: string,
    tx?: PrismaTx,
  ): Promise<ProviderOnboardingRelations | null> {
    return this.db(tx).providerProfile.findUnique({
      where: { id: providerProfileId },
      select: RELATIONS_INCLUDE,
    }) as Promise<ProviderOnboardingRelations | null>;
  }

  /** Create the draft row on first touch.
   *
   *  `upsert` rather than create-if-missing: two autosaves racing on the very
   *  first keystroke is entirely ordinary, and the unique index on
   *  providerProfileId means the loser of that race would otherwise get a
   *  P2002 on a request that did nothing wrong. */
  ensure(
    providerProfileId: string,
    input: { currentStep: string; policyVersion: string },
    tx?: PrismaTx,
  ): Promise<ProviderOnboardingDraft> {
    // Sprint 09B.29 Phase 5 (C1) — this deliberately does NOT report whether it
    // created the row.
    //
    // An earlier attempt did, by reading first and comparing. That is a
    // time-of-check/time-of-use guess: two first requests for one provider —
    // a tab restore, a double tap — both find nothing and both claim the
    // creation. The V2 defaults were then gated on that claim.
    //
    // The question was removed rather than answered. `ProviderOnboardingDefaults
    // Service` applies each default as a single conditional statement whose
    // predicate the DATABASE evaluates at write time, so it is idempotent and
    // needs to know nothing about who created what.
    return this.db(tx).providerOnboardingDraft.upsert({
      where: { providerProfileId },
      create: {
        providerProfileId,
        currentStep: input.currentStep,
        policyVersion: input.policyVersion,
      },
      // Deliberately empty. An `ensure` that also updated would silently
      // reset a live draft's step or re-pin its policy version.
      update: {},
    });
  }

  /**
   * Advance the draft, but ONLY if it is still at the version the caller read.
   *
   * The version lives in the WHERE clause rather than being compared in
   * application code, so the check and the write are one statement and two
   * concurrent PATCHes cannot both pass a read-then-compare. A return of 0 is
   * a genuine conflict — the other tab won — and becomes a 409 carrying the
   * server's current state, never a silent overwrite.
   */
  async advanceIfVersion(
    providerProfileId: string,
    expectedVersion: number,
    patch: {
      currentStep: string;
      completedSteps: string[];
      data: Prisma.InputJsonValue;
    },
    tx?: PrismaTx,
  ): Promise<number> {
    const db = this.db(tx);

    const result = await db.providerOnboardingDraft.updateMany({
      where: { providerProfileId, version: expectedVersion },
      data: {
        currentStep: patch.currentStep,
        completedSteps: patch.completedSteps,
        version: { increment: 1 },
        lastSavedAt: new Date(),
      },
    });
    if (result.count === 0) return 0;

    // `data` is MERGED, never replaced. Sprint 09B.29 Phase 5 (C2) — and this
    // was a live defect, not a precaution.
    //
    // The caller's `data` is the CLIENT scratch bag, built by spreading the
    // draft as it looked when the request began. That column also holds
    // SERVER-OWNED provenance — which headline was generated, which radius was
    // derived and for which market — written during the very same request by
    // the defaults service, AFTER the caller took its copy.
    //
    // Replacing the column therefore erased every stamp the request had just
    // written. The visible consequence: a derived radius carried no provenance
    // at all, so the server could never tell its own suggestion from a
    // provider's deliberate choice, and a headline the provider had cleared
    // was refilled on their next keystroke.
    //
    // Postgres performs the merge, so no read participates and two writers
    // touching DIFFERENT keys cannot erase each other. The version CAS above
    // still decides WHETHER this request may write at all: a concurrent PATCH
    // has already bumped the version, the updateMany matched nothing, and this
    // statement is not reached. Merging without that guard would be a silent
    // overwrite; merging behind it is the same conflict semantics with the
    // server's own bookkeeping preserved.
    //
    // Raw SQL because Prisma's JSON update replaces rather than merges; its
    // typed API has no `||` equivalent.
    await db.$executeRaw`
      UPDATE "ProviderOnboardingDraft"
      SET "data" = COALESCE("data", '{}'::jsonb) || ${JSON.stringify(patch.data)}::jsonb
      WHERE "providerProfileId" = ${providerProfileId}
    `;

    return result.count;
  }

  findByProfileId(
    providerProfileId: string,
    tx?: PrismaTx,
  ): Promise<ProviderOnboardingDraft | null> {
    return this.db(tx).providerOnboardingDraft.findUnique({ where: { providerProfileId } });
  }

  /**
   * Replace a provider's whole week.
   *
   * Delete-then-insert rather than a diff. Overlap is a property of the SET,
   * so the set is what gets written; a diff would need the old and new rows to
   * be non-overlapping at every intermediate point, which they are not — a
   * provider shifting 09:00-12:00 to 10:00-13:00 passes through a state that
   * collides with itself.
   *
   * Callers run this inside a transaction, so the empty window between the
   * delete and the insert is never observable.
   */
  async replaceAvailability(
    providerProfileId: string,
    intervals: { dayOfWeek: number; startMinute: number; endMinute: number; timezone: string }[],
    tx: PrismaTx,
  ): Promise<void> {
    await tx.providerAvailabilityInterval.deleteMany({ where: { providerProfileId } });
    if (intervals.length === 0) return;
    await tx.providerAvailabilityInterval.createMany({
      data: intervals.map((i) => ({ ...i, providerProfileId })),
    });
  }

  /** Replace the equipment set. Same reasoning as availability, minus the
   *  overlap: the client sends what it has, so absence means removed. */
  async replaceEquipment(
    providerProfileId: string,
    equipmentItemIds: string[],
    tx: PrismaTx,
  ): Promise<void> {
    await tx.providerEquipment.deleteMany({ where: { providerProfileId } });
    if (equipmentItemIds.length === 0) return;
    await tx.providerEquipment.createMany({
      data: equipmentItemIds.map((equipmentItemId) => ({ providerProfileId, equipmentItemId })),
    });
  }

  /** Replace the service-area set. Each row is exactly one of city / district /
   *  neighborhood — the database CHECK constraint enforces that regardless of
   *  what is passed here. */
  async replaceServiceAreas(
    providerProfileId: string,
    areas: { cityId?: string; districtId?: string; neighborhoodId?: string }[],
    tx: PrismaTx,
  ): Promise<void> {
    await tx.providerServiceArea.deleteMany({ where: { providerProfileId } });
    if (areas.length === 0) return;
    await tx.providerServiceArea.createMany({
      data: areas.map((a) => ({
        providerProfileId,
        cityId: a.cityId ?? null,
        districtId: a.districtId ?? null,
        neighborhoodId: a.neighborhoodId ?? null,
      })),
    });
  }

  /** Resolve equipment CODES to ids, keeping only active catalogue items.
   *  Codes rather than ids on the wire so the client can hard-code a stable
   *  value; inactive items are silently excluded here and reported by the
   *  service, so retiring a catalogue entry does not break saved drafts. */
  findEquipmentByCodes(codes: string[], tx?: PrismaTx): Promise<EquipmentCatalogItem[]> {
    if (codes.length === 0) return Promise.resolve([]);
    return this.db(tx).equipmentCatalogItem.findMany({
      where: { code: { in: codes }, isActive: true },
    });
  }

  /** Classify submitted place ids into their tables in one round-trip each.
   *  Returns only ACTIVE rows, so a deactivated district cannot be re-selected
   *  by a client holding a stale catalogue. */
  async findPlaces(
    ids: string[],
    tx?: PrismaTx,
  ): Promise<{ cityIds: string[]; districtIds: string[]; neighborhoodIds: string[] }> {
    if (ids.length === 0) return { cityIds: [], districtIds: [], neighborhoodIds: [] };
    const db = this.db(tx);
    const [cities, districts, neighborhoods] = await Promise.all([
      db.city.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } }),
      db.district.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } }),
      db.neighborhood.findMany({
        where: { id: { in: ids }, isActive: true },
        select: { id: true },
      }),
    ]);
    return {
      cityIds: cities.map((c) => c.id),
      districtIds: districts.map((d) => d.id),
      neighborhoodIds: neighborhoods.map((n) => n.id),
    };
  }
}
