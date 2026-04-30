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

// React Query hook for the notification drawer feed. 30s stale time
// matches the requests / bookings / conversations feeds — sub-minute
// freshness without polling on every render.
export function useNotifications(filter?: { unread?: boolean }) {
  return useQuery<NotificationListResponse>({
    queryKey: seekerQueryKeys.notifications.list(filter),
    queryFn: () => listNotifications(filter ?? {}),
    staleTime: 30 * 1000,
  });
}

// Lightweight count for the bell badge. Separate from the list so the
// badge can update independently (and a future realtime slice can
// invalidate just this key).
export function useUnreadNotificationsCount() {
  return useQuery<NotificationUnreadCountResponse>({
    queryKey: seekerQueryKeys.notifications.unreadCount(),
    queryFn: () => getUnreadNotificationsCount(),
    staleTime: 30 * 1000,
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
