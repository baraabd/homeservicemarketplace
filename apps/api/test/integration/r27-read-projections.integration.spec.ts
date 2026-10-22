import type { BookingStatus, PrismaTx } from '@homeservicemarketplace/database';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type {
  BookingWithAdminRelations,
  ProviderBookingListRow,
} from '../../src/infrastructure/persistence/bookings/booking.repository';
import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Real PostgreSQL repository equivalence and statement accounting. These are
// component assertions, not HTTP/auth or hosted capacity acceptance: R27's
// same-harness HTTP profile and the existing R17 guard suites supply that proof.
// Compare each new read with the previous Prisma read under REPEATABLE READ,
// so unrelated parallel fixtures cannot change between the two observations.
const enabled = process.env.RUN_DB_INTEGRATION === '1';
const P = fixturePrefix('r27-read-projections');
const seekerId = `${P}seeker`;
const providerUserId = `${P}provider-user`;
const providerId = `${P}provider`;
const otherProviderId = `${P}other-provider`;
const categoryId = `${P}category`;
const inactiveCategoryId = `${P}inactive-category`;
const stamp = new Date('2200-01-01T00:00:00.123Z');
const idAt = (kind: string, index: number) => `${P}${kind}-${String(index).padStart(3, '0')}`;

async function harness() {
  const { PrismaClient } = await import('@homeservicemarketplace/database');
  const client = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  const statements: string[] = [];
  client.$on('query', (event) => {
    if (/^\s*SELECT\b/i.test(event.query)) statements.push(event.query);
  });
  const [{ BookingRepository }, { ServiceRequestRepository }, { ProviderProfileRepository }] =
    await Promise.all([
      import('../../src/infrastructure/persistence/bookings/booking.repository'),
      import('../../src/infrastructure/persistence/requests/service-request.repository'),
      import('../../src/infrastructure/persistence/bids/provider-profile.repository'),
    ]);
  const prisma = { client } as unknown as PrismaService;
  return {
    db: client,
    statements,
    bookings: new BookingRepository(prisma),
    requests: new ServiceRequestRepository(prisma),
    providers: new ProviderProfileRepository(prisma),
  };
}

(enabled ? describe : describe.skip)('R27 read projections on real PostgreSQL', () => {
  let h: Awaited<ReturnType<typeof harness>>;
  let locks: HeldLock | undefined;

  async function clean() {
    const owned = { startsWith: P };
    await h.db.booking.deleteMany({ where: { id: owned } });
    await h.db.bid.deleteMany({ where: { id: owned } });
    await h.db.serviceRequest.deleteMany({ where: { id: owned } });
    await h.db.providerProfileServiceCategory.deleteMany({ where: { providerProfileId: owned } });
    await h.db.providerProfile.deleteMany({ where: { id: owned } });
    await h.db.serviceCategory.deleteMany({ where: { id: owned } });
    await h.db.user.deleteMany({ where: { id: owned } });
  }

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle', mode: 'shared' },
      { resource: 'serviceRequests', mode: 'shared' },
    ]);
    h = await harness();
    await clean();
    await h.db.user.createMany({
      data: [seekerId, providerUserId, `${P}other-user`].map((id) => ({
        id,
        email: `${id}@example.test`,
        firstName: 'Synthetic',
        lastName: 'Private',
        status: 'ACTIVE',
        isActive: true,
      })),
    });
    await h.db.providerProfile.createMany({
      data: [
        {
          id: providerId,
          userId: providerUserId,
          displayName: 'R27 provider',
          initials: 'RP',
          serviceAreaCity: 'Aleppo',
          serviceAreaCityKey: 'aleppo',
          serviceAreaLat: 36.2,
          serviceAreaLng: 37.16,
          serviceAreaRadiusKm: 10,
        },
        { id: otherProviderId, userId: `${P}other-user`, displayName: 'Other', initials: 'OT' },
        { id: `${P}unlinked-provider`, displayName: 'Unlinked', initials: 'UL' },
      ],
    });
    await h.db.serviceCategory.createMany({
      data: [
        { id: categoryId, slug: categoryId, labelEn: 'Plumbing', labelAr: 'سباكة', icon: 'wrench' },
        {
          id: inactiveCategoryId,
          slug: inactiveCategoryId,
          labelEn: 'Historical category',
          labelAr: 'فئة سابقة',
          icon: 'wrench',
          isActive: false,
          deletedAt: stamp,
        },
      ],
    });
    await h.db.providerProfileServiceCategory.createMany({
      data: [categoryId, inactiveCategoryId].map((serviceCategoryId) => ({
        providerProfileId: providerId,
        serviceCategoryId,
      })),
    });
    const indices = Array.from({ length: 120 }, (_, i) => i);
    await h.db.serviceRequest.createMany({
      data: indices.map((i) => ({
        id: idAt('request', i),
        seekerUserId: seekerId,
        categoryId: i % 5 === 0 ? null : i % 7 === 0 ? inactiveCategoryId : categoryId,
        customServiceText: i % 5 === 0 ? 'Custom service' : null,
        description: `Synthetic private request ${i}`,
        status: 'BID_ACCEPTED',
        scheduleType: 'ASAP',
        addressSnapshot: { city: 'Aleppo', country: 'SY', line1: `Private ${i}` },
        createdAt: new Date(stamp.getTime() + Math.floor(i / 4) * 3_600_000),
        updatedAt: stamp,
        deletedAt: i === 11 ? stamp : null,
      })),
    });
    await h.db.bid.createMany({
      data: indices.map((i) => ({
        id: idAt('bid', i),
        requestId: idAt('request', i),
        providerId: i < 110 ? providerId : otherProviderId,
        amount: 1001 + i,
        currency: i % 2 === 0 ? 'USD' : 'SEK',
        pricingType: i % 2 === 0 ? 'FIXED' : 'HOURLY',
        note: `Original bid ${i}`,
        status: i === 115 ? 'WITHDRAWN' : 'ACCEPTED',
        deletedAt: i === 116 ? stamp : null,
      })),
    });
    await h.db.booking.createMany({
      data: indices.map((i) => ({
        id: idAt('booking', i),
        requestId: idAt('request', i),
        bidId: idAt('bid', i),
        seekerUserId: seekerId,
        providerId: i === 119 ? `${P}unlinked-provider` : i < 110 ? providerId : otherProviderId,
        priceAmount: 1001 + i,
        currency: i % 2 === 0 ? 'USD' : 'SEK',
        status: i === 15 ? 'SCHEDULED' : i === 16 ? 'IN_PROGRESS' : 'COMPLETED',
        scheduledAt:
          i % 3 === 0 ? null : new Date(stamp.getTime() + Math.floor(i / 6) * 86_400_000),
        createdAt: new Date(stamp.getTime() + Math.floor(i / 4) * 3_600_000),
        updatedAt: new Date(stamp.getTime() + Math.floor(i / 3) * 3_600_000),
        deletedAt: i === 17 ? stamp : null,
      })),
    });
  }, 30_000);

  afterAll(async () => {
    try {
      if (h) await clean();
    } finally {
      await h?.db.$disconnect();
      await locks?.release();
    }
  });

  const repeatable = (fn: (tx: PrismaTx) => Promise<void>) =>
    h.db.$transaction(fn, { isolationLevel: 'RepeatableRead' });

  async function counted<T>(limit: number, read: () => Promise<T>): Promise<T> {
    h.statements.length = 0;
    const result = await read();
    expect(h.statements).toHaveLength(limit);
    return result;
  }

  async function oldProviderPage(
    tx: PrismaTx,
    args: { take: number; cursor?: string; status?: BookingStatus },
  ): Promise<ProviderBookingListRow[]> {
    const rows = await tx.booking.findMany({
      where: { providerId, deletedAt: null, ...(args.status ? { status: args.status } : {}) },
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [
        { scheduledAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      include: {
        request: { include: { category: true } },
        bid: true,
        provider: true,
        seeker: { select: { id: true, firstName: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      requestId: row.requestId,
      bidId: row.bidId,
      status: row.status,
      scheduledAt: row.scheduledAt,
      priceAmount: row.priceAmount,
      currency: row.currency,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      request: {
        addressSnapshot: row.request.addressSnapshot,
        customServiceText: row.request.customServiceText,
        category: row.request.category
          ? {
              id: row.request.category.id,
              slug: row.request.category.slug,
              labelEn: row.request.category.labelEn,
              labelAr: row.request.category.labelAr,
            }
          : null,
      },
      bid: { pricingType: row.bid.pricingType, note: row.bid.note },
      seeker: row.seeker,
    }));
  }

  async function oldFinancialPage(
    tx: PrismaTx,
    args: { take: number; cursor?: string },
  ): Promise<BookingWithAdminRelations[]> {
    const rows = await tx.booking.findMany({
      where: { deletedAt: null, status: 'COMPLETED' },
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        request: { include: { category: true } },
        bid: true,
        provider: { include: { user: { select: { id: true, email: true } } } },
        seeker: { select: { id: true, firstName: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      priceAmount: row.priceAmount,
      currency: row.currency,
      updatedAt: row.updatedAt,
      request: {
        addressSnapshot: row.request.addressSnapshot,
        customServiceText: row.request.customServiceText,
        category: row.request.category
          ? {
              id: row.request.category.id,
              slug: row.request.category.slug,
              labelEn: row.request.category.labelEn,
              labelAr: row.request.category.labelAr,
            }
          : null,
      },
      provider: {
        id: row.provider.id,
        displayName: row.provider.displayName,
        user: row.provider.user,
      },
      seeker: row.seeker,
    }));
  }

  it.each([5, 20, 100])(
    'provider limit %i preserves old fields/order with one statement',
    async (take) => {
      await repeatable(async (tx) => {
        const actual = await counted(1, () => h.bookings.listForProvider({ providerId, take }, tx));
        expect(actual).toEqual(await oldProviderPage(tx, { take }));
        expect(actual).toHaveLength(take);
        expect(JSON.stringify(actual)).not.toContain('@example.test');
        expect(actual.some((row) => row.id === idAt('booking', 17))).toBe(false);
      });
    },
  );

  it.each([109, 108, 96, 17, 15])(
    'provider cursor %i retains nullable/tied/deleted/status semantics',
    async (i) => {
      await repeatable(async (tx) => {
        const args = {
          providerId,
          take: 20,
          cursor: idAt('booking', i),
          status: 'COMPLETED' as const,
        };
        const actual = await counted(1, () => h.bookings.listForProvider(args, tx));
        expect(actual).toEqual(await oldProviderPage(tx, args));
      });
    },
  );

  it('provider ownership and adversarial identities cannot position a private page', async () => {
    expect(await h.bookings.isCursorOwnedByProvider(idAt('booking', 115), providerId)).toBe(false);
    expect(await h.bookings.isCursorOwnedByProvider(idAt('booking', 17), providerId)).toBe(true);
    expect(await h.bookings.isCursorOwnedByProvider("x' OR TRUE --", providerId)).toBe(false);
    expect(
      await h.bookings.listForProvider({ providerId, take: 20, cursor: idAt('booking', 115) }),
    ).toEqual([]);
    expect(await h.bookings.listForProvider({ providerId: "x' OR TRUE --", take: 20 })).toEqual([]);
  });

  it.each([5, 20, 100])(
    'financial limit %i preserves values and original order with one statement',
    async (take) => {
      await repeatable(async (tx) => {
        const actual = await counted(1, () =>
          h.bookings.listCompletedBookingsForAdmin({ take }, tx),
        );
        expect(actual).toEqual(await oldFinancialPage(tx, { take }));
        expect(actual).toHaveLength(take);
        expect(actual[0].updatedAt).toBeInstanceOf(Date);
      });
    },
  );

  it.each([110, 108, 17, 15])(
    'financial cursor %i retains tied/deleted/status semantics',
    async (i) => {
      await repeatable(async (tx) => {
        const args = { take: 20, cursor: idAt('booking', i) };
        const actual = await counted(1, () => h.bookings.listCompletedBookingsForAdmin(args, tx));
        expect(actual).toEqual(await oldFinancialPage(tx, args));
      });
    },
  );

  it('financial invented cursor returns no rows and remains parameterized', async () => {
    expect(
      await h.bookings.listCompletedBookingsForAdmin({ take: 20, cursor: "x' OR TRUE --" }),
    ).toEqual([]);
  });

  it.each([5, 20, 100])(
    'seeker limit %i retains category, counts and latest booking in three statements',
    async (take) => {
      await repeatable(async (tx) => {
        const actual = await counted(3, () =>
          h.requests.listForSeeker({ seekerUserId: seekerId, take }, tx),
        );
        const expected = await tx.serviceRequest.findMany({
          where: { seekerUserId: seekerId, deletedAt: null },
          take,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            category: true,
            bookings: {
              where: { deletedAt: null },
              orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: { id: true, status: true, updatedAt: true },
            },
            _count: {
              select: { bids: { where: { deletedAt: null, status: { not: 'WITHDRAWN' } } } },
            },
          },
        });
        expect(actual).toEqual(expected);
        expect(actual).toHaveLength(take);
        expect(actual.find((row) => row.id === idAt('request', 115))?._count?.bids).toBe(0);
        expect(actual.find((row) => row.id === idAt('request', 116))?._count?.bids).toBe(0);
      });
    },
  );

  it('seeker empty and foreign scopes do not start an enrichment query', async () => {
    expect(
      await counted(1, () => h.requests.listForSeeker({ seekerUserId: providerUserId, take: 20 })),
    ).toEqual([]);
    expect(await h.requests.listForSeeker({ seekerUserId: "x' OR TRUE --", take: 20 })).toEqual([]);
  });

  it('seeker recovery keeps the latest live booking and excludes a newer soft-deleted one', async () => {
    const rollback = new Error('rollback synthetic booking history');
    await expect(
      h.db.$transaction(async (tx) => {
        for (const index of [120, 121]) {
          const historyProvider = index === 120 ? providerId : `${P}unlinked-provider`;
          await tx.bid.create({
            data: {
              id: idAt('bid', index),
              requestId: idAt('request', 119),
              providerId: historyProvider,
              amount: 1111,
              pricingType: 'FIXED',
              status: 'ACCEPTED',
            },
          });
          await tx.booking.create({
            data: {
              id: idAt('booking', index),
              requestId: idAt('request', 119),
              bidId: idAt('bid', index),
              seekerUserId: seekerId,
              providerId: historyProvider,
              priceAmount: 1111,
              currency: 'USD',
              status: index === 120 ? 'IN_PROGRESS' : 'COMPLETED',
              updatedAt: new Date(`2201-01-0${index - 119}T00:00:00Z`),
              deletedAt: index === 121 ? stamp : null,
            },
          });
        }
        const [actual] = await counted(3, () =>
          h.requests.listForSeeker({ seekerUserId: seekerId, take: 1 }, tx),
        );
        expect(actual.id).toBe(idAt('request', 119));
        expect(actual.bookings).toEqual([
          {
            id: idAt('booking', 120),
            status: 'IN_PROGRESS',
            updatedAt: new Date('2201-01-01T00:00:00Z'),
          },
        ]);
        expect(actual._count?.bids).toBe(3);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('marketplace projection reads exact configured categories/geo once without pending/private data', async () => {
    await repeatable(async (tx) => {
      const actual = await counted(1, () =>
        h.providers.findMarketplaceProfileByUserId(providerUserId, tx),
      );
      const previous = await h.providers.findByUserIdWithCategories(providerUserId, tx);
      expect(actual).toEqual({
        id: previous!.id,
        userId: previous!.userId,
        serviceAreaLat: previous!.serviceAreaLat,
        serviceAreaLng: previous!.serviceAreaLng,
        serviceAreaRadiusKm: previous!.serviceAreaRadiusKm,
        serviceAreaCity: previous!.serviceAreaCity,
        serviceAreaCityKey: previous!.serviceAreaCityKey,
        serviceCategories: previous!.serviceCategories
          .map(({ serviceCategoryId }) => ({ serviceCategoryId }))
          .sort((a, b) => a.serviceCategoryId.localeCompare(b.serviceCategoryId)),
      });
      expect(actual?.serviceCategories).toContainEqual({ serviceCategoryId: inactiveCategoryId });
      expect(JSON.stringify(actual)).not.toMatch(
        /email|phone|pendingCategories|categoryApplications/,
      );
    });
    expect(await h.providers.findMarketplaceProfileByUserId("x' OR TRUE --")).toBeNull();
    expect(
      (await h.providers.findMarketplaceProfileByUserId(`${P}other-user`))?.serviceCategories,
    ).toEqual([]);
  });

  it('all projections observe caller-owned uncommitted state and do not escape rollback', async () => {
    const failure = new Error('intentional outer rollback');
    await expect(
      h.db.$transaction(async (tx) => {
        await tx.serviceCategory.update({
          where: { id: categoryId },
          data: { labelEn: 'Uncommitted' },
        });
        await tx.bid.update({ where: { id: idAt('bid', 109) }, data: { status: 'WITHDRAWN' } });
        await tx.booking.update({
          where: { id: idAt('booking', 109) },
          data: {
            priceAmount: 9187,
            updatedAt: new Date(stamp.getTime() + Math.floor(109 / 3) * 3_600_000),
          },
        });
        await tx.providerProfileServiceCategory.deleteMany({
          where: { providerProfileId: providerId },
        });
        const seeker = await h.requests.listForSeeker({ seekerUserId: seekerId, take: 30 }, tx);
        expect(seeker.find((row) => row.id === idAt('request', 109))?._count?.bids).toBe(0);
        expect(seeker.find((row) => row.id === idAt('request', 109))?.category?.labelEn).toBe(
          'Uncommitted',
        );
        const provider = await h.bookings.listForProvider({ providerId, take: 110 }, tx);
        expect(provider.find((row) => row.id === idAt('booking', 109))?.priceAmount).toBe(9187);
        const financial = await h.bookings.listCompletedBookingsForAdmin({ take: 30 }, tx);
        expect(financial.find((row) => row.id === idAt('booking', 109))?.priceAmount).toBe(9187);
        expect(
          (await h.providers.findMarketplaceProfileByUserId(providerUserId, tx))?.serviceCategories,
        ).toEqual([]);
        // A separate pooled connection cannot observe the caller's provisional change.
        expect(
          (await h.db.booking.findUniqueOrThrow({ where: { id: idAt('booking', 109) } }))
            .priceAmount,
        ).toBe(1110);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(
      (await h.db.booking.findUniqueOrThrow({ where: { id: idAt('booking', 109) } })).priceAmount,
    ).toBe(1110);
    expect(
      (await h.providers.findMarketplaceProfileByUserId(providerUserId))?.serviceCategories,
    ).toHaveLength(2);
  });

  it('a separately committed cursor update retains the prior mutable-position contract', async () => {
    const first = await h.bookings.listCompletedBookingsForAdmin({ take: 20 });
    const cursor = first.at(-1)!;
    const original = await h.db.booking.findUniqueOrThrow({ where: { id: cursor.id } });
    expect(original.id.startsWith(P)).toBe(true);
    try {
      // This commit occurs between HTTP-equivalent page reads, outside their
      // transactions. It deliberately does not assert a snapshot guarantee.
      await h.db.booking.update({
        where: { id: cursor.id },
        data: { updatedAt: new Date('2201-01-01T00:00:00Z') },
      });
      await repeatable(async (tx) => {
        const args = { take: 20, cursor: cursor.id };
        const actual = await h.bookings.listCompletedBookingsForAdmin(args, tx);
        expect(actual).toEqual(await oldFinancialPage(tx, args));
        expect(actual.some((row) => first.some((before) => before.id === row.id))).toBe(true);
      });
    } finally {
      await h.db.booking.update({
        where: { id: cursor.id },
        data: { updatedAt: original.updatedAt },
      });
    }
  });

  it('a committed profile removal is visible to the next uncached marketplace read', async () => {
    try {
      await h.db.providerProfile.update({ where: { id: providerId }, data: { deletedAt: stamp } });
      expect(await h.providers.findMarketplaceProfileByUserId(providerUserId)).toBeNull();
    } finally {
      await h.db.providerProfile.update({ where: { id: providerId }, data: { deletedAt: null } });
    }
  });

  it('honors a caller datasource schema and rolls back its isolated schema without reading public rows', async () => {
    const { PrismaClient } = await import('@homeservicemarketplace/database');
    const schema = 'it_r27_read_projection_scope';
    const scopedUrl = new URL(process.env.DATABASE_URL!);
    scopedUrl.searchParams.set('schema', schema);
    const scoped = new PrismaClient({ datasources: { db: { url: scopedUrl.toString() } } });
    const rollback = new Error('rollback isolated schema');
    try {
      await expect(
        scoped.$transaction(async (tx) => {
          // Static, test-owned identifiers only. The schema, copied projection
          // tables and fixture rows are all uncommitted and rolled back together.
          // No live row, public constraint or migration is changed.
          await tx.$executeRaw`DO $fixture$ BEGIN
          CREATE SCHEMA "it_r27_read_projection_scope";
          CREATE TABLE "it_r27_read_projection_scope"."User" (LIKE "public"."User");
          CREATE TABLE "it_r27_read_projection_scope"."ProviderProfile" (LIKE "public"."ProviderProfile");
          CREATE TABLE "it_r27_read_projection_scope"."ProviderProfileServiceCategory" (LIKE "public"."ProviderProfileServiceCategory");
          CREATE TABLE "it_r27_read_projection_scope"."ServiceCategory" (LIKE "public"."ServiceCategory");
          CREATE TABLE "it_r27_read_projection_scope"."ServiceRequest" (LIKE "public"."ServiceRequest");
          CREATE TABLE "it_r27_read_projection_scope"."Bid" (LIKE "public"."Bid");
          CREATE TABLE "it_r27_read_projection_scope"."Booking" (LIKE "public"."Booking");
        END $fixture$`;
          await tx.$executeRaw`INSERT INTO "it_r27_read_projection_scope"."User"
          SELECT * FROM "public"."User" WHERE id IN (${seekerId}, ${providerUserId})`;
          await tx.$executeRaw`INSERT INTO "it_r27_read_projection_scope"."ProviderProfile"
          SELECT * FROM "public"."ProviderProfile" WHERE id = ${providerId}`;
          await tx.$executeRaw`INSERT INTO "it_r27_read_projection_scope"."ProviderProfileServiceCategory"
          SELECT * FROM "public"."ProviderProfileServiceCategory" WHERE "providerProfileId" = ${providerId}`;
          await tx.$executeRaw`INSERT INTO "it_r27_read_projection_scope"."ServiceCategory"
          SELECT * FROM "public"."ServiceCategory" WHERE id IN (${categoryId}, ${inactiveCategoryId})`;
          await tx.$executeRaw`INSERT INTO "it_r27_read_projection_scope"."ServiceRequest"
          SELECT * FROM "public"."ServiceRequest" WHERE id = ${idAt('request', 109)}`;
          await tx.$executeRaw`INSERT INTO "it_r27_read_projection_scope"."Bid"
          SELECT * FROM "public"."Bid" WHERE id = ${idAt('bid', 109)}`;
          await tx.$executeRaw`INSERT INTO "it_r27_read_projection_scope"."Booking"
          SELECT * FROM "public"."Booking" WHERE id = ${idAt('booking', 109)}`;
          // LIKE copies the original enum column types. Public supplies those
          // types only; each relation named by the reads exists in this schema.
          await tx.$queryRaw`SELECT set_config('search_path', ${`${schema}, public`}, true)`;
          await tx.$executeRaw`UPDATE "Booking" SET "priceAmount" = 9876`;
          await tx.$executeRaw`UPDATE "Bid" SET status = 'WITHDRAWN'`;
          await tx.$executeRaw`UPDATE "ServiceCategory" SET "labelEn" = 'Schema category'`;
          await tx.$executeRaw`UPDATE "ProviderProfile" SET "serviceAreaCity" = 'Schema city'`;

          const seeker = await h.requests.listForSeeker({ seekerUserId: seekerId, take: 20 }, tx);
          expect(seeker).toHaveLength(1);
          expect(seeker[0].id).toBe(idAt('request', 109));
          expect(seeker[0].category?.labelEn).toBe('Schema category');
          expect(seeker[0]._count?.bids).toBe(0);
          const provider = await h.bookings.listForProvider({ providerId, take: 20 }, tx);
          expect(provider).toHaveLength(1);
          expect(provider[0].priceAmount).toBe(9876);
          expect(provider[0].request.category?.labelEn).toBe('Schema category');
          const financial = await h.bookings.listCompletedBookingsForAdmin({ take: 20 }, tx);
          expect(financial).toHaveLength(1);
          expect(financial[0].priceAmount).toBe(9876);
          expect(
            (await h.providers.findMarketplaceProfileByUserId(providerUserId, tx))?.serviceAreaCity,
          ).toBe('Schema city');
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await scoped.$disconnect();
    }
    expect(
      (await h.db.booking.findUniqueOrThrow({ where: { id: idAt('booking', 109) } })).priceAmount,
    ).toBe(1110);
    expect(
      (await h.providers.findMarketplaceProfileByUserId(providerUserId))?.serviceAreaCity,
    ).toBe('Aleppo');
    expect(
      await h.db
        .$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${schema}`,
    ).toEqual([]);
  });
});
