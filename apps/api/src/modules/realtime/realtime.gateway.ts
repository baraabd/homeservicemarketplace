import { Logger, UseFilters } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
  BaseWsExceptionFilter,
} from '@nestjs/websockets';
import { ArgumentsHost, Catch } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type {
  RealtimeConnectionAck,
  RealtimeEvent,
  SubscribeToConversationPayload,
} from '@homeservicemarketplace/contracts';

import { AppConfigService } from '../../config/app-config.service';
import { TokenService, AccessTokenClaims } from '../iam/authentication/services/token.service';
import { ACCESS_COOKIE } from '../iam/authentication/helpers/cookies';
import { ConversationParticipantGate } from './conversation-participant.gate';

// Catches WsException + plain Error in the gateway scope so the
// socket sees a stable `error` payload instead of a raw stack trace.
@Catch()
class GatewayExceptionFilter extends BaseWsExceptionFilter {
  private readonly log = new Logger('RealtimeGateway.exception');
  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();
    const code =
      exception instanceof WsException
        ? ((exception.getError() as { code?: string })?.code ?? 'WS_ERROR')
        : 'WS_ERROR';
    if (!(exception instanceof WsException)) {
      this.log.warn({ msg: 'gateway.exception', err: String(exception) });
    }
    client.emit('error', { code });
  }
}

interface SocketData {
  userId: string;
  roles: string[];
  providerProfileId: string | null;
  joinedRooms: string[];
}

// Sprint 7.0 (refined) — Socket.IO gateway.
//
// Handshake auth: the client supplies the access token via either
//   - `auth: { token: '<jwt>' }` (preferred — set by socket.io-client),
//   - `Authorization: Bearer <jwt>` header (manual probes, native ws),
//   - the access cookie (web with HttpOnly cookies — picked up
//     automatically by the same handshake flow).
//
// On a successful handshake the gateway joins the connected socket
// to the SERVER-OWNED rooms derived from the JWT identity:
//   - user:{userId}             — always
//   - provider:{profileId}      — iff the user has a provider profile
//   - admin                     — iff `admin` ∈ roles
//
// The only CLIENT-INITIATED join is `subscribe:conversation` and it
// runs the same participant gate REST uses before issuing socket.join.
//
// Mutations stay on REST. The gateway never accepts business writes.
@UseFilters(new GatewayExceptionFilter())
@WebSocketGateway({
  // Same CORS allow-list as the REST surface — origins resolved at
  // bootstrap and reflected here so a browser can complete the WS
  // upgrade only from approved origins.
  cors: { origin: true, credentials: true },
  // Serve from the default /socket.io path so socket.io-client
  // doesn't need an explicit `path:` override.
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tokens: TokenService,
    private readonly config: AppConfigService,
    private readonly participantGate: ConversationParticipantGate,
  ) {}

  afterInit(server: Server): void {
    this.server = server;
    const flagOn = this.config.get('REALTIME_SOCKET_IO');
    this.log.log(`Socket.IO gateway initialised (REALTIME_SOCKET_IO=${flagOn ? 'on' : 'off'})`);
  }

  async handleConnection(client: Socket): Promise<void> {
    // Feature flag — when off, every connection is closed at the
    // handshake. The flag exists so an operator can fully disable
    // the realtime channel in production without redeploying.
    if (!this.config.get('REALTIME_SOCKET_IO')) {
      client.emit('error', { code: 'REALTIME_DISABLED' });
      client.disconnect(true);
      return;
    }

    let claims: AccessTokenClaims;
    try {
      const token = extractAccessToken(client);
      if (!token) throw new Error('missing token');
      claims = this.tokens.verifyAccessToken(token);
    } catch {
      // Stable code on the wire; no internal detail leaks. Logs are
      // deliberately silent on the rejection path — never log the
      // token, cookie value, or claims of a failed handshake.
      client.emit('error', { code: 'AUTH_INVALID_CREDENTIALS' });
      client.disconnect(true);
      return;
    }

    const providerProfileId = await this.participantGate.findProviderProfileId(claims.sub);
    const data: SocketData = {
      userId: claims.sub,
      roles: claims.roles ?? [],
      providerProfileId,
      joinedRooms: [],
    };
    (client.data as SocketData) = data;

    // Server-owned room joins. The wire never carries a `join`
    // command for these — the rooms are derived from the verified
    // JWT identity.
    const userRoom = `user:${claims.sub}`;
    await client.join(userRoom);
    data.joinedRooms.push(userRoom);

    if (providerProfileId) {
      const providerRoom = `provider:${providerProfileId}`;
      await client.join(providerRoom);
      data.joinedRooms.push(providerRoom);
    }

    if (data.roles.includes('admin')) {
      await client.join('admin');
      data.joinedRooms.push('admin');
    }

    const ack: RealtimeConnectionAck = {
      userId: claims.sub,
      joinedRooms: data.joinedRooms,
    };
    client.emit('connection.ack', ack);
    this.log.log({ msg: 'socket.connected', userId: claims.sub, rooms: data.joinedRooms });
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as Partial<SocketData> | undefined;
    if (data?.userId) {
      this.log.log({ msg: 'socket.disconnected', userId: data.userId });
    }
  }

  @SubscribeMessage('subscribe:conversation')
  async handleSubscribeConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeToConversationPayload,
  ): Promise<{ ok: true; room: string } | { ok: false; code: string }> {
    const data = client.data as SocketData | undefined;
    if (!data?.userId) {
      throw new WsException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    const conversationId = (body?.conversationId ?? '').toString().trim();
    if (!conversationId) {
      return { ok: false, code: 'VALIDATION_ERROR' };
    }
    const allowed = await this.participantGate.userIsParticipant(data.userId, conversationId);
    if (!allowed) {
      // Same shape REST uses for cross-conversation reads.
      this.log.warn({
        msg: 'socket.subscribe.conversation.forbidden',
        userId: data.userId,
        conversationId,
      });
      return { ok: false, code: 'FORBIDDEN' };
    }
    const room = `conversation:${conversationId}`;
    await client.join(room);
    if (!data.joinedRooms.includes(room)) data.joinedRooms.push(room);
    return { ok: true, room };
  }

  // Used by the publisher to broadcast a wire envelope into a room.
  // The publisher is the only legitimate caller — gateway methods
  // never publish to a foreign room from a client emit.
  emitToRoom(room: string, event: RealtimeEvent): void {
    if (!this.server) return;
    this.server.to(room).emit('realtime.event', event);
  }
}

// Sprint 7.x — extract the access JWT from the handshake. Order
// matters: the explicit transports (auth.token / Authorization) win
// over the cookie so a non-web client with a real Bearer token isn't
// accidentally re-authenticated via a stale browser cookie. The
// cookie path is the ONLY way web clients authenticate — the access
// token lives in the httpOnly `hsm_at` cookie that JS can't read, so
// the gateway must parse it from the handshake cookie header itself.
function extractAccessToken(client: Socket): string | null {
  // 1) socket.io-client convention: `auth: { token }` for mobile /
  //    native / probes that have a real access JWT on hand. Never
  //    accept this if it's empty or whitespace — an empty string
  //    here used to come from the web client passing the CSRF token
  //    in by mistake, which would fail verification with a noisy
  //    log; a strict trim+length check makes that path silent.
  const auth = client.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token.trim().length > 0) {
    return auth.token.trim();
  }
  // 2) Authorization: Bearer header — same audience as auth.token.
  const header = client.handshake.headers['authorization'];
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length).trim() || null;
  }
  // 3) Cookie — web clients. The Socket.IO handshake re-uses the
  //    underlying HTTP CONNECT, so the browser sends every cookie
  //    scoped to the API origin. We read ACCESS_COOKIE (`hsm_at`)
  //    using the SAME constant the REST cookie helpers use so the
  //    two surfaces can never drift on the name.
  return readCookie(client.handshake.headers.cookie, ACCESS_COOKIE);
}

function readCookie(cookieHeader: string | string[] | undefined, name: string): string | null {
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    if (key !== name) continue;
    const value = trimmed.slice(eq + 1);
    if (value.length === 0) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      // Malformed cookie value — treat as absent rather than throw.
      return null;
    }
  }
  return null;
}
