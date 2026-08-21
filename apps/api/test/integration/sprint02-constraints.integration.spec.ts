/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
export {}; // module marker.
//
// Sprint 2 — the four database constraints, and the concurrency they exist to
// survive.
//
// Every one of these invariants was previously enforced by a SELECT followed
// by an INSERT inside a transaction. Under Postgres' default READ COMMITTED
// isolation that pattern is not atomic: two concurrent callers both read
// "nothing there" and both write. The unit suites cannot see this — they mock
// the repository, and a mock has no isolation level — so it can only be caught
// here, against a real database, with genuinely parallel writers.
//
// The tests therefore fire real concurrent requests rather than simulating
// them. `Promise.all` over independent transactions is what actually produces
// the interleaving; awaiting them in sequence would pass against the old code
// and prove nothing.
//
// Gated by RUN_DB_INTEGRATION=1. Uses uniquely-suffixed fixtures and deletes
// only its own rows — it never truncates, so it can share a database with the
// other suites.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(90_000);

const TAG = `s2c-${Date.now()}`;

d('Sprint 2 constraints — concurrency and ownership', () => {
  let prisma: any;
  let categories: { a: any; b: any };
  const createdUserIds: string[] = [];
  const createdProfileIds: string[] = [];
  const createdCategoryIds: string[] = [];
  const createdRequestIds: string[] = [];

  // Service-layer wiring, so the tests exercise the code paths the API uses
  // rather than a parallel reimplementation of them.
  let providerCategories: any;

  async function makeProvider(suffix: string) {
    const user = await prisma.user.create({
      data: {
        email: `${TAG}-${suffix}@itest.local`,
        firstName: 'P',
        lastName: suffix,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    createdUserIds.push(user.id);
    const profile = await prisma.providerProfile.create({
      data: { userId: user.id, displayName: `Provider ${suffix}`, initials: 'PX' },
    });
    createdProfileIds.push(profile.id);
    return { user, profile };
  }

  beforeAll(async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const {
      ProviderProfileRepository,
    } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const {
      ProviderCategoryApplicationRepository,
    } = require('../../src/infrastructure/persistence/services/provider-category-application.repository');
    const {
      ServiceCategoryRepository,
    } = require('../../src/infrastructure/persistence/services/service-category.repository');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const { ProviderCategoriesService } =
      require('../../src/modules/provider/categories/provider-categories.service') as {
        ProviderCategoriesService: typeof import('../../src/modules/provider/categories/provider-categories.service').ProviderCategoriesService;
      };

    const prismaSvc = { client: prisma, isReady: () => true, ping: async () => true };
    providerCategories = new ProviderCategoriesService(
      new ProviderProfileRepository(prismaSvc),
      new ProviderCategoryApplicationRepository(prismaSvc),
      new ServiceCategoryRepository(prismaSvc),
      new AuditService(new AuditEventRepository(prismaSvc)),
      new TransactionRunner(prismaSvc),
    );

    const a = await prisma.serviceCategory.create({
      data: {
        slug: `${TAG}-alpha`,
        labelEn: 'Alpha',
        labelAr: 'Alpha-ar',
        icon: 'a',
        sortOrder: 900,
      },
    });
    const b = await prisma.serviceCategory.create({
      data: {
        slug: `${TAG}-beta`,
        labelEn: 'Beta',
        labelAr: 'Beta-ar',
        icon: 'b',
        sortOrder: 901,
      },
    });
    categories = { a, b };
    createdCategoryIds.push(a.id, b.id);
  });

  afterAll(async () => {
    // Children first — the schema cascades, but being explicit keeps a partial
    // failure from stranding rows that a later run would trip over.
    await prisma.bid.deleteMany({ where: { providerId: { in: createdProfileIds } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    await prisma.providerCategoryApplication.deleteMany({
      where: { providerProfileId: { in: createdProfileIds } },
    });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { in: createdProfileIds } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { in: createdProfileIds } } });
    await prisma.auditEvent.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.address.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: createdCategoryIds } } });
    await prisma.$disconnect();
  });

  // ── C1: one live PENDING application per (provider, category) ────────────
  describe('one pending category application', () => {
    it('two SIMULTANEOUS applications leave exactly one live PENDING row', async () => {
      const { user, profile } = await makeProvider('race-apply');

      // The real race. Both calls run their own transaction concurrently, so
      // both pass the findLivePending check before either inserts.
      const results = await Promise.allSettled([
        providerCategories.apply(user.id, { categoryId: categories.a.id }),
        providerCategories.apply(user.id, { categoryId: categories.a.id }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The loser gets the ordinary "already applied" answer, not a 500. This
      // is what the P2002 mapping in the service buys.
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });

      const live = await prisma.providerCategoryApplication.findMany({
        where: {
          providerProfileId: profile.id,
          serviceCategoryId: categories.a.id,
          status: 'PENDING',
          supersededAt: null,
        },
      });
      expect(live).toHaveLength(1);
    });

    it('the database refuses a duplicate even when the service is bypassed', async () => {
      // Proves the constraint is real rather than a convention the service
      // happens to honour. Any future code path that writes this table
      // directly is covered by the same guarantee.
      const { profile } = await makeProvider('raw-dup');
      await prisma.providerCategoryApplication.create({
        data: { providerProfileId: profile.id, serviceCategoryId: categories.a.id },
      });
      await expect(
        prisma.providerCategoryApplication.create({
          data: { providerProfileId: profile.id, serviceCategoryId: categories.a.id },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('a REJECTED application does not block re-applying', async () => {
      // The index is partial for exactly this reason. A plain unique would
      // have permanently barred a provider from a second attempt.
      const { user, profile } = await makeProvider('reapply');
      const first = await providerCategories.apply(user.id, { categoryId: categories.a.id });
      await prisma.providerCategoryApplication.update({
        where: { id: first.application.id },
        data: { status: 'REJECTED' },
      });

      const second = await providerCategories.apply(user.id, { categoryId: categories.a.id });
      expect(second.application.status).toBe('PENDING');

      // Both rows survive: the rejection stays as history beside the retry.
      const all = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: profile.id, serviceCategoryId: categories.a.id },
      });
      expect(all).toHaveLength(2);
    });

    it('a superseded row does not block re-applying either', async () => {
      const { user, profile } = await makeProvider('superseded');
      const first = await providerCategories.apply(user.id, { categoryId: categories.b.id });
      await prisma.providerCategoryApplication.update({
        where: { id: first.application.id },
        data: { supersededAt: new Date() },
      });

      await expect(
        providerCategories.apply(user.id, { categoryId: categories.b.id }),
      ).resolves.toMatchObject({ application: { status: 'PENDING' } });

      const rows = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: profile.id, serviceCategoryId: categories.b.id },
      });
      expect(rows).toHaveLength(2);
    });
  });

  // ── ownership ────────────────────────────────────────────────────────────
  describe('ownership', () => {
    it('a provider sees only their own applications', async () => {
      const alice = await makeProvider('own-alice');
      const bob = await makeProvider('own-bob');

      await providerCategories.apply(alice.user.id, { categoryId: categories.a.id });
      await providerCategories.apply(bob.user.id, { categoryId: categories.b.id });

      const aliceList = await providerCategories.listMine(alice.user.id, {});
      const bobList = await providerCategories.listMine(bob.user.id, {});

      expect(aliceList.items.map((i: any) => i.category.id)).toEqual([categories.a.id]);
      expect(bobList.items.map((i: any) => i.category.id)).toEqual([categories.b.id]);

      // The decisive assertion: neither list contains the other's row, and no
      // request parameter existed through which either could have asked for it.
      const aliceIds = new Set(aliceList.items.map((i: any) => i.id));
      for (const item of bobList.items) expect(aliceIds.has(item.id)).toBe(false);
    });

    it('applying as one provider never touches another provider profile', async () => {
      const alice = await makeProvider('cross-alice');
      const bob = await makeProvider('cross-bob');

      await providerCategories.apply(alice.user.id, { categoryId: categories.a.id });

      const bobRows = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: bob.profile.id },
      });
      expect(bobRows).toHaveLength(0);
    });
  });

  // ── C2: case-insensitive unique email ────────────────────────────────────
  describe('case-insensitive unique email', () => {
    it('rejects an address that differs only in case', async () => {
      const email = `${TAG}-Case@itest.local`;
      const first = await prisma.user.create({
        data: { email: email.toLowerCase(), firstName: 'A', lastName: 'A', status: 'ACTIVE' },
      });
      createdUserIds.push(first.id);

      await expect(
        prisma.user.create({
          data: { email: email.toUpperCase(), firstName: 'B', lastName: 'B', status: 'ACTIVE' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('still allows genuinely different addresses', async () => {
      const u = await prisma.user.create({
        data: {
          email: `${TAG}-distinct@itest.local`,
          firstName: 'C',
          lastName: 'C',
          status: 'ACTIVE',
        },
      });
      createdUserIds.push(u.id);
      expect(u.id).toBeTruthy();
    });
  });

  // ── C3: one default address per user ─────────────────────────────────────
  describe('one default address per user', () => {
    it('rejects a second default for the same user', async () => {
      const { user } = await makeProvider('addr');
      await prisma.address.create({
        data: {
          userId: user.id,
          label: 'Home',
          city: 'Aleppo',
          country: 'SY',
          type: 'HOME',
          line1: '1 St',
          isDefault: true,
        },
      });
      await expect(
        prisma.address.create({
          data: {
            userId: user.id,
            label: 'Work',
            city: 'Aleppo',
            country: 'SY',
            type: 'WORK',
            line1: '2 St',
            isDefault: true,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('two CONCURRENT promotions cannot both win', async () => {
      const { user } = await makeProvider('addr-race');
      const mk = (label: string, type: string) =>
        prisma.address.create({
          data: {
            userId: user.id,
            label,
            city: 'Aleppo',
            country: 'SY',
            type,
            line1: label,
            isDefault: false,
          },
        });
      const one = await mk('One', 'HOME');
      const two = await mk('Two', 'WORK');

      const results = await Promise.allSettled([
        prisma.address.update({ where: { id: one.id }, data: { isDefault: true } }),
        prisma.address.update({ where: { id: two.id }, data: { isDefault: true } }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const defaults = await prisma.address.count({
        where: { userId: user.id, isDefault: true, deletedAt: null },
      });
      expect(defaults).toBe(1);
    });

    it('a soft-deleted default does not consume the slot', async () => {
      const { user } = await makeProvider('addr-softdel');
      const old = await prisma.address.create({
        data: {
          userId: user.id,
          label: 'Old',
          city: 'Aleppo',
          country: 'SY',
          type: 'HOME',
          line1: 'old',
          isDefault: true,
        },
      });
      await prisma.address.update({
        where: { id: old.id },
        data: { deletedAt: new Date() },
      });

      // Without `deletedAt IS NULL` in the index predicate this would fail and
      // the user could never have a default again.
      const fresh = await prisma.address.create({
        data: {
          userId: user.id,
          label: 'New',
          city: 'Aleppo',
          country: 'SY',
          type: 'HOME',
          line1: 'new',
          isDefault: true,
        },
      });
      expect(fresh.isDefault).toBe(true);
    });
  });

  // ── C4: one active bid per (provider, request) ───────────────────────────
  describe('one active bid per provider and request', () => {
    async function makeOpenRequest(seekerUserId: string) {
      const req = await prisma.serviceRequest.create({
        data: {
          seekerUserId,
          categoryId: categories.a.id,
          description: 'integration fixture',
          status: 'OPEN_FOR_BIDS',
          scheduleType: 'ASAP',
          addressSnapshot: { city: 'Aleppo', country: 'SY' },
        },
      });
      createdRequestIds.push(req.id);
      return req;
    }

    it('two SIMULTANEOUS bids from one provider leave exactly one active', async () => {
      const seeker = await makeProvider('bid-seeker');
      const provider = await makeProvider('bid-provider');
      const req = await makeOpenRequest(seeker.user.id);

      const submit = (amount: number) =>
        prisma.bid.create({
          data: {
            requestId: req.id,
            providerId: provider.profile.id,
            amount,
            pricingType: 'FIXED',
          },
        });

      const results = await Promise.allSettled([submit(100), submit(120)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const active = await prisma.bid.count({
        where: {
          requestId: req.id,
          providerId: provider.profile.id,
          status: { not: 'WITHDRAWN' },
          deletedAt: null,
        },
      });
      // The seeker sees this provider once, at one price.
      expect(active).toBe(1);
    });

    it('withdrawing frees the slot so the provider can bid again', async () => {
      const seeker = await makeProvider('bid-wd-seeker');
      const provider = await makeProvider('bid-wd-provider');
      const req = await makeOpenRequest(seeker.user.id);

      const first = await prisma.bid.create({
        data: {
          requestId: req.id,
          providerId: provider.profile.id,
          amount: 100,
          pricingType: 'FIXED',
        },
      });
      await prisma.bid.update({ where: { id: first.id }, data: { status: 'WITHDRAWN' } });

      const second = await prisma.bid.create({
        data: {
          requestId: req.id,
          providerId: provider.profile.id,
          amount: 90,
          pricingType: 'FIXED',
        },
      });
      expect(second.id).toBeTruthy();

      // The withdrawn bid is still on record — the constraint excludes it, it
      // does not delete it.
      const all = await prisma.bid.count({
        where: { requestId: req.id, providerId: provider.profile.id },
      });
      expect(all).toBe(2);
    });

    it('two DIFFERENT providers may both bid on the same request', async () => {
      const seeker = await makeProvider('bid-multi-seeker');
      const p1 = await makeProvider('bid-multi-1');
      const p2 = await makeProvider('bid-multi-2');
      const req = await makeOpenRequest(seeker.user.id);

      await prisma.bid.create({
        data: { requestId: req.id, providerId: p1.profile.id, amount: 100, pricingType: 'FIXED' },
      });
      await prisma.bid.create({
        data: { requestId: req.id, providerId: p2.profile.id, amount: 110, pricingType: 'FIXED' },
      });

      const count = await prisma.bid.count({ where: { requestId: req.id } });
      expect(count).toBe(2);
    });
  });
});
