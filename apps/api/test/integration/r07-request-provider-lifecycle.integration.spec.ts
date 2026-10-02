/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * R07 is intentionally a real-Postgres suite. Lazy requires keep the ordinary
 * hermetic unit run from opening a database pool when RUN_DB_INTEGRATION is off.
 */

export {};

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

d('R07 — request-to-provider lifecycle hardening (real Postgres)', () => {
  let prisma: any;
  let requests: any;
  let providerBids: any;
  let providerBookings: any;
  let requestRepo: any;
  let txRunner: any;
  let batchHandler: any;
  let notificationCreateMany: jest.Mock;

  const P = fixturePrefix('r07-lifecycle');
  const SEEKER = `${P}seeker`;
  const ELIGIBLE_USER = `${P}eligible-user`;
  const INELIGIBLE_USER = `${P}ineligible-user`;
  const ELIGIBLE_PP = `${P}eligible-pp`;
  const INELIGIBLE_PP = `${P}ineligible-pp`;
  const CATEGORY = `${P}category`;
  const OTHER_CATEGORY = `${P}other-category`;

  let locks: HeldLock | undefined;

  const baseRequest = (idempotencyKey?: string) => ({
    customServiceText: 'R07 lifecycle proof',
    description: 'A real request used by the R07 integration suite.',
    scheduleType: 'ASAP',
    scheduledAt: null,
    manualAddress: {
      line1: '1 Test Street',
      city: 'Aleppo',
      country: 'SY',
    },
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

  const categorizedRequest = (idempotencyKey?: string) => ({
    ...baseRequest(idempotencyKey),
    categoryId: CATEGORY,
    customServiceText: null,
  });

  async function cleanup(): Promise<void> {
    const requestRows = await prisma.serviceRequest.findMany({
      where: { seekerUserId: SEEKER },
      select: { id: true },
    });
    const requestIds = requestRows.map((row: { id: string }) => row.id);

    if (requestIds.length > 0) {
      await prisma.outboxHandlerRun
        .deleteMany({
          where: {
            event: {
              aggregateType: 'ServiceRequest',
              aggregateId: { in: requestIds },
            },
          },
        })
        .catch(() => undefined);
      await prisma.outboxEvent.deleteMany({
        where: {
          aggregateType: 'ServiceRequest',
          aggregateId: { in: requestIds },
        },
      });
      await prisma.notification.deleteMany({
        where: { resourceId: { in: requestIds } },
      });
      await prisma.booking.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.bid.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.serviceRequestEvent.deleteMany({ where: { requestId: { in: requestIds } } });
      await prisma.serviceRequest.deleteMany({ where: { id: { in: requestIds } } });
    }

    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { in: [ELIGIBLE_PP, INELIGIBLE_PP] } },
    });
    await prisma.providerProfile.deleteMany({
      where: { id: { in: [ELIGIBLE_PP, INELIGIBLE_PP] } },
    });
    await prisma.serviceCategory.deleteMany({
      where: { id: { in: [CATEGORY, OTHER_CATEGORY] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [SEEKER, ELIGIBLE_USER, INELIGIBLE_USER] } },
    });
  }

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([
      { resource: 'outbox' as const, mode: 'shared' as const },
      { resource: 'providerLifecycle' as const, mode: 'shared' as const },
      { resource: 'serviceRequests' as const, mode: 'shared' as const },
    ]);

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    const prismaSvc = { client: prisma };

    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      AddressRepository,
    } = require('../../src/infrastructure/persistence/addresses/address.repository');
    const {
      ServiceCategoryRepository,
    } = require('../../src/infrastructure/persistence/services/service-category.repository');
    const {
      ServiceRequestRepository,
    } = require('../../src/infrastructure/persistence/requests/service-request.repository');
    const {
      ServiceRequestEventRepository,
    } = require('../../src/infrastructure/persistence/requests/service-request-event.repository');
    const {
      ProviderProfileRepository,
    } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const { BidRepository } = require('../../src/infrastructure/persistence/bids/bid.repository');
    const {
      BookingRepository,
    } = require('../../src/infrastructure/persistence/bookings/booking.repository');
    const {
      BookingEventRepository,
    } = require('../../src/infrastructure/persistence/bookings/booking-event.repository');
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const { RequestsService } = require('../../src/modules/requests/requests.service');
    const { ProviderBidsService } = require('../../src/modules/provider/bids/provider-bids.service');
    const {
      ProviderBookingsService,
    } = require('../../src/modules/provider/bookings/provider-bookings.service');
    const {
      RequestAvailableBatchHandler,
    } = require('../../src/modules/requests/outbox/request-available.handler');

    const addresses = new AddressRepository(prismaSvc);
    const categories = new ServiceCategoryRepository(prismaSvc);
    requestRepo = new ServiceRequestRepository(prismaSvc);
    const requestEvents = new ServiceRequestEventRepository(prismaSvc);
    const providers = new ProviderProfileRepository(prismaSvc);
    const bids = new BidRepository(prismaSvc);
    const bookings = new BookingRepository(prismaSvc);
    const bookingEvents = new BookingEventRepository(prismaSvc);
    txRunner = new TransactionRunner(prismaSvc);

    const noMedia = {
      resolveClaimable: async () => [],
      claim: async () => undefined,
    };
    requests = new RequestsService(
      requestRepo,
      requestEvents,
      addresses,
      categories,
      txRunner,
      new OutboxRepository(prismaSvc),
      noMedia,
    );

    const notificationStub = {
      createForUser: async () => undefined,
    };
    providerBids = new ProviderBidsService(
      providers,
      bids,
      requestRepo,
      requestEvents,
      notificationStub,
      txRunner,
    );

    providerBookings = new ProviderBookingsService(
      providers,
      bookings,
      bookingEvents,
      notificationStub,
      txRunner,
      { publish: async () => undefined },
    );

    notificationCreateMany = jest.fn().mockResolvedValue(0);
    batchHandler = new RequestAvailableBatchHandler(
      { createMany: notificationCreateMany },
      { publishFor: jest.fn() },
      requestRepo,
    );

    await cleanup();

    for (const [id, firstName] of [
      [SEEKER, 'Seeker'],
      [ELIGIBLE_USER, 'Eligible'],
      [INELIGIBLE_USER, 'Ineligible'],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@r07-lifecycle.invalid`,
          passwordHash: 'x',
          firstName,
          lastName: 'R07',
        },
      });
    }

    await prisma.serviceCategory.createMany({
      data: [
        {
          id: CATEGORY,
          slug: `${P}plumbing`,
          labelEn: 'R07 Plumbing',
          labelAr: 'سباكة R07',
          icon: 'wrench',
          isActive: true,
          isLeaf: true,
        },
        {
          id: OTHER_CATEGORY,
          slug: `${P}electrical`,
          labelEn: 'R07 Electrical',
          labelAr: 'كهرباء R07',
          icon: 'bolt',
          isActive: true,
          isLeaf: true,
        },
      ],
    });

    await prisma.providerProfile.create({
      data: {
        id: ELIGIBLE_PP,
        userId: ELIGIBLE_USER,
        displayName: 'Eligible R07',
        initials: 'ER',
        status: 'ACTIVE',
        serviceAreaCity: 'Aleppo',
        serviceAreaCityKey: 'aleppo',
        serviceAreaCountry: 'SY',
        serviceCategories: { create: [{ serviceCategoryId: CATEGORY }] },
      },
    });
    await prisma.providerProfile.create({
      data: {
        id: INELIGIBLE_PP,
        userId: INELIGIBLE_USER,
        displayName: 'Ineligible R07',
        initials: 'IR',
        status: 'ACTIVE',
        serviceAreaCity: 'Damascus',
        serviceAreaCityKey: 'damascus',
        serviceAreaCountry: 'SY',
        serviceCategories: { create: [{ serviceCategoryId: OTHER_CATEGORY }] },
      },
    });
  });

  afterAll(async () => {
    if (prisma) await cleanup();
    await locks?.release();
  });

  it('collapses sequential and concurrent request retries to one durable request', async () => {
    const key = `${P}idem-concurrent-1234567890`;
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => requests.create(SEEKER, baseRequest(key))),
    );

    expect(new Set(attempts.map((item: { id: string }) => item.id)).size).toBe(1);
    const requestId = attempts[0].id;

    expect(
      await prisma.serviceRequest.count({
        where: { seekerUserId: SEEKER, idempotencyKey: key },
      }),
    ).toBe(1);
    expect(
      await prisma.serviceRequestEvent.count({
        where: { requestId, type: 'REQUEST_CREATED' },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxEvent.count({
        where: { aggregateType: 'ServiceRequest', aggregateId: requestId },
      }),
    ).toBe(1);

    const replay = await requests.create(SEEKER, baseRequest(key));
    expect(replay.id).toBe(requestId);
    expect(
      await prisma.serviceRequest.count({
        where: { seekerUserId: SEEKER, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it('rejects a past LATER schedule before creating any durable row', async () => {
    const key = `${P}idem-past-1234567890`;
    const before = await prisma.serviceRequest.count({ where: { seekerUserId: SEEKER } });

    await expect(
      requests.create(SEEKER, {
        ...baseRequest(key),
        scheduleType: 'LATER',
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

    expect(await prisma.serviceRequest.count({ where: { seekerUserId: SEEKER } })).toBe(before);
  });

  it('allows the matching provider to bid but hides the same request from an ineligible provider', async () => {
    const created = await requests.create(
      SEEKER,
      categorizedRequest(`${P}idem-eligible-1234567890`),
    );

    const accepted = await providerBids.submit(ELIGIBLE_USER, {
      requestId: created.id,
      amount: 12500,
      pricingType: 'FIXED',
      note: 'Eligible provider bid',
    });
    expect(accepted.bid.requestId).toBe(created.id);

    await expect(
      providerBids.submit(INELIGIBLE_USER, {
        requestId: created.id,
        amount: 9000,
        pricingType: 'FIXED',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    expect(
      await prisma.bid.count({
        where: { requestId: created.id, providerId: INELIGIBLE_PP },
      }),
    ).toBe(0);
  });

  it('makes a bid wait behind a lifecycle lock and refuse after cancellation commits', async () => {
    const created = await requests.create(
      SEEKER,
      categorizedRequest(`${P}idem-race-1234567890`),
    );

    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let marked!: () => void;
    const updated = new Promise<void>((resolve) => {
      marked = resolve;
    });

    const cancellation = prisma.$transaction(async (tx: any) => {
      await tx.serviceRequest.update({
        where: { id: created.id },
        data: { status: 'CANCELLED' },
      });
      marked();
      await hold;
    });

    await updated;

    const bidAttempt = providerBids.submit(ELIGIBLE_USER, {
      requestId: created.id,
      amount: 11000,
      pricingType: 'FIXED',
    });

    // Give the bid transaction a chance to reach SELECT ... FOR UPDATE while
    // the cancellation transaction still owns the row lock.
    await new Promise((resolve) => setTimeout(resolve, 40));
    release();
    await cancellation;

    await expect(bidAttempt).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(await prisma.bid.count({ where: { requestId: created.id } })).toBe(0);
    expect(
      (await prisma.serviceRequest.findUnique({ where: { id: created.id } })).status,
    ).toBe('CANCELLED');
  });

  it('suppresses a stale request.available batch after the request is closed', async () => {
    const created = await requests.create(
      SEEKER,
      categorizedRequest(`${P}idem-fanout-1234567890`),
    );
    await prisma.serviceRequest.update({
      where: { id: created.id },
      data: { status: 'CANCELLED' },
    });

    const result = await txRunner.run((tx: any) =>
      batchHandler.handle(
        {
          payload: {
            requestId: created.id,
            seekerUserId: SEEKER,
            categoryId: CATEGORY,
            categoryLabel: 'R07 Plumbing',
            city: 'Aleppo',
            cityKey: 'aleppo',
            lat: null,
            lng: null,
            recipientUserIds: [ELIGIBLE_USER],
            batchIndex: 0,
          },
        },
        tx,
      ),
    );

    expect(result.stats.written).toBe(0);
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });

  it('keeps request media visible on provider booking detail after acceptance', async () => {
    const created = await requests.create(
      SEEKER,
      categorizedRequest(`${P}idem-booking-media-1234567890`),
    );
    const media = [
      'https://media.example/r07/one.jpg',
      'https://media.example/r07/two.jpg',
    ];
    await prisma.serviceRequest.update({
      where: { id: created.id },
      data: { mediaUrls: media, status: 'BID_ACCEPTED' },
    });

    const bid = await prisma.bid.create({
      data: {
        requestId: created.id,
        providerId: ELIGIBLE_PP,
        amount: 14000,
        currency: 'USD',
        pricingType: 'FIXED',
        status: 'ACCEPTED',
      },
    });
    const booking = await prisma.booking.create({
      data: {
        requestId: created.id,
        bidId: bid.id,
        seekerUserId: SEEKER,
        providerId: ELIGIBLE_PP,
        priceAmount: 14000,
        currency: 'USD',
        status: 'SCHEDULED',
      },
    });

    const detail = await providerBookings.detail(ELIGIBLE_USER, booking.id);
    expect(detail.requestMediaUrls).toEqual(media);
  });
});
