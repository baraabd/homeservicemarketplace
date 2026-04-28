import type {
  Bid,
  BidStatus,
  ProviderProfile,
  ServiceRequest,
  ServiceRequestStatus,
} from '@homeservicemarketplace/database';

import type {
  BidRepository,
  BidWithProvider,
} from '../../infrastructure/persistence/bids/bid.repository';
import type {
  ServiceRequestRepository,
  ServiceRequestWithCategory,
} from '../../infrastructure/persistence/requests/service-request.repository';
import { AppError } from '../../shared/errors/app-error';
import { BidsService } from './bids.service';

function makeProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'pp-1',
    userId: null,
    displayName: 'Omar Al-Khalid',
    initials: 'OK',
    avatarUrl: null,
    ratingAvg: 4.9,
    reviewCount: 312,
    completedJobs: 540,
    verified: true,
    topPro: true,
    createdAt: new Date('2026-04-28T00:00:00.000Z'),
    updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeBid(overrides: Partial<Bid> = {}, provider = makeProvider()): BidWithProvider {
  return {
    id: 'bid-1',
    requestId: 'req-1',
    providerId: provider.id,
    amount: 35,
    currency: 'USD',
    pricingType: 'HOURLY',
    note: null,
    status: 'PENDING' as BidStatus,
    responseTimeMinutes: 5,
    badge: 'BEST_MATCH',
    submittedAt: new Date('2026-04-28T01:00:00.000Z'),
    createdAt: new Date('2026-04-28T01:00:00.000Z'),
    updatedAt: new Date('2026-04-28T01:00:00.000Z'),
    deletedAt: null,
    ...overrides,
    provider,
  };
}

function makeRequest(overrides: Partial<ServiceRequest> = {}): ServiceRequestWithCategory {
  return {
    id: 'req-1',
    seekerUserId: 'user-1',
    categoryId: null,
    customServiceText: null,
    description: null,
    status: 'OPEN_FOR_BIDS' as ServiceRequestStatus,
    scheduleType: 'ASAP',
    scheduledAt: null,
    addressId: null,
    addressSnapshot: { label: null, line1: 'a', city: 'b', country: 'cc', lat: null, lng: null },
    createdAt: new Date('2026-04-28T00:00:00.000Z'),
    updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
    category: null,
  };
}

interface Mocks {
  bids: { listForRequest: jest.Mock; findOwned: jest.Mock };
  requests: { findOwned: jest.Mock };
}

function makeMocks(over: Partial<Mocks> = {}): Mocks {
  return {
    bids: {
      listForRequest: jest.fn().mockResolvedValue([]),
      findOwned: jest.fn().mockResolvedValue(null),
      ...(over.bids ?? {}),
    },
    requests: {
      findOwned: jest.fn().mockResolvedValue(makeRequest()),
      ...(over.requests ?? {}),
    },
  };
}

function makeService(m: Mocks) {
  return new BidsService(
    m.bids as unknown as BidRepository,
    m.requests as unknown as ServiceRequestRepository,
  );
}

describe('BidsService', () => {
  // ─── ownership ────────────────────────────────────────────────────────
  describe('ownership', () => {
    it('list rejects with NOT_FOUND when the request is not owned', async () => {
      const m = makeMocks({ requests: { findOwned: jest.fn().mockResolvedValue(null) } });
      await expect(
        makeService(m).listForRequest('user-attacker', 'req-victim'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(m.bids.listForRequest).not.toHaveBeenCalled();
    });

    it('detail rejects with NOT_FOUND when the request is not owned', async () => {
      const m = makeMocks({ requests: { findOwned: jest.fn().mockResolvedValue(null) } });
      await expect(
        makeService(m).detail('user-attacker', 'req-victim', 'bid-1'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(m.bids.findOwned).not.toHaveBeenCalled();
    });

    it('detail rejects with NOT_FOUND when the bid is missing on an owned request', async () => {
      const m = makeMocks({
        bids: { findOwned: jest.fn().mockResolvedValue(null), listForRequest: jest.fn() },
      });
      await expect(makeService(m).detail('user-1', 'req-1', 'bid-bogus')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // ─── list ─────────────────────────────────────────────────────────────
  describe('list', () => {
    it('returns the items envelope mapped to BidSummary (drops persistence fields)', async () => {
      const m = makeMocks({
        bids: {
          listForRequest: jest.fn().mockResolvedValue([makeBid()]),
          findOwned: jest.fn(),
        },
      });
      const out = await makeService(m).listForRequest('user-1', 'req-1');
      expect(out.items).toHaveLength(1);
      expect(out.nextCursor).toBeNull();
      const dto = out.items[0];
      // Persistence-only fields must not leak.
      expect(dto).not.toHaveProperty('providerId');
      expect(dto).not.toHaveProperty('deletedAt');
      // Provider summary is the lightweight shape (no userId).
      expect(dto.provider).not.toHaveProperty('userId');
      // ISO timestamp on the wire.
      expect(typeof dto.submittedAt).toBe('string');
      expect(() => new Date(dto.submittedAt).toISOString()).not.toThrow();
    });

    it('empty list returns 200-shape with empty items array', async () => {
      const m = makeMocks();
      const out = await makeService(m).listForRequest('user-1', 'req-1');
      expect(out).toEqual({ items: [], nextCursor: null });
    });

    it('forwards the requested sort to the repository', async () => {
      const m = makeMocks({
        bids: {
          listForRequest: jest.fn().mockResolvedValue([]),
          findOwned: jest.fn(),
        },
      });
      await makeService(m).listForRequest('user-1', 'req-1', { sort: 'price' });
      expect(m.bids.listForRequest).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-1', sort: 'price' }),
      );
    });

    it('default sort is "recommended" when no query is supplied', async () => {
      const m = makeMocks({
        bids: {
          listForRequest: jest.fn().mockResolvedValue([]),
          findOwned: jest.fn(),
        },
      });
      await makeService(m).listForRequest('user-1', 'req-1');
      expect(m.bids.listForRequest).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'recommended' }),
      );
    });
  });

  // ─── provider summary mapping ─────────────────────────────────────────
  it('provider summary maps every public field and excludes private ones', async () => {
    const provider = makeProvider({
      userId: 'leaky-user-id', // must NOT show up on the wire
      avatarUrl: 'https://cdn/x.png',
    });
    const m = makeMocks({
      bids: {
        listForRequest: jest.fn().mockResolvedValue([makeBid({}, provider)]),
        findOwned: jest.fn(),
      },
    });
    const out = await makeService(m).listForRequest('user-1', 'req-1');
    expect(out.items[0].provider).toEqual({
      id: 'pp-1',
      displayName: 'Omar Al-Khalid',
      initials: 'OK',
      avatarUrl: 'https://cdn/x.png',
      ratingAvg: 4.9,
      reviewCount: 312,
      completedJobs: 540,
      verified: true,
      topPro: true,
    });
  });

  // ─── error contract ───────────────────────────────────────────────────
  it('throws AppError on every error path (no raw Prisma errors leak)', async () => {
    const m = makeMocks({ requests: { findOwned: jest.fn().mockResolvedValue(null) } });
    const svc = makeService(m);
    await Promise.all([
      expect(svc.listForRequest('u', 'r')).rejects.toBeInstanceOf(AppError),
      expect(svc.detail('u', 'r', 'b')).rejects.toBeInstanceOf(AppError),
    ]);
  });
});
