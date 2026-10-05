import type {
  ListNotificationsQuery,
  MarkAllNotificationsReadRequest,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  NotificationListResponse,
  NotificationUnreadCountResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// R17-B — the seeker app reads and marks only seeker-experience
// notifications (deep links under /home/, plus dispute notices, which belong
// to both participant experiences). Without it the seeker drawer showed the
// same account's provider rows, and its read-all cleared them.
const SEEKER_EXPERIENCE = 'seeker' as const;

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
      experience: SEEKER_EXPERIENCE,
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
    { params: { experience: SEEKER_EXPERIENCE } },
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

// R17-B — read-all names the unread notifications the seeker was shown; one
// that arrived after the list was read stays unread.
export async function markAllNotificationsRead(
  ids: string[],
): Promise<MarkAllNotificationsReadResponse> {
  const body: MarkAllNotificationsReadRequest = { ids };
  const { data } = await api.post<MarkAllNotificationsReadResponse>(
    '/v1/me/notifications/read-all',
    body,
    { params: { experience: SEEKER_EXPERIENCE } },
  );
  return data;
}

export async function deleteNotification(notificationId: string): Promise<void> {
  await api.delete(`/v1/me/notifications/${notificationId}`);
}
