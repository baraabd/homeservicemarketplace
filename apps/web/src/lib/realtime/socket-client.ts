import { io, type Socket } from 'socket.io-client';
import type { RealtimeEvent } from '@homeservicemarketplace/contracts';

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
  onDisconnect?: (reason: string) => void;
  onEvent?: (event: RealtimeEvent) => void;
}

export function openRealtimeSocket(opts: OpenRealtimeSocketOptions): Socket {
  closeRealtimeSocket();
  const sock = io(opts.url ?? resolveSocketUrl(), {
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    // Cap backoff at 30s so a flaky network doesn't spin the CPU.
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    transports: ['websocket', 'polling'],
    withCredentials: true,
    auth: () => ({ token: opts.getToken() ?? '' }),
  });

  sock.on('connect', () => opts.onConnect?.());
  sock.on('disconnect', (reason) => opts.onDisconnect?.(reason));
  sock.on('realtime.event', (event: RealtimeEvent) => opts.onEvent?.(event));

  sock.connect();
  activeSocket = sock;
  return sock;
}

export function closeRealtimeSocket(): void {
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
  return new Promise((resolve) => {
    sock.emit('subscribe:conversation', { conversationId }, (ack: SubscribeConversationAck) =>
      resolve(ack ?? { ok: false, code: 'NO_ACK' }),
    );
  });
}
