/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy requires: with RUN_DB_INTEGRATION unset this suite is skipped, and a
 * top-level import of AppModule would validate env and open pools on every
 * hermetic run.
 */

export {};

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 09B.29 Phase 5 (C1) — the V2 onboarding defaults, against real Postgres.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §1.6
//
// WHY THIS SUITE EXISTS RATHER THAN MORE UNIT TESTS
//
// The C1 policy is pure and already covered. What it cannot answer is whether
// APPLYING it is safe, and three specific doubts were raised about the first
// implementation:
//
//   1. `ensure()` read the row and then upserted, so "did I create it" was a
//      time-of-check/time-of-use guess.
//   2. the defaults were decided from a previously-loaded `ctx.profile` and
//      then written unconditionally, so a concurrent explicit write between
//      the read and the write would be overwritten.
//   3. a brand-new provider has NO primary service, so a headline seeded only
//      at draft creation would be blank for ever.
//
// None of those is observable with a fake: they are all about what two real
// connections do to one row. So this suite drives real Postgres.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

d('Phase 5 C1 — onboarding defaults are race-safe (real Postgres)', () => {
  let prisma: any;
  let service: any;
  let lifecycleLock: HeldLock;

  const P = fixturePrefix('p5-c1');
  const USER = `${P}user`;
  const PROFILE = `${P}profile`;
  const ROOT = `${P}root`;
  const LEAF = `${P}leaf`;

  /** A profile in whatever starting state a case needs. */
  async function makeProfile(
    over: Record<string, unknown> = {},
    id = PROFILE,
    userId = USER,
  ): Promise<string> {
    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email: `${userId}@p5c1.invalid`,
        passwordHash: 'x',
        firstName: 'Pat',
        lastName: 'Provider',
      },
      update: {},
    });
    await prisma.providerProfile.create({
      data: {
        id,
        userId,
        displayName: 'Pat Provider',
        initials: 'PP',
        availability: 'OFFLINE',
        ...over,
      },
    });
    // The draft, exactly as the real flow creates it: `get()` calls
    // `drafts.ensure()` BEFORE applying defaults, so a draft always exists by
    // the time the service runs. It is also where the provenance stamp lives,
    // so a suite that skipped it would be testing a state the product never
    // reaches.
    await prisma.providerOnboardingDraft.create({
      data: { providerProfileId: id, currentStep: 'PROVIDER_TYPE', policyVersion: 'test-v1' },
    });
    return id;
  }

  const profileRow = (id = PROFILE) =>
    prisma.providerProfile.findUnique({
      where: { id },
      select: { providerType: true, headline: true, updatedAt: true },
    });

  const draftRow = (providerProfileId = PROFILE) =>
    prisma.providerOnboardingDraft.findUnique({ where: { providerProfileId } });

  async function wipe(): Promise<void> {
    const profiles = await prisma.providerProfile.findMany({
      where: { id: { startsWith: P } },
      select: { id: true },
    });
    const ids = profiles.map((p: { id: string }) => p.id);
    if (ids.length > 0) {
      await prisma.providerOnboardingDraft.deleteMany({
        where: { providerProfileId: { in: ids } },
      });
      await prisma.providerProfileServiceCategory.deleteMany({
        where: { providerProfileId: { in: ids } },
      });
      await prisma.providerCategoryApplication.deleteMany({
        where: { providerProfileId: { in: ids } },
      });
      await prisma.providerProfile.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: [LEAF, ROOT] } } });
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const {
      ProviderOnboardingDefaultsService,
    } = require('../../src/modules/provider/onboarding/market/onboarding-defaults.service');
    service = new ProviderOnboardingDefaultsService({ client: prisma });

    await wipe();
    await prisma.serviceCategory.create({
      data: { id: ROOT, slug: ROOT, labelEn: 'Painting', labelAr: 'دهان', icon: 'brush' },
    });
    await prisma.serviceCategory.create({
      data: {
        id: LEAF,
        slug: LEAF,
        labelEn: 'Interior painting',
        labelAr: 'دهانات داخلية',
        icon: 'brush',
        parentId: ROOT,
      },
    });
  });

  afterAll(async () => {
    await wipe();
    await lifecycleLock?.release();
  });

  beforeEach(async () => {
    const profiles = await prisma.providerProfile.findMany({
      where: { id: { startsWith: P } },
      select: { id: true },
    });
    const ids = profiles.map((p: { id: string }) => p.id);
    if (ids.length > 0) {
      await prisma.providerOnboardingDraft.deleteMany({
        where: { providerProfileId: { in: ids } },
      });
      await prisma.providerProfile.deleteMany({ where: { id: { in: ids } } });
    }
  });

  // ── providerType ─────────────────────────────────────────────────────────

  describe('providerType', () => {
    it('defaults to INDIVIDUAL when the profile has none', async () => {
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null });

      expect((await profileRow()).providerType).toBe('INDIVIDUAL');
    });

    it('NEVER overwrites an explicit BUSINESS value', async () => {
      await makeProfile({ providerType: 'BUSINESS' });
      await service.apply(PROFILE, { suggestedTitle: null });

      expect((await profileRow()).providerType).toBe('BUSINESS');
    });

    it('loses to a CONCURRENT explicit write rather than overwriting it', async () => {
      // Doubt (2). The default is decided from a row read earlier; if the write
      // is unconditional, an explicit BUSINESS landing in between is lost.
      await makeProfile();

      await Promise.all([
        service.apply(PROFILE, { suggestedTitle: null }),
        prisma.providerProfile.update({
          where: { id: PROFILE },
          data: { providerType: 'BUSINESS' },
        }),
      ]);

      // Whichever order the two land in, the EXPLICIT value must survive: the
      // default may only fill a column that is still empty at write time.
      expect((await profileRow()).providerType).toBe('BUSINESS');
    });

    it('is idempotent across repeated application', async () => {
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null });
      const first = await profileRow();

      await service.apply(PROFILE, { suggestedTitle: null });
      const second = await profileRow();

      expect(second.providerType).toBe('INDIVIDUAL');
      // An ordinary read must not move updatedAt — a default that rewrites the
      // same value on every GET is a write amplifier and a false audit signal.
      expect(second.updatedAt).toEqual(first.updatedAt);
    });
  });

  // ── headline, including the LATE primary service ─────────────────────────

  describe('headline', () => {
    it('stays blank while the provider has no primary service yet', async () => {
      // Doubt (3). A brand-new provider has no primary service, so there is no
      // suggestion to seed. Nothing must be invented.
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null });

      expect((await profileRow()).headline).toBeNull();
    });

    it('seeds LATER, when a primary service first makes a suggestion available', async () => {
      // The heart of doubt (3): if defaults ran only at draft creation, this
      // headline would be blank for ever.
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null });
      expect((await profileRow()).headline).toBeNull();

      await service.apply(PROFILE, { suggestedTitle: 'Painting professional' });

      expect((await profileRow()).headline).toBe('Painting professional');
    });

    it('NEVER overwrites a headline the provider wrote', async () => {
      await makeProfile({ headline: 'The best painter in Aleppo' });
      await service.apply(PROFILE, { suggestedTitle: 'Painting professional' });

      expect((await profileRow()).headline).toBe('The best painter in Aleppo');
    });

    it('seeds over an empty or whitespace legacy headline', async () => {
      await makeProfile({ headline: '   ' });
      await service.apply(PROFILE, { suggestedTitle: 'Painting professional' });

      expect((await profileRow()).headline).toBe('Painting professional');
    });

    it('does NOT refill a headline the provider deliberately cleared', async () => {
      // Provenance. Once seeded, clearing is the provider's decision and must
      // survive every later read — otherwise the default is an overwrite on a
      // delay.
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: 'Painting professional' });
      expect((await profileRow()).headline).toBe('Painting professional');

      await prisma.providerProfile.update({ where: { id: PROFILE }, data: { headline: null } });
      await service.apply(PROFILE, { suggestedTitle: 'Painting professional' });

      expect((await profileRow()).headline).toBeNull();
    });

    it('loses to a CONCURRENT explicit headline', async () => {
      await makeProfile();

      await Promise.all([
        service.apply(PROFILE, { suggestedTitle: 'Painting professional' }),
        prisma.providerProfile.update({
          where: { id: PROFILE },
          data: { headline: 'Chosen by the provider' },
        }),
      ]);

      expect((await profileRow()).headline).toBe('Chosen by the provider');
    });

    it('records provenance exactly once, in the draft the server owns', async () => {
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: 'Painting professional' });

      const draft = await draftRow();
      const data = (draft?.data ?? {}) as Record<string, unknown>;
      expect(typeof data.v2GeneratedHeadlineAt).toBe('string');

      const first = data.v2GeneratedHeadlineAt;
      await service.apply(PROFILE, { suggestedTitle: 'Something else entirely' });
      const again = ((await draftRow())?.data ?? {}) as Record<string, unknown>;

      // Neither the headline nor the stamp moves on a second application.
      expect(again.v2GeneratedHeadlineAt).toBe(first);
      expect((await profileRow()).headline).toBe('Painting professional');
    });
  });

  // ── locale ───────────────────────────────────────────────────────────────

  describe('locale', () => {
    it('stores the suggestion in the language the provider was shown', async () => {
      // Two providers, two locales, one service. Each keeps the wording they
      // actually saw and accepted.
      await makeProfile({}, `${P}en`, `${P}enuser`);
      await makeProfile({}, `${P}ar`, `${P}aruser`);

      await service.apply(`${P}en`, { suggestedTitle: 'Painting professional' });
      await service.apply(`${P}ar`, { suggestedTitle: 'فني دهانات' });

      expect((await profileRow(`${P}en`)).headline).toBe('Painting professional');
      expect((await profileRow(`${P}ar`)).headline).toBe('فني دهانات');
    });

    it('does not re-translate a stored headline when the language changes', async () => {
      // A headline is a single user-facing string in the language it was
      // confirmed in. Switching UI language must not rewrite it.
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: 'فني دهانات' });

      await service.apply(PROFILE, { suggestedTitle: 'Painting professional' });

      expect((await profileRow()).headline).toBe('فني دهانات');
    });
  });

  // ── concurrency at the draft ─────────────────────────────────────────────

  describe('two concurrent first requests', () => {
    it('produce ONE draft, no P2002, and one set of defaults', async () => {
      // Doubt (1). Two first requests for the same provider is the ordinary
      // case — a tab restore, a double tap — not an exotic one.
      await makeProfile();

      const results = await Promise.allSettled([
        service.apply(PROFILE, { suggestedTitle: 'Painting professional' }),
        service.apply(PROFILE, { suggestedTitle: 'Painting professional' }),
        service.apply(PROFILE, { suggestedTitle: 'Painting professional' }),
      ]);

      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toEqual([]);

      const drafts = await prisma.providerOnboardingDraft.findMany({
        where: { providerProfileId: PROFILE },
      });
      expect(drafts).toHaveLength(1);

      const row = await profileRow();
      expect(row.providerType).toBe('INDIVIDUAL');
      expect(row.headline).toBe('Painting professional');
    });
  });

  // ── radius derivation and provenance (C2) ────────────────────────────────

  describe('radius', () => {
    const CAR = { suggestedKm: 15, basedOn: 'CAR' };
    const FOOT = { suggestedKm: 3, basedOn: 'ON_FOOT' };

    const radiusOf = async (id = PROFILE) =>
      (
        await prisma.providerProfile.findUnique({
          where: { id },
          select: { serviceAreaRadiusKm: true },
        })
      ).serviceAreaRadiusKm;

    const stampOf = async (id = PROFILE) => {
      const draft = await draftRow(id);
      return ((draft?.data ?? {}) as Record<string, unknown>).v2DerivedRadius as
        | { basedOn: string | null; km: number; at: string }
        | undefined;
    };

    it('derives a radius when none is stored, and records where it came from', async () => {
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null, radius: CAR });

      expect(await radiusOf()).toBe(15);
      expect(await stampOf()).toMatchObject({ basedOn: 'CAR', km: 15 });
    });

    it('recomputes a DERIVED radius when the primary transport changes', async () => {
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null, radius: CAR });
      await service.apply(PROFILE, { suggestedTitle: null, radius: FOOT });

      expect(await radiusOf()).toBe(3);
      expect(await stampOf()).toMatchObject({ basedOn: 'ON_FOOT', km: 3 });
    });

    it('PRESERVES a legacy radius that carries no provenance', async () => {
      // The provider chose 22 km, or a migration wrote it. Either way nothing
      // recorded it as ours, so it is theirs — for ever.
      await makeProfile({ serviceAreaRadiusKm: 22 });
      await service.apply(PROFILE, { suggestedTitle: null, radius: CAR });

      expect(await radiusOf()).toBe(22);
      expect(await stampOf()).toBeUndefined();
    });

    it('PRESERVES a value the provider edited after we derived it', async () => {
      // This is the case a value comparison gets wrong. We derived 15, the
      // provider changed it to 25, and the stamp still says 15 — so the stored
      // number is no longer ours and must not be recomputed.
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null, radius: CAR });
      await prisma.providerProfile.update({
        where: { id: PROFILE },
        data: { serviceAreaRadiusKm: 25 },
      });

      await service.apply(PROFILE, { suggestedTitle: null, radius: FOOT });

      expect(await radiusOf()).toBe(25);
    });

    it('does NOT infer provenance from the value matching the suggestion', async () => {
      // The provider deliberately chose exactly the number we would have
      // suggested. A comparison-based implementation would treat it as derived
      // and silently move it when the market's numbers changed; the absence of
      // a stamp is what keeps it theirs.
      await makeProfile({ serviceAreaRadiusKm: 15 });
      await service.apply(PROFILE, { suggestedTitle: null, radius: FOOT });

      expect(await radiusOf()).toBe(15);
    });

    it('is idempotent — repeated application neither rewrites nor re-stamps', async () => {
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null, radius: CAR });
      const first = await stampOf();

      await service.apply(PROFILE, { suggestedTitle: null, radius: CAR });

      expect(await radiusOf()).toBe(15);
      expect((await stampOf())?.at).toBe(first?.at);
    });

    it('loses to a CONCURRENT explicit radius', async () => {
      await makeProfile();

      await Promise.all([
        service.apply(PROFILE, { suggestedTitle: null, radius: CAR }),
        prisma.providerProfile.update({
          where: { id: PROFILE },
          data: { serviceAreaRadiusKm: 30 },
        }),
      ]);

      // The conditional write carries the expected current value, so whichever
      // order they land in the explicit number survives.
      expect(await radiusOf()).toBe(30);
    });

    it('writes nothing at all when the caller supplies no policy answer', async () => {
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null });

      expect(await radiusOf()).toBeNull();
      expect(await stampOf()).toBeUndefined();
    });
  });

  // ── provenance identity and atomicity (audit round) ──────────────────────

  describe('radius provenance carries enough identity to explain the value', () => {
    const CAR_SY = { suggestedKm: 15, basedOn: 'CAR', countryCode: 'SY', policyVersion: 'v1' };

    const stampOf = async (id = PROFILE) =>
      ((await draftRow(id))?.data ?? {}).v2DerivedRadius as Record<string, unknown> | undefined;

    it('records the MARKET, not only the transport mode', async () => {
      // Without the country, a later request cannot tell whether a derived
      // radius is still right: the same CAR basis means 15 km in one market
      // and something else in another, so "same transport, different country"
      // is indistinguishable from "nothing changed".
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null, radius: CAR_SY });

      expect(await stampOf()).toMatchObject({
        basedOn: 'CAR',
        km: 15,
        countryCode: 'SY',
      });
    });

    it('records the policy version, so a settings change can be detected', async () => {
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null, radius: CAR_SY });

      expect(await stampOf()).toMatchObject({ policyVersion: 'v1' });
    });

    it('RECOMPUTES when the country changes but the transport does not', async () => {
      // The case the transport-only stamp gets wrong.
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null, radius: CAR_SY });

      await service.apply(PROFILE, {
        suggestedTitle: null,
        radius: { suggestedKm: 40, basedOn: 'CAR', countryCode: 'SE', policyVersion: 'v1' },
      });

      expect(
        (
          await prisma.providerProfile.findUnique({
            where: { id: PROFILE },
            select: { serviceAreaRadiusKm: true },
          })
        ).serviceAreaRadiusKm,
      ).toBe(40);
      expect(await stampOf()).toMatchObject({ countryCode: 'SE', km: 40 });
    });

    it('RECOMPUTES when the market policy version changes', async () => {
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null, radius: CAR_SY });

      await service.apply(PROFILE, {
        suggestedTitle: null,
        radius: { suggestedKm: 18, basedOn: 'CAR', countryCode: 'SY', policyVersion: 'v2' },
      });

      expect(await stampOf()).toMatchObject({ policyVersion: 'v2', km: 18 });
    });

    it('CLEARS provenance when the provider sets the value explicitly', async () => {
      // Even when the number they choose equals the suggestion. A stale stamp
      // would let a later market change silently move a value the provider
      // deliberately picked.
      await makeProfile();
      await service.apply(PROFILE, { suggestedTitle: null, radius: CAR_SY });

      await service.recordExplicitRadius(PROFILE, 15);

      expect(await stampOf()).toBeUndefined();
    });

    it('does not lose a CONCURRENT write to another draft.data key', async () => {
      // The lost-update hazard: provenance was written by spreading a
      // previously-read `data` object into a full replacement, so a headline
      // stamp written in between would be erased.
      await makeProfile();
      await Promise.all([
        service.apply(PROFILE, { suggestedTitle: 'Painting professional', radius: CAR_SY }),
        service.apply(PROFILE, { suggestedTitle: 'Painting professional', radius: CAR_SY }),
      ]);

      const data = ((await draftRow())?.data ?? {}) as Record<string, unknown>;
      expect(data.v2GeneratedHeadlineAt).toBeDefined();
      expect(data.v2DerivedRadius).toBeDefined();
    });
  });
});
