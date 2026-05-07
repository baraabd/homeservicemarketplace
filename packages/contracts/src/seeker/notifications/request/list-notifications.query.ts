// Optional query parameters for GET /v1/me/notifications. All optional;
// defaults: every notification (read + unread), newest first, page size
// 50. The unread filter drives the drawer's "New" section count without
// a second round-trip.
//
// `experience` (Sprint 5.5) scopes the feed to one user-experience.
// The server derives the experience from the notification's
// `deepLink` prefix (`/home/...` => seeker, `/provider/...` =>
// provider, `/admin/...` => admin) — no schema column needed.
// Passing `seeker` on the seeker app + `provider` on the provider
// app keeps cross-experience notifications out of the wrong drawer.
export type NotificationExperience = 'seeker' | 'provider' | 'admin';

export interface ListNotificationsQuery {
  unread?: boolean;
  experience?: NotificationExperience;
  limit?: number;
  cursor?: string;
}
