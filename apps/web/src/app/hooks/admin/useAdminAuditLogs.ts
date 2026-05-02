import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListAdminAuditLogsQuery } from '@homeservicemarketplace/contracts';

import {
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
};

export function useAdminAuditLogs(filters: ListAdminAuditLogsQuery = {}) {
  return useQuery({
    queryKey: adminAuditQueryKeys.list(filters),
    queryFn: () => listAdminAuditLogs(filters),
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

export function useMarkAdminNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) => markAdminNotificationRead(notificationId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminNotificationsQueryKeys.root });
    },
  });
}
