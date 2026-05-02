import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { providerQueryKeys } from '../../../lib/provider/query-keys';
import {
  getProviderUnreadNotificationsCount,
  listProviderNotifications,
  markAllProviderNotificationsRead,
  markProviderNotificationRead,
} from '../../../lib/provider/provider-notifications-api';

// Sprint 5.5 — provider notifications hooks.
//
// Polling cadence: 20 s for the list, 15 s for the badge count
// (badge updates need to feel snappier; the spec calls for
// 15–30 s on both). React Query pauses both intervals when the
// tab is backgrounded; refetchOnWindowFocus = true catches up
// the moment the operator returns.

const LIST_REFETCH_MS = 20_000;
const COUNT_REFETCH_MS = 15_000;

export function useProviderNotifications(filters: { unread?: boolean } = {}) {
  return useQuery({
    queryKey: providerQueryKeys.notifications.list({ unread: filters.unread }),
    queryFn: () => listProviderNotifications(filters),
    refetchInterval: LIST_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function useProviderUnreadNotificationsCount() {
  return useQuery({
    queryKey: providerQueryKeys.notifications.unreadCount(),
    queryFn: getProviderUnreadNotificationsCount,
    refetchInterval: COUNT_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function useMarkProviderNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => markProviderNotificationRead(notificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: providerQueryKeys.notifications.root });
    },
  });
}

export function useMarkAllProviderNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllProviderNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: providerQueryKeys.notifications.root });
    },
  });
}
