// Sprint 7.x — NotificationArrivalWatcher.
//
// Why: even with the Socket.IO bridge working, every recipient also
// runs REST polling against /v1/me/notifications (Sprint 7.x adds
// refetchInterval). When the socket is offline, slow, or hasn't
// connected yet, polling is the only delivery channel. Without this
// watcher, polling refreshes the badge silently and the user gets NO
// toast / sound / vibration for the lifecycle events they care about
// — the exact bug the user reported.
//
// What: this hook observes the seeker notifications query, detects
// newly-arrived unread rows since the previous poll, synthesises a
// `notification.created` realtime envelope for each, and pumps them
// through the SAME `dispatchRealtimeSideEffects` +
// `dispatchInvalidations` pair the socket uses. Same dedupe map →
// same toast collapses across socket and polling.
//
// Where: mounted ONCE inside `AuthProvider` (above Router so it
// survives page navigation). On logout / user switch the high-water
// mark resets, so an old session's notifications never leak into a
// fresh login's first poll.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  NotificationListResponse,
  NotificationSummary,
  RealtimeEvent,
} from '@homeservicemarketplace/contracts';

import { seekerQueryKeys } from '../seeker/query-keys';
import { dispatchInvalidations } from './use-realtime-socket';
import { dispatchRealtimeSideEffects } from './side-effects';

export interface UseNotificationArrivalWatcherOptions {
  // Pass `true` to observe; `false` to disable. Typically driven by
  // `useAuth().isAuthenticated`.
  enabled: boolean;
  // The authenticated user's id. Drives the high-water-mark reset on
  // user switch AND the anti-echo gate inside the side-effects
  // dispatcher (pass-through).
  currentUserId: string | null;
}

// Module-level high-water mark per user id. Keyed by userId so a
// quick logout / re-login as the SAME user doesn't replay old
// notifications; a switch to a DIFFERENT user reads a fresh marker.
//
// We track:
//   - lastSeenCreatedAt: ISO string of the newest notification
//     processed so far. New rows have `createdAt > lastSeenCreatedAt`.
//   - seenIds: id set of notifications already pushed through the
//     side-effects dispatcher. A defensive secondary key — covers the
//     edge case where two rows share the same createdAt (sub-ms
//     resolution at insert time).
interface WatermarkState {
  lastSeenCreatedAt: string | null;
  seenIds: Set<string>;
}

const watermarks = new Map<string, WatermarkState>();

function getWatermark(userId: string): WatermarkState {
  let state = watermarks.get(userId);
  if (!state) {
    state = { lastSeenCreatedAt: null, seenIds: new Set() };
    watermarks.set(userId, state);
  }
  return state;
}

export function useNotificationArrivalWatcher({
  enabled,
  currentUserId,
}: UseNotificationArrivalWatcherOptions): void {
  const qc = useQueryClient();
  // Track the previous userId so a user switch (or logout) resets the
  // high-water mark cleanly — otherwise the new session's first poll
  // would see "all rows are old" and never fire any UX.
  const prevUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== currentUserId) {
      // User switched (including switch-to-null on logout). Drop the
      // previous user's watermark so a future re-login starts fresh.
      watermarks.delete(prevUserIdRef.current);
    }
    prevUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    if (!enabled || !currentUserId) return undefined;

    // Subscribe to every cache change for the seeker notifications
    // root. React Query's `getQueryCache().subscribe` fires for ANY
    // event under that prefix (list filters + unread + ad-hoc keys),
    // so we filter to the list queries inside the callback. Polling
    // (refetchInterval) writes a fresh response into the same key,
    // which trips this subscription.
    const cache = qc.getQueryCache();
    const unsubscribe = cache.subscribe((event) => {
      // Only react to "data updated" events. Errors / mounts / etc.
      // are not relevant here.
      if (event.type !== 'updated') return;
      const queryKey = event.query.queryKey;
      // We only care about the seeker notification LIST queries
      // (drawer feed). The unread-count query is a separate key
      // (`['seeker', 'notifications', 'unread-count']`) — counts
      // alone don't carry the row data we need to fire UX.
      if (
        !Array.isArray(queryKey) ||
        queryKey[0] !== 'seeker' ||
        queryKey[1] !== 'notifications' ||
        queryKey[2] !== 'list'
      ) {
        return;
      }
      const data = event.query.state.data as NotificationListResponse | undefined;
      if (!data || !Array.isArray(data.items)) return;
      processNotificationBatch(data.items, currentUserId, qc);
    });

    // Also process whatever's already in the cache at mount time so
    // we set the high-water mark to "everything currently loaded" —
    // otherwise the first poll AFTER mount would treat the entire
    // backlog as "new" and fire a barrage of stale toasts.
    seedWatermarkFromCache(qc, currentUserId);

    return () => {
      unsubscribe();
    };
  }, [enabled, currentUserId, qc]);
}

// Seed the high-water mark from whatever notifications are already
// in the cache. Called once at mount so the FIRST poll after mount
// doesn't replay the entire backlog as freshly-arrived events.
function seedWatermarkFromCache(qc: ReturnType<typeof useQueryClient>, userId: string): void {
  const wm = getWatermark(userId);
  const cache = qc.getQueryCache();
  const lists = cache.findAll({ queryKey: seekerQueryKeys.notifications.root });
  for (const query of lists) {
    const queryKey = query.queryKey;
    if (
      !Array.isArray(queryKey) ||
      queryKey[0] !== 'seeker' ||
      queryKey[1] !== 'notifications' ||
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
    }
  }
}

// For each item in the latest poll response, decide whether it's
// newly arrived (vs already-seen) and — if new — synthesise a
// `notification.created` realtime envelope and pump it through the
// same side-effects + invalidations dispatchers the socket uses.
function processNotificationBatch(
  items: NotificationSummary[],
  userId: string,
  qc: ReturnType<typeof useQueryClient>,
): void {
  const wm = getWatermark(userId);
  // Walk oldest-first so a multi-item batch processes in the same
  // order the backend wrote them — the side-effects dedupe map
  // collapses any same-key duplicates inside the 2.5s window.
  const ordered = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let nextWatermark = wm.lastSeenCreatedAt;
  for (const n of ordered) {
    if (wm.seenIds.has(n.id)) continue;
    if (wm.lastSeenCreatedAt && n.createdAt <= wm.lastSeenCreatedAt) {
      // Older than the watermark AND not in seenIds (e.g. a backfill
      // / pagination loaded a historical row). Record it so we don't
      // re-process if the cache re-emits, but do not fire UX.
      wm.seenIds.add(n.id);
      continue;
    }
    wm.seenIds.add(n.id);
    if (!nextWatermark || n.createdAt > nextWatermark) {
      nextWatermark = n.createdAt;
    }
    // Synthesise the same envelope shape the socket would produce.
    // `actorUserId` is null on REST notifications (the wire DTO does
    // not expose it); the side-effects bridge treats null actor as
    // "non-self" so the toast fires for the recipient. This matches
    // the user's intent — they're seeing a notification ABOUT
    // something the other party did.
    const event: RealtimeEvent = {
      v: 1,
      type: 'notification.created',
      userId,
      actorUserId: null,
      occurredAt: n.createdAt,
      payload: n,
    };
    dispatchInvalidations(qc, event);
    dispatchRealtimeSideEffects(event, { currentUserId: userId });
  }
  wm.lastSeenCreatedAt = nextWatermark;
}

// Test-only reset hook. Production code never needs to call this —
// the user-switch effect handles natural cleanup.
export function __resetNotificationArrivalWatcherForTests(): void {
  watermarks.clear();
}
