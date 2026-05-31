import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';

import { api } from '../../../lib/api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';
import { seekerQueryKeys } from '../../../lib/seeker/query-keys';
import { useAcceptBid } from './useBids';

// ─────────────────────────────────────────────────────────────────────
// Sprint 7.5 — useAcceptBid cache invalidation.
//
// After a successful POST /v1/me/requests/:rid/bids/:bid/accept the
// hook must invalidate every cache the acceptance touches across both
// bounded contexts:
//   - seeker bids root for THIS request
//   - seeker requests root
//   - seeker bookings root
//   - seeker notifications root
//   - seeker conversations root
//   - provider available-requests root
//   - provider bids root
//   - provider bookings root
//   - provider notifications root
//
// These tests stand up a real QueryClient + intercept the network with
// MockAdapter so we observe the actual invalidation surface — not the
// implementation detail of which method invalidates which key.
// ─────────────────────────────────────────────────────────────────────

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

const ACCEPT_OK = {
  bid: {
    id: 'b-omar',
    requestId: 'req-1',
    amount: 35,
    currency: 'USD',
    pricingType: 'HOURLY' as const,
    note: null,
    status: 'ACCEPTED' as const,
    responseTimeMinutes: 5,
    badge: 'BEST_MATCH' as const,
    submittedAt: '2026-04-28T01:00:00.000Z',
    provider: {
      id: 'pp-omar',
      displayName: 'Omar Al-Khalid',
      initials: 'OK',
      avatarUrl: null,
      ratingAvg: 4.9,
      reviewCount: 312,
      completedJobs: 540,
      verified: true,
      topPro: true,
    },
  },
  booking: {
    id: 'bk-1',
    requestId: 'req-1',
    bidId: 'b-omar',
    status: 'SCHEDULED' as const,
    scheduledAt: null,
    priceAmount: 35,
    currency: 'USD',
    createdAt: '2026-04-28T02:00:00.000Z',
  },
  requestStatus: 'BID_ACCEPTED' as const,
};

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Seed a value into every cache root we expect to be invalidated so we
  // can observe the "queryHash present + state.isInvalidated" flip.
  qc.setQueryData(seekerQueryKeys.bids.list('req-1'), { items: [], nextCursor: null });
  qc.setQueryData(seekerQueryKeys.requests.list(), { items: [], nextCursor: null });
  qc.setQueryData(seekerQueryKeys.bookings.list(), { items: [], nextCursor: null });
  qc.setQueryData(seekerQueryKeys.notifications.list(), { items: [], nextCursor: null });
  qc.setQueryData(seekerQueryKeys.conversations.list(), { items: [], nextCursor: null });
  qc.setQueryData(providerQueryKeys.availableRequests.list(), { items: [], nextCursor: null });
  qc.setQueryData(providerQueryKeys.bids.list(), { items: [], nextCursor: null });
  qc.setQueryData(providerQueryKeys.bookings.list(), { items: [], nextCursor: null });
  qc.setQueryData(providerQueryKeys.notifications.list(), { items: [], nextCursor: null });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

// React Query's `invalidateQueries` flips the matching cache entries'
// `state.isInvalidated` to true. We assert on that flag because it
// captures the *invalidation surface* without depending on which
// internal mechanism the hook used.
function isInvalidated(qc: QueryClient, key: readonly unknown[]): boolean {
  const entries = qc.getQueryCache().findAll({ queryKey: key as unknown as readonly unknown[] });
  return entries.length > 0 && entries.every((e) => e.state.isInvalidated);
}

describe('useAcceptBid', () => {
  it('invalidates seeker bids/requests/bookings/notifications/conversations on success', async () => {
    mock.onPost(/\/v1\/me\/requests\/.+\/bids\/.+\/accept/).reply(200, ACCEPT_OK);
    const { qc, wrapper } = setup();

    const { result } = renderHook(() => useAcceptBid('req-1'), { wrapper });
    result.current.mutate('b-omar');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(isInvalidated(qc, seekerQueryKeys.bids.root('req-1'))).toBe(true);
    expect(isInvalidated(qc, seekerQueryKeys.requests.root)).toBe(true);
    expect(isInvalidated(qc, seekerQueryKeys.bookings.root)).toBe(true);
    expect(isInvalidated(qc, seekerQueryKeys.notifications.root)).toBe(true);
    expect(isInvalidated(qc, seekerQueryKeys.conversations.root)).toBe(true);
  });

  it('also invalidates provider-side caches (available-requests, bids, bookings, notifications) on success', async () => {
    mock.onPost(/\/v1\/me\/requests\/.+\/bids\/.+\/accept/).reply(200, ACCEPT_OK);
    const { qc, wrapper } = setup();

    const { result } = renderHook(() => useAcceptBid('req-1'), { wrapper });
    result.current.mutate('b-omar');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(isInvalidated(qc, providerQueryKeys.availableRequests.root)).toBe(true);
    expect(isInvalidated(qc, providerQueryKeys.bids.root)).toBe(true);
    expect(isInvalidated(qc, providerQueryKeys.bookings.root)).toBe(true);
    expect(isInvalidated(qc, providerQueryKeys.notifications.root)).toBe(true);
  });

  it('does NOT invalidate any cache when the accept call fails (409 stale accept)', async () => {
    mock.onPost(/\/v1\/me\/requests\/.+\/bids\/.+\/accept/).reply(409, {
      error: { code: 'CONFLICT', message: 'This bid has already been accepted.' },
    });
    const { qc, wrapper } = setup();

    const { result } = renderHook(() => useAcceptBid('req-1'), { wrapper });
    result.current.mutate('b-omar');
    await waitFor(() => expect(result.current.isError).toBe(true));

    // Every seeded root MUST remain non-invalidated on a failed accept —
    // we don't want a stale-data refetch storm fired by a no-op write.
    expect(isInvalidated(qc, seekerQueryKeys.bids.root('req-1'))).toBe(false);
    expect(isInvalidated(qc, seekerQueryKeys.bookings.root)).toBe(false);
    expect(isInvalidated(qc, providerQueryKeys.availableRequests.root)).toBe(false);
  });
});
