import { ArgumentsHost, Catch, Logger, OnModuleDestroy, UseFilters } from '@nestjs/common';
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
import type { ConversationReceipt } from './conversation-participant.gate';
import {
  RealtimeIdentityResolver,
  hasAdminAccess,
  providerMayJoinMarketplaceRooms,
} from './realtime-identity.resolver';
import {
  MAX_REALTIME_CONNECTIONS_PER_INSTANCE,
  MAX_REALTIME_PAYLOAD_BYTES,
  realtimeOriginAllowed,
  realtimeTransport,
} from './realtime-socket.adapter';

export const MAX_CONVERSATION_ROOMS = 32;
export const MAX_PENDING_REALTIME_DELIVERIES = 512;
export const MAX_PENDING_DELIVERIES_PER_SOCKET = 16;
const MAX_PENDING_DELIVERY_BYTES = 16 * 1024 * 1024;
const DELIVERY_CONCURRENCY = 8;
const SESSION_RECHECK_INTERVAL_MS = 10_000;
const LOCAL_LEASE_VALIDITY_MS = 30_000;
const INTERNAL_DELIVERY_EVENT = 'hsm.realtime.delivery.v1';

@Catch()
class GatewayExceptionFilter extends BaseWsExceptionFilter {
  private readonly log = new Logger('RealtimeGateway.exception');
  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();
    const code =
      exception instanceof WsException
        ? ((exception.getError() as { code?: string })?.code ?? 'WS_ERROR')
        : 'WS_ERROR';
    if (!(exception instanceof WsException)) this.log.warn({ msg: 'gateway.exception' });
    client.emit('error', { code });
  }
}

interface SocketData {
  userId: string;
  sessionId: string;
  /** The ORIGINAL signed credential; never substitute the database's new jti. */
  jti: string;
  expiresAt: number;
  leaseValidUntil: number;
  roles: string[];
  permissions: string[];
  providerProfileId: string | null;
  providerStatus: string | null;
  joinedRooms: string[];
  providerConversationRooms?: string[];
  subscriptionBusy: boolean;
  subscriptionWindowAt: number;
  subscriptionCount: number;
}

interface Delivery {
  client: Socket;
  room: string;
  event: RealtimeEvent;
  bytes: number;
}

export const userRoom = (userId: string): string => `user:${userId}`;
export const sessionRoom = (sessionId: string): string => `session:${sessionId}`;
export const providerRoom = (providerProfileId: string): string => `provider:${providerProfileId}`;
export const ADMIN_ROOM = 'admin';
export const providerConversationsRoom = (providerProfileId: string): string =>
  `provider-conversations:${providerProfileId}`;

/** REST remains the business authority. Server-side Redis delivery is an
 * internal signal: EACH receiving replica authorizes its local recipients
 * before writing a packet. Ordinary room broadcasts would bypass async auth
 * on the receiving replica after a missed revocation notification. */
@UseFilters(new GatewayExceptionFilter())
@WebSocketGateway({ transports: ['websocket', 'polling'] })
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly log = new Logger(RealtimeGateway.name);
  private readonly clients = new Map<string, Socket>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingBySocket = new Map<string, number>();
  private readonly busySockets = new Set<string>();
  private readonly deliveries: Delivery[] = [];
  private pendingBytes = 0;
  private activeDeliveries = 0;
  private pendingHandshakes = 0;
  private recheckTimer?: NodeJS.Timeout;
  private recheckRunning = false;

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
    server.on(INTERNAL_DELIVERY_EVENT, (room: unknown, event: unknown) => {
      this.enqueueLocal(room, event);
    });
    this.subscribeToSecurityEvents();
    this.recheckTimer = setInterval(
      () => void this.recheckConnections(),
      SESSION_RECHECK_INTERVAL_MS,
    );
    this.recheckTimer.unref();
    this.log.log('Socket.IO initialized; connection state always recovers through authorized REST');
  }

  onModuleDestroy(): void {
    if (this.recheckTimer) clearInterval(this.recheckTimer);
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear();
    for (const client of this.clients.values()) client.disconnect(true);
    this.clients.clear();
    this.deliveries.length = 0;
    this.pendingBytes = 0;
    this.pendingBySocket.clear();
  }

  private subscribeToSecurityEvents(): void {
    this.securityEvents.onSessionRevoked(async ({ sessionId }) => {
      await this.disconnectRoom(sessionRoom(sessionId));
    });
    this.securityEvents.onAllSessionsRevoked(async ({ userId }) => {
      await this.disconnectRoom(userRoom(userId));
    });
    this.securityEvents.onRolesChanged(async ({ userId }) => {
      await this.disconnectRoom(userRoom(userId));
    });
    this.securityEvents.onProviderStatusChanged(async ({ providerProfileId, status }) => {
      if (providerMayJoinMarketplaceRooms(status)) return;
      await this.leaveRoom(providerRoom(providerProfileId));
      await this.leaveProviderConversations(providerProfileId);
    });
  }

  private async disconnectRoom(room: string): Promise<void> {
    if (!this.server) return;
    try {
      await this.server.in(room).disconnectSockets(true);
    } catch {
      // The mutation already committed. Per-delivery DB auth is the backstop.
      this.log.warn({ msg: 'socket.room.disconnect.failed' });
    }
  }

  private async leaveProviderConversations(providerProfileId: string): Promise<void> {
    if (!this.server) return;
    const marker = providerConversationsRoom(providerProfileId);
    try {
      const sockets = await this.server.in(marker).fetchSockets();
      for (const socket of sockets) {
        const data = socket.data as Partial<SocketData>;
        for (const room of data.providerConversationRooms ?? []) await socket.leave(room);
        await socket.leave(marker);
      }
    } catch {
      this.log.warn({ msg: 'socket.provider-conversations.leave.failed' });
    }
  }

  private async leaveRoom(room: string): Promise<void> {
    if (!this.server) return;
    try {
      await this.server.in(room).socketsLeave(room);
    } catch {
      this.log.warn({ msg: 'socket.room.leave.failed' });
    }
  }

  private transportReady(): boolean {
    return Boolean(
      this.config.get('REALTIME_SOCKET_IO') && realtimeTransport(this.server)?.isReady(),
    );
  }

  async handleConnection(client: Socket): Promise<void> {
    if (!this.config.get('REALTIME_SOCKET_IO')) return this.reject(client, 'REALTIME_DISABLED');
    if (!this.transportReady()) return this.reject(client, 'REALTIME_UNAVAILABLE');
    if (
      !realtimeOriginAllowed(
        this.config,
        client.handshake.headers.origin,
        Boolean(client.handshake.headers.cookie),
      )
    ) {
      return this.reject(client, 'AUTH_INVALID_CREDENTIALS');
    }
    // Increment before the first await so concurrent handshakes cannot evade
    // the per-process budget while their database checks are in flight.
    if (this.clients.size + this.pendingHandshakes >= MAX_REALTIME_CONNECTIONS_PER_INSTANCE) {
      return this.reject(client, 'REALTIME_CONNECTION_LIMIT');
    }
    this.pendingHandshakes += 1;
    try {
      await this.establishConnection(client);
    } catch {
      this.reject(client, 'AUTH_INVALID_CREDENTIALS');
    } finally {
      this.pendingHandshakes -= 1;
    }
  }

  private async establishConnection(client: Socket): Promise<void> {
    const token = extractAccessToken(client);
    if (!token || token.length > 8_192) throw new Error('Invalid credential');
    const claims: AccessTokenClaims = this.tokens.verifyAccessToken(token);
    if (
      !claims?.sub ||
      !claims.sid ||
      !claims.jti ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp * 1000 <= Date.now()
    ) {
      throw new Error('Invalid credential');
    }
    await this.sessionValidation.assertSessionActive({
      userId: claims.sub,
      sessionId: claims.sid,
      jti: claims.jti,
    });
    const identity = await this.identities.resolve(claims.sub);
    const transport = realtimeTransport(this.server);
    if (!transport?.isReady()) return this.reject(client, 'REALTIME_UNAVAILABLE');
    if (!(await transport.reserve(claims.sub, client.id))) {
      return this.reject(
        client,
        transport.isReady() ? 'REALTIME_CONNECTION_LIMIT' : 'REALTIME_UNAVAILABLE',
      );
    }

    const data: SocketData = {
      userId: claims.sub,
      sessionId: claims.sid,
      jti: claims.jti,
      expiresAt: claims.exp * 1000,
      leaseValidUntil: Date.now() + LOCAL_LEASE_VALIDITY_MS,
      roles: identity.roles,
      permissions: identity.permissions,
      providerProfileId: identity.providerProfileId,
      providerStatus: identity.providerStatus,
      joinedRooms: [],
      subscriptionBusy: false,
      subscriptionWindowAt: Date.now(),
      subscriptionCount: 0,
    };
    client.data = data;
    try {
      // Close the rotation/logout race while the role/grant and reservation
      // lookups were pending. Every later packet independently checks again.
      await this.assertSocketSession(client);
      if (!client.connected || !this.transportReady()) throw new Error('Connection unavailable');
      const join = async (room: string): Promise<void> => {
        await client.join(room);
        data.joinedRooms.push(room);
      };
      await join(userRoom(data.userId));
      await join(sessionRoom(data.sessionId));
      if (identity.providerProfileId && identity.mayViewMarketplace) {
        await join(providerRoom(identity.providerProfileId));
      }
      if (hasAdminAccess(identity.roles, identity.permissions)) await join(ADMIN_ROOM);
      this.clients.set(client.id, client);
      const timer = setTimeout(
        () => this.reject(client, 'AUTH_INVALID_CREDENTIALS'),
        Math.min(data.expiresAt - Date.now(), 2_147_483_647),
      );
      timer.unref();
      this.expiryTimers.set(client.id, timer);
      const ack: RealtimeConnectionAck & {
        recovery: { mode: 'rest'; required: true; maxWindow: number };
      } = {
        userId: data.userId,
        joinedRooms: data.joinedRooms,
        recovery: { mode: 'rest', required: true, maxWindow: 200 },
      };
      client.emit('connection.ack', ack);
    } catch {
      await transport.release(data.userId, client.id);
      this.reject(client, 'AUTH_INVALID_CREDENTIALS');
    }
  }

  private reject(client: Socket, code: string): void {
    client.emit('error', { code });
    client.disconnect(true);
    this.handleDisconnect(client);
  }

  handleDisconnect(client: Socket): void {
    this.clients.delete(client.id);
    const timer = this.expiryTimers.get(client.id);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(client.id);
    const data = client.data as Partial<SocketData> | undefined;
    if (data?.userId) {
      void realtimeTransport(this.server)
        ?.release(data.userId, client.id)
        .catch(() => undefined);
    }
  }

  private async assertSocketSession(client: Socket): Promise<void> {
    const data = client.data as Partial<SocketData> | undefined;
    if (
      !data?.userId ||
      !data.sessionId ||
      !data.jti ||
      !data.expiresAt ||
      data.expiresAt <= Date.now() ||
      !data.leaseValidUntil ||
      data.leaseValidUntil <= Date.now()
    ) {
      throw new Error('Invalid credential');
    }
    await this.sessionValidation.assertSessionActive({
      userId: data.userId,
      sessionId: data.sessionId,
      jti: data.jti,
    });
    // A database wait can cross a deadline before the event-loop timer runs.
    // Recheck the signed deadline immediately after that asynchronous gate.
    if (data.expiresAt <= Date.now() || data.leaseValidUntil <= Date.now()) {
      throw new Error('Invalid credential');
    }
  }

  @SubscribeMessage('subscribe:conversation')
  async handleSubscribeConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: SubscribeToConversationPayload,
  ): Promise<{ ok: true; room: string } | { ok: false; code: string }> {
    const data = client.data as SocketData | undefined;
    if (!data?.userId || !data.sessionId || !data.jti) {
      throw new WsException({ code: 'AUTH_INVALID_CREDENTIALS' });
    }
    if (!this.transportReady()) return { ok: false, code: 'REALTIME_UNAVAILABLE' };
    const conversationId = body?.conversationId;
    if (typeof conversationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(conversationId)) {
      return { ok: false, code: 'VALIDATION_ERROR' };
    }
    if (Date.now() - data.subscriptionWindowAt >= 60_000) {
      data.subscriptionWindowAt = Date.now();
      data.subscriptionCount = 0;
    }
    if (data.subscriptionBusy || data.subscriptionCount >= 60) {
      return { ok: false, code: 'REALTIME_RATE_LIMIT' };
    }
    const room = `conversation:${conversationId}`;
    if (
      !client.rooms.has(room) &&
      data.joinedRooms.filter((name) => name.startsWith('conversation:')).length >=
        MAX_CONVERSATION_ROOMS
    ) {
      return { ok: false, code: 'REALTIME_ROOM_LIMIT' };
    }
    data.subscriptionCount += 1;
    data.subscriptionBusy = true;
    try {
      await this.assertSocketSession(client);
      const receipt = await this.conversationReceipt(data.userId, conversationId);
      if (!receipt.allowed) return { ok: false, code: 'FORBIDDEN' };
      await this.assertSocketSession(client);
      if (!client.connected || !this.transportReady())
        return { ok: false, code: 'REALTIME_UNAVAILABLE' };
      await client.join(room);
      if (!data.joinedRooms.includes(room)) data.joinedRooms.push(room);
      if (receipt.side === 'PROVIDER' && receipt.providerProfileId) {
        const rooms = (data.providerConversationRooms ??= []);
        if (!rooms.includes(room)) rooms.push(room);
        await client.join(providerConversationsRoom(receipt.providerProfileId));
      }
      return { ok: true, room };
    } catch {
      this.reject(client, 'AUTH_INVALID_CREDENTIALS');
      return { ok: false, code: 'AUTH_INVALID_CREDENTIALS' };
    } finally {
      data.subscriptionBusy = false;
    }
  }

  /** Also used by the bounded SSE stream. Identity comes from its authenticated
   * request, never an event recipient or a client-supplied room. */
  async mayReceiveEvent(userId: string, room: string, event: RealtimeEvent): Promise<boolean> {
    if (event.userId !== null && event.userId !== userId) return false;
    if (room.startsWith('conversation:')) {
      return (await this.conversationReceipt(userId, room.slice(13))).allowed;
    }
    if (room === ADMIN_ROOM) {
      const identity = await this.identities.resolve(userId);
      return (
        event.type === 'provider.status_changed' &&
        hasAdminAccess(identity.roles, identity.permissions)
      );
    }
    if (room.startsWith('provider:')) {
      const identity = await this.identities.resolve(userId);
      return identity.providerProfileId === room.slice(9) && identity.mayViewMarketplace;
    }
    if (room !== userRoom(userId) || event.userId !== userId) return false;
    if (event.type === 'request.available')
      return (await this.identities.resolve(userId)).mayViewMarketplace;
    if (event.type === 'message.created') {
      const id = (event.payload as { conversationId?: unknown } | null)?.conversationId;
      return typeof id === 'string' && (await this.conversationReceipt(userId, id)).allowed;
    }
    // Notifications remain the owner's durable feed, including decisions that
    // explain lost provider access; this mirrors NotificationsController.
    return true;
  }

  private async conversationReceipt(
    userId: string,
    conversationId: string,
  ): Promise<ConversationReceipt> {
    const receipt = await this.participantGate.mayReceiveConversation(userId, conversationId);
    if (receipt.allowed && receipt.side === 'PROVIDER') {
      // Provider REST also requires the provider role. A current capability
      // cannot replace that role after it has been removed from the account.
      const identity = await this.identities.resolve(userId);
      if (!identity.roles.includes('provider')) return { allowed: false };
    }
    return receipt;
  }

  emitToRoom(room: string, event: RealtimeEvent): void {
    if (!this.transportReady() || !validEnvelope(room, event)) return;
    this.enqueueLocal(room, event);
    // serverSideEmit has no business acknowledgement: committed REST history
    // handles loss, duplicate delivery, process death and recovery.
    this.server.serverSideEmit(INTERNAL_DELIVERY_EVENT, room, event);
  }

  private enqueueLocal(room: unknown, event: unknown): void {
    if (!this.transportReady() || !validEnvelope(room, event)) return;
    const bytes = Buffer.byteLength(JSON.stringify(event));
    for (const client of this.clients.values()) {
      if (!client.connected || !client.rooms.has(room)) continue;
      const pending = this.pendingBySocket.get(client.id) ?? 0;
      if (
        pending >= MAX_PENDING_DELIVERIES_PER_SOCKET ||
        this.deliveries.length + this.activeDeliveries >= MAX_PENDING_REALTIME_DELIVERIES ||
        this.pendingBytes + bytes > MAX_PENDING_DELIVERY_BYTES
      ) {
        this.reject(client, 'REALTIME_BACKPRESSURE');
        continue;
      }
      this.pendingBySocket.set(client.id, pending + 1);
      this.pendingBytes += bytes;
      this.deliveries.push({ client, room, event: event as RealtimeEvent, bytes });
    }
    this.drainDeliveries();
  }

  private drainDeliveries(): void {
    while (this.activeDeliveries < DELIVERY_CONCURRENCY) {
      const index = this.deliveries.findIndex(
        (delivery) => !this.busySockets.has(delivery.client.id),
      );
      if (index < 0) break;
      const delivery = this.deliveries.splice(index, 1)[0]!;
      this.busySockets.add(delivery.client.id);
      this.activeDeliveries += 1;
      void this.deliverAuthorized(delivery).finally(() => {
        this.activeDeliveries -= 1;
        this.busySockets.delete(delivery.client.id);
        this.pendingBytes = Math.max(0, this.pendingBytes - delivery.bytes);
        const remaining = (this.pendingBySocket.get(delivery.client.id) ?? 1) - 1;
        if (remaining <= 0) this.pendingBySocket.delete(delivery.client.id);
        else this.pendingBySocket.set(delivery.client.id, remaining);
        this.drainDeliveries();
      });
    }
  }

  private async deliverAuthorized({ client, room, event }: Delivery): Promise<void> {
    try {
      if (!client.connected || !this.transportReady() || !client.rooms.has(room)) return;
      const data = client.data as SocketData;
      if (!(await this.mayReceiveEvent(data.userId, room, event))) {
        if (room !== userRoom(data.userId)) await client.leave(room);
        return;
      }
      // Last asynchronous gate before the packet: current DB session against
      // the original signed token, including access-token expiration.
      await this.assertSocketSession(client);
      if (!client.connected || !this.transportReady() || !client.rooms.has(room)) return;
      // Volatile events do not pile up in an unwritable Engine.IO transport;
      // the bounded REST recovery cadence covers missed accelerations.
      client.volatile.emit('realtime.event', event);
    } catch {
      this.reject(client, 'AUTH_INVALID_CREDENTIALS');
    }
  }

  private async recheckConnections(): Promise<void> {
    if (this.recheckRunning) return;
    this.recheckRunning = true;
    try {
      const clients = [...this.clients.values()];
      for (let offset = 0; offset < clients.length; offset += DELIVERY_CONCURRENCY) {
        await Promise.all(
          clients.slice(offset, offset + DELIVERY_CONCURRENCY).map(async (client) => {
            try {
              const data = client.data as SocketData;
              if (!this.transportReady()) return this.reject(client, 'REALTIME_UNAVAILABLE');
              await this.assertSocketSession(client);
              if (!(await realtimeTransport(this.server)!.reserve(data.userId, client.id))) {
                return this.reject(client, 'REALTIME_CONNECTION_LIMIT');
              }
              data.leaseValidUntil = Date.now() + LOCAL_LEASE_VALIDITY_MS;
              const identity = await this.identities.resolve(data.userId);
              if (!hasAdminAccess(identity.roles, identity.permissions))
                await client.leave(ADMIN_ROOM);
              if (data.providerProfileId && !identity.mayViewMarketplace) {
                await client.leave(providerRoom(data.providerProfileId));
              }
              // Membership/capability is additionally checked on every packet.
            } catch {
              this.reject(client, 'AUTH_INVALID_CREDENTIALS');
            }
          }),
        );
      }
    } finally {
      this.recheckRunning = false;
    }
  }
}

function validEnvelope(room: unknown, event: unknown): room is string {
  if (typeof room !== 'string' || room.length > 256 || !event || typeof event !== 'object')
    return false;
  const envelope = event as Partial<RealtimeEvent>;
  if (envelope.v !== 1 || typeof envelope.type !== 'string') return false;
  try {
    return Buffer.byteLength(JSON.stringify(event)) <= MAX_REALTIME_PAYLOAD_BYTES;
  } catch {
    return false;
  }
}

// Existing socket transport precedence is retained: explicit native tokens,
// then bearer, then the browser's httpOnly access cookie. Origin is separately
// validated even if an explicit token accompanies a cookie.
function extractAccessToken(client: Socket): string | null {
  const auth = client.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token.trim().length > 0) return auth.token.trim();
  const header = client.handshake.headers.authorization;
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
    if (eq < 0 || trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}
