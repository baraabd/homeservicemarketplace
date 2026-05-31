import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  NotificationListResponse,
  NotificationUnreadCountResponse,
} from '@homeservicemarketplace/contracts';

import {
  deleteNotification,
  getUnreadNotificationsCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../../lib/seeker/notifications-api';
import { seekerQueryKeys } from '../../../lib/seeker/query-keys';

// React Query hook for the notification drawer feed.
//
// Sprint 7.x — added refetchInterval + refetchOnWindowFocus so the
// drawer converges on fresh state even when the realtime Socket.IO
// channel is offline (handshake failure, network blip, browser tab
// background-suspended). The realtime bridge is the primary delivery
// channel; this polling is the safety net.
//
//   staleTime               5s   — short enough that any focus / tab
//                                 switch within seconds of an event
//                                 picks up the new state.
//   refetchInterval         20s  — drawer polls quietly while open;
//                                 well under the typical accept-bid
//                                 → notification-arrives latency
//                                 budget.
//   refetchOnWindowFocus    true — switching back to the tab after
//                                 inactivity always triggers a fresh
//                                 fetch.
export function useNotifications(filter?: { unread?: boolean }) {
  return useQuery<NotificationListResponse>({
    queryKey: seekerQueryKeys.notifications.list(filter),
    queryFn: () => listNotifications(filter ?? {}),
    staleTime: 5 * 1000,
    refetchInterval: 20 * 1000,
    refetchOnWindowFocus: true,
  });
}

// Lightweight count for the bell badge. Separate from the list so the
// badge can update independently. Same polling fallback semantics as
// useNotifications, but with a tighter 15s interval — the badge is
// always visible (drawer doesn't need to be open) and a stale count
// is the most user-noticeable lag.
export function useUnreadNotificationsCount() {
  return useQuery<NotificationUnreadCountResponse>({
    queryKey: seekerQueryKeys.notifications.unreadCount(),
    queryFn: () => getUnreadNotificationsCount(),
    staleTime: 5 * 1000,
    refetchInterval: 15 * 1000,
    refetchOnWindowFocus: true,
  });
}

// Mark-one-read mutation. Idempotent server-side. On success,
// invalidate the notifications root so list + unread count both
// refetch (the badge clears, the drawer row flips to read).
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation<MarkNotificationReadResponse, Error, string>({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: seekerQueryKeys.notifications.root });
    },
  });
}

// Mark-all-read mutation. Idempotent (returns count: 0 when nothing
// was unread). Same invalidation as single mark-read.
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation<MarkAllNotificationsReadResponse, Error, void>({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: seekerQueryKeys.notifications.root });
    },
  });
}

// Soft-delete (HTTP 204). The drawer doesn't expose this surface yet
// but the hook is here so a future "clear notifications" CTA can
// hook in cleanly.
export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (notificationId: string) => deleteNotification(notificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: seekerQueryKeys.notifications.root });
    },
  });
}
