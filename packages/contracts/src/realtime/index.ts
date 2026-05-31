// Realtime channel.
//
// Sprint 7.0 (initial): SSE at GET /v1/me/events.
// Sprint 7.0 (refined): Socket.IO gateway on the same Nest HTTP
//   server. The wire envelope below is unchanged across transports
//   so the web client can swap EventSource → socket.io-client
//   without a contract change.
//
// Versioned envelope so the bus can evolve without breaking
// connected clients. The payload mirrors the existing REST response
// shapes — clients drop them straight into their React Query cache.
import type { BidSummary } from '../seeker/bids/response/bid-summary';
import type { BookingStatus } from '../seeker/bookings/enums/booking-status';
import type { BookingSummary } from '../seeker/bookings/response/booking-summary';

export type RealtimeEventType =
  | 'notification.created'
  | 'message.created'
  | 'request.available'
  | 'bid.created'
  | 'bid.accepted'
  // Sprint 7.5 — fired alongside bid.accepted on a successful
  // accept-bid. Separate from booking.status_changed (which covers
  // start/complete/cancel transitions on an existing booking) because
  // the seeker/provider apps subscribe to it to seed their bookings
  // cache the instant the row is created.
  | 'booking.created'
  | 'booking.status_changed'
  | 'bid.status_changed'
  | 'provider.status_changed';

// Sprint 7.6 — `actorUserId` is the OPTIONAL envelope-level identity
// of the user whose action produced this event. It enables anti-echo
// gating on the client: the side-effects bridge (toast / sound /
// vibration) suppresses UX feedback when the recipient IS the actor,
// while React Query cache invalidation still runs unconditionally so
// other tabs / devices of the same actor stay in sync.
//
// Set on EVERY publish path that has a definite human actor (bid
// accept, booking lifecycle, notification.created for those flows).
// System-generated events (e.g. request.available emitted by the
// matching engine) omit it — `actorUserId` therefore stays `null`
// and the bridge defaults to "non-actor → show UX".
//
// Older clients that pre-date Sprint 7.6 simply ignore the field —
// the envelope is additive-only, so backward compatibility is intact.
export interface RealtimeEvent<T = unknown> {
  v: 1;
  type: RealtimeEventType;
  // Recipient userId for user-targeted events. For room-targeted
  // events (conversation:, provider:, admin) this is the originating
  // user or null — clients route on the event `type` and the room
  // they joined, not on `userId`.
  userId: string | null;
  // Sprint 7.6 — see comment above. Optional + nullable. The client
  // bridge MUST prefer this envelope-level field over any
  // `actorUserId` that happens to be inside `payload`.
  actorUserId?: string | null;
  occurredAt: string;
  payload: T;
}

// Sprint 7.5 — typed payload for bid.accepted (Sprint 7.6 added
// `actorUserId` on the envelope; we also keep the field on the
// payload for self-contained subscribers that key off the body).
//
// Recipients: seeker (cache + ack) and provider (cache + bid update).
// Anti-echo: actor = seeker; the seeker's own tabs/devices receive
// the event for cache invalidation but the bridge silences UX.
export interface BidAcceptedRealtimePayload {
  requestId: string;
  bid: BidSummary;
  bookingId: string;
  actorUserId: string;
  actorRole: 'SEEKER';
}

// Sprint 7.5 — typed payload for booking.created. Fires alongside
// bid.accepted so the bookings tab can seed the new row without an
// extra fetch. Same anti-echo semantics as BidAcceptedRealtimePayload.
export interface BookingCreatedRealtimePayload {
  requestId: string;
  booking: BookingSummary;
  actorUserId: string;
  actorRole: 'SEEKER';
}

// Sprint 7.5.1 — typed payload for booking.status_changed.
//
// Published post-commit by the provider booking lifecycle service
// (`start` / `complete` / `cancel`). Delivered to BOTH the seeker
// (so the Bookings tab + active overlays refresh) and the provider
// (so other tabs/devices on the same provider account see the
// transition without polling).
//
// Field semantics:
//   - bookingId        : id of the booking that transitioned
//   - requestId        : the parent ServiceRequest id (carried so
//                        seeker UIs that key cache by request can
//                        target the right entry without a second
//                        fetch)
//   - bidId            : the accepted-bid id when known. Null for
//                        legacy rows that pre-date the bid<>booking
//                        link, never null in current writes.
//   - from             : previous BookingStatus (e.g. 'SCHEDULED')
//   - to               : next BookingStatus (e.g. 'IN_PROGRESS')
//   - actorUserId      : userId of the party that drove the
//                        transition. PROVIDER-initiated for this
//                        sprint; the type stays string so a future
//                        seeker-cancel or admin path slots in
//                        without a contract break.
//   - actorRole        : Discriminator on the actor. Provider start /
//                        complete / cancel land as 'PROVIDER'. Sprint
//                        7.x added 'SEEKER' for the seeker-initiated
//                        cancel (BookingsService.cancel) so a single
//                        consumer case handles every transition. The
//                        recipient-side bridge only needs `actorUserId`
//                        for anti-echo; `actorRole` is for analytics /
//                        copy variants and is treated as opaque by
//                        the cache dispatcher.
//
// The shape is intentionally narrow — no booking summary, no
// timeline event payload. Clients re-fetch through their normal
// React Query invalidation path, so the realtime event is a
// notification, not a state replica.
export type BookingStatusChangedActorRole = 'PROVIDER' | 'SEEKER';

export interface BookingStatusChangedRealtimePayload {
  bookingId: string;
  requestId: string;
  bidId: string | null;
  from: BookingStatus;
  to: BookingStatus;
  actorUserId: string;
  actorRole: BookingStatusChangedActorRole;
}

// Sprint 7.0 (refined): Socket.IO room taxonomy. Rooms are SERVER-
// OWNED — the client never names a room directly. The gateway joins
// the user's `user:` / `provider:` / `admin` rooms on the `connection`
// event from the resolved JWT identity. The only client-emitted join
// is `subscribe:conversation { conversationId }` which runs the
// participant gate before calling `socket.join`.
export type RealtimeRoomKind = 'user' | 'provider' | 'conversation' | 'admin';

export interface RealtimeRoom {
  kind: RealtimeRoomKind;
  // One of: <userId>, <providerProfileId>, <conversationId>, or ''
  // for the admin room.
  id: string;
}

export interface SubscribeToConversationPayload {
  conversationId: string;
}

// Tiny lifecycle ack so the client can paint a "connected" indicator
// and tell which rooms it ended up in. The runtime payload is
// intentionally small — clients use it only for connection-state
// UI hooks, never to feed business state.
export interface RealtimeConnectionAck {
  userId: string;
  joinedRooms: string[];
}
