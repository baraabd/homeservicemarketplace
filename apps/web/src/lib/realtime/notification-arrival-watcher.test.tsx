import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationListResponse } from '@homeservicemarketplace/contracts';

import {
  __resetNotificationArrivalWatcherForTests,
  useNotificationArrivalWatcher,
} from './notification-arrival-watcher';
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

describe('NotificationArrivalWatcher — REGRESSION TARGET', () => {
  it('initial mount seeds the watermark — pre-existing notifications do NOT replay as toasts', () => {
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
