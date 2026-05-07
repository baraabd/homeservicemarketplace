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

  it('booking.status_changed → invalidates seeker + provider bookings + wallet', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, event('booking.status_changed', { id: 'b-1' }));
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(seekerQueryKeys.bookings.root);
    expect(calls).toContainEqual(providerQueryKeys.bookings.root);
    expect(calls).toContainEqual(providerQueryKeys.wallet.root);
  });

  it('request.available → invalidates the provider available-requests feed', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, event('request.available'));
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(providerQueryKeys.availableRequests.root);
  });

  it('bid.accepted → invalidates provider bids/bookings + seeker bookings', () => {
    const { qc, spy } = makeQc();
    dispatchInvalidations(qc, event('bid.accepted'));
    const calls = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(calls).toContainEqual(providerQueryKeys.bids.root);
    expect(calls).toContainEqual(providerQueryKeys.bookings.root);
    expect(calls).toContainEqual(seekerQueryKeys.bookings.root);
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
});
