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
    const result = await this.db(tx).providerOnboardingDraft.updateMany({
      where: { providerProfileId, version: expectedVersion },
      data: {
        currentStep: patch.currentStep,
        completedSteps: patch.completedSteps,
        data: patch.data,
        version: { increment: 1 },
        lastSavedAt: new Date(),
      },
    });
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
