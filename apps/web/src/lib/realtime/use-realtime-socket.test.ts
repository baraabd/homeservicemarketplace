import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import type { RealtimeEvent } from '@homeservicemarketplace/contracts';

import {
  createRealtimeEventWindow,
  activeConversationId,
  dispatchInvalidations,
  reconnectDelayMs,
  recoveryDelayMs,
  resyncAuthoritativeState,
  useRealtimeSocket,
  validateRealtimeEvent,
} from './use-realtime-socket';
import { closeRealtimeSocket, openRealtimeSocket } from './socket-client';
import { providerQueryKeys } from '../provider/query-keys';
import { seekerQueryKeys } from '../seeker/query-keys';

const socketIo = vi.hoisted(() => vi.fn());
vi.mock('socket.io-client', () => ({ io: socketIo }));

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
    expect(calls).toContainEqual(providerQueryKeys.capabilities.get());
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
    // R17-E — and the authority decision the workspace renders from.
    expect(calls).toContainEqual(providerQueryKeys.capabilities.get());
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

describe('R25 immutable event window and bounded recovery', () => {
  it('derives only existing message-query conversation ids, never arbitrary private rooms', () => {
    expect(activeConversationId(seekerQueryKeys.conversations.messages('c-1'))).toBe('c-1');
    expect(activeConversationId(providerQueryKeys.chat.messages('c-2'))).toBe('c-2');
    expect(activeConversationId(['admin', 'providers', 'c-1', 'messages'])).toBeNull();
    expect(
      activeConversationId(['seeker', 'conversations', 'admin:private', 'messages']),
    ).toBeNull();
    expect(activeConversationId(seekerQueryKeys.conversations.list())).toBeNull();
  });
  it('rejects malformed, oversized and foreign-user envelopes without consuming state', () => {
    const valid = {
      ...event('message.created', { id: 'message-1' }),
      eventId: 'immutable-1',
      revision: 1,
    };
    expect(validateRealtimeEvent(valid, 'u-1')).toEqual(valid);
    expect(validateRealtimeEvent({ ...valid, userId: null }, 'u-1')).not.toBeNull();
    for (const invalid of [
      null,
      { ...valid, v: 2 },
      { ...valid, userId: 'another-user' },
      { ...valid, occurredAt: 'invalid' },
      { ...valid, revision: -1 },
      { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, eventId: 'x'.repeat(257) },
      { ...valid, payload: [] },
      { ...valid, payload: { body: 'x'.repeat(65_536) } },
    ])
      expect(validateRealtimeEvent(invalid, 'u-1')).toBeNull();
  });

  it('drops immutable replays but accepts distinct creations with equal or older revisions', () => {
    const window = createRealtimeEventWindow();
    const first = {
      ...event('message.created', { id: 'm-1', conversationId: 'c-1' }),
      eventId: 'e-1',
      revision: 20,
    };
    expect(window.observe(first)).toBe('fresh');
    expect(window.observe(first)).toBe('duplicate');
    expect(window.observe({ ...first, eventId: 'e-2', payload: { id: 'm-2' } })).toBe('fresh');
    expect(window.observe({ ...first, eventId: 'e-3', revision: 10, payload: { id: 'm-3' } })).toBe(
      'fresh',
    );
  });

  it('suppresses stale transition UX and asks REST when the finite window cannot prove continuity', () => {
    const window = createRealtimeEventWindow(2);
    const transition = {
      ...event('booking.status_changed', { bookingId: 'booking-1' }),
      eventId: 'e-new',
      revision: 20,
    };
    expect(window.observe(transition)).toBe('fresh');
    expect(window.observe({ ...transition, eventId: 'e-old', revision: 10 })).toBe('stale');
    expect(window.observe({ ...transition, eventId: 'e-next', revision: 30 })).toBe('resync');
    for (let n = 0; n < 1_000; n += 1) {
      window.observe({
        ...transition,
        eventId: `event-${n}`,
        payload: { bookingId: `booking-${n}` },
        revision: n,
      });
    }
    expect(window.size()).toEqual({ events: 2, revisions: 2 });
    expect(window.observe(event('message.created', {}))).toBe('resync');
    const legacy = { ...event('provider.status_changed', { id: 'provider-1', status: 'ACTIVE' }) };
    expect(window.observe(legacy)).toBe('resync');
    expect(window.observe({ ...legacy, payload: { id: 'provider-1', status: 'SUSPENDED' } })).toBe(
      'resync',
    );
  });

  it('caps socket attempts and failed polling with jitter, without zero-delay retries', () => {
    expect(reconnectDelayMs(0, 0)).toBe(1_600);
    expect(reconnectDelayMs(0, 1)).toBe(2_000);
    expect(reconnectDelayMs(50, 1)).toBe(60_000);
    expect(recoveryDelayMs(false, 0)).toBe(20_000);
    expect(recoveryDelayMs(false, 3)).toBe(60_000);
    expect(recoveryDelayMs(true, 0)).toBe(60_000);
  });
});

describe('R25 authorized REST recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checks current identity before re-reading active seeker/provider/admin resources; invalidates inactive history', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const calls: string[] = [];
    const keys = [
      ['auth', 'me'],
      seekerQueryKeys.conversations.list(),
      providerQueryKeys.chat.conversations(),
      ['admin', 'providers', 'list'],
    ];
    const subscriptions = keys.map((key) => {
      qc.setQueryData(key, key[0] === 'auth' ? { id: 'u-1' } : { items: ['stale'] });
      const observer = new QueryObserver(qc, {
        queryKey: key,
        queryFn: async () => {
          calls.push(String(key[0]));
          return key[0] === 'auth' ? { id: 'u-1' } : { items: ['authoritative'] };
        },
      });
      return observer.subscribe(() => undefined);
    });
    qc.setQueryData(['seeker', 'conversations', 'old-thread', 'messages'], { items: ['history'] });
    expect(await resyncAuthoritativeState(qc, 'u-1', () => true)).toBe(true);
    expect(calls[0]).toBe('auth');
    expect(new Set(calls.slice(1))).toEqual(new Set(['seeker', 'provider', 'admin']));
    expect(qc.getQueryData(providerQueryKeys.chat.conversations())).toEqual({
      items: ['authoritative'],
    });
    expect(
      qc.getQueryState(['seeker', 'conversations', 'old-thread', 'messages'])?.isInvalidated,
    ).toBe(true);
    subscriptions.forEach((unsubscribe) => unsubscribe());
    qc.clear();
  });

  it('does not fetch private data for a changed identity or a cancelled session', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['auth', 'me'], { id: 'new-user' });
    const spy = vi.spyOn(qc, 'refetchQueries');
    expect(await resyncAuthoritativeState(qc, 'old-user', () => false)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(await resyncAuthoritativeState(qc, 'old-user', () => true)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ queryKey: ['auth', 'me'] });
    qc.clear();
  });

  it('uses the existing auth purge signal on suspension, without retrying private data', async () => {
    const qc = new QueryClient();
    const ended = vi.fn();
    globalThis.window.addEventListener('auth:session-expired', ended);
    const reads = vi.spyOn(qc, 'refetchQueries').mockRejectedValue({ response: { status: 403 } });
    expect(await resyncAuthoritativeState(qc, 'u-1', () => true)).toBe(false);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    globalThis.window.removeEventListener('auth:session-expired', ended);
    qc.clear();
  });

  it('does not remove a new session cache when an old private read rejects after logout', async () => {
    const qc = new QueryClient();
    qc.setQueryData(['auth', 'me'], { id: 'u-1' });
    qc.setQueryData(['seeker', 'conversations'], { items: ['new-session'] });
    let current = true;
    vi.spyOn(qc, 'refetchQueries')
      .mockResolvedValueOnce()
      .mockImplementationOnce(async () => {
        current = false;
        const query = qc.getQueryCache().find({ queryKey: ['seeker', 'conversations'] })!;
        query.setState({ error: { response: { status: 403 } } as unknown as Error });
        throw new Error('late denied response');
      });
    const removed = vi.spyOn(qc, 'removeQueries');
    expect(await resyncAuthoritativeState(qc, 'u-1', () => current)).toBe(false);
    expect(removed).not.toHaveBeenCalled();
    expect(qc.getQueryData(['seeker', 'conversations'])).toEqual({ items: ['new-session'] });
    qc.clear();
  });
});

describe('R25 authenticated socket lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_REALTIME_SOCKET_IO', 'true');
    vi.mocked(openRealtimeSocket).mockClear();
    vi.mocked(closeRealtimeSocket).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('restores on connect and ignores old callback traffic after switching users or logging out', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['auth', 'me'], { id: 'u-1' });
    const invalidated = vi.spyOn(qc, 'invalidateQueries');
    const getToken = vi.fn(() => null);
    const hook = renderHook(
      (props: { enabled: boolean; currentUserId: string | null }) =>
        useRealtimeSocket({ ...props, getToken }),
      {
        initialProps: { enabled: true, currentUserId: 'u-1' },
        wrapper: ({ children }) => createElement(QueryClientProvider, { client: qc }, children),
      },
    );
    const old = vi.mocked(openRealtimeSocket).mock.calls[0][0];
    old.onConnect?.();
    expect(invalidated).not.toHaveBeenCalled();
    old.onReady?.({ userId: 'u-1', joinedRooms: ['user:u-1'] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(invalidated).toHaveBeenCalledWith(expect.objectContaining({ refetchType: 'none' }));
    qc.setQueryData(['auth', 'me'], { id: 'u-2' });
    hook.rerender({ enabled: true, currentUserId: 'u-2' });
    expect(openRealtimeSocket).toHaveBeenCalledTimes(2);
    invalidated.mockClear();
    old.onEvent?.(event('message.created', { id: 'old-private-message' }));
    expect(invalidated).not.toHaveBeenCalled();
    hook.rerender({ enabled: false, currentUserId: null });
    expect(closeRealtimeSocket).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(invalidated).not.toHaveBeenCalled();
    hook.unmount();
    qc.clear();
  });

  it('coalesces rapid recovery hints but preserves the trailing authoritative read', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['auth', 'me'], { id: 'u-1' });
    const invalidated = vi.spyOn(qc, 'invalidateQueries');
    const hook = renderHook(
      () => useRealtimeSocket({ enabled: true, currentUserId: 'u-1', getToken: () => null }),
      {
        wrapper: ({ children }) => createElement(QueryClientProvider, { client: qc }, children),
      },
    );
    vi.mocked(openRealtimeSocket).mock.calls[0][0].onReady?.({
      userId: 'u-1',
      joinedRooms: ['user:u-1'],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(invalidated).toHaveBeenCalledTimes(1);
    await act(async () => {
      for (let hint = 0; hint < 10; hint += 1) {
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(100);
      }
    });
    expect(invalidated).toHaveBeenCalledTimes(2);
    hook.unmount();
    qc.clear();
  });
});

describe('R25 Socket.IO client transport contract', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('holds application traffic until server authorization acknowledgement, and bounds a missing acknowledgement', async () => {
    vi.useFakeTimers();
    const client = await vi.importActual<typeof import('./socket-client')>('./socket-client');
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket = {
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
        handlers.set(name, handler);
      }),
      connect: vi.fn(),
      removeAllListeners: vi.fn(),
      disconnect: vi.fn(),
    };
    socketIo.mockReturnValue(socket);
    const ready = vi.fn();
    const received = vi.fn();
    const failed = vi.fn();
    client.openRealtimeSocket({
      url: 'http://127.0.0.1:4325',
      getToken: () => null,
      onReady: ready,
      onEvent: received,
      onConnectError: failed,
    });
    handlers.get('connect')!();
    handlers.get('realtime.event')!(event('message.created', { id: 'before-auth' }));
    expect(received).not.toHaveBeenCalled();
    handlers.get('connection.ack')!({ userId: 'u-1', joinedRooms: ['user:u-1'] });
    expect(ready).toHaveBeenCalledTimes(1);
    handlers.get('realtime.event')!(event('message.created', { id: 'after-auth' }));
    expect(received).toHaveBeenCalledTimes(1);
    handlers.get('disconnect')!('transport close');
    handlers.get('connect')!();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ data: { code: 'ACK_TIMEOUT' } }));
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    client.closeRealtimeSocket();
  });

  it('completes callback-based auth, bounds connect timeout and delegates retries to one owner', async () => {
    const client = await vi.importActual<typeof import('./socket-client')>('./socket-client');
    const socket = {
      on: vi.fn(),
      connect: vi.fn(),
      removeAllListeners: vi.fn(),
      disconnect: vi.fn(),
    };
    socketIo.mockReturnValue(socket);
    let token = 'first-token';
    client.openRealtimeSocket({ url: 'http://127.0.0.1:4325', getToken: () => token });
    const options = socketIo.mock.calls.at(-1)![1];
    expect(options).toMatchObject({
      reconnection: false,
      timeout: 10_000,
      transports: ['websocket'],
      withCredentials: true,
    });
    const answer = vi.fn();
    options.auth(answer);
    expect(answer).toHaveBeenLastCalledWith({ token: 'first-token' });
    token = 'rotated-token';
    options.auth(answer);
    expect(answer).toHaveBeenLastCalledWith({ token: 'rotated-token' });
    expect(socket.connect).toHaveBeenCalledTimes(1);
    client.closeRealtimeSocket();
  });

  it('requires explicit polling upgrade opt-in and bounds a disappeared conversation acknowledgement', async () => {
    const client = await vi.importActual<typeof import('./socket-client')>('./socket-client');
    const emit = vi.fn();
    const socket = {
      on: vi.fn(),
      connect: vi.fn(),
      removeAllListeners: vi.fn(),
      disconnect: vi.fn(),
      connected: true,
      timeout: vi.fn(() => ({ emit })),
    };
    socketIo.mockReturnValue(socket);
    vi.stubEnv('VITE_REALTIME_TRANSPORTS', 'polling,websocket');
    client.openRealtimeSocket({ url: 'http://127.0.0.1:4325', getToken: () => null });
    expect(socketIo.mock.calls.at(-1)![1].transports).toEqual(['polling', 'websocket']);
    expect(await client.subscribeToConversation('foreign room:admin')).toEqual({
      ok: false,
      code: 'INVALID_CONVERSATION',
    });
    expect(emit).not.toHaveBeenCalled();
    const ack = client.subscribeToConversation('conversation-1');
    expect(socket.timeout).toHaveBeenCalledWith(5_000);
    emit.mock.calls[0][2](new Error('timeout'));
    expect(await ack).toEqual({ ok: false, code: 'ACK_TIMEOUT' });
    client.closeRealtimeSocket();
  });
});
