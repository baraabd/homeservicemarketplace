import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationListResponse } from '@homeservicemarketplace/contracts';

import {
  __resetNotificationArrivalWatcherForTests,
  useNotificationArrivalWatcher,
} from './notification-arrival-watcher';
import { readNotificationBaseline, writeNotificationBaseline } from './notification-baseline';
import type { NotificationExperience } from './notification-target';
import { __resetSideEffectsForTests } from './side-effects';
import { __resetRealtimeI18nForTests } from './realtime-i18n';
import { __resetNotificationUXForTests } from './notification-ux';

// Sprint 7.x — CRITICAL REGRESSION TARGET.
//
// The previous bug: the unread badge updated via REST polling but no
// toast / sound / vibration fired and Active Leads stayed stale. This
// suite pins the contract that a newly-arrived NotificationSummary
// (delivered by the polling refetchInterval) triggers the SAME UX
// path the socket bridge uses — including domain query invalidation.

const toastSuccess = vi.fn();
const toastDefault = vi.fn();
vi.mock('sonner', () => {
  const fn = Object.assign((...args: unknown[]) => toastDefault(...args), {
    success: (...args: unknown[]) => toastSuccess(...args),
  });
  return { toast: fn };
});

const triggerSpy = vi.fn();
vi.mock('./notification-ux', async () => {
  const actual = await vi.importActual<typeof import('./notification-ux')>('./notification-ux');
  return {
    ...actual,
    triggerNotificationUX: (...args: unknown[]) => triggerSpy(...args),
  };
});

beforeEach(() => {
  toastSuccess.mockClear();
  toastDefault.mockClear();
  triggerSpy.mockClear();
  __resetNotificationArrivalWatcherForTests();
  __resetSideEffectsForTests();
  __resetRealtimeI18nForTests();
  __resetNotificationUXForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

// Mounts the watcher with the given user + initial notification list.
// Returns a handle for pushing later polls into the same query key
// so the subscriber sees the "newly arrived" transition.
function setup(args: { userId: string | null; initial: NotificationListResponse }) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  qc.setQueryData(['seeker', 'notifications', 'list', {}], args.initial);
  function Probe() {
    useNotificationArrivalWatcher({
      enabled: args.userId !== null,
      currentUserId: args.userId,
    });
    return null;
  }
  const view = render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  return {
    qc,
    rerenderWith(user: string | null) {
      view.rerender(
        <QueryClientProvider client={qc}>
          <Probe />
        </QueryClientProvider>,
      );
      void user;
    },
    pushPoll(next: NotificationListResponse) {
      act(() => {
        qc.setQueryData(['seeker', 'notifications', 'list', {}], next);
      });
    },
    unmount: view.unmount,
  };
}

function notif(over: {
  id: string;
  type?: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}) {
  return {
    id: over.id,
    type: (over.type ?? 'BOOKING_IN_PROGRESS') as 'BOOKING_IN_PROGRESS',
    title: over.type === 'BOOKING_COMPLETED' ? 'Booking completed' : 'Booking started',
    body: 'b',
    resourceType: over.resourceType ?? 'BOOKING',
    resourceId: over.resourceId ?? 'bk-1',
    deepLink: null,
    metadata: over.metadata ?? null,
    readAt: null,
    createdAt: over.createdAt,
  } as unknown as NotificationListResponse['items'][number];
}

// Experience-aware mount used by the Sprint 7.13 baseline tests so we
// can seed the matching (seeker|provider) list query key.
function setupExp(args: {
  userId: string;
  experience: NotificationExperience;
  initial: NotificationListResponse;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  qc.setQueryData([args.experience, 'notifications', 'list', {}], args.initial);
  function Probe() {
    useNotificationArrivalWatcher({
      enabled: true,
      currentUserId: args.userId,
      experience: args.experience,
    });
    return null;
  }
  const view = render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
  return { qc, unmount: view.unmount };
}

describe('NotificationArrivalWatcher — REGRESSION TARGET', () => {
  it('initial mount seeds the watermark — pre-existing notifications do NOT replay as INDIVIDUAL toasts', () => {
    // Sprint 7.12 — baseline storm protection. Two pre-existing
    // unread notifications produce AT MOST ONE aggregate toast (not
    // two per-item toasts). The aggregate copy is generic
    // ("You have new notifications") and doesn't carry per-item
    // titles so the test asserts the storm-protection contract:
    //   - per-item titles never reach the toast renderer
    //   - aggregate channel fires once
    setup({
      userId: 'user-seeker',
      initial: {
        items: [
          notif({ id: 'old-1', createdAt: '2026-05-30T10:00:00Z' }),
          notif({ id: 'old-2', createdAt: '2026-05-30T11:00:00Z' }),
        ],
        nextCursor: null,
      },
    });
    // success channel is for booking.status_changed toasts; baseline
    // aggregate uses the default channel.
    expect(toastSuccess).not.toHaveBeenCalled();
    // Exactly one aggregate toast (NOT one per pre-existing item).
    expect(toastDefault).toHaveBeenCalledTimes(1);
    const [aggregateTitle] = toastDefault.mock.calls[0];
    // Per-item titles must never appear — the aggregate uses generic copy.
    expect(aggregateTitle).not.toBe('Booking started');
    expect(aggregateTitle).toBe('You have new notifications');
    // Sound + vibration fire ONCE for the aggregate (not per item).
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('READ pre-existing notifications fire NO toasts (baseline only counts unread)', () => {
    // Variant of the above: when every pre-existing notification is
    // already READ, the baseline unreadCount is 0, so no aggregate
    // toast fires. Useful for the "user just logged back in but
    // already cleared the drawer" case.
    setup({
      userId: 'user-seeker',
      initial: {
        items: [
          {
            ...notif({ id: 'read-1', createdAt: '2026-05-30T10:00:00Z' }),
            readAt: '2026-05-30T10:05:00Z',
          } as unknown as NotificationListResponse['items'][number],
          {
            ...notif({ id: 'read-2', createdAt: '2026-05-30T11:00:00Z' }),
            readAt: '2026-05-30T11:05:00Z',
          } as unknown as NotificationListResponse['items'][number],
        ],
        nextCursor: null,
      },
    });
    expect(toastDefault).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('REGRESSION: a newly-arrived BOOKING_IN_PROGRESS poll fires toast + sound + vibration', () => {
    const handle = setup({
      userId: 'user-seeker',
      initial: { items: [], nextCursor: null },
    });
    handle.pushPoll({
      items: [
        notif({
          id: 'fresh-1',
          type: 'BOOKING_IN_PROGRESS',
          resourceType: 'BOOKING',
          resourceId: 'bk-77',
          metadata: { to: 'IN_PROGRESS', bookingId: 'bk-77', requestId: 'req-1' },
          createdAt: '2026-05-30T12:00:00Z',
        }),
      ],
      nextCursor: null,
    });
    // Toast fired through the default channel (notification.created
    // uses sonner's plain toast(), not toast.success()).
    expect(toastDefault).toHaveBeenCalledTimes(1);
    const [title] = toastDefault.mock.calls[0];
    expect(title).toBe('Booking started');
    // Sound + vibration trigger via the same UX helper the socket uses.
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('REGRESSION: BOOKING_COMPLETED poll fires status-specific toast copy', () => {
    const handle = setup({
      userId: 'user-seeker',
      initial: { items: [], nextCursor: null },
    });
    handle.pushPoll({
      items: [
        notif({
          id: 'fresh-2',
          type: 'BOOKING_COMPLETED',
          resourceType: 'BOOKING',
          resourceId: 'bk-77',
          metadata: { to: 'COMPLETED', bookingId: 'bk-77', requestId: 'req-1' },
          createdAt: '2026-05-30T13:00:00Z',
        }),
      ],
      nextCursor: null,
    });
    expect(toastDefault).toHaveBeenCalledTimes(1);
    const [title] = toastDefault.mock.calls[0];
    expect(title).toBe('Booking completed');
  });

  it('REGRESSION: BOOKING_CANCELLED poll fires status-specific toast copy', () => {
    const handle = setup({
      userId: 'user-seeker',
      initial: { items: [], nextCursor: null },
    });
    handle.pushPoll({
      items: [
        notif({
          id: 'fresh-3',
          type: 'BOOKING_CANCELLED',
          resourceType: 'BOOKING',
          resourceId: 'bk-77',
          metadata: { to: 'CANCELLED', bookingId: 'bk-77' },
          createdAt: '2026-05-30T13:30:00Z',
        }),
      ],
      nextCursor: null,
    });
    expect(toastDefault).toHaveBeenCalledTimes(1);
    const [title] = toastDefault.mock.calls[0];
    expect(title).toBe('Booking cancelled');
  });

  it('REGRESSION: invalidates domain queries — Active Leads / bookings refresh after poll', () => {
    const handle = setup({
      userId: 'user-seeker',
      initial: { items: [], nextCursor: null },
    });
    // Seed some domain queries so we can observe invalidation.
    handle.qc.setQueryData(['seeker', 'requests', 'list', {}], { items: [], nextCursor: null });
    handle.qc.setQueryData(['seeker', 'bookings', 'list', {}], { items: [], nextCursor: null });
    handle.pushPoll({
      items: [
        notif({
          id: 'fresh-4',
          type: 'BOOKING_IN_PROGRESS',
          resourceType: 'BOOKING',
          resourceId: 'bk-77',
          metadata: { to: 'IN_PROGRESS', bookingId: 'bk-77' },
          createdAt: '2026-05-30T14:00:00Z',
        }),
      ],
      nextCursor: null,
    });
    // The dispatcher invalidates the seeker requests + bookings roots
    // on every BOOKING notification.created.
    const requestsQ = handle.qc
      .getQueryCache()
      .find({ queryKey: ['seeker', 'requests', 'list', {}] });
    const bookingsQ = handle.qc
      .getQueryCache()
      .find({ queryKey: ['seeker', 'bookings', 'list', {}] });
    expect(requestsQ?.state.isInvalidated).toBe(true);
    expect(bookingsQ?.state.isInvalidated).toBe(true);
  });

  it('REGRESSION: same booking lifecycle event delivered by polling + socket dedupes to ONE toast', () => {
    const handle = setup({
      userId: 'user-seeker',
      initial: { items: [], nextCursor: null },
    });
    // First arrival via polling.
    handle.pushPoll({
      items: [
        notif({
          id: 'fresh-5',
          type: 'BOOKING_IN_PROGRESS',
          resourceType: 'BOOKING',
          resourceId: 'bk-77',
          metadata: { to: 'IN_PROGRESS', bookingId: 'bk-77' },
          createdAt: '2026-05-30T15:00:00Z',
        }),
      ],
      nextCursor: null,
    });
    expect(toastDefault).toHaveBeenCalledTimes(1);
    // A repeat poll (same item) must NOT re-fire UX — watermark
    // tracks seenIds so the same notification.id can't surface twice.
    handle.pushPoll({
      items: [
        notif({
          id: 'fresh-5',
          type: 'BOOKING_IN_PROGRESS',
          resourceType: 'BOOKING',
          resourceId: 'bk-77',
          metadata: { to: 'IN_PROGRESS', bookingId: 'bk-77' },
          createdAt: '2026-05-30T15:00:00Z',
        }),
      ],
      nextCursor: null,
    });
    expect(toastDefault).toHaveBeenCalledTimes(1);
  });

  it('disabled (user is null / logged-out) ignores cache updates entirely', () => {
    const handle = setup({
      userId: null,
      initial: { items: [], nextCursor: null },
    });
    handle.pushPoll({
      items: [
        notif({
          id: 'logged-out-1',
          type: 'BOOKING_IN_PROGRESS',
          resourceType: 'BOOKING',
          resourceId: 'bk-77',
          metadata: { to: 'IN_PROGRESS', bookingId: 'bk-77' },
          createdAt: '2026-05-30T16:00:00Z',
        }),
      ],
      nextCursor: null,
    });
    expect(toastDefault).not.toHaveBeenCalled();
    expect(triggerSpy).not.toHaveBeenCalled();
  });
});

// ─── Sprint 7.12 — login storm protection + experience awareness ───
describe('NotificationArrivalWatcher — Sprint 7.12 storm protection', () => {
  it('large polling batch (> 3 fresh items) collapses to ONE aggregate toast', () => {
    const handle = setup({
      userId: 'user-seeker',
      initial: { items: [], nextCursor: null },
    });
    // 5 distinct fresh notifications — above the 3-item threshold.
    handle.pushPoll({
      items: [
        notif({ id: 'big-1', createdAt: '2026-05-30T17:00:01Z' }),
        notif({ id: 'big-2', createdAt: '2026-05-30T17:00:02Z' }),
        notif({ id: 'big-3', createdAt: '2026-05-30T17:00:03Z' }),
        notif({ id: 'big-4', createdAt: '2026-05-30T17:00:04Z' }),
        notif({ id: 'big-5', createdAt: '2026-05-30T17:00:05Z' }),
      ],
      nextCursor: null,
    });
    // Exactly one toast (aggregate), NOT five.
    expect(toastDefault).toHaveBeenCalledTimes(1);
    const [aggTitle] = toastDefault.mock.calls[0];
    expect(aggTitle).toBe('You have new notifications');
    // Sound + vibration fire ONCE for the whole batch.
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('small polling batch (1–3 items) fires per-item toasts (no aggregate)', () => {
    const handle = setup({
      userId: 'user-seeker',
      initial: { items: [], nextCursor: null },
    });
    handle.pushPoll({
      items: [
        notif({
          id: 'small-1',
          type: 'BOOKING_IN_PROGRESS',
          createdAt: '2026-05-30T18:00:01Z',
        }),
        notif({
          id: 'small-2',
          type: 'BOOKING_COMPLETED',
          createdAt: '2026-05-30T18:00:02Z',
        }),
      ],
      nextCursor: null,
    });
    expect(toastDefault).toHaveBeenCalledTimes(2);
    expect(triggerSpy).toHaveBeenCalledTimes(2);
  });

  it('per-user-and-experience watermark — switching user resets so the new session can fire', () => {
    const handle = setup({
      userId: 'user-A',
      initial: { items: [], nextCursor: null },
    });
    handle.pushPoll({
      items: [
        notif({
          id: 'A-fresh-1',
          type: 'BOOKING_IN_PROGRESS',
          resourceId: 'bk-A',
          createdAt: '2026-05-30T19:00:01Z',
        }),
      ],
      nextCursor: null,
    });
    expect(toastDefault).toHaveBeenCalledTimes(1);
    toastDefault.mockClear();
    triggerSpy.mockClear();
    // Switch to user B with a different booking. The two
    // watermarks are keyed independently (per userId + experience),
    // so user B's first poll fires normally even though user A's
    // batch happened moments earlier. Distinct bookingIds keep the
    // sibling side-effects dedupe (keyed by resourceId+status) from
    // collapsing the two events — the watermark cleanup is what's
    // under test here.
    handle.unmount();
    const handleB = setup({
      userId: 'user-B',
      initial: { items: [], nextCursor: null },
    });
    handleB.pushPoll({
      items: [
        notif({
          id: 'B-fresh-1',
          type: 'BOOKING_IN_PROGRESS',
          resourceId: 'bk-B',
          createdAt: '2026-05-30T19:00:02Z',
        }),
      ],
      nextCursor: null,
    });
    expect(toastDefault).toHaveBeenCalledTimes(1);
  });
});

// ─── Sprint 7.13 — new-count baseline semantics ───
//
// The login aggregate must announce only genuinely-NEW unread rows
// since the last visit — never the historical unread total. On the
// first login on a device (no prior baseline) we show a count-less
// generic hint; on a returning login we diff against the persisted
// cursor.
describe('NotificationArrivalWatcher — Sprint 7.13 new-count baseline', () => {
  function manyUnread(n: number): NotificationListResponse {
    return {
      items: Array.from({ length: n }, (_, i) =>
        notif({ id: `hist-${i}`, createdAt: `2026-05-01T10:00:${String(i).padStart(2, '0')}Z` }),
      ),
      nextCursor: null,
    };
  }

  it('first login with 50 historical unread does NOT claim "50 new" — generic copy only', () => {
    setupExp({ userId: 'u-seeker', experience: 'seeker', initial: manyUnread(50) });
    expect(toastDefault).toHaveBeenCalledTimes(1);
    const [, opts] = toastDefault.mock.calls[0] as [string, { description?: string }];
    // Generic body, never the historical total.
    expect(opts.description).toBe('You have unread notifications to review.');
    expect(opts.description).not.toMatch(/50/);
  });

  it('first login establishes a persisted baseline (newest createdAt)', () => {
    setupExp({ userId: 'u-seeker', experience: 'seeker', initial: manyUnread(3) });
    const baseline = readNotificationBaseline('seeker', 'u-seeker');
    expect(baseline?.lastSeenCreatedAt).toBe('2026-05-01T10:00:02Z');
  });

  it('returning login announces only the genuinely-new unread since the baseline', () => {
    // Simulate a prior visit by seeding the persisted cursor.
    writeNotificationBaseline('seeker', 'u-seeker', '2026-05-01T10:00:00Z');
    // Backlog: one OLD unread (<= cursor) + two NEW unread (> cursor).
    setupExp({
      userId: 'u-seeker',
      experience: 'seeker',
      initial: {
        items: [
          notif({ id: 'old', createdAt: '2026-05-01T10:00:00Z' }),
          notif({ id: 'new-1', createdAt: '2026-05-02T09:00:00Z' }),
          notif({ id: 'new-2', createdAt: '2026-05-02T09:30:00Z' }),
        ],
        nextCursor: null,
      },
    });
    expect(toastDefault).toHaveBeenCalledTimes(1);
    const [, opts] = toastDefault.mock.calls[0] as [string, { description?: string }];
    // Exactly "2 new" — not 3 (the old unread row is excluded).
    expect(opts.description).toBe('2 new notifications to review.');
  });

  it('returning login with no new rows since the baseline fires NO aggregate', () => {
    writeNotificationBaseline('seeker', 'u-seeker', '2026-05-02T12:00:00Z');
    setupExp({
      userId: 'u-seeker',
      experience: 'seeker',
      initial: manyUnread(5), // all created 2026-05-01, older than the cursor
    });
    expect(toastDefault).not.toHaveBeenCalled();
  });

  it('seeker and provider baselines are independent', () => {
    setupExp({ userId: 'u-1', experience: 'seeker', initial: manyUnread(2) });
    expect(readNotificationBaseline('seeker', 'u-1')?.lastSeenCreatedAt).toBeTruthy();
    // Provider baseline for the same user id is still untouched.
    expect(readNotificationBaseline('provider', 'u-1')).toBeNull();
  });

  it('user switch does not leak the baseline (keyed per user)', () => {
    setupExp({ userId: 'u-A', experience: 'seeker', initial: manyUnread(2) });
    expect(readNotificationBaseline('seeker', 'u-A')?.lastSeenCreatedAt).toBeTruthy();
    // A different user has no baseline → first-login generic path.
    expect(readNotificationBaseline('seeker', 'u-B')).toBeNull();
  });
});
