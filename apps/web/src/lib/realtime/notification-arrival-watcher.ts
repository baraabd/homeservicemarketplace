// Sprint 7.x — NotificationArrivalWatcher.
// Sprint 7.12 — generalised to support BOTH seeker AND provider
// experiences, plus login-storm protection (baseline mode +
// aggregate toast).
//
// Why: even with the Socket.IO bridge working, every recipient also
// runs REST polling against /v1/me/notifications. When the socket is
// offline, slow, or hasn't connected yet, polling is the only
// delivery channel. Without this watcher, polling refreshes the badge
// silently and the user gets NO toast / sound / vibration for the
// lifecycle events they care about.
//
// What: this hook observes the matching notifications query for the
// chosen experience, detects newly-arrived unread rows since the
// previous poll, synthesises a `notification.created` realtime
// envelope for each, and pumps them through the SAME
// `dispatchRealtimeSideEffects` + `dispatchInvalidations` pair the
// socket uses. Same dedupe map → same toast collapses across socket
// and polling.
//
// Storm protection (Sprint 7.12):
//   1. On first poll after login, capture every notification id +
//      timestamp as a baseline. Pre-existing notifications never
//      replay as individual toasts.
//   2. If unreadCount > 0 at baseline, emit ONE aggregate toast.
//   3. After baseline, batches > 3 fresh notifications collapse to
//      ONE aggregate toast — never barrage the user with 10 toasts.
//
// Where: mounted ONCE per experience inside `AuthProvider` (above
// Router so it survives page navigation). On logout / user switch /
// experience switch the high-water mark resets, so an old session's
// notifications never leak into a fresh login's first poll.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  NotificationListResponse,
  NotificationSummary,
  RealtimeEvent,
} from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../provider/query-keys';
import { seekerQueryKeys } from '../seeker/query-keys';
import { dispatchInvalidations } from './use-realtime-socket';
import {
  dispatchRealtimeSideEffects,
  emitAggregateNotificationToast,
  pruneDedupeStore,
} from './side-effects';
import { setRealtimeExperience } from './realtime-experience';
import type { NotificationExperience } from './notification-target';
import {
  __clearAllNotificationBaselinesForTests,
  readNotificationBaseline,
  writeNotificationBaseline,
} from './notification-baseline';

// Threshold above which a single polling batch collapses to one
// aggregate toast instead of N individual toasts. Tuned so quick
// catch-up after a brief network blip (≤3 new events) still feels
// crisp, but a large backlog (e.g. waking the tab after 10 minutes
// with 10 new events) does NOT produce a toast cascade.
const AGGREGATE_BATCH_THRESHOLD = 3;

export interface UseNotificationArrivalWatcherOptions {
  // Pass `true` to observe; `false` to disable. Typically driven by
  // `useAuth().isAuthenticated`.
  enabled: boolean;
  // The authenticated user's id. Drives the high-water-mark reset on
  // user switch AND the anti-echo gate inside the side-effects
  // dispatcher (pass-through).
  currentUserId: string | null;
  // Sprint 7.12 — which experience this watcher belongs to. Drives
  // (a) which notifications query root to observe, (b) which toast
  // brand variant fires, (c) which deepLink the aggregate toast
  // action uses. Defaults to 'seeker' for backwards compatibility.
  experience?: NotificationExperience;
}

// Module-level high-water mark per (userId, experience). Keyed so a
// quick logout / re-login as the SAME user doesn't replay old
// notifications, and so a switch to a DIFFERENT user reads a fresh
// marker.
//
// We track:
//   - baselineSet: whether the first poll has been seen. Until it
//     is, individual events are suppressed and an aggregate may fire.
//   - lastSeenCreatedAt: ISO string of the newest notification
//     processed so far. New rows have `createdAt > lastSeenCreatedAt`.
//   - seenIds: id set of notifications already pushed through the
//     side-effects dispatcher. Defensive secondary key — covers the
//     edge case where two rows share the same createdAt (sub-ms
//     resolution at insert time).
interface WatermarkState {
  baselineSet: boolean;
  lastSeenCreatedAt: string | null;
  seenIds: Set<string>;
}

const watermarks = new Map<string, WatermarkState>();

function watermarkKey(userId: string, experience: NotificationExperience): string {
  return `${experience}:${userId}`;
}

function getWatermark(userId: string, experience: NotificationExperience): WatermarkState {
  const key = watermarkKey(userId, experience);
  let state = watermarks.get(key);
  if (!state) {
    state = { baselineSet: false, lastSeenCreatedAt: null, seenIds: new Set() };
    watermarks.set(key, state);
  }
  return state;
}

export function useNotificationArrivalWatcher({
  enabled,
  currentUserId,
  experience = 'seeker',
}: UseNotificationArrivalWatcherOptions): void {
  const qc = useQueryClient();
  // Track the previous (userId, experience) so a switch resets the
  // high-water mark cleanly — otherwise the new session's first poll
  // would see "all rows are old" and never fire any UX.
  const prevKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = currentUserId ? watermarkKey(currentUserId, experience) : null;
    if (prevKeyRef.current !== null && prevKeyRef.current !== key) {
      // User or experience switched (including switch-to-null on logout).
      // Drop the previous watermark so a future re-login starts fresh.
      watermarks.delete(prevKeyRef.current);
    }
    prevKeyRef.current = key;
  }, [currentUserId, experience]);

  useEffect(() => {
    if (!enabled || !currentUserId) return undefined;

    // Subscribe to every cache change for the matching notifications
    // root. React Query's `getQueryCache().subscribe` fires for ANY
    // event under that prefix (list filters + unread + ad-hoc keys),
    // so we filter to the list queries inside the callback. Polling
    // (refetchInterval) writes a fresh response into the same key,
    // which trips this subscription.
    const cache = qc.getQueryCache();
    const rootKey =
      experience === 'provider'
        ? providerQueryKeys.notifications.root
        : seekerQueryKeys.notifications.root;
    const expectedRoot0 = rootKey[0];
    const expectedRoot1 = rootKey[1];

    const unsubscribe = cache.subscribe((event) => {
      // Only react to "data updated" events. Errors / mounts / etc.
      // are not relevant here.
      if (event.type !== 'updated') return;
      const queryKey = event.query.queryKey;
      // We only care about the LIST queries (drawer feed). The
      // unread-count query is a separate key — counts alone don't
      // carry the row data we need to fire UX.
      if (
        !Array.isArray(queryKey) ||
        queryKey[0] !== expectedRoot0 ||
        queryKey[1] !== expectedRoot1 ||
        queryKey[2] !== 'list'
      ) {
        return;
      }
      const data = event.query.state.data as NotificationListResponse | undefined;
      if (!data || !Array.isArray(data.items)) return;
      processNotificationBatch(data.items, currentUserId, experience, qc);
    });

    // Seed baseline from whatever's already in the cache so the first
    // post-mount poll doesn't replay the entire backlog. If unread
    // notifications exist, emit ONE aggregate toast.
    seedBaselineFromCache(qc, currentUserId, experience);

    return () => {
      unsubscribe();
    };
  }, [enabled, currentUserId, experience, qc]);
}

// Seed the high-water mark from whatever notifications are already
// in the cache. Called once at mount so the FIRST poll after mount
// doesn't replay the entire backlog as freshly-arrived events.
//
// If unread items exist at baseline, fire ONE aggregate toast so the
// user sees a single "you have notifications to review" hint instead
// of the badge silently incrementing.
function seedBaselineFromCache(
  qc: ReturnType<typeof useQueryClient>,
  userId: string,
  experience: NotificationExperience,
): void {
  const wm = getWatermark(userId, experience);
  if (wm.baselineSet) return; // already seeded — happens on a quick re-mount
  const cache = qc.getQueryCache();
  const rootKey =
    experience === 'provider'
      ? providerQueryKeys.notifications.root
      : seekerQueryKeys.notifications.root;
  const lists = cache.findAll({ queryKey: rootKey });

  // Sprint 7.13 — diff the current backlog against the PERSISTED
  // cross-session cursor so we announce only genuinely-new unread rows,
  // never the historical unread total. `null` means "no prior baseline
  // on this device" → first login here.
  const prevBaseline = readNotificationBaseline(experience, userId);
  const prevCursor = prevBaseline?.lastSeenCreatedAt ?? null;

  let totalUnread = 0;
  let newUnreadSinceBaseline = 0;
  let newestCreatedAt: string | null = null;

  for (const query of lists) {
    const queryKey = query.queryKey;
    if (
      !Array.isArray(queryKey) ||
      queryKey[0] !== rootKey[0] ||
      queryKey[1] !== rootKey[1] ||
      queryKey[2] !== 'list'
    ) {
      continue;
    }
    const data = query.state.data as NotificationListResponse | undefined;
    if (!data?.items) continue;
    for (const n of data.items) {
      wm.seenIds.add(n.id);
      if (!wm.lastSeenCreatedAt || n.createdAt > wm.lastSeenCreatedAt) {
        wm.lastSeenCreatedAt = n.createdAt;
      }
      if (!newestCreatedAt || n.createdAt > newestCreatedAt) {
        newestCreatedAt = n.createdAt;
      }
      if (n.readAt === null) {
        totalUnread += 1;
        // "New" = unread AND created after the last visit's cursor.
        if (prevCursor === null || n.createdAt > prevCursor) {
          newUnreadSinceBaseline += 1;
        }
      }
    }
  }
  wm.baselineSet = true;

  // Advance the persisted cursor to the newest row we've now seen so
  // the NEXT login diffs against this visit — not the account's whole
  // history. Does NOT mark anything as read; it's a separate concept.
  writeNotificationBaseline(experience, userId, newestCreatedAt);

  // Decide whether to surface a single aggregate hint.
  if (prevCursor === null) {
    // First login on this device: we cannot compute a trustworthy
    // "new since last visit" count (the only number we have is the
    // historical unread total), so show a count-less generic hint —
    // never "50 new notifications".
    if (totalUnread > 0) {
      setRealtimeExperience(experience);
      emitAggregateNotificationToast({
        experience,
        count: null,
        drawerDeepLink: experience === 'provider' ? '/provider/notifications' : '/home/profile',
      });
    }
    return;
  }

  // Returning visit: announce ONLY the genuinely-new unread rows.
  if (newUnreadSinceBaseline > 0) {
    setRealtimeExperience(experience);
    emitAggregateNotificationToast({
      experience,
      count: newUnreadSinceBaseline,
      drawerDeepLink: experience === 'provider' ? '/provider/notifications' : '/home/profile',
    });
  }
}

// For each item in the latest poll response, decide whether it's
// newly arrived (vs already-seen) and — if new — synthesise a
// `notification.created` realtime envelope and pump it through the
// same side-effects + invalidations dispatchers the socket uses.
function processNotificationBatch(
  items: NotificationSummary[],
  userId: string,
  experience: NotificationExperience,
  qc: ReturnType<typeof useQueryClient>,
): void {
  const wm = getWatermark(userId, experience);
  // Walk oldest-first so a multi-item batch processes in the same
  // order the backend wrote them — the side-effects dedupe map
  // collapses any same-key duplicates inside the 2.5s window.
  const ordered = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let nextWatermark = wm.lastSeenCreatedAt;
  // Collect fresh items first, then decide whether to fire individual
  // toasts or one aggregate.
  const fresh: NotificationSummary[] = [];
  for (const n of ordered) {
    if (wm.seenIds.has(n.id)) continue;
    if (wm.lastSeenCreatedAt && n.createdAt <= wm.lastSeenCreatedAt) {
      // Older than the watermark AND not in seenIds (e.g. a backfill
      // / pagination loaded a historical row). Record it so we don't
      // re-process if the cache re-emits, but do not fire UX.
      wm.seenIds.add(n.id);
      continue;
    }
    fresh.push(n);
    wm.seenIds.add(n.id);
    if (!nextWatermark || n.createdAt > nextWatermark) {
      nextWatermark = n.createdAt;
    }
  }
  wm.lastSeenCreatedAt = nextWatermark;
  // Keep the cross-session cursor in step with rows seen this session so
  // notifications that arrived while logged in are not re-counted as
  // "new" on the next login. writeNotificationBaseline never rewinds.
  writeNotificationBaseline(experience, userId, nextWatermark);

  if (fresh.length === 0) return;

  // Always invalidate domain caches — even when we collapse to an
  // aggregate toast, the underlying data needs to refresh. Synthesize
  // the envelope per item so domain-specific invalidations (Active
  // Leads, bookings, conversations) all fan out correctly.
  for (const n of fresh) {
    const event: RealtimeEvent = {
      v: 1,
      type: 'notification.created',
      userId,
      actorUserId: null,
      occurredAt: n.createdAt,
      payload: n,
    };
    dispatchInvalidations(qc, event);
  }

  // Sprint 7.12 — set the experience on the bridge so the toast(s)
  // fire with the right brand variant. RootInner re-pushes the
  // route-derived value on every navigation; we set it here too so
  // the very first event after mount is branded correctly.
  setRealtimeExperience(experience);

  if (fresh.length > AGGREGATE_BATCH_THRESHOLD) {
    // Large batch → one aggregate toast + one UX trigger. Domain
    // invalidations already fired above so the user sees fresh data
    // the moment they tap through.
    emitAggregateNotificationToast({
      experience,
      count: fresh.length,
      drawerDeepLink: experience === 'provider' ? '/provider/notifications' : '/home/profile',
    });
  } else {
    // Small batch (1–3) → fire per-event toasts so the user sees the
    // specific copy ("Booking started", "Bid accepted", …).
    for (const n of fresh) {
      const event: RealtimeEvent = {
        v: 1,
        type: 'notification.created',
        userId,
        actorUserId: null,
        occurredAt: n.createdAt,
        payload: n,
      };
      dispatchRealtimeSideEffects(event, { currentUserId: userId });
    }
  }

  // Long-running session hygiene — drop dedupe entries older than
  // the window so the map stays bounded over hours of polling.
  pruneDedupeStore();
}

// Test-only reset hook. Production code never needs to call this —
// the user-switch effect handles natural cleanup.
export function __resetNotificationArrivalWatcherForTests(): void {
  watermarks.clear();
  __clearAllNotificationBaselinesForTests();
}
