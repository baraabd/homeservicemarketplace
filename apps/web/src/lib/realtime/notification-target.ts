// Sprint 7.12 — shared notification target resolver.
//
// Every surface that opens a notification target uses THIS function:
//   - side-effects.ts (Sonner toast "View" action — produces a deepLink)
//   - HomeScreen.handleNotifTap (Seeker drawer tap — opens an overlay
//     keyed off `.kind` + `.id`)
//   - ProviderApp notification drawer tap (Provider experience)
//   - ProfileTab notifications tap (Seeker profile)
//   - CompletedPostsView item tap
//
// Centralising the routing rules in one pure function fixes the
// previous defect where the Seeker drawer used resourceType-driven
// overlay routing but the toast "View" button used a separate
// resourceId-only deepLink fallback that wrongly used `bidId` as
// `requestId` and frequently landed on the app home.
//
// Returns null only when the payload is missing every identifier the
// router could possibly use; the caller should NOT navigate at all
// when null (don't fall back to home — bouncing users to the home
// screen on a notification tap is the original UX bug we fixed).

import type {
  NotificationResourceType,
  NotificationSummary,
  NotificationType,
} from '@homeservicemarketplace/contracts';

export type NotificationExperience = 'seeker' | 'provider';

// Logical destination — surfaces consume it by kind, not by URL.
// In-app overlay routers (HomeScreen) read `kind` + `id`; routed
// surfaces (toast View, ProviderApp) read `deepLink`.
export type NotificationTarget =
  // Seeker overlays. `id` is the resourceId; the overlay router maps
  // it to the appropriate React Query detail.
  | { kind: 'seeker-request-bids'; requestId: string; deepLink: string }
  | { kind: 'seeker-request-detail'; requestId: string; deepLink: string }
  | { kind: 'seeker-booking-detail'; bookingId: string; deepLink: string }
  | { kind: 'seeker-conversation'; conversationId: string; deepLink: string }
  // Provider overlays. Same id-vs-deepLink contract.
  | { kind: 'provider-bid-detail'; bidId: string; deepLink: string }
  | { kind: 'provider-booking-detail'; bookingId: string; deepLink: string }
  | { kind: 'provider-request-detail'; requestId: string; deepLink: string }
  | { kind: 'provider-conversation'; conversationId: string; deepLink: string };

// Narrow shape — mirrors NotificationSummary so callers can pass any
// notification-like envelope (REST polling row, realtime payload,
// synthesized AppNotification) without an upstream conversion.
export interface NotificationTargetInput {
  type?: NotificationType | string | null;
  resourceType?: NotificationResourceType | string | null;
  resourceId?: string | null;
  deepLink?: string | null;
  metadata?: Record<string, unknown> | null;
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// Resolve a notification payload into a typed target. The caller's
// `experience` argument decides which destination kinds are valid —
// the same BID_ACCEPTED notification produces different targets for
// the Seeker (booking detail) vs. Provider (My Bids accepted item).
//
// Routing rules (ordered by specificity):
//
//   BID + type=BID_RECEIVED  →  seeker request-bids (uses metadata.requestId)
//   BID + type=BID_ACCEPTED  →  provider bid-detail (deepLink /provider/bids/:bidId)
//                           OR seeker booking-detail when metadata.bookingId is present
//   BOOKING                 →  experience-specific booking detail
//   REQUEST                 →  experience-specific request detail
//   CONVERSATION            →  conversation by resourceId
//
// SYSTEM / null / unknown   →  null (don't navigate — let the toast
//                              act as an information-only banner).
export function resolveNotificationTarget(
  input: NotificationTargetInput,
  experience: NotificationExperience,
): NotificationTarget | null {
  const resourceType = (input.resourceType ?? null) as string | null;
  const resourceId = input.resourceId ?? null;
  const type = (input.type ?? null) as string | null;
  const meta = input.metadata ?? null;

  // BID — the resourceId is the bidId, NEVER the requestId. Use
  // metadata-supplied parent ids for the actual navigation target.
  if (resourceType === 'BID') {
    if (experience === 'provider') {
      // Provider received bid feedback (accept / reject) on their bid.
      const bookingId = metaString(meta, 'bookingId');
      if (bookingId) {
        return {
          kind: 'provider-booking-detail',
          bookingId,
          deepLink: `/provider/bookings/${bookingId}`,
        };
      }
      if (resourceId) {
        return {
          kind: 'provider-bid-detail',
          bidId: resourceId,
          deepLink: `/provider/bids/${resourceId}`,
        };
      }
      return null;
    }
    // Seeker received a bid (BID_RECEIVED) — open the bids compare
    // view for the parent request. Falls back to the request detail
    // when the bid has been accepted and a bookingId is available.
    const bookingIdSeeker = metaString(meta, 'bookingId');
    if (bookingIdSeeker && type === 'BID_ACCEPTED') {
      return {
        kind: 'seeker-booking-detail',
        bookingId: bookingIdSeeker,
        deepLink: `/home/bookings/${bookingIdSeeker}`,
      };
    }
    const requestId = metaString(meta, 'requestId');
    if (requestId) {
      return {
        kind: 'seeker-request-bids',
        requestId,
        deepLink: `/home/requests/${requestId}/bids`,
      };
    }
    return null;
  }

  // BOOKING — resourceId IS the bookingId, deepLink prefers
  // the backend-supplied value when present (so a future routing
  // change on the backend wins without a frontend deploy).
  if (resourceType === 'BOOKING' && resourceId) {
    const supplied =
      typeof input.deepLink === 'string' && input.deepLink.length > 0 ? input.deepLink : null;
    if (experience === 'provider') {
      return {
        kind: 'provider-booking-detail',
        bookingId: resourceId,
        deepLink: supplied ?? `/provider/bookings/${resourceId}`,
      };
    }
    return {
      kind: 'seeker-booking-detail',
      bookingId: resourceId,
      deepLink: supplied ?? `/home/bookings/${resourceId}`,
    };
  }

  // REQUEST — resourceId is the requestId. Provider-side
  // notifications include REQUEST_AVAILABLE (fan-out) which lands on
  // the available-requests detail route; seeker-side notifications
  // (e.g. REQUEST_UPDATED) land on the seeker request detail.
  if (resourceType === 'REQUEST' && resourceId) {
    const supplied =
      typeof input.deepLink === 'string' && input.deepLink.length > 0 ? input.deepLink : null;
    if (experience === 'provider') {
      return {
        kind: 'provider-request-detail',
        requestId: resourceId,
        deepLink: supplied ?? `/provider/requests/${resourceId}`,
      };
    }
    return {
      kind: 'seeker-request-detail',
      requestId: resourceId,
      deepLink: supplied ?? `/home/requests/${resourceId}`,
    };
  }

  // CONVERSATION — resourceId is the conversationId. Both experiences
  // open their own chat surface.
  if (resourceType === 'CONVERSATION' && resourceId) {
    const supplied =
      typeof input.deepLink === 'string' && input.deepLink.length > 0 ? input.deepLink : null;
    if (experience === 'provider') {
      return {
        kind: 'provider-conversation',
        conversationId: resourceId,
        deepLink: supplied ?? `/provider/chat/${resourceId}`,
      };
    }
    return {
      kind: 'seeker-conversation',
      conversationId: resourceId,
      deepLink: supplied ?? `/home/messages/${resourceId}`,
    };
  }

  // SYSTEM / REVIEW / unknown / null — no actionable target.
  return null;
}

// Convenience: typed input from a NotificationSummary. Pure pass-
// through so callers don't have to re-shape the row.
export function targetFromSummary(
  summary: Pick<
    NotificationSummary,
    'type' | 'resourceType' | 'resourceId' | 'deepLink' | 'metadata'
  >,
  experience: NotificationExperience,
): NotificationTarget | null {
  return resolveNotificationTarget(
    {
      type: summary.type ?? null,
      resourceType: summary.resourceType ?? null,
      resourceId: summary.resourceId ?? null,
      deepLink: summary.deepLink ?? null,
      metadata: summary.metadata ?? null,
    },
    experience,
  );
}
