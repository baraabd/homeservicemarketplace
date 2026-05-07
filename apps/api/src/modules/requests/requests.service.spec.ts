import type {
  Address,
  ServiceCategory,
  ServiceRequest,
  ServiceRequestStatus,
} from '@homeservicemarketplace/database';

import type { AddressRepository } from '../../infrastructure/persistence/addresses/address.repository';
import type { ServiceCategoryRepository } from '../../infrastructure/persistence/services/service-category.repository';
import type {
  ServiceRequestRepository,
  ServiceRequestWithCategory,
} from '../../infrastructure/persistence/requests/service-request.repository';
import type { ServiceRequestEventRepository } from '../../infrastructure/persistence/requests/service-request-event.repository';
import type { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import { RequestsService } from './requests.service';

// In-memory tx that just calls the supplied callback with `undefined`
// — no real Prisma transaction is required for these unit tests
// because every repository method is mocked.
function makeTx(): TransactionRunner {
  return {
    run: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
  } as unknown as TransactionRunner;
}

function makeCategory(overrides: Partial<ServiceCategory> = {}): ServiceCategory {
  return {
    id: 'cat-1',
    slug: 'plumbing',
    labelEn: 'Plumbing',
    labelAr: 'سباكة',
    icon: '🔧',
    sortOrder: 0,
    isActive: true,
    createdAt: new Date('2026-04-26T00:00:00.000Z'),
    updatedAt: new Date('2026-04-26T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    id: 'addr-1',
    userId: 'user-1',
    label: 'Home',
    type: 'HOME',
    line1: '4 Main St',
    city: 'Riyadh',
    country: 'SA',
    lat: null,
    lng: null,
    isDefault: true,
    createdAt: new Date('2026-04-27T00:00:00.000Z'),
    updatedAt: new Date('2026-04-27T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<ServiceRequest> = {}): ServiceRequestWithCategory {
  const baseDate = new Date('2026-04-28T00:00:00.000Z');
  return {
    id: 'req-1',
    seekerUserId: 'user-1',
    categoryId: 'cat-1',
    customServiceText: null,
    description: null,
    mediaUrls: [],
    status: 'OPEN_FOR_BIDS' as ServiceRequestStatus,
    scheduleType: 'ASAP',
    scheduledAt: null,
    addressId: 'addr-1',
    addressSnapshot: {
      label: 'Home',
      line1: '4 Main St',
      city: 'Riyadh',
      country: 'SA',
      lat: null,
      lng: null,
    },
    createdAt: baseDate,
    updatedAt: baseDate,
    deletedAt: null,
    ...overrides,
    category: makeCategory(),
  };
}

interface Mocks {
  requests: {
    listForSeeker: jest.Mock;
    findOwned: jest.Mock;
    create: jest.Mock;
    updateOwned: jest.Mock;
    setStatusOwned: jest.Mock;
  };
  events: { create: jest.Mock; listForRequest: jest.Mock };
  addresses: { findOwned: jest.Mock };
  categories: { findById: jest.Mock };
}

function makeMocks(over: Partial<Mocks> = {}): Mocks {
  return {
    requests: {
      listForSeeker: jest.fn().mockResolvedValue([]),
      findOwned: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(makeRequest()),
      updateOwned: jest.fn().mockResolvedValue({ count: 0 }),
      setStatusOwned: jest.fn().mockResolvedValue({ count: 0 }),
      ...(over.requests ?? {}),
    },
    events: {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      listForRequest: jest.fn().mockResolvedValue([]),
      ...(over.events ?? {}),
    },
    addresses: {
      findOwned: jest.fn().mockResolvedValue(makeAddress()),
      ...(over.addresses ?? {}),
    },
    categories: {
      findById: jest.fn().mockResolvedValue(makeCategory()),
      ...(over.categories ?? {}),
    },
  };
}

function makeService(m: Mocks) {
  return new RequestsService(
    m.requests as unknown as ServiceRequestRepository,
    m.events as unknown as ServiceRequestEventRepository,
    m.addresses as unknown as AddressRepository,
    m.categories as unknown as ServiceCategoryRepository,
    makeTx(),
  );
}

describe('RequestsService', () => {
  // ─── create ──────────────────────────────────────────────────────────
  describe('create', () => {
    it('creates a request from an owned addressId and snapshots from the DB row', async () => {
      const m = makeMocks();
      m.addresses.findOwned.mockResolvedValue(
        makeAddress({ label: 'Office', line1: 'King Fahd Rd', city: 'Riyadh' }),
      );
      const out = await makeService(m).create('user-1', {
        categoryId: 'cat-1',
        scheduleType: 'ASAP',
        addressId: 'addr-1',
      });
      expect(out.status).toBe('OPEN_FOR_BIDS');
      // The snapshot stored on the request must come from the DB row,
      // NOT from any client-supplied fields.
      const passed = m.requests.create.mock.calls[0]?.[0];
      expect(passed.addressSnapshot).toEqual({
        label: 'Office',
        line1: 'King Fahd Rd',
        city: 'Riyadh',
        // Sprint 7.x — case-insensitive city filter. Snapshot
        // writers also persist a lowercase-trimmed `cityKey` so the
        // available-requests filter can match without losing display
        // casing on the wire.
        cityKey: 'riyadh',
        country: 'SA',
        lat: null,
        lng: null,
      });
      // userId comes from the session, not from the wire.
      expect(passed.seekerUserId).toBe('user-1');
      // A REQUEST_CREATED event is emitted in the same transaction.
      expect(m.events.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'REQUEST_CREATED', actorUserId: 'user-1' }),
        undefined,
      );
    });

    it('creates a request from a manualAddress when no addressId is supplied', async () => {
      const m = makeMocks();
      await makeService(m).create('user-1', {
        categoryId: 'cat-1',
        scheduleType: 'ASAP',
        manualAddress: { line1: 'Main', city: 'Jeddah', country: 'SA' },
      });
      expect(m.addresses.findOwned).not.toHaveBeenCalled();
      const passed = m.requests.create.mock.calls[0]?.[0];
      expect(passed.addressId).toBeNull();
      expect(passed.addressSnapshot).toEqual({
        label: null,
        line1: 'Main',
        city: 'Jeddah',
        cityKey: 'jeddah',
        country: 'SA',
        lat: null,
        lng: null,
      });
    });

    it('rejects with VALIDATION_ERROR when neither categoryId nor customServiceText is present', async () => {
      const m = makeMocks();
      await expect(
        makeService(m).create('user-1', {
          scheduleType: 'ASAP',
          addressId: 'addr-1',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      expect(m.requests.create).not.toHaveBeenCalled();
    });

    it('rejects with VALIDATION_ERROR for an unknown categoryId', async () => {
      const m = makeMocks({ categories: { findById: jest.fn().mockResolvedValue(null) } });
      await expect(
        makeService(m).create('user-1', {
          categoryId: 'cat-bogus',
          scheduleType: 'ASAP',
          addressId: 'addr-1',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(m.requests.create).not.toHaveBeenCalled();
    });

    it('rejects with VALIDATION_ERROR for an inactive category', async () => {
      const m = makeMocks({
        categories: {
          findById: jest.fn().mockResolvedValue(makeCategory({ isActive: false })),
        },
      });
      await expect(
        makeService(m).create('user-1', {
          categoryId: 'cat-inactive',
          scheduleType: 'ASAP',
          addressId: 'addr-1',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects with NOT_FOUND when the addressId belongs to another user', async () => {
      // findOwned returns null for a foreign address (its where clause
      // matches { id, userId, deletedAt: null }), so the service can't
      // distinguish "doesn't exist" from "owned by someone else" — and
      // shouldn't, since that would leak existence of another user's row.
      const m = makeMocks({ addresses: { findOwned: jest.fn().mockResolvedValue(null) } });
      await expect(
        makeService(m).create('user-attacker', {
          categoryId: 'cat-1',
          scheduleType: 'ASAP',
          addressId: 'addr-victim',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(m.requests.create).not.toHaveBeenCalled();
    });

    it('requires scheduledAt when scheduleType is LATER', async () => {
      const m = makeMocks();
      await expect(
        makeService(m).create('user-1', {
          categoryId: 'cat-1',
          scheduleType: 'LATER',
          addressId: 'addr-1',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects scheduledAt when scheduleType is ASAP', async () => {
      const m = makeMocks();
      await expect(
        makeService(m).create('user-1', {
          categoryId: 'cat-1',
          scheduleType: 'ASAP',
          scheduledAt: '2026-05-01T10:00:00Z',
          addressId: 'addr-1',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('accepts customServiceText without a categoryId', async () => {
      const m = makeMocks();
      await makeService(m).create('user-1', {
        customServiceText: 'Need help moving a couch',
        scheduleType: 'ASAP',
        addressId: 'addr-1',
      });
      expect(m.requests.create.mock.calls[0]?.[0].customServiceText).toBe(
        'Need help moving a couch',
      );
      expect(m.categories.findById).not.toHaveBeenCalled();
    });
  });

  // ─── list / detail ───────────────────────────────────────────────────
  describe('list / detail', () => {
    it('list scopes by seekerUserId and forwards status filter', async () => {
      const m = makeMocks();
      m.requests.listForSeeker.mockResolvedValue([makeRequest()]);
      const out = await makeService(m).list('user-1', { status: 'OPEN_FOR_BIDS' });
      expect(out.items).toHaveLength(1);
      expect(out.nextCursor).toBeNull();
      expect(m.requests.listForSeeker).toHaveBeenCalledWith(
        expect.objectContaining({ seekerUserId: 'user-1', status: 'OPEN_FOR_BIDS' }),
      );
    });

    it('list returns a nextCursor when there are more rows than the page size', async () => {
      const m = makeMocks();
      const rows = Array.from({ length: 11 }, (_, i) => makeRequest({ id: `req-${i}` }));
      m.requests.listForSeeker.mockResolvedValue(rows);
      const out = await makeService(m).list('user-1', { limit: 10 });
      expect(out.items).toHaveLength(10);
      expect(out.nextCursor).toBe('req-9');
    });

    it('detail returns the row when owned', async () => {
      const m = makeMocks();
      m.requests.findOwned.mockResolvedValue(makeRequest());
      const out = await makeService(m).detail('user-1', 'req-1');
      expect(out.id).toBe('req-1');
    });

    it('detail rejects with NOT_FOUND when the request is not owned', async () => {
      const m = makeMocks();
      m.requests.findOwned.mockResolvedValue(null);
      await expect(makeService(m).detail('user-attacker', 'req-victim')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('persistence-only fields (seekerUserId, createdAt, updatedAt, deletedAt) never escape the DTO', async () => {
      const m = makeMocks();
      m.requests.listForSeeker.mockResolvedValue([makeRequest()]);
      const out = await makeService(m).list('user-1', {});
      const dto = out.items[0];
      expect(dto).not.toHaveProperty('seekerUserId');
      expect(dto).not.toHaveProperty('deletedAt');
      // bidsCount is always 0 — bids slice not yet shipped.
      expect(dto.bidsCount).toBe(0);
    });
  });

  // ─── update ──────────────────────────────────────────────────────────
  describe('update', () => {
    it('patches an owned OPEN_FOR_BIDS request and emits REQUEST_UPDATED with changed fields', async () => {
      const m = makeMocks();
      m.requests.findOwned
        .mockResolvedValueOnce(makeRequest()) // ownership / preconditions check
        .mockResolvedValueOnce(makeRequest({ description: 'updated' })); // post-update reload
      m.requests.updateOwned.mockResolvedValue({ count: 1 });
      const out = await makeService(m).update('user-1', 'req-1', {
        description: 'updated',
      });
      expect(out.description).toBe('updated');
      expect(m.events.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REQUEST_UPDATED',
          metadata: { changed: ['description'] },
        }),
        undefined,
      );
    });

    it('rejects update when the request is not OPEN_FOR_BIDS (CANCELLED)', async () => {
      const m = makeMocks();
      m.requests.findOwned.mockResolvedValue(
        makeRequest({ status: 'CANCELLED' as ServiceRequestStatus }),
      );
      await expect(
        makeService(m).update('user-1', 'req-1', { description: 'sneaky' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      expect(m.requests.updateOwned).not.toHaveBeenCalled();
    });

    it('rejects update across users (NOT_FOUND, not 200)', async () => {
      const m = makeMocks();
      m.requests.findOwned.mockResolvedValue(null);
      await expect(
        makeService(m).update('user-attacker', 'req-victim', { description: 'pwn' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── cancel / reopen ─────────────────────────────────────────────────
  describe('cancel / reopen', () => {
    it('cancel: OPEN_FOR_BIDS → CANCELLED + REQUEST_CANCELLED event', async () => {
      const m = makeMocks();
      m.requests.findOwned
        .mockResolvedValueOnce(makeRequest()) // preconditions
        .mockResolvedValueOnce(makeRequest({ status: 'CANCELLED' as ServiceRequestStatus })); // reload
      m.requests.setStatusOwned.mockResolvedValue({ count: 1 });
      const out = await makeService(m).cancel('user-1', 'req-1');
      expect(out.status).toBe('CANCELLED');
      expect(m.requests.setStatusOwned).toHaveBeenCalledWith(
        'req-1',
        'user-1',
        ['OPEN_FOR_BIDS'],
        'CANCELLED',
        undefined,
      );
      expect(m.events.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'REQUEST_CANCELLED' }),
        undefined,
      );
    });

    it('cancel: rejects with CONFLICT when already CANCELLED', async () => {
      const m = makeMocks();
      m.requests.findOwned.mockResolvedValue(
        makeRequest({ status: 'CANCELLED' as ServiceRequestStatus }),
      );
      await expect(makeService(m).cancel('user-1', 'req-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(m.requests.setStatusOwned).not.toHaveBeenCalled();
    });

    it('cancel: cross-user attempt → NOT_FOUND (no existence leak)', async () => {
      const m = makeMocks();
      m.requests.findOwned.mockResolvedValue(null);
      await expect(makeService(m).cancel('user-attacker', 'req-victim')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('reopen: CANCELLED → OPEN_FOR_BIDS + REQUEST_REOPENED event', async () => {
      const m = makeMocks();
      m.requests.findOwned
        .mockResolvedValueOnce(makeRequest({ status: 'CANCELLED' as ServiceRequestStatus }))
        .mockResolvedValueOnce(makeRequest());
      m.requests.setStatusOwned.mockResolvedValue({ count: 1 });
      const out = await makeService(m).reopen('user-1', 'req-1');
      expect(out.status).toBe('OPEN_FOR_BIDS');
      expect(m.requests.setStatusOwned).toHaveBeenCalledWith(
        'req-1',
        'user-1',
        ['CANCELLED'],
        'OPEN_FOR_BIDS',
        undefined,
      );
      expect(m.events.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'REQUEST_REOPENED' }),
        undefined,
      );
    });

    it('reopen: rejects with CONFLICT when the request is OPEN_FOR_BIDS (not cancelled)', async () => {
      const m = makeMocks();
      m.requests.findOwned.mockResolvedValue(makeRequest()); // status is OPEN_FOR_BIDS
      await expect(makeService(m).reopen('user-1', 'req-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  // ─── timeline ────────────────────────────────────────────────────────
  describe('timeline', () => {
    it('returns the events for an owned request, oldest first', async () => {
      const m = makeMocks();
      m.requests.findOwned.mockResolvedValue(makeRequest());
      const events = [
        {
          id: 'e1',
          requestId: 'req-1',
          actorUserId: 'user-1',
          type: 'REQUEST_CREATED',
          metadata: null,
          createdAt: new Date('2026-04-28T00:00:00.000Z'),
        },
        {
          id: 'e2',
          requestId: 'req-1',
          actorUserId: 'user-1',
          type: 'REQUEST_CANCELLED',
          metadata: null,
          createdAt: new Date('2026-04-28T01:00:00.000Z'),
        },
      ];
      m.events.listForRequest.mockResolvedValue(events);
      const out = await makeService(m).timeline('user-1', 'req-1');
      expect(out.items.map((e) => e.type)).toEqual(['REQUEST_CREATED', 'REQUEST_CANCELLED']);
      // actorUserId is intentionally NOT in the wire event.
      for (const e of out.items) {
        expect(e).not.toHaveProperty('actorUserId');
      }
    });

    it('rejects with NOT_FOUND when the request is not owned', async () => {
      const m = makeMocks();
      m.requests.findOwned.mockResolvedValue(null);
      await expect(makeService(m).timeline('user-attacker', 'req-victim')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(m.events.listForRequest).not.toHaveBeenCalled();
    });
  });

  // ─── error contract ──────────────────────────────────────────────────
  it('throws AppError on every error path (no raw Prisma errors leak)', async () => {
    const m = makeMocks();
    m.requests.findOwned.mockResolvedValue(null);
    const svc = makeService(m);
    await Promise.all([
      expect(svc.detail('u', 'r')).rejects.toBeInstanceOf(AppError),
      expect(svc.update('u', 'r', { description: 'x' })).rejects.toBeInstanceOf(AppError),
      expect(svc.cancel('u', 'r')).rejects.toBeInstanceOf(AppError),
      expect(svc.reopen('u', 'r')).rejects.toBeInstanceOf(AppError),
      expect(svc.timeline('u', 'r')).rejects.toBeInstanceOf(AppError),
    ]);
  });

  // ─── address-snapshot immutability ───────────────────────────────────
  it('a later edit of the source Address row does not mutate the request snapshot', async () => {
    // Two scenarios using the same RequestsService instance:
    //   1) create at T1 → snapshot frozen with the address as-of T1
    //   2) the source address mutates at T2 → repository.create still
    //      receives the T1 snapshot we passed in
    const m = makeMocks();
    const t1Address = makeAddress({ label: 'Home', line1: 'Old', city: 'Riyadh' });
    m.addresses.findOwned.mockResolvedValueOnce(t1Address);
    await makeService(m).create('user-1', {
      categoryId: 'cat-1',
      scheduleType: 'ASAP',
      addressId: 'addr-1',
    });
    const passedAtT1 = m.requests.create.mock.calls[0]?.[0].addressSnapshot;
    // Simulate the source address being edited later.
    t1Address.label = 'Old Place';
    t1Address.line1 = 'New';
    expect(passedAtT1).toEqual({
      label: 'Home',
      line1: 'Old',
      city: 'Riyadh',
      cityKey: 'riyadh',
      country: 'SA',
      lat: null,
      lng: null,
    });
  });
});
