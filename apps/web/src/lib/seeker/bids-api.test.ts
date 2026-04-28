import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../api';
import { acceptBid, getBidDetail, listBidsForRequest } from './bids-api';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

const ROW = {
  id: 'b-1',
  requestId: 'req-1',
  amount: 35,
  currency: 'USD',
  pricingType: 'HOURLY' as const,
  note: null,
  status: 'PENDING' as const,
  responseTimeMinutes: 5,
  badge: 'BEST_MATCH' as const,
  submittedAt: '2026-04-28T01:00:00.000Z',
  provider: {
    id: 'pp-1',
    displayName: 'Omar Al-Khalid',
    initials: 'OK',
    avatarUrl: null,
    ratingAvg: 4.9,
    reviewCount: 312,
    completedJobs: 540,
    verified: true,
    topPro: true,
  },
};

describe('bids-api — listBidsForRequest', () => {
  it('GETs /v1/me/requests/:id/bids and unwraps the envelope', async () => {
    let capturedParams: Record<string, unknown> = {};
    mock.onGet('/v1/me/requests/req-1/bids').reply((config) => {
      capturedParams = (config.params ?? {}) as Record<string, unknown>;
      return [200, { items: [ROW], nextCursor: null }];
    });
    const out = await listBidsForRequest('req-1');
    expect(out.items).toHaveLength(1);
    expect(out.nextCursor).toBeNull();
    // No sort param sent when not asked.
    expect(capturedParams).toEqual({});
  });

  it('forwards the sort query parameter', async () => {
    let captured: Record<string, unknown> = {};
    mock.onGet('/v1/me/requests/req-1/bids').reply((config) => {
      captured = (config.params ?? {}) as Record<string, unknown>;
      return [200, { items: [], nextCursor: null }];
    });
    await listBidsForRequest('req-1', { sort: 'price' });
    expect(captured).toEqual({ sort: 'price' });
  });

  it('rejects on 5xx so React Query can surface an error state', async () => {
    mock
      .onGet('/v1/me/requests/req-1/bids')
      .reply(503, { error: { code: 'DEPENDENCY_UNAVAILABLE' } });
    await expect(listBidsForRequest('req-1')).rejects.toBeDefined();
  });

  it('does NOT send seekerUserId or providerId on the wire', async () => {
    let captured: Record<string, unknown> = {};
    mock.onGet('/v1/me/requests/req-1/bids').reply((config) => {
      captured = (config.params ?? {}) as Record<string, unknown>;
      return [200, { items: [], nextCursor: null }];
    });
    await listBidsForRequest('req-1', { sort: 'rating' });
    expect(captured).not.toHaveProperty('seekerUserId');
    expect(captured).not.toHaveProperty('providerId');
    expect(captured).not.toHaveProperty('userId');
  });
});

describe('bids-api — getBidDetail', () => {
  it('hits /v1/me/requests/:id/bids/:bidId', async () => {
    mock.onGet('/v1/me/requests/req-1/bids/b-1').reply(200, ROW);
    const out = await getBidDetail('req-1', 'b-1');
    expect(out.id).toBe('b-1');
    expect(out.provider.displayName).toBe('Omar Al-Khalid');
  });
});

describe('bids-api — acceptBid', () => {
  it('POSTs /v1/me/requests/:id/bids/:bidId/accept and returns the response envelope', async () => {
    let postedUrl: string | null = null;
    mock.onPost(/\/v1\/me\/requests\/.+\/bids\/.+\/accept/).reply((config) => {
      postedUrl = config.url ?? null;
      return [
        200,
        {
          bid: { ...ROW, status: 'ACCEPTED' },
          booking: {
            id: 'bk-1',
            requestId: 'req-1',
            bidId: 'b-1',
            status: 'SCHEDULED',
            scheduledAt: null,
            priceAmount: 35,
            currency: 'USD',
            createdAt: '2026-04-28T02:00:00.000Z',
          },
          requestStatus: 'BID_ACCEPTED',
        },
      ];
    });
    const out = await acceptBid('req-1', 'b-1');
    expect(postedUrl).toBe('/v1/me/requests/req-1/bids/b-1/accept');
    expect(out.bid.status).toBe('ACCEPTED');
    expect(out.booking.id).toBe('bk-1');
    expect(out.requestStatus).toBe('BID_ACCEPTED');
  });

  it('propagates a 409 (already-accepted) so the UI can surface a CONFLICT message', async () => {
    mock.onPost('/v1/me/requests/req-1/bids/b-1/accept').reply(409, {
      error: {
        code: 'CONFLICT',
        message: 'A bid has already been accepted for this request.',
      },
    });
    await expect(acceptBid('req-1', 'b-1')).rejects.toMatchObject({
      response: { status: 409 },
    });
  });

  it('does NOT send a body — accept-bid is path-param only', async () => {
    let bodyLen: number | undefined;
    mock.onPost('/v1/me/requests/req-1/bids/b-1/accept').reply((config) => {
      bodyLen = (config.data as string | undefined)?.length;
      return [
        200,
        {
          bid: ROW,
          booking: {
            id: 'bk-1',
            requestId: 'req-1',
            bidId: 'b-1',
            status: 'SCHEDULED',
            scheduledAt: null,
            priceAmount: 35,
            currency: 'USD',
            createdAt: '2026-04-28T02:00:00.000Z',
          },
          requestStatus: 'BID_ACCEPTED',
        },
      ];
    });
    await acceptBid('req-1', 'b-1');
    // axios POST without a body shouldn't ship one.
    expect(bodyLen === undefined || bodyLen === 0).toBe(true);
  });
});
