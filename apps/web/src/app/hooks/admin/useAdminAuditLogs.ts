import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListAdminAuditLogsQuery } from '@homeservicemarketplace/contracts';

import {
  getAdminUnreadNotificationsCount,
  listAdminAuditLogs,
  listAdminNotifications,
  markAdminNotificationRead,
} from '../../../lib/admin/admin-audit-logs-api';

const REFETCH_MS = 60_000;

export const adminAuditQueryKeys = {
  root: ['admin', 'audit-logs'] as const,
  list: (filters: ListAdminAuditLogsQuery) => ['admin', 'audit-logs', 'list', filters] as const,
};

export const adminNotificationsQueryKeys = {
  root: ['admin', 'notifications'] as const,
  list: (filters: { unread?: boolean }) => ['admin', 'notifications', 'list', filters] as const,
  unreadCount: () => ['admin', 'notifications', 'unread-count'] as const,
};

// R17-D (D-7): the audit log pages by the server's keyset cursor. The first
// page alone hid everything older than the newest 50 events.
export function useAdminAuditLogs(filters: Omit<ListAdminAuditLogsQuery, 'cursor'> = {}) {
  return useInfiniteQuery({
    queryKey: adminAuditQueryKeys.list(filters),
    queryFn: ({ pageParam }) =>
      listAdminAuditLogs({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? null,
    refetchInterval: REFETCH_MS,
    staleTime: 15_000,
  });
}

export function useAdminNotifications(filters: { unread?: boolean } = {}) {
  return useQuery({
    queryKey: adminNotificationsQueryKeys.list(filters),
    queryFn: () => listAdminNotifications(filters),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function useAdminUnreadNotificationsCount() {
  return useQuery({
    queryKey: adminNotificationsQueryKeys.unreadCount(),
    queryFn: () => getAdminUnreadNotificationsCount(),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function useMarkAdminNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => markAdminNotificationRead(notificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminNotificationsQueryKeys.root });
    },
  });
}
