/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
export {};

import { randomUUID } from 'node:crypto';

const suite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120_000);

suite('R05 seeker durability invariants (real Postgres)', () => {
  let prisma: any;
  let db: any;
  let addresses: any;
  let profiles: any;
  let requests: any;
  let bookings: any;
  let services: any;

  const createdRequestIds = new Set<string>();
  const createdUserIds = new Set<string>();
  const createdProviderIds = new Set<string>();
  const createdCategoryIds = new Set<string>();

  async function user(label: string) {
    const row = await prisma.user.create({
      data: {
        email: `r05-${label}-${randomUUID()}@itest.local`,
        firstName: 'R05',
        lastName: label,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
    createdUserIds.add(row.id);
    return row;
  }

  async function category(label: string) {
    const row = await prisma.serviceCategory.create({
      data: {
        slug: `r05-${label}-${randomUUID()}`,
        labelEn: `R05 ${label}`,
        labelAr: `اختبار ${label}`,
        icon: 'wrench',
        isActive: true,
        isLeaf: true,
      },
    });
    createdCategoryIds.add(row.id);
    return row;
  }

  beforeAll(async () => {
    db = require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    const prismaSvc = { client: prisma };

    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { AddressRepository } = require('../../src/infrastructure/persistence/addresses/address.repository');
    const { UserRepository } = require('../../src/infrastructure/persistence/iam/user.repository');
    const {
      UserProfileRepository,
    } = require('../../src/infrastructure/persistence/profiles/user-profile.repository');
    const {
      ServiceCategoryRepository,
    } = require('../../src/infrastructure/persistence/services/service-category.repository');
    const {
      ServiceRequestRepository,
    } = require('../../src/infrastructure/persistence/requests/service-request.repository');
    const {
      ServiceRequestEventRepository,
    } = require('../../src/infrastructure/persistence/requests/service-request-event.repository');
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const { BookingRepository } = require('../../src/infrastructure/persistence/bookings/booking.repository');
    const {
      BookingEventRepository,
    } = require('../../src/infrastructure/persistence/bookings/booking-event.repository');
    const { AddressesService } = require('../../src/modules/addresses/addresses.service');
    const { ProfileService } = require('../../src/modules/profile/profile.service');
    const { RequestsService } = require('../../src/modules/requests/requests.service');
    const { BookingsService } = require('../../src/modules/bookings/bookings.service');
    const { ServicesService } = require('../../src/modules/services/services.service');

    const tx = new TransactionRunner(prismaSvc);
    const addressRepo = new AddressRepository(prismaSvc);
    const categoryRepo = new ServiceCategoryRepository(prismaSvc);
    addresses = new AddressesService(addressRepo, tx);
    profiles = new ProfileService(
      new UserRepository(prismaSvc),
      new UserProfileRepository(prismaSvc),
      tx,
    );
    requests = new RequestsService(
      new ServiceRequestRepository(prismaSvc),
      new ServiceRequestEventRepository(prismaSvc),
      addressRepo,
      categoryRepo,
      tx,
      new OutboxRepository(prismaSvc),
    );
    bookings = new BookingsService(
      new BookingRepository(prismaSvc),
      new BookingEventRepository(prismaSvc),
      {},
      tx,
      {},
    );
    services = new ServicesService(categoryRepo, prismaSvc);
  });

  afterEach(async () => {
    const requestIds = [...createdRequestIds];
    if (requestIds.length > 0) {
      await prisma.outboxHandlerRun.deleteMany({
        where: { event: { aggregateId: { in: requestIds }, aggregateType: 'ServiceRequest' } },
      }).catch(() => undefined);
      await prisma.outboxEvent.deleteMany({
        where: { aggregateId: { in: requestIds }, aggregateType: 'ServiceRequest' },
      });
    }

    if (createdUserIds.size > 0) {
      const users = [...createdUserIds];
      await prisma.booking.deleteMany({ where: { seekerUserId: { in: users } } });
      await prisma.bid.deleteMany({ where: { request: { seekerUserId: { in: users } } } });
      await prisma.serviceRequest.deleteMany({ where: { seekerUserId: { in: users } } });
      await prisma.address.deleteMany({ where: { userId: { in: users } } });
      await prisma.userProfile.deleteMany({ where: { userId: { in: users } } });
    }
    if (createdProviderIds.size > 0) {
      await prisma.providerProfile.deleteMany({ where: { id: { in: [...createdProviderIds] } } });
    }
    if (createdCategoryIds.size > 0) {
      await prisma.serviceCategory.deleteMany({ where: { id: { in: [...createdCategoryIds] } } });
    }
    if (createdUserIds.size > 0) {
      await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds] } } });
    }

    createdRequestIds.clear();
    createdUserIds.clear();
    createdProviderIds.clear();
    createdCategoryIds.clear();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('serializes concurrent first/default mutations and denies cross-user object IDs', async () => {
    const owner = await user('owner');
    const attacker = await user('attacker');

    const [first, second] = await Promise.all([
      addresses.create(owner.id, {
        label: 'Home A',
        type: db.AddressType.HOME,
        line1: '1 Alpha Street',
        city: 'Aleppo',
        country: 'Syria',
      }),
      addresses.create(owner.id, {
        label: 'Home B',
        type: db.AddressType.CUSTOM,
        line1: '2 Beta Street',
        city: 'Aleppo',
        country: 'Syria',
      }),
    ]);

    let live = await prisma.address.findMany({
      where: { userId: owner.id, deletedAt: null },
      orderBy: { id: 'asc' },
    });
    expect(live).toHaveLength(2);
    expect(live.filter((row: any) => row.isDefault)).toHaveLength(1);

    const third = await addresses.create(owner.id, {
      label: 'Office',
      type: db.AddressType.WORK,
      line1: '3 Gamma Street',
      city: 'Aleppo',
      country: 'Syria',
    });

    await Promise.all([
      addresses.setDefault(owner.id, first.id),
      addresses.setDefault(owner.id, third.id),
    ]);
    live = await prisma.address.findMany({ where: { userId: owner.id, deletedAt: null } });
    expect(live.filter((row: any) => row.isDefault)).toHaveLength(1);

    await expect(
      addresses.update(attacker.id, second.id, { label: 'stolen' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(addresses.setDefault(attacker.id, second.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    await expect(addresses.remove(attacker.id, second.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });

    const currentDefault = live.find((row: any) => row.isDefault);
    await expect(addresses.remove(owner.id, currentDefault.id)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
  });

  it('persists Unicode profile fields and returns the same values after a fresh service read', async () => {
    const owner = await user('profile');
    const bio = 'مهندس خدمات منزلية — خبرة طويلة في مدينة حلب';

    await profiles.update(owner.id, {
      firstName: 'براء',
      lastName: 'عبد اللطيف',
      phoneNumber: '+963 944 000 000',
      city: 'حلب',
      bio,
    });

    const reloaded = await profiles.get(owner.id);
    expect(reloaded.profile).toMatchObject({
      firstName: 'براء',
      lastName: 'عبد اللطيف',
      phoneNumber: '+963 944 000 000',
      city: 'حلب',
      bio,
    });

    const storedUser = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    const storedProfile = await prisma.userProfile.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    expect(storedUser.firstName).toBe('براء');
    expect(storedProfile.city).toBe('حلب');
    expect(storedProfile.bio).toBe(bio);
  });

  it('keeps request and booking address snapshots immutable after address edits and soft deletion', async () => {
    const seeker = await user('history');
    const providerUser = await user('provider');
    const cat = await category('history');
    const address = await addresses.create(seeker.id, {
      label: 'Original Home',
      type: db.AddressType.HOME,
      line1: '10 Old Street',
      city: 'Aleppo',
      country: 'Syria',
      lat: 36.2,
      lng: 37.16,
    });

    const request = await requests.create(seeker.id, {
      categoryId: cat.id,
      customServiceText: null,
      description: 'Historical snapshot fixture',
      mediaUrls: [],
      scheduleType: db.ScheduleType.ASAP,
      scheduledAt: null,
      addressId: address.id,
      manualAddress: null,
    });
    createdRequestIds.add(request.id);

    const provider = await prisma.providerProfile.create({
      data: {
        userId: providerUser.id,
        displayName: 'R05 Provider',
        initials: 'RP',
      },
    });
    createdProviderIds.add(provider.id);
    const bid = await prisma.bid.create({
      data: {
        requestId: request.id,
        providerId: provider.id,
        amount: 12500,
        currency: 'USD',
        pricingType: db.PricingType.FIXED,
      },
    });
    const booking = await prisma.booking.create({
      data: {
        requestId: request.id,
        bidId: bid.id,
        seekerUserId: seeker.id,
        providerId: provider.id,
        priceAmount: 12500,
        currency: 'USD',
      },
    });

    await addresses.update(seeker.id, address.id, {
      label: 'Moved Home',
      line1: '99 New Street',
      city: 'Damascus',
      lat: 33.51,
      lng: 36.29,
    });
    await addresses.remove(seeker.id, address.id);

    const requestAfter = await requests.detail(seeker.id, request.id);
    const bookingAfter = await bookings.detail(seeker.id, booking.id);
    const expected = {
      label: 'Original Home',
      line1: '10 Old Street',
      city: 'Aleppo',
      country: 'Syria',
      lat: 36.2,
      lng: 37.16,
    };
    expect(requestAfter.addressSnapshot).toMatchObject(expected);
    expect(bookingAfter.addressSnapshot).toMatchObject(expected);

    const stored = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(stored.addressSnapshot).toMatchObject(expected);
    expect((await prisma.address.findUniqueOrThrow({ where: { id: address.id } })).deletedAt).not.toBeNull();
  });

  it('hides retired categories from new selection while preserving historical request labels', async () => {
    const seeker = await user('catalog');
    const cat = await category('retired');
    const address = await addresses.create(seeker.id, {
      label: 'Home',
      type: db.AddressType.HOME,
      line1: '1 Catalog Street',
      city: 'Aleppo',
      country: 'Syria',
    });

    const before = await services.listCategories();
    expect(before.map((item: any) => item.id)).toContain(cat.id);

    const historical = await requests.create(seeker.id, {
      categoryId: cat.id,
      customServiceText: null,
      description: null,
      mediaUrls: [],
      scheduleType: db.ScheduleType.ASAP,
      scheduledAt: null,
      addressId: address.id,
      manualAddress: null,
    });
    createdRequestIds.add(historical.id);

    await prisma.serviceCategory.update({ where: { id: cat.id }, data: { isActive: false } });
    const after = await services.listCategories();
    expect(after.map((item: any) => item.id)).not.toContain(cat.id);

    await expect(
      requests.create(seeker.id, {
        categoryId: cat.id,
        customServiceText: null,
        description: null,
        mediaUrls: [],
        scheduleType: db.ScheduleType.ASAP,
        scheduledAt: null,
        addressId: address.id,
        manualAddress: null,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });

    const detail = await requests.detail(seeker.id, historical.id);
    expect(detail.category).toMatchObject({
      id: cat.id,
      labelEn: cat.labelEn,
      labelAr: cat.labelAr,
    });

    const custom = 'خدمة منزلية خاصة '.repeat(8).trim();
    const freeform = await requests.create(seeker.id, {
      categoryId: null,
      customServiceText: custom,
      description: null,
      mediaUrls: [],
      scheduleType: db.ScheduleType.ASAP,
      scheduledAt: null,
      addressId: address.id,
      manualAddress: null,
    });
    createdRequestIds.add(freeform.id);
    expect((await requests.detail(seeker.id, freeform.id)).customServiceText).toBe(custom);
  });
});
