import type {
  ListNotificationsQuery,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  NotificationListResponse,
  NotificationUnreadCountResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Thin typed wrappers around the /v1/me/notifications endpoints. All
// requests carry credentials (api.ts sets `withCredentials: true`);
// mutations pick up the X-CSRF-Token header from the request
// interceptor; the 401-refresh interceptor handles transparent
// access-token refresh.

export async function listNotifications(
  query: ListNotificationsQuery = {},
): Promise<NotificationListResponse> {
  const { data } = await api.get<NotificationListResponse>('/v1/me/notifications', {
    params: {
      ...(query.unread !== undefined ? { unread: query.unread } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    },
  });
  return data;
}

export async function getUnreadNotificationsCount(): Promise<NotificationUnreadCountResponse> {
  const { data } = await api.get<NotificationUnreadCountResponse>(
    '/v1/me/notifications/unread-count',
  );
  return data;
}

export async function markNotificationRead(
  notificationId: string,
): Promise<MarkNotificationReadResponse> {
  const { data } = await api.post<MarkNotificationReadResponse>(
    `/v1/me/notifications/${notificationId}/read`,
  );
  return data;
}

export async function markAllNotificationsRead(): Promise<MarkAllNotificationsReadResponse> {
  const { data } = await api.post<MarkAllNotificationsReadResponse>(
    '/v1/me/notifications/read-all',
  );
  return data;
}

export async function deleteNotification(notificationId: string): Promise<void> {
  await api.delete(`/v1/me/notifications/${notificationId}`);
}
