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
import { SecurityEventsBus } from '../../shared/security-events/security-events.bus';
import { TokenService, AccessTokenClaims } from '../iam/authentication/services/token.service';
import { SessionValidationService } from '../iam/authentication/services/session-validation.service';
import { ACCESS_COOKIE } from '../iam/authentication/helpers/cookies';
import { ConversationParticipantGate } from './conversation-participant.gate';
import {
  RealtimeIdentityResolver,
  hasAdminAccess,
  providerMayJoinMarketplaceRooms,
} from './realtime-identity.resolver';

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
  sessionId: string;
  /** CURRENT roles, resolved from the database at handshake — not the JWT claim. */
  roles: string[];
  providerProfileId: string | null;
  providerStatus: string | null;
  joinedRooms: string[];
}

// Room name helpers — one definition, used by both the join path and the
// eviction path so a rename can never desynchronise them.
export const userRoom = (userId: string): string => `user:${userId}`;
export const sessionRoom = (sessionId: string): string => `session:${sessionId}`;
export const providerRoom = (providerProfileId: string): string => `provider:${providerProfileId}`;
export const ADMIN_ROOM = 'admin';

// Socket.IO gateway.
//
// ── D-4: what was wrong ──────────────────────────────────────────────────────
// The handshake did a STATELESS `tokens.verifyAccessToken(token)` and nothing
// more. Consequences:
//
//   1. A revoked session (logout, logout-all, password reset, refresh
//      rotation) could still open a NEW socket, because nothing consulted the
//      Session row — the REST surface and the realtime surface disagreed about
//      whether the credential was alive.
//   2. A globally suspended user could still open a new socket, for the same
//      reason.
//   3. `admin` room membership was decided by the JWT `roles` claim, so a
//      revoked admin stayed in the admin broadcast room until their token
//      expired.
//   4. `provider:{id}` was joined whenever a ProviderProfile row EXISTED,
//      regardless of status — DRAFT / PENDING_REVIEW / SUSPENDED / REJECTED
//      providers received marketplace fan-out that REST would have refused
//      them at ProviderActiveGuard.
//   5. Nothing disconnected an ALREADY-CONNECTED socket after any of those
//      mutations. A socket authenticated once and then received events
//      forever; there is no per-message re-auth to catch up later.
//
// ── What it does now ─────────────────────────────────────────────────────────
// The handshake runs the SAME authoritative check REST runs
// (SessionValidationService.assertSessionActive), then resolves CURRENT roles
// and provider status from the database (RealtimeIdentityResolver), and joins
// only server-owned rooms the resolved facts justify.
//
// Already-connected sockets are evicted from SecurityEventsBus subscriptions
// registered in afterInit(). Eviction uses Socket.IO's adapter-aware
// `disconnectSockets` / `socketsLeave`, which the Redis adapter fans out to
// every instance — so a logout served by pod A kills the socket held by pod B.
//
// Mutations stay on REST. The gateway never accepts business writes.
@UseFilters(new GatewayExceptionFilter())
@WebSocketGateway({
  cors: { origin: true, credentials: true },
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
    private readonly sessionValidation: SessionValidationService,
    private readonly identities: RealtimeIdentityResolver,
    private readonly securityEvents: SecurityEventsBus,
  ) {}

  afterInit(server: Server): void {
    this.server = server;
    const flagOn = this.config.get('REALTIME_SOCKET_IO');
    this.log.log(`Socket.IO gateway initialised (REALTIME_SOCKET_IO=${flagOn ? 'on' : 'off'})`);
    this.subscribeToSecurityEvents();
  }

  // ── Post-commit enforcement ────────────────────────────────────────────────
  // Registered once at init. Every handler is adapter-aware, so it reaches
  // sockets on OTHER instances too.
  private subscribeToSecurityEvents(): void {
    this.securityEvents.onSessionRevoked(async ({ sessionId }) => {
      // Single-session logout: kill only that session's sockets. The user's
      // other devices stay connected.
      await this.disconnectRoom(sessionRoom(sessionId), 'session-revoked');
    });

    this.securityEvents.onAllSessionsRevoked(async ({ userId, reason }) => {
      // logout-all / password reset / account suspension: every socket the
      // user holds, on every instance.
      await this.disconnectRoom(userRoom(userId), reason);
    });

    this.securityEvents.onRolesChanged(async ({ userId }) => {
      // Roles are resolved at handshake, so a role change cannot be applied
      // in place. Every role mutation also revokes the user's sessions, so the
      // correct action is to drop the sockets and make them re-handshake with
      // a freshly issued session.
      await this.disconnectRoom(userRoom(userId), 'roles-changed');
    });

    this.securityEvents.onProviderStatusChanged(async ({ userId, providerProfileId, status }) => {
      if (providerMayJoinMarketplaceRooms(status)) return; // promotion to ACTIVE: nothing to revoke

      // Withdraw marketplace access WITHOUT killing the user's session: a
      // suspended provider who is also a customer keeps their Customer
      // access, which is a separate axis. Evicting the room (rather than
      // disconnecting) is what makes that distinction real.
      await this.leaveRoom(providerRoom(providerProfileId), 'provider-status-changed');
      this.log.log({
        msg: 'socket.provider-room.evicted',
        providerProfileId,
        status,
        userId: userId ?? undefined,
      });
    });
  }

  private async disconnectRoom(room: string, reason: string): Promise<void> {
    if (!this.server) return;
    try {
      // `true` closes the underlying connection rather than just the
      // namespace, so the client cannot keep the socket alive.
      await this.server.in(room).disconnectSockets(true);
      this.log.log({ msg: 'socket.room.disconnected', room, reason });
    } catch (err) {
      // Never rethrow: the database mutation that triggered this already
      // committed and REST is already enforcing it.
      this.log.warn({
        msg: 'socket.room.disconnect.failed',
        room,
        reason,
        err: (err as Error).message,
      });
    }
  }

  private async leaveRoom(room: string, reason: string): Promise<void> {
    if (!this.server) return;
    try {
      await this.server.in(room).socketsLeave(room);
    } catch (err) {
      this.log.warn({
        msg: 'socket.room.leave.failed',
        room,
        reason,
        err: (err as Error).message,
      });
    }
  }

  // ── Handshake ──────────────────────────────────────────────────────────────
  async handleConnection(client: Socket): Promise<void> {
    // Feature flag — when off, every connection is closed at the handshake so
    // an operator can disable the realtime channel without redeploying.
    if (!this.config.get('REALTIME_SOCKET_IO')) {
      client.emit('error', { code: 'REALTIME_DISABLED' });
      client.disconnect(true);
      return;
    }

    let claims: AccessTokenClaims;
    try {
      const token = extractAccessToken(client);
      if (!token) throw new Error('missing token');
      // Stateless half: signature, issuer, audience, and expiry. TokenService
      // pins iss/aud; `verify` enforces exp.
      claims = this.tokens.verifyAccessToken(token);
      if (!claims?.sub || !claims?.sid || !claims?.jti) throw new Error('incomplete claims');
    } catch {
      // Stable code on the wire; no internal detail leaks. The rejection path
      // never logs the token, cookie value, or claims.
      this.rejectHandshake(client);
      return;
    }

    // Stateful half — the SAME authority REST uses. A revoked/expired/rotated
    // session, or a suspended/deleted/deactivated owner, is refused here
    // exactly as it would be on a REST call. Fails closed on infrastructure
    // errors.
    try {
      await this.sessionValidation.assertSessionActive({
        userId: claims.sub,
        sessionId: claims.sid,
        jti: claims.jti,
      });
    } catch {
      this.rejectHandshake(client);
      return;
    }

    // CURRENT authorization facts, from the database — never the JWT claim.
    let identity;
    try {
      identity = await this.identities.resolve(claims.sub);
    } catch (err) {
      // Fail closed: without current roles we cannot decide room membership,
      // and guessing would mean either over- or under-granting.
      this.log.warn({
        msg: 'socket.identity.resolve.failed',
        err: (err as Error).message,
      });
      this.rejectHandshake(client);
      return;
    }

    const data: SocketData = {
      userId: claims.sub,
      sessionId: claims.sid,
      roles: identity.roles,
      providerProfileId: identity.providerProfileId,
      providerStatus: identity.providerStatus,
      joinedRooms: [],
    };
    (client.data as SocketData) = data;

    // ── Server-owned room joins ──────────────────────────────────────────────
    // The wire never carries a `join` command for these.
    const join = async (room: string): Promise<void> => {
      await client.join(room);
      data.joinedRooms.push(room);
    };

    // Personal room — every authenticated socket.
    await join(userRoom(claims.sub));
    // Session room — the eviction target for a single-session logout.
    await join(sessionRoom(claims.sid));

    // Provider marketplace room — ONLY for a currently ACTIVE profile. A
    // DRAFT / PENDING_REVIEW / SUSPENDED / REJECTED provider connects fine
    // (they may still use Customer features and view their own status) but
    // receives no marketplace fan-out.
    if (identity.providerProfileId && providerMayJoinMarketplaceRooms(identity.providerStatus)) {
      await join(providerRoom(identity.providerProfileId));
    }

    // Admin room — ONLY for a user who currently holds the admin role.
    if (hasAdminAccess(identity.roles)) {
      await join(ADMIN_ROOM);
    }

    const ack: RealtimeConnectionAck = {
      userId: claims.sub,
      joinedRooms: data.joinedRooms,
    };
    client.emit('connection.ack', ack);
    this.log.log({ msg: 'socket.connected', userId: claims.sub, rooms: data.joinedRooms });
  }

  private rejectHandshake(client: Socket): void {
    client.emit('error', { code: 'AUTH_INVALID_CREDENTIALS' });
    client.disconnect(true);
  }

  handleDisconnect(client: Socket): void {
    const data = client.data as Partial<SocketData> | undefined;
    if (data?.userId) {
      this.log.log({ msg: 'socket.disconnected', userId: data.userId });
    }
  }

  // ── Client-initiated subscription ──────────────────────────────────────────
  @SubscribeMessage('subscribe:conversation')
  async handleSubscribeConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeToConversationPayload,
  ): Promise<{ ok: true; room: string } | { ok: false; code: string }> {
    const data = client.data as SocketData | undefined;
    if (!data?.userId || !data?.sessionId) {
      throw new WsException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }

    // D-4 — revalidate the session on this security-sensitive event. The
    // handshake proved the session was live when the socket opened; this
    // proves it is STILL live now. Belt and braces with the revocation-driven
    // disconnect above: if an eviction was ever missed (a Redis hiccup during
    // fan-out), the socket still cannot subscribe to anything new.
    try {
      await this.sessionValidation.assertSessionActive({
        userId: data.userId,
        sessionId: data.sessionId,
        // The handshake pinned this socket to one session; the jti it
        // presented is the session's current one unless a rotation has since
        // happened, in which case this socket must re-handshake.
        jti: await this.currentJtiFor(data),
      });
    } catch {
      client.disconnect(true);
      return { ok: false, code: 'AUTH_INVALID_CREDENTIALS' };
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

  // The socket does not retain the raw token, so the jti for the revalidation
  // above is read back from the session row. A revoked/missing session yields
  // a value that cannot match, and assertSessionActive rejects it.
  private async currentJtiFor(data: SocketData): Promise<string> {
    const jti = await this.participantGate.currentJtiForSession(data.sessionId);
    return jti ?? '';
  }

  // Used by the publisher to broadcast a wire envelope into a room. The
  // publisher is the only legitimate caller — gateway methods never publish to
  // a foreign room from a client emit.
  emitToRoom(room: string, event: RealtimeEvent): void {
    if (!this.server) return;
    this.server.to(room).emit('realtime.event', event);
  }
}

// Extract the access JWT from the handshake. Order matters: the explicit
// transports (auth.token / Authorization) win over the cookie so a non-web
// client with a real Bearer token isn't accidentally re-authenticated via a
// stale browser cookie. The cookie path is the ONLY way web clients
// authenticate — the access token lives in the httpOnly `hsm_at` cookie that
// JS can't read, so the gateway must parse it from the handshake cookie header.
function extractAccessToken(client: Socket): string | null {
  const auth = client.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token.trim().length > 0) {
    return auth.token.trim();
  }
  const header = client.handshake.headers['authorization'];
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length).trim() || null;
  }
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
