import type { NotificationResourceType } from '../enums/notification-resource-type';
import type { NotificationType } from '../enums/notification-type';

// Row shape returned by the list / detail / mark-read endpoints. Every
// field the drawer card needs to render: kind (drives icon/colour),
// title + body strings, the resource link the tap handler routes to,
// and the read state.
//
// `metadata` is an optional JSON blob the writer controls — keeps
// auxiliary keys (e.g. `acceptedBidId` on a BOOKING_CREATED) out of
// the title/body which the drawer renders as-is.
//
// `userId` is intentionally NOT exposed — every notification surfaces
// only on the owner's feed.
export interface NotificationSummary {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  resourceType: NotificationResourceType | null;
  resourceId: string | null;
  deepLink: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}
