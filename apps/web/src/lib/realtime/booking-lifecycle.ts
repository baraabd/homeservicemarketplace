// Sprint 7.x — shared booking-lifecycle helpers.
//
// Five problems this module solves in one place so the two surfaces
// that fire UX (the realtime socket bridge AND the REST polling
// watcher) stay in lockstep:
//
// 1. Status normalization: a "booking moved to IN_PROGRESS" event can
//    arrive as `booking.status_changed { to: 'IN_PROGRESS' }`, or as a
//    `notification.created` whose payload mirrors NotificationSummary
//    (`type: 'BOOKING_IN_PROGRESS'`, `metadata.to: 'IN_PROGRESS'`,
//    `metadata.status: 'IN_PROGRESS'`). Multiple shapes; ONE source of
//    truth for "what status did we just observe".
//
// 2. Lifecycle ordering: socket + polling can race, so an older
//    SCHEDULED / BID_ACCEPTED payload sometimes lands AFTER an
//    IN_PROGRESS / COMPLETED / CANCELLED one. The UI must never
//    visually revert. `compareLifecycle` returns a stable ordering so
//    consumers can drop a stale event.
//
// 3. Shared dedupe key: socket and polling can each deliver the same
//    transition. Computing the key in one place (with the same shape
//    for both sources) collapses duplicates into a single toast/beep.
//
// 4. Source-agnostic side-effects firing: the side-effects layer
//    consumes ONE shape (LifecycleEvent) so polling-side calls don't
//    diverge from socket-side calls.
//
// 5. Test isolation: a `__reset…ForTests` hook lets vitest start every
//    case from a clean dedupe map without rebuilding the module.

import type {
  BookingStatusChangedRealtimePayload,
  RealtimeEvent,
} from '@homeservicemarketplace/contracts';

// The narrow subset of BookingStatus values the seeker UX cares about.
// Other values (e.g. future SCHEDULED → BOOKED) pass through this
// helper untouched.
export type BookingLifecycleStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

// Total order on the lifecycle. Higher = more "advanced". Used by
// `compareLifecycle` to drop stale events.
//
//   SCHEDULED (0)  <  IN_PROGRESS (1)  <  COMPLETED (2)
//                                     <  CANCELLED (2)
//
// CANCELLED and COMPLETED both occupy the terminal tier (2) — once
// you're in either, no further transitions are valid. The current
// product rule allows IN_PROGRESS → CANCELLED, which the comparator
// handles via "incoming >= current" semantics.
const LIFECYCLE_ORDER: Record<BookingLifecycleStatus, number> = {
  SCHEDULED: 0,
  IN_PROGRESS: 1,
  COMPLETED: 2,
  CANCELLED: 2,
};

// True when `incoming` is at least as advanced as `current`. Used to
// gate UI patching: if the cache already shows COMPLETED, an
// incoming IN_PROGRESS event should NOT downgrade the visible state.
export function isLifecycleAtLeast(
  incoming: BookingLifecycleStatus | null,
  current: BookingLifecycleStatus | null,
): boolean {
  if (!incoming) return false;
  if (!current) return true;
  return LIFECYCLE_ORDER[incoming] >= LIFECYCLE_ORDER[current];
}

// ─── Status normalizer ───────────────────────────────────────────────

// NotificationType values that map deterministically onto a single
// BookingLifecycleStatus. Used when neither `metadata.to` nor
// `metadata.status` is supplied — older payloads / future
// publishers that haven't migrated to the enriched metadata yet.
const NOTIF_TYPE_TO_LIFECYCLE: Record<string, BookingLifecycleStatus> = {
  BOOKING_CREATED: 'SCHEDULED',
  BOOKING_IN_PROGRESS: 'IN_PROGRESS',
  BOOKING_COMPLETED: 'COMPLETED',
  BOOKING_CANCELLED: 'CANCELLED',
};

function asLifecycleStatus(value: unknown): BookingLifecycleStatus | null {
  return value === 'SCHEDULED' ||
    value === 'IN_PROGRESS' ||
    value === 'COMPLETED' ||
    value === 'CANCELLED'
    ? value
    : null;
}

// Reads the right lifecycle status from any of the wire shapes the
// backend emits today:
//
//   booking.status_changed → payload.to (typed)
//   booking.status_changed → payload.status (defensive — some future
//                                            emitters might write this)
//   notification.created   → payload.metadata.to
//   notification.created   → payload.metadata.status
//   notification.created   → payload.type (when neither metadata key
//                                          is present; reverse-mapped
//                                          via NOTIF_TYPE_TO_LIFECYCLE)
//
// Returns null when the event has no recognisable lifecycle hint —
// the caller drops the side-effect on the floor.
export function deriveBookingLifecycleStatus(event: RealtimeEvent): BookingLifecycleStatus | null {
  if (event.type === 'booking.status_changed') {
    const p = event.payload as Partial<BookingStatusChangedRealtimePayload> & {
      status?: unknown;
    };
    return asLifecycleStatus(p.to) ?? asLifecycleStatus(p.status);
  }
  if (event.type === 'notification.created') {
    const p = event.payload as {
      type?: string;
      resourceType?: string | null;
      metadata?: { to?: unknown; status?: unknown } | null;
    } | null;
    // Only BOOKING-scoped notifications carry a lifecycle status; a
    // REQUEST or BID notification.created event with stray metadata.to
    // is not the booking we're tracking.
    if (p?.resourceType !== 'BOOKING') return null;
    return (
      asLifecycleStatus(p.metadata?.to) ??
      asLifecycleStatus(p.metadata?.status) ??
      (typeof p.type === 'string' ? (NOTIF_TYPE_TO_LIFECYCLE[p.type] ?? null) : null)
    );
  }
  return null;
}

// Reads the bookingId off either event shape so the dedupe key +
// cache patcher can target the right row.
export function deriveBookingId(event: RealtimeEvent): string | null {
  if (event.type === 'booking.status_changed') {
    const p = event.payload as Partial<BookingStatusChangedRealtimePayload>;
    return typeof p.bookingId === 'string' && p.bookingId.length > 0 ? p.bookingId : null;
  }
  if (event.type === 'notification.created') {
    const p = event.payload as {
      resourceType?: string | null;
      resourceId?: string | null;
      metadata?: { bookingId?: unknown } | null;
    } | null;
    if (p?.resourceType !== 'BOOKING') return null;
    if (typeof p.resourceId === 'string' && p.resourceId.length > 0) return p.resourceId;
    const metaBookingId = p?.metadata?.bookingId;
    return typeof metaBookingId === 'string' && metaBookingId.length > 0 ? metaBookingId : null;
  }
  return null;
}

// ─── Shared dedupe ───────────────────────────────────────────────────

// Strong key: notification id (always unique per write). The polling
// watcher derives this from NotificationSummary.id; the realtime
// `notification.created` event uses the same field. So the same
// notification arriving over both transports collapses.
//
// Weak key: bookingId + status. Used when no notification id exists
// (the `booking.status_changed` realtime event mirrors a transition
// that may or may not be paired with a notification — e.g. start was
// notification-less before Sprint 7.x).
export function buildLifecycleDedupeKey(
  event: RealtimeEvent,
  status: BookingLifecycleStatus | null,
): string | null {
  if (!status) return null;
  if (event.type === 'notification.created') {
    const p = event.payload as { id?: string } | null;
    if (p?.id) return `notif:${p.id}`;
  }
  const bookingId = deriveBookingId(event);
  if (!bookingId) return null;
  return `booking:${bookingId}:${status}`;
}

// Module-level dedupe cache. Production never clears this map by
// hand — entries fall out of relevance after the window passes
// (a recurring transition for the same booking + status is what
// would re-set the timestamp anyway). `__reset…ForTests` is the
// test-only escape hatch.
const DEDUPE_WINDOW_MS = 2500;
const seen = new Map<string, number>();

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

// Returns true if this key has fired UX inside the dedupe window —
// caller should drop the side-effect. False means "first time you've
// seen this; record + fire."
export function isDuplicateLifecycleEvent(key: string | null): boolean {
  if (!key) return false;
  const last = seen.get(key);
  const now = nowMs();
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return true;
  seen.set(key, now);
  return false;
}

export function __resetBookingLifecycleForTests(): void {
  seen.clear();
}
