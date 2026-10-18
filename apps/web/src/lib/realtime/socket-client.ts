import { io, type Socket } from 'socket.io-client';
import type { RealtimeConnectionAck, RealtimeEvent } from '@homeservicemarketplace/contracts';

// Sprint 7.0 (refined) — thin Socket.IO client wrapper.
//
// Resolves the realtime URL from the same VITE_API_URL the REST
// surface uses (sockets share the API origin in production behind
// a TLS-terminating proxy). The auth token flows over the handshake
// `auth.token` field — the same access token cookie the REST 401
// interceptor would refresh, surfaced here through getToken().
//
// The wrapper is intentionally small:
//   - one shared socket instance per page (open/close pair)
//   - emitToRoom is server-only (the client never names a room)
//   - on('realtime.event') is the single event the React hook listens
//     to for query invalidation
//
// Mutations stay on REST. The socket is read-only from the client's
// perspective — `subscribe:conversation` is the only outbound emit
// and it is server-authorised.

let activeSocket: Socket | null = null;
let clearActiveHandshake: (() => void) | null = null;

function resolveSocketUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL?.trim();
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return 'http://localhost:4000';
  throw new Error('VITE_API_URL is required for the realtime socket in production builds');
}

export interface OpenRealtimeSocketOptions {
  // Authoritative source of the access token used in the WS handshake.
  // The hook re-evaluates this each `connect` so a token rotation
  // surfaces on the next reconnect.
  getToken(): string | null;
  // Optional override (tests / local probes).
  url?: string;
  onConnect?: () => void;
  onReady?: (ack: RealtimeConnectionAck) => void;
  onDisconnect?: (reason: string) => void;
  onConnectError?: (error: Error & { data?: { code?: string } }) => void;
  onEvent?: (event: RealtimeEvent) => void;
}

export function openRealtimeSocket(opts: OpenRealtimeSocketOptions): Socket {
  closeRealtimeSocket();
  const sock = io(opts.url ?? resolveSocketUrl(), {
    autoConnect: false,
    // One owner of retry/backoff: the authenticated recovery hook. Running
    // Socket.IO's loop as well would double retries during an outage.
    reconnection: false,
    timeout: 10_000,
    // WebSocket-only needs no sticky-session routing. The optional polling
    // upgrade mode requires the proxy's documented sticky-session policy.
    transports:
      import.meta.env.VITE_REALTIME_TRANSPORTS === 'polling,websocket'
        ? ['polling', 'websocket']
        : ['websocket'],
    withCredentials: true,
    // Socket.IO invokes an auth *callback*. Returning an object here leaves
    // the namespace handshake waiting forever (including cookie sessions).
    auth: (callback) => callback({ token: opts.getToken() ?? '' }),
  });

  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let ready = false;
  clearActiveHandshake = () => {
    clearTimeout(handshakeTimer);
    ready = false;
  };
  sock.on('connect', () => {
    ready = false;
    clearTimeout(handshakeTimer);
    handshakeTimer = setTimeout(() => {
      opts.onConnectError?.(
        Object.assign(new Error('Realtime authorization timed out'), {
          data: { code: 'ACK_TIMEOUT' },
        }),
      );
      sock.disconnect();
    }, 5_000);
    opts.onConnect?.();
  });
  sock.on('connection.ack', (value: unknown) => {
    const ack = value as Partial<RealtimeConnectionAck> | null;
    if (
      !ack ||
      typeof ack.userId !== 'string' ||
      ack.userId.length > 128 ||
      !Array.isArray(ack.joinedRooms) ||
      ack.joinedRooms.length > 40 ||
      !ack.joinedRooms.every((room) => typeof room === 'string' && room.length <= 128)
    ) {
      sock.disconnect();
      return;
    }
    ready = true;
    clearTimeout(handshakeTimer);
    opts.onReady?.(ack as RealtimeConnectionAck);
  });
  sock.on('disconnect', (reason) => {
    ready = false;
    clearTimeout(handshakeTimer);
    opts.onDisconnect?.(reason);
  });
  sock.on('connect_error', (error) => opts.onConnectError?.(error));
  sock.on('realtime.event', (event: RealtimeEvent) => {
    if (ready) opts.onEvent?.(event);
  });

  activeSocket = sock;
  sock.connect();
  return sock;
}

export function closeRealtimeSocket(): void {
  clearActiveHandshake?.();
  clearActiveHandshake = null;
  if (activeSocket) {
    activeSocket.removeAllListeners();
    activeSocket.disconnect();
    activeSocket = null;
  }
}

export function getActiveSocket(): Socket | null {
  return activeSocket;
}

// Outbound `subscribe:conversation` ack — server runs the participant
// gate before joining the conversation room. Returns the server's ack
// payload; callers fall back to polling if the server refuses.
export interface SubscribeConversationAck {
  ok: boolean;
  room?: string;
  code?: string;
}

export async function subscribeToConversation(
  conversationId: string,
): Promise<SubscribeConversationAck> {
  const sock = activeSocket;
  if (!sock || !sock.connected) return { ok: false, code: 'NOT_CONNECTED' };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(conversationId)) {
    return { ok: false, code: 'INVALID_CONVERSATION' };
  }
  return new Promise((resolve) => {
    // The server may disappear after emit. A bounded acknowledgement also
    // bounds Socket.IO's ack callback queue while REST remains available.
    sock
      .timeout(5_000)
      .emit(
        'subscribe:conversation',
        { conversationId },
        (error: Error | null, ack?: SubscribeConversationAck) =>
          resolve(
            error ? { ok: false, code: 'ACK_TIMEOUT' } : (ack ?? { ok: false, code: 'NO_ACK' }),
          ),
      );
  });
}
