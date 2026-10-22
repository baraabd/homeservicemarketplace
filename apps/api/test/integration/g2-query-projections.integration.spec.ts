/* eslint-disable @typescript-eslint/no-require-imports -- Keep real database/repository imports inside the integration gate. */
import type {
  Booking,
  BookingStatus,
  Prisma,
  PrismaClient,
  PrismaTx,
} from '@homeservicemarketplace/database';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type {
  BookingRepository,
  ProviderBookingListRow,
  AdminFinancialBookingListRow,
} from '../../src/infrastructure/persistence/bookings/booking.repository';
import type { ServiceRequestRepository } from '../../src/infrastructure/persistence/requests/service-request.repository';
import type { ProviderProfileRepository } from '../../src/infrastructure/persistence/bids/provider-profile.repository';
import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';

const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;

// Repository equivalence on PostgreSQL, not a replacement for the real guarded
// HTTP counts/browser checks in the R27 harness. The reference reads retain the
// pre-repair Prisma filters, relations and cursor/skip behavior. Each comparison
// uses one repeatable-read snapshot so parallel fixture writers cannot skew it.
dbDescribe('G2 bounded query projections (real PostgreSQL)', () => {
  const prefix = fixturePrefix('g2-query-projections');
  const id = (suffix: string) => `${prefix}${suffix}`;
  const date = (day: number) => new Date(Date.UTC(2199, 0, day, 12));
  const seeker = id('seeker');
  const otherSeeker = id('other-seeker');
  const provider = id('provider');
  const otherProvider = id('other-provider');
  const detachedProvider = id('detached-provider');
  const category = id('category');
  const inactiveCategory = id('inactive-category');
  const pendingCategory = id('pending-category');
  let prisma: PrismaClient;
  let bookings: BookingRepository;
  let requests: ServiceRequestRepository;
  let profiles: ProviderProfileRepository;
  let lock: HeldLock | undefined;
  const statements: string[] = [];

  const providerSelect = {
    id: true,
    requestId: true,
    bidId: true,
    status: true,
    scheduledAt: true,
    priceAmount: true,
    currency: true,
    createdAt: true,
    updatedAt: true,
    request: {
      select: {
        customServiceText: true,
        addressSnapshot: true,
        category: { select: { id: true, slug: true, labelEn: true, labelAr: true } },
      },
    },
    bid: { select: { pricingType: true, note: true } },
    seeker: { select: { firstName: true } },
  } satisfies Prisma.BookingSelect;

  const financialSelect = {
    id: true,
    priceAmount: true,
    currency: true,
    updatedAt: true,
    request: providerSelect.request,
    provider: {
      select: { id: true, displayName: true, user: { select: { id: true, email: true } } },
    },
    seeker: { select: { id: true, firstName: true } },
  } satisfies Prisma.BookingSelect;

  async function cleanup() {
    if (!prisma) return;
    await prisma.booking.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.bid.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.providerCategoryApplication.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { startsWith: prefix } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  }

  async function snapshot<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn, { isolationLevel: 'RepeatableRead' });
  }

  async function countSelects<T>(count: number, action: () => Promise<T>): Promise<T> {
    const start = statements.length;
    const result = await action();
    expect(statements.slice(start).filter((sql) => /^\s*SELECT\b/i.test(sql))).toHaveLength(count);
    return result;
  }

  beforeAll(async () => {
    lock = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle', mode: 'shared' },
      { resource: 'serviceRequests', mode: 'shared' },
    ]);
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    const client = new db.PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    client.$on('query', (event) => statements.push(event.query));
    prisma = client;
    const { BookingRepository: Bookings } =
      require('../../src/infrastructure/persistence/bookings/booking.repository') as typeof import('../../src/infrastructure/persistence/bookings/booking.repository');
    const { ServiceRequestRepository: Requests } =
      require('../../src/infrastructure/persistence/requests/service-request.repository') as typeof import('../../src/infrastructure/persistence/requests/service-request.repository');
    const { ProviderProfileRepository: Profiles } =
      require('../../src/infrastructure/persistence/bids/provider-profile.repository') as typeof import('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const service = { client: prisma } as unknown as PrismaService;
    bookings = new Bookings(service);
    requests = new Requests(service);
    profiles = new Profiles(service);
    await cleanup();

    await prisma.user.createMany({
      data: [
        'seeker',
        'other-seeker',
        'provider-user',
        'other-provider-user',
        'empty-user',
        'deleted-user',
      ].map((suffix) => ({
        id: id(suffix),
        email: `${id(suffix)}@example.test`,
        firstName: 'Layla',
        lastName: 'Test',
        status: 'ACTIVE',
      })),
    });
    await prisma.providerProfile.createMany({
      data: [
        { id: provider, userId: id('provider-user') },
        { id: otherProvider, userId: id('other-provider-user') },
        { id: detachedProvider, userId: null },
        { id: id('empty-provider'), userId: id('empty-user') },
        { id: id('deleted-provider'), userId: id('deleted-user'), deletedAt: date(1) },
      ].map((row) => ({
        ...row,
        displayName: 'Query fixture',
        initials: 'QF',
        serviceAreaCity: 'Riyadh',
        serviceAreaCityKey: 'riyadh',
        serviceAreaLat: 24.7,
        serviceAreaLng: 46.7,
        serviceAreaRadiusKm: 25,
      })),
    });
    await prisma.serviceCategory.createMany({
      data: [category, inactiveCategory, pendingCategory].map((categoryId) => ({
        id: categoryId,
        slug: categoryId,
        labelEn: 'Plumbing',
        labelAr: 'سباكة',
        icon: 'tool',
        isActive: categoryId !== inactiveCategory,
        deletedAt: categoryId === inactiveCategory ? date(1) : null,
      })),
    });
    await prisma.providerProfileServiceCategory.createMany({
      data: [category, inactiveCategory].map((serviceCategoryId) => ({
        providerProfileId: provider,
        serviceCategoryId,
      })),
    });
    await prisma.providerCategoryApplication.create({
      data: {
        id: id('application'),
        providerProfileId: provider,
        serviceCategoryId: pendingCategory,
        status: 'PENDING',
      },
    });

    await prisma.serviceRequest.createMany({
      data: [
        { id: id('main-request'), status: 'BID_ACCEPTED' as const },
        {
          id: id('custom-request'),
          status: 'BID_ACCEPTED' as const,
          categoryId: null,
          customServiceText: 'Custom fixture',
        },
        { id: id('empty-request'), status: 'OPEN_FOR_BIDS' as const },
        { id: id('bid-count-request'), status: 'OPEN_FOR_BIDS' as const },
        { id: id('deleted-request'), status: 'OPEN_FOR_BIDS' as const, deletedAt: date(1) },
        { id: id('foreign-request'), status: 'OPEN_FOR_BIDS' as const, seekerUserId: otherSeeker },
      ].map((row) => ({
        seekerUserId: seeker,
        categoryId: category,
        scheduleType: 'ASAP' as const,
        addressSnapshot: { city: 'Riyadh', country: 'SA', line1: 'Private fixture address' },
        createdAt: date(1),
        updatedAt: date(1),
        ...row,
      })),
    });

    async function booking(suffix: string, overrides: Partial<Booking> = {}) {
      const requestId = overrides.requestId ?? id(`request-${suffix}`);
      const seekerUserId = overrides.seekerUserId ?? seeker;
      const providerId = overrides.providerId ?? provider;
      if (!overrides.requestId) {
        await prisma.serviceRequest.create({
          data: {
            id: requestId,
            seekerUserId,
            categoryId: category,
            status: 'BID_ACCEPTED',
            scheduleType: 'ASAP',
            addressSnapshot: { city: 'Riyadh', country: 'SA', line1: 'Private fixture address' },
            createdAt: date(1),
            updatedAt: date(1),
          },
        });
      }
      const bidId = id(`bid-${suffix}`);
      await prisma.bid.create({
        data: {
          id: bidId,
          requestId,
          providerId,
          amount: 1001,
          currency: 'SAR',
          pricingType: 'FIXED',
          note: 'Visible booking note',
          status: 'ACCEPTED',
        },
      });
      await prisma.booking.create({
        data: {
          id: id(suffix),
          bidId,
          requestId,
          providerId,
          seekerUserId,
          status: 'COMPLETED',
          priceAmount: 1001,
          currency: 'SAR',
          createdAt: date(1),
          updatedAt: date(1),
          scheduledAt: date(1),
          ...overrides,
        },
      });
    }

    await booking('dated-high', { scheduledAt: date(8), updatedAt: date(8) });
    await booking('dated-tie-z', {
      scheduledAt: date(7),
      createdAt: date(3),
      updatedAt: date(7),
      priceAmount: 101,
    });
    await booking('dated-tie-a', {
      scheduledAt: date(7),
      createdAt: date(3),
      updatedAt: date(7),
      priceAmount: 102,
    });
    await booking('dated-mid', {
      scheduledAt: date(7),
      createdAt: date(2),
      updatedAt: date(6),
      status: 'SCHEDULED',
    });
    await booking('dated-low', { scheduledAt: date(5), updatedAt: date(5) });
    await booking('null-high', {
      scheduledAt: null,
      createdAt: date(5),
      updatedAt: date(4),
      status: 'IN_PROGRESS',
    });
    await booking('null-tie-z', { scheduledAt: null, createdAt: date(3), updatedAt: date(3) });
    await booking('null-tie-a', { scheduledAt: null, createdAt: date(3), updatedAt: date(3) });
    await booking('null-low', { scheduledAt: null, updatedAt: date(1), status: 'CANCELLED' });
    await booking('deleted-date', { scheduledAt: date(6), updatedAt: date(6), deletedAt: date(9) });
    await booking('deleted-null', {
      scheduledAt: null,
      createdAt: date(4),
      updatedAt: date(4),
      deletedAt: date(9),
    });
    await booking('main-a', {
      requestId: id('main-request'),
      scheduledAt: date(2),
      updatedAt: date(2),
      status: 'CANCELLED',
    });
    await booking('main-z', {
      requestId: id('main-request'),
      providerId: otherProvider,
      scheduledAt: date(2),
      updatedAt: date(2),
    });
    await booking('main-deleted', {
      requestId: id('main-request'),
      providerId: detachedProvider,
      updatedAt: date(10),
      deletedAt: date(10),
    });
    await booking('detached-custom', {
      requestId: id('custom-request'),
      providerId: detachedProvider,
      updatedAt: date(9),
    });
    await booking('foreign', {
      requestId: id('foreign-request'),
      providerId: otherProvider,
      seekerUserId: otherSeeker,
      updatedAt: date(8),
    });
    await prisma.bid.createMany({
      data: [
        { id: id('count-pending'), providerId: provider, status: 'PENDING' as const },
        { id: id('count-accepted'), providerId: otherProvider, status: 'ACCEPTED' as const },
        { id: id('count-rejected'), providerId: detachedProvider, status: 'REJECTED' as const },
        { id: id('count-withdrawn'), providerId: provider, status: 'WITHDRAWN' as const },
        {
          id: id('count-deleted'),
          providerId: provider,
          status: 'PENDING' as const,
          deletedAt: date(1),
        },
      ].map((row) => ({
        ...row,
        requestId: id('bid-count-request'),
        amount: 1001,
        currency: 'SAR',
        pricingType: 'FIXED' as const,
      })),
    });
  }, 120_000);

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma?.$disconnect();
      await lock?.release();
    }
  }, 120_000);

  const providerCases: Array<{
    name: string;
    take: number;
    cursor?: string;
    status?: BookingStatus;
  }> = [
    { name: 'first page', take: 5 },
    { name: 'one row', take: 1 },
    { name: 'large page', take: 100 },
    { name: 'completed filter', take: 5, status: 'COMPLETED' },
    { name: 'scheduled tie', take: 5, cursor: 'dated-tie-z' },
    { name: 'scheduled lower partition', take: 5, cursor: 'dated-low' },
    { name: 'null schedule partition', take: 5, cursor: 'null-high' },
    { name: 'null schedule tie', take: 5, cursor: 'null-tie-z' },
    { name: 'deleted scheduled anchor', take: 5, cursor: 'deleted-date' },
    { name: 'deleted null anchor', take: 5, cursor: 'deleted-null' },
    { name: 'status-excluded anchor', take: 5, cursor: 'dated-mid', status: 'COMPLETED' },
    { name: 'null status-excluded anchor', take: 5, cursor: 'null-high', status: 'COMPLETED' },
    { name: 'foreign anchor', take: 5, cursor: 'foreign' },
    { name: 'missing anchor', take: 5, cursor: 'missing' },
    { name: 'final page', take: 5, cursor: 'null-low' },
  ];

  it.each(providerCases)(
    'provider page equals Prisma: $name',
    async ({ name: _name, ...input }) => {
      const args = {
        ...input,
        providerId: provider,
        cursor: input.cursor ? id(input.cursor) : undefined,
      };
      await snapshot(async (tx) => {
        const actual = await countSelects(1, () => bookings.listForProviderSummary(args, tx));
        const expected = await tx.booking.findMany({
          where: {
            providerId: provider,
            deletedAt: null,
            ...(args.status ? { status: args.status } : {}),
          },
          take: args.take,
          ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
          orderBy: [
            { scheduledAt: { sort: 'desc', nulls: 'last' } },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
          select: providerSelect,
        });
        expect(actual).toEqual(expected);
        const original = await bookings.listForProvider(args, tx);
        expect(actual.map((row) => row.id)).toEqual(original.map((row) => row.id));
        expect(
          actual.every(
            (row) => !['foreign', 'main-z', 'main-deleted'].includes(row.id.slice(prefix.length)),
          ),
        ).toBe(true);
      });
    },
  );

  it('walks every provider page once across date/null/tie boundaries', async () => {
    await snapshot(async (tx) => {
      const expected = await tx.booking.findMany({
        where: { providerId: provider, deletedAt: null },
        orderBy: [
          { scheduledAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        select: { id: true },
      });
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let attempt = 0; attempt <= expected.length; attempt++) {
        const page = await bookings.listForProviderSummary(
          { providerId: provider, take: 2, cursor },
          tx,
        );
        if (page.length === 0) break;
        seen.push(...page.map((row) => row.id));
        cursor = page.at(-1)!.id;
      }
      expect(seen).toEqual(expected.map((row) => row.id));
      expect(new Set(seen).size).toBe(seen.length);
    });
  });

  it('retains the separate cursor ownership decision, including deleted owned anchors', async () => {
    expect(await bookings.isCursorOwnedByProvider(id('deleted-date'), provider)).toBe(true);
    expect(await bookings.isCursorOwnedByProvider(id('foreign'), provider)).toBe(false);
    expect(await bookings.isCursorOwnedByProvider(id('missing'), provider)).toBe(false);
    expect(
      await countSelects(1, () =>
        bookings.listForProviderSummary({ providerId: id('empty-provider'), take: 5 }),
      ),
    ).toEqual([]);
  });

  const financialCases = [
    { name: 'first page', take: 5 },
    { name: 'large page', take: 100 },
    { name: 'timestamp tie', take: 5, cursor: 'dated-tie-z' },
    { name: 'deleted anchor', take: 5, cursor: 'deleted-date' },
    { name: 'incomplete anchor', take: 5, cursor: 'dated-mid' },
    { name: 'missing anchor', take: 5, cursor: 'missing' },
  ];

  it.each(financialCases)(
    'financial page equals Prisma: $name',
    async ({ name: _name, ...input }) => {
      const args = { ...input, cursor: input.cursor ? id(input.cursor) : undefined };
      await snapshot(async (tx) => {
        const actual = await countSelects(1, () =>
          bookings.listCompletedBookingsForAdmin(args, tx),
        );
        const expected = await tx.booking.findMany({
          where: { deletedAt: null, status: 'COMPLETED' },
          take: args.take,
          ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          select: financialSelect,
        });
        expect(actual).toEqual(expected);
        expect(actual.some((row) => row.id === id('main-deleted'))).toBe(false);
      });
    },
  );

  it('preserves mutable financial cursor semantics instead of inventing a snapshot cursor', async () => {
    const rollback = new Error('rollback fixture-only cursor mutation');
    await expect(
      prisma.$transaction(
        async (tx) => {
          await tx.booking.update({
            where: { id: id('dated-tie-z') },
            data: { updatedAt: date(12) },
          });
          const actual = await bookings.listCompletedBookingsForAdmin(
            { take: 5, cursor: id('dated-tie-z') },
            tx,
          );
          const expected = await tx.booking.findMany({
            where: { deletedAt: null, status: 'COMPLETED' },
            take: 5,
            cursor: { id: id('dated-tie-z') },
            skip: 1,
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            select: financialSelect,
          });
          expect(actual).toEqual(expected);
          throw rollback;
        },
        { isolationLevel: 'RepeatableRead' },
      ),
    ).rejects.toBe(rollback);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: id('dated-tie-z') } })).updatedAt,
    ).toEqual(date(7));
  });

  it('preserves exact money, nullable category/user and authorized display fields', async () => {
    const page = await bookings.listCompletedBookingsForAdmin({ take: 100 });
    const detached = page.find((row) => row.id === id('detached-custom'));
    expect(detached).toMatchObject({
      priceAmount: 1001,
      currency: 'SAR',
      updatedAt: date(9),
      request: {
        category: null,
        customServiceText: 'Custom fixture',
        addressSnapshot: { line1: 'Private fixture address' },
      },
      provider: { id: detachedProvider, user: null },
      seeker: { id: seeker, firstName: 'Layla' },
    });
    expect(page.find((row) => row.id === id('dated-tie-z'))?.priceAmount).toBe(101);
  });

  it.each([
    { name: 'first page', take: 5 },
    { name: 'large page', take: 100 },
    { name: 'status filter', take: 5, status: 'OPEN_FOR_BIDS' as const },
    { name: 'cursor', take: 5, cursor: id('empty-request') },
  ])('seeker enrichment equals original relations: $name', async ({ name: _name, ...input }) => {
    const args = { ...input, seekerUserId: seeker };
    await snapshot(async (tx) => {
      const actual = await requests.listForSeeker(args, tx);
      const expected = await tx.serviceRequest.findMany({
        where: {
          seekerUserId: seeker,
          deletedAt: null,
          ...(args.status ? { status: args.status } : {}),
        },
        take: args.take,
        ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
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
      expect(
        actual.some((row) => [id('foreign-request'), id('deleted-request')].includes(row.id)),
      ).toBe(false);
    });
  });

  it('counts only visible bids and selects the latest visible booking using its ID tie-break', async () => {
    const rows = await requests.listForSeeker({ seekerUserId: seeker, take: 100 });
    expect(rows.find((row) => row.id === id('bid-count-request'))?._count?.bids).toBe(3);
    expect(rows.find((row) => row.id === id('empty-request'))).toMatchObject({
      _count: { bids: 0 },
      bookings: [],
    });
    expect(rows.find((row) => row.id === id('main-request'))?.bookings).toEqual([
      { id: id('main-z'), status: 'COMPLETED', updatedAt: date(2) },
    ]);
    await countSelects(3, () =>
      requests.listForSeeker({ seekerUserId: seeker, status: 'OPEN_FOR_BIDS', take: 5 }),
    );
    expect(
      await countSelects(1, () =>
        requests.listForSeeker({ seekerUserId: id('missing-user'), take: 5 }),
      ),
    ).toEqual([]);
  });

  it('reads only the profile area and linked category IDs in one statement', async () => {
    await snapshot(async (tx) => {
      const actual = await countSelects(1, () =>
        profiles.findByUserIdForAvailableRequests(id('provider-user'), tx),
      );
      const expected = await tx.providerProfile.findFirst({
        where: { userId: id('provider-user'), deletedAt: null },
        select: {
          id: true,
          userId: true,
          serviceAreaLat: true,
          serviceAreaLng: true,
          serviceAreaRadiusKm: true,
          serviceAreaCity: true,
          serviceAreaCityKey: true,
          serviceCategories: {
            select: { serviceCategoryId: true },
            orderBy: { serviceCategoryId: 'asc' },
          },
        },
      });
      expect(actual).toEqual(expected);
      expect(actual?.serviceCategories.map((link) => link.serviceCategoryId)).toEqual(
        [category, inactiveCategory].sort(),
      );
      expect(actual?.serviceCategories.map((link) => link.serviceCategoryId)).not.toContain(
        pendingCategory,
      );
    });
  });

  it('retains missing/deleted/empty profile behavior and nullable area fields', async () => {
    expect(
      await countSelects(1, () => profiles.findByUserIdForAvailableRequests(id('missing-user'))),
    ).toBeNull();
    expect(
      await countSelects(1, () => profiles.findByUserIdForAvailableRequests(id('deleted-user'))),
    ).toBeNull();
    const rollback = new Error('rollback fixture-only profile mutation');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.providerProfile.update({
          where: { id: id('empty-provider') },
          data: {
            serviceAreaCity: null,
            serviceAreaCityKey: null,
            serviceAreaLat: null,
            serviceAreaLng: null,
            serviceAreaRadiusKm: null,
          },
        });
        const actual = await countSelects(1, () =>
          profiles.findByUserIdForAvailableRequests(id('empty-user'), tx),
        );
        expect(actual).toEqual({
          id: id('empty-provider'),
          userId: id('empty-user'),
          serviceCategories: [],
          serviceAreaCity: null,
          serviceAreaCityKey: null,
          serviceAreaLat: null,
          serviceAreaLng: null,
          serviceAreaRadiusKm: null,
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('uses the supplied transaction for booking projections and seeker enrichment', async () => {
    const rollback = new Error('rollback fixture-only projection mutation');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: id('dated-high') },
          data: { priceAmount: 4321, updatedAt: date(13) },
        });
        const providerRows: ProviderBookingListRow[] = await bookings.listForProviderSummary(
          { providerId: provider, take: 100 },
          tx,
        );
        const financialRows: AdminFinancialBookingListRow[] =
          await bookings.listCompletedBookingsForAdmin({ take: 100 }, tx);
        const seekerRows = await requests.listForSeeker({ seekerUserId: seeker, take: 100 }, tx);
        expect(providerRows.find((row) => row.id === id('dated-high'))?.priceAmount).toBe(4321);
        expect(financialRows.find((row) => row.id === id('dated-high'))?.priceAmount).toBe(4321);
        expect(
          seekerRows.find((row) => row.id === id('request-dated-high'))?.bookings?.[0].updatedAt,
        ).toEqual(date(13));
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: id('dated-high') } })).priceAmount,
    ).toBe(1001);
  });

  it('honors the configured connection schema instead of reading public tables', async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    const url = new URL(process.env.DATABASE_URL!);
    // A one-connection, session-local schema exercises the same URL schema
    // setting without creating a persistent schema or changing migrations.
    url.searchParams.set('schema', 'pg_temp');
    url.searchParams.set('connection_limit', '1');
    const isolated = new db.PrismaClient({ datasourceUrl: url.toString() });
    try {
      const tables = [
        'User',
        'ProviderProfile',
        'ServiceCategory',
        'ProviderProfileServiceCategory',
        'ServiceRequest',
        'Bid',
        'Booking',
      ] as const;
      for (const table of tables) {
        // Identifiers are exclusively this constant fixture allowlist. Values
        // remain bound parameters; no request input reaches Prisma.raw.
        const tableName = db.Prisma.raw(`"${table}"`);
        const ownerColumn = db.Prisma.raw(
          table === 'ProviderProfileServiceCategory' ? '"providerProfileId"' : '"id"',
        );
        await isolated.$executeRaw(
          db.Prisma
            .sql`CREATE TEMPORARY TABLE ${tableName} (LIKE "public".${tableName} INCLUDING ALL)`,
        );
        await isolated.$executeRaw(
          db.Prisma
            .sql`INSERT INTO ${tableName} SELECT * FROM "public".${tableName} WHERE ${ownerColumn} LIKE ${`${prefix}%`}`,
        );
      }
      await isolated.providerProfile.update({
        where: { id: provider },
        data: { serviceAreaCity: 'Isolated city', serviceAreaCityKey: 'isolated city' },
      });
      await isolated.booking.update({
        where: { id: id('dated-high') },
        data: { priceAmount: 7777, updatedAt: date(15) },
      });
      await isolated.serviceRequest.update({
        where: { id: id('empty-request') },
        data: { customServiceText: 'Isolated request' },
      });
      const { BookingRepository: Bookings } =
        require('../../src/infrastructure/persistence/bookings/booking.repository') as typeof import('../../src/infrastructure/persistence/bookings/booking.repository');
      const { ServiceRequestRepository: Requests } =
        require('../../src/infrastructure/persistence/requests/service-request.repository') as typeof import('../../src/infrastructure/persistence/requests/service-request.repository');
      const { ProviderProfileRepository: Profiles } =
        require('../../src/infrastructure/persistence/bids/provider-profile.repository') as typeof import('../../src/infrastructure/persistence/bids/provider-profile.repository');
      const service = { client: isolated } as unknown as PrismaService;
      const isolatedBookings = new Bookings(service);
      const providerPage = await isolatedBookings.listForProviderSummary({
        providerId: provider,
        take: 100,
      });
      const financialPage = await isolatedBookings.listCompletedBookingsForAdmin({ take: 100 });
      const seekerPage = await new Requests(service).listForSeeker({
        seekerUserId: seeker,
        take: 100,
      });
      const profile = await new Profiles(service).findByUserIdForAvailableRequests(
        id('provider-user'),
      );
      expect(providerPage.find((row) => row.id === id('dated-high'))?.priceAmount).toBe(7777);
      expect(financialPage.find((row) => row.id === id('dated-high'))?.priceAmount).toBe(7777);
      expect(seekerPage.find((row) => row.id === id('empty-request'))?.customServiceText).toBe(
        'Isolated request',
      );
      expect(
        seekerPage.find((row) => row.id === id('request-dated-high'))?.bookings?.[0].updatedAt,
      ).toEqual(date(15));
      expect(profile?.serviceAreaCity).toBe('Isolated city');
      expect(
        (await prisma.booking.findUniqueOrThrow({ where: { id: id('dated-high') } })).priceAmount,
      ).toBe(1001);
    } finally {
      await isolated.$disconnect();
    }
  });
});
