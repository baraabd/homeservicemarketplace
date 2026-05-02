import type {
  ListAdminAuditLogsQuery,
  ListAdminAuditLogsResponse,
  MarkNotificationReadResponse,
  NotificationListResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Sprint 6.6 — admin audit-logs + notifications API clients.

export async function listAdminAuditLogs(
  query: ListAdminAuditLogsQuery = {},
): Promise<ListAdminAuditLogsResponse> {
  const params: Record<string, string | number> = {};
  if (query.actor) params.actor = query.actor;
  if (query.action) params.action = query.action;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListAdminAuditLogsResponse>('/v1/admin/audit-logs', { params });
  return data;
}

export async function listAdminNotifications(
  query: { unread?: boolean; limit?: number; cursor?: string } = {},
): Promise<NotificationListResponse> {
  const params: Record<string, string | number> = {};
  if (query.unread !== undefined) params.unread = String(query.unread);
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<NotificationListResponse>('/v1/admin/notifications', {
    params,
  });
  return data;
}

export async function markAdminNotificationRead(
  notificationId: string,
): Promise<MarkNotificationReadResponse> {
  const { data } = await api.post<MarkNotificationReadResponse>(
    `/v1/admin/notifications/${notificationId}/read`,
  );
  return data;
}
