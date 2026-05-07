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
export type RealtimeEventType =
  | 'notification.created'
  | 'message.created'
  | 'request.available'
  | 'bid.created'
  | 'bid.accepted'
  | 'booking.status_changed'
  | 'bid.status_changed'
  | 'provider.status_changed';

export interface RealtimeEvent<T = unknown> {
  v: 1;
  type: RealtimeEventType;
  // Recipient userId for user-targeted events. For room-targeted
  // events (conversation:, provider:, admin) this is the originating
  // user or null — clients route on the event `type` and the room
  // they joined, not on `userId`.
  userId: string | null;
  occurredAt: string;
  payload: T;
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
