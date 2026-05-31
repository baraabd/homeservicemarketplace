import { toast } from 'sonner';
import type {
  BookingStatusChangedRealtimePayload,
  NotificationResourceType,
  NotificationType,
  RealtimeEvent,
} from '@homeservicemarketplace/contracts';

import { triggerNotificationUX } from './notification-ux';
import { translateRealtime } from './realtime-i18n';

// Sprint 7.5.1 — UI side-effects bridge for realtime events.
// Sprint 7.6 — anti-echo gate (currentUserId vs event.actorUserId).
// Sprint 7.x — type-specific toast copy for notification.created so
//   the in-app banner says exactly what happened ("New bid received",
//   "Booking completed", etc.) instead of a generic placeholder.
//
// Lives next to `dispatchInvalidations` (the pure cache dispatcher in
// `use-realtime-socket.ts`) and is invoked from the same hook callback.
// Splitting the two means:
//   - `dispatchInvalidations` stays a pure function over QueryClient
//     and runs UNCONDITIONALLY (even for actor-originated events) so
//     the actor's own tabs/devices converge on the new state.
//   - `dispatchRealtimeSideEffects` owns toast + sound + vibration
//     and SKIPS the UX feedback when actorUserId === currentUserId.
//     The user just triggered the action; they already saw the
//     in-screen confirmation. Beeping in their face is bad UX.
//
// Dedupe contract:
//   - Each fired event computes a composite key that identifies the
//     "thing that happened" (bookingId + to + actor for booking
//     events, notificationId / resourceId + actor for notifications).
//     If we've already fired UX for the same key inside the dedupe
//     window, this call is a silent no-op.
//   - This is what prevents the seeker from receiving a toast + tone
//     TWICE when the backend writes a Notification AND publishes
//     booking.status_changed for the same booking in the same
//     transaction (today's behaviour for complete / cancel).

// Dedupe window. 2.5s is comfortably longer than the typical inter-
// arrival of a notification.created + booking.status_changed pair
// fired from the same backend mutation (sub-millisecond), and short
// enough that a genuine second event (e.g., the provider restarts
// the booking flow on a stuck row) still surfaces.
const DEDUPE_WINDOW_MS = 2500;

// LRU-ish map of dedupe key → timestamp. We don't bother evicting on
// a fixed schedule — the map is bounded by the number of distinct
// keys seen in any 2.5s window, which in practice never grows beyond
// a handful.
const seen = new Map<string, number>();

export interface DispatchRealtimeSideEffectsOptions {
  // The authenticated user's id. When the event's `actorUserId`
  // equals this value, the bridge silently returns — no toast, no
  // sound, no vibration. Cache invalidation (handled by the sibling
  // `dispatchInvalidations`) still runs unconditionally.
  //
  // Pass `null` when no user is loaded (the bridge then treats every
  // recipient as a non-actor, which is the safe default).
  currentUserId: string | null;
  // Reserved for future locale plumbing if a UI consumer wants to
  // force a render-time language override. Today the bridge reads
  // from `realtime-i18n` which is kept in sync by RootInner's
  // LanguageProvider bridge.
  locale?: string;
}

export function dispatchRealtimeSideEffects(
  event: RealtimeEvent,
  options: DispatchRealtimeSideEffectsOptions,
): void {
  // Sprint 7.6 — anti-echo gate. Read the envelope-level field
  // FIRST; some payloads also carry `actorUserId` for self-contained
  // subscribers, but the envelope is the canonical source of truth.
  const actorUserId = readActorUserId(event);
  if (
    actorUserId !== null &&
    options.currentUserId !== null &&
    actorUserId === options.currentUserId
  ) {
    return;
  }

  const key = buildDedupeKey(event, actorUserId);
  if (!key) return;
  const now = nowMs();
  const last = seen.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
    // Duplicate inside the window — silently drop the UX side-effect.
    // The cache invalidation already fired through the sibling
    // dispatcher; the user has the data, just not the redundant beep.
    return;
  }
  seen.set(key, now);

  switch (event.type) {
    case 'booking.status_changed': {
      const message = bookingToastMessage(event.payload as BookingStatusChangedRealtimePayload);
      toast.success(message);
      triggerNotificationUX();
      break;
    }
    case 'notification.created': {
      const { title, body } = notificationToastCopy(event.payload as NotificationSummaryLike);
      // Sonner accepts `(title, { description })` for two-line layouts;
      // a missing body collapses to a single-line toast automatically.
      if (body) {
        toast(title, { description: body });
      } else {
        toast(title);
      }
      triggerNotificationUX();
      break;
    }
    // Other event types are cache-only — the data refresh through
    // React Query is enough; no toast or sound. Adding new toast-
    // worthy events later is a one-case extension.
    default:
      break;
  }
}

// ─── helpers ────────────────────────────────────────────────────────

// Narrow shape — mirrors the relevant slice of NotificationSummary so
// the dispatcher doesn't need to import the full contract just to
// read a handful of fields.
interface NotificationSummaryLike {
  id?: string;
  type?: NotificationType | string;
  title?: string | null;
  body?: string | null;
  resourceType?: NotificationResourceType | string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Envelope-first lookup. Falls back to a payload-level field for
// backward compatibility with older publishers / future room-event
// emitters that might use the payload as the source of truth.
function readActorUserId(event: RealtimeEvent): string | null {
  if (typeof event.actorUserId === 'string' && event.actorUserId.length > 0) {
    return event.actorUserId;
  }
  // Defensive payload read — typed payloads (BidAccepted /
  // BookingCreated / BookingStatusChanged) all carry actorUserId
  // today, but a raw notification.created payload mirrors
  // NotificationSummary and does not. Returning null when absent
  // is the safe default — every recipient is treated as non-actor.
  const p = event.payload as { actorUserId?: unknown } | null | undefined;
  if (p && typeof p.actorUserId === 'string' && p.actorUserId.length > 0) {
    return p.actorUserId;
  }
  return null;
}

// Returns null for events we don't dedupe — those skip the side-
// effects path entirely. Sprint 7.6 added the actor to every key so
// two distinct actors producing the same {resource, transition}
// don't collapse into one dedupe slot. Same-actor duplicates still
// collapse (which is the whole point of dedupe).
function buildDedupeKey(event: RealtimeEvent, actorUserId: string | null): string | null {
  const actorSuffix = actorUserId ?? 'system';
  switch (event.type) {
    case 'booking.status_changed': {
      const p = event.payload as Partial<BookingStatusChangedRealtimePayload> | undefined;
      if (!p?.bookingId) return null;
      // The dedupe key intentionally includes the target status so
      // two distinct transitions on the same booking (e.g. start
      // then complete in quick succession during a race) still
      // surface as two toasts. The paired notification.created for
      // the same transition uses the SAME composite via its
      // resourceId so it dedupes against the booking event.
      return `booking:${p.bookingId}:${p.to ?? ''}:${actorSuffix}`;
    }
    case 'notification.created': {
      const p = event.payload as NotificationSummaryLike | undefined;
      if (p?.resourceType === 'BOOKING' && p.resourceId) {
        const to =
          (p.metadata as { to?: string } | null | undefined)?.to ??
          // Sprint 7.x: BOOKING_COMPLETED / BOOKING_CANCELLED notifications
          // do not carry an explicit `metadata.to` (the backend writes
          // requestId/providerId only), so the type itself disambiguates
          // distinct transitions on the same booking. Falling back to
          // `type` keeps the dedupe matching the paired
          // booking.status_changed event for COMPLETED/CANCELLED and
          // still separates two distinct transitions on the same row.
          p.type ??
          '';
        return `booking:${p.resourceId}:${to}:${actorSuffix}`;
      }
      if (p?.id) return `notification:${p.id}:${actorSuffix}`;
      // Unkeyed notification → don't dedupe; let it surface once
      // and trust the dispatcher's typical sub-millisecond cadence.
      return `notification:${nowMs()}:${actorSuffix}`;
    }
    default:
      return null;
  }
}

function bookingToastMessage(payload: BookingStatusChangedRealtimePayload): string {
  // Show a status-specific message when we recognise the target;
  // fall back to the generic "Booking status updated" copy
  // otherwise. The shape of the payload guarantees `to` is a
  // BookingStatus so the switch is exhaustive in practice.
  switch (payload.to) {
    case 'IN_PROGRESS':
      return translateRealtime('realtime.booking.started');
    case 'COMPLETED':
      return translateRealtime('realtime.booking.completed');
    case 'CANCELLED':
      return translateRealtime('realtime.booking.cancelled');
    default:
      return translateRealtime('realtime.booking.statusChanged');
  }
}

// Sprint 7.x — type-specific toast copy. Prefers the localised
// realtime-i18n strings over the backend-supplied title/body so the
// in-app toast stays in the user's active language even when the
// backend ships English-only copy. Falls back to backend strings,
// then to a generic "New notification" so an unknown type never
// produces an empty toast.
function notificationToastCopy(payload: NotificationSummaryLike): {
  title: string;
  body: string | null;
} {
  const type = typeof payload.type === 'string' ? payload.type : null;
  if (type) {
    const localisedTitle = translateRealtime(
      `realtime.notif.${type}.title` as Parameters<typeof translateRealtime>[0],
    );
    const localisedBody = bodyForNotification(type, payload);
    // `translateRealtime` returns the key itself when there's no match;
    // detect that and fall back to the backend-supplied title.
    const titleHit = localisedTitle && !localisedTitle.startsWith('realtime.notif.');
    const title = titleHit
      ? localisedTitle
      : (payload.title ?? translateRealtime('realtime.notification.created'));
    return { title, body: localisedBody };
  }
  return {
    title: payload.title ?? translateRealtime('realtime.notification.created'),
    body: payload.body ?? null,
  };
}

// BOOKING_CANCELLED can be initiated by either party — the backend
// writes `metadata.cancelledBy: 'seeker' | 'provider'` (Sprint 7.x
// `BookingsService.cancel`). Use it to pick a clearer body string;
// fall back to the generic copy when absent.
function bodyForNotification(type: string, payload: NotificationSummaryLike): string | null {
  if (type === 'BOOKING_CANCELLED') {
    const by = (payload.metadata as { cancelledBy?: string } | null | undefined)?.cancelledBy;
    if (by === 'seeker') {
      return translateRealtime('realtime.notif.BOOKING_CANCELLED.bySeeker.body');
    }
    if (by === 'provider') {
      return translateRealtime('realtime.notif.BOOKING_CANCELLED.byProvider.body');
    }
  }
  const localised = translateRealtime(
    `realtime.notif.${type}.body` as Parameters<typeof translateRealtime>[0],
  );
  // Same key-passthrough check as the title — fall back to the
  // backend-supplied body when no localisation exists.
  if (localised && !localised.startsWith('realtime.notif.')) {
    return localised || null;
  }
  return payload.body ?? null;
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

// Test-only reset for the dedupe cache. Production code never needs
// to clear this — the natural cooldown handles eviction.
export function __resetSideEffectsForTests(): void {
  seen.clear();
}
