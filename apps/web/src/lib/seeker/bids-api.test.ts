import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../api';
import { getBidDetail, listBidsForRequest } from './bids-api';

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
