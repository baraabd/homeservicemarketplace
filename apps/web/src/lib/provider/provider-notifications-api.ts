import type {
  ListNotificationsQuery,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  NotificationListResponse,
  NotificationUnreadCountResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Sprint 5.5 — provider-side wrappers around /v1/me/notifications.
//
// The endpoints are role-agnostic; the `experience=provider` query
// parameter (server-side filtered by the deepLink prefix
// `/provider/...`) is what scopes the feed + read-all to the
// provider drawer. These helpers default to that scope so callers
// can't accidentally read or silence the seeker's badge.

const PROVIDER_EXPERIENCE = 'provider' as const;

export async function listProviderNotifications(
  query: Omit<ListNotificationsQuery, 'experience'> = {},
): Promise<NotificationListResponse> {
  const { data } = await api.get<NotificationListResponse>('/v1/me/notifications', {
    params: {
      experience: PROVIDER_EXPERIENCE,
      ...(query.unread !== undefined ? { unread: query.unread } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    },
  });
  return data;
}

export async function getProviderUnreadNotificationsCount(): Promise<NotificationUnreadCountResponse> {
  const { data } = await api.get<NotificationUnreadCountResponse>(
    '/v1/me/notifications/unread-count',
    { params: { experience: PROVIDER_EXPERIENCE } },
  );
  return data;
}

export async function markProviderNotificationRead(
  notificationId: string,
): Promise<MarkNotificationReadResponse> {
  const { data } = await api.post<MarkNotificationReadResponse>(
    `/v1/me/notifications/${encodeURIComponent(notificationId)}/read`,
  );
  return data;
}

export async function markAllProviderNotificationsRead(): Promise<MarkAllNotificationsReadResponse> {
  const { data } = await api.post<MarkAllNotificationsReadResponse>(
    '/v1/me/notifications/read-all',
    null,
    { params: { experience: PROVIDER_EXPERIENCE } },
  );
  return data;
}
