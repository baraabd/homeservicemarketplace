import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@homeservicemarketplace/contracts';

import { dispatchInvalidations } from './use-realtime-socket';
import { providerQueryKeys } from '../provider/query-keys';
import { seekerQueryKeys } from '../seeker/query-keys';

// Sprint 7.0 (refined) — verify that each `RealtimeEventType` triggers
// the right React Query invalidation. We exercise `dispatchInvalidations`
// directly (the pure dispatcher exported alongside the hook) so the
// test does not need a real Socket.IO server. The polling fallback
// path is asserted by NOT firing the dispatcher and confirming the
// existing query subscriptions keep working — covered by the existing
// hook tests in this repo.

function makeQc(): { qc: QueryClient; spy: ReturnType<typeof vi.fn> } {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  return { qc, spy };
}

function event<T>(type: RealtimeEvent['type'], payload: T = {} as T): RealtimeEvent<T> {
  return {
    v: 1,
    type,
    userId: 'u-1',
    occurredAt: '2026-05-02T10:00:00Z',
    payload,
  };
}

describe('dispatchInvalidations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('notification.created → invalidates BOTH seeker + provider notifications roots', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, event('notification.created'));
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(seekerQueryKeys.notifications.root);
    expect(calls).toContainEqual(providerQueryKeys.notifications.root);
  });

  it('message.created with conversationId → invalidates that thread on BOTH sides', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, event('message.created', { conversationId: 'c-7' }));
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(seekerQueryKeys.conversations.messages('c-7'));
    expect(calls).toContainEqual(providerQueryKeys.chat.messages('c-7'));
    // Plus the root invalidations so the conversation-list ordering
    // and unread counts refresh.
    expect(calls).toContainEqual(seekerQueryKeys.conversations.root);
    expect(calls).toContainEqual(providerQueryKeys.chat.root);
  });

  it('message.created without conversationId → only invalidates roots', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, event('message.created', {}));
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(seekerQueryKeys.conversations.root);
    expect(calls).toContainEqual(providerQueryKeys.chat.root);
    // No per-conversation slot was invalidated.
    expect(calls.some((k) => Array.isArray(k) && k.includes('messages') && k.length > 3)).toBe(
      false,
    );
  });

  it('booking.status_changed → invalidates seeker + provider bookings + wallet + seeker requests (Active Leads sync)', () => {
    const { qc, spy } = makeQc();
    // Sprint 7.5.1 — payload carries the typed
    // BookingStatusChangedRealtimePayload shape; the dispatcher is
    // agnostic to the payload contents because the invalidation set
    // is the same for every booking transition.
    //
    // Sprint 7.x — `seekerQueryKeys.requests.root` is now invalidated
    // too. The seeker's Active Leads carousel is backed by the
    // requests root; the parent ServiceRequest stays at BID_ACCEPTED
    // across booking transitions but the card's derived UI (bidsCount,
    // lifecycle copy) still needs a refetch so the card doesn't
    // visibly lie when the provider starts/completes/cancels.
    dispatchInvalidations(
      qc,
      event('booking.status_changed', {
        bookingId: 'bk-1',
        requestId: 'req-1',
        bidId: 'bid-1',
        from: 'SCHEDULED',
        to: 'IN_PROGRESS',
        actorUserId: 'user-prov-1',
        actorRole: 'PROVIDER',
      }),
    );
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(seekerQueryKeys.bookings.root);
    expect(calls).toContainEqual(providerQueryKeys.bookings.root);
    expect(calls).toContainEqual(providerQueryKeys.wallet.root);
    expect(calls).toContainEqual(seekerQueryKeys.requests.root);
  });

  it('request.available → invalidates the provider available-requests feed', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, event('request.available'));
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(providerQueryKeys.availableRequests.root);
  });

  it('bid.accepted → invalidates provider bids/bookings + seeker bookings + seeker requests (Active Leads sync)', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, event('bid.accepted'));
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(providerQueryKeys.bids.root);
    expect(calls).toContainEqual(providerQueryKeys.bookings.root);
    expect(calls).toContainEqual(seekerQueryKeys.bookings.root);
    // Sprint 7.x — the accept-bid transition flips request status
    // OPEN_FOR_BIDS → BID_ACCEPTED; the lead card's "pending" pill
    // must flip to "active" without a manual refresh.
    expect(calls).toContainEqual(seekerQueryKeys.requests.root);
  });

  // Sprint 7.6 — booking.created has an explicit case (was forward-
  // compat falling through to default). Invalidates both sides'
  // bookings roots so the new row appears without a manual refetch.
  // Sprint 7.x — also invalidates seeker requests for Active Leads.
  it('booking.created → invalidates seeker + provider bookings roots + seeker requests', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, event('booking.created', { id: 'bk-1' }));
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(seekerQueryKeys.bookings.root);
    expect(calls).toContainEqual(providerQueryKeys.bookings.root);
    expect(calls).toContainEqual(seekerQueryKeys.requests.root);
  });

  // Sprint 7.6 — invariant: invalidation runs UNCONDITIONALLY,
  // including for actor-originated events. The side-effects bridge
  // is what suppresses UX feedback; cache convergence must still
  // happen so the actor's own tabs see the new state.
  it('runs invalidations even when envelope.actorUserId === recipient (silent invalidation contract)', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, {
      v: 1,
      type: 'booking.status_changed',
      userId: 'user-actor',
      actorUserId: 'user-actor',
      occurredAt: '2026-05-30T10:00:00Z',
      payload: { bookingId: 'bk-1' },
    } as never);
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(seekerQueryKeys.bookings.root);
    expect(calls).toContainEqual(providerQueryKeys.bookings.root);
  });

  it('provider.status_changed → invalidates provider profile + auth/me', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, event('provider.status_changed', { id: 'p-1' }));
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(providerQueryKeys.profile.root);
    expect(calls).toContainEqual(['auth', 'me']);
  });

  it('an unknown event type is silently ignored (no throw, no invalidation)', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, {
      v: 1,
      type: 'something.never-seen' as never,
      userId: 'u-1',
      occurredAt: '2026-05-02T10:00:00Z',
      payload: {},
    });
    expect(spy).not.toHaveBeenCalled();
  });

  // ─── Sprint 7.x — notification.created resource-type safety net ────
  //
  // When the backend forgets to publish a paired domain event, the
  // notification's resourceType still drives the right domain
  // invalidation. These tests pin the mapping per resourceType.

  it('notification.created (resourceType=BOOKING) → invalidates bookings + seeker requests (Active Leads)', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(
      qc,
      event('notification.created', {
        id: 'notif-1',
        resourceType: 'BOOKING',
        resourceId: 'bk-1',
        metadata: { requestId: 'req-1' },
      }),
    );
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(seekerQueryKeys.bookings.root);
    expect(calls).toContainEqual(providerQueryKeys.bookings.root);
    expect(calls).toContainEqual(seekerQueryKeys.requests.root);
    // Notifications + unread always refresh on every notification.created.
    expect(calls).toContainEqual(seekerQueryKeys.notifications.root);
  });

  it('notification.created (resourceType=BID) → invalidates seeker requests + provider bids', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(
      qc,
      event('notification.created', {
        id: 'notif-bid',
        resourceType: 'BID',
        resourceId: 'bid-1',
        metadata: { requestId: 'req-1' },
      }),
    );
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(seekerQueryKeys.requests.root);
    expect(calls).toContainEqual(providerQueryKeys.bids.root);
  });

  it('notification.created (resourceType=REQUEST) → invalidates seeker requests + provider available-requests', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(
      qc,
      event('notification.created', {
        id: 'notif-req',
        resourceType: 'REQUEST',
        resourceId: 'req-1',
      }),
    );
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(seekerQueryKeys.requests.root);
    expect(calls).toContainEqual(providerQueryKeys.availableRequests.root);
  });

  it('notification.created (resourceType=null / SYSTEM) → only notifications root, no domain churn', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(
      qc,
      event('notification.created', { id: 'notif-sys', resourceType: null }),
    );
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(seekerQueryKeys.notifications.root);
    // No domain root churn for SYSTEM / unknown notifications — the
    // notifications drawer + unread badge cover the visible state.
    expect(calls).not.toContainEqual(seekerQueryKeys.requests.root);
    expect(calls).not.toContainEqual(seekerQueryKeys.bookings.root);
  });
});
