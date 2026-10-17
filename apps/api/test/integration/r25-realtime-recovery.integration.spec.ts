/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Prisma is loaded only behind the existing DB+Redis gates. Every repository,
 * JWT/session/role/capability guard, Socket.IO adapter and REST controller below
 * is the production class. This is two real Nest API instances, not two OS
 * processes; the R25 process/browser harness supplies that separate evidence.
 */
import { randomUUID } from 'node:crypto';
import { get as httpGet, type ClientRequest, type IncomingMessage } from 'node:http';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import type Redis from 'ioredis';

import { AppConfigService } from '../../src/config/app-config.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../src/infrastructure/prisma/transaction.runner';
import { AllExceptionsFilter } from '../../src/infrastructure/http/all-exceptions.filter';
import { OutboxRepository } from '../../src/infrastructure/outbox/outbox.repository';
import { UserRepository } from '../../src/infrastructure/persistence/iam/user.repository';
import { RoleRepository } from '../../src/infrastructure/persistence/iam/role.repository';
import { SessionRepository } from '../../src/infrastructure/persistence/iam/session.repository';
import { ProviderProfileRepository } from '../../src/infrastructure/persistence/bids/provider-profile.repository';
import { BookingRepository } from '../../src/infrastructure/persistence/bookings/booking.repository';
import { ConversationRepository } from '../../src/infrastructure/persistence/conversations/conversation.repository';
import { ConversationParticipantRepository } from '../../src/infrastructure/persistence/conversations/conversation-participant.repository';
import { MessageRepository } from '../../src/infrastructure/persistence/conversations/message.repository';
import { NotificationRepository } from '../../src/infrastructure/persistence/notifications/notification.repository';
import { SecurityEventsBus } from '../../src/shared/security-events/security-events.bus';
import { TokenService } from '../../src/modules/iam/authentication/services/token.service';
import { SessionValidationService } from '../../src/modules/iam/authentication/services/session-validation.service';
import { JwtStrategy } from '../../src/modules/iam/authentication/strategies/jwt.strategy';
import { JwtAuthGuard } from '../../src/modules/iam/authentication/guards/jwt-auth.guard';
import { CsrfGuard } from '../../src/modules/iam/authentication/guards/csrf.guard';
import { RolesGuard } from '../../src/modules/iam/authorization/guards/roles.guard';
import { ProviderCapabilityService } from '../../src/modules/provider/capability/provider-capability.service';
import { ProviderCapabilityGuard } from '../../src/modules/provider/guards/provider-capability.guard';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { ConversationsController } from '../../src/modules/conversations/conversations.controller';
import { ProviderConversationsController } from '../../src/modules/conversations/provider-conversations.controller';
import {
  NotificationsService,
  toNotificationSummary,
} from '../../src/modules/notifications/notifications.service';
import { NotificationsController } from '../../src/modules/notifications/notifications.controller';
import { NotificationCreatedHandler } from '../../src/modules/notifications/notification-created.handler';
import { ConversationParticipantGate } from '../../src/modules/realtime/conversation-participant.gate';
import { RealtimeIdentityResolver } from '../../src/modules/realtime/realtime-identity.resolver';
import {
  RealtimeGateway,
  MAX_PENDING_REALTIME_DELIVERIES,
} from '../../src/modules/realtime/realtime.gateway';
import { RealtimeEventsPublisher } from '../../src/modules/realtime/realtime-events.publisher';
import { RealtimeEventsController } from '../../src/modules/realtime/realtime-events.controller';
import {
  RealtimeSocketAdapter,
  realtimeTransport,
  MAX_REALTIME_CONNECTIONS_PER_USER,
} from '../../src/modules/realtime/realtime-socket.adapter';
import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

const enabled = process.env.RUN_DB_INTEGRATION === '1' && process.env.RUN_REDIS_INTEGRATION === '1';
const d = enabled ? describe : describe.skip;
jest.setTimeout(60_000);

interface Replica {
  app: INestApplication;
  adapter: RealtimeSocketAdapter;
  url: string;
  gateway: RealtimeGateway;
  publisher: RealtimeEventsPublisher;
  tokens: TokenService;
}
interface Actor {
  id: string;
  sessionId: string;
  token: string;
  jti: string;
  roles: string[];
}
interface Connection {
  socket: ClientSocket;
  userId: string;
  serverSocketId: string | undefined;
  replica: Replica;
  events: any[];
  result: { ack?: any; error?: string };
}

d('R25 two API replicas, real PostgreSQL/Redis and authorized REST recovery', () => {
  const P = fixturePrefix('r25rt');
  const actors = new Map<string, Actor>();
  const connections: Connection[] = [];
  const startedReplicas = new Set<Replica>();
  const streams = new Set<ClientRequest>();
  let prisma: any;
  let lock: HeldLock | undefined;
  let a: Replica;
  let b: Replica;
  let providerId: string;
  let adminRoleId: string;
  let providerRoleId: string;
  let pausedSubscriber: Redis | undefined;

  const values: Record<string, unknown> = {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    REALTIME_SOCKET_IO: true,
    REALTIME_ALLOW_SINGLE_INSTANCE: false,
    FRONTEND_URL: 'http://r25.test.invalid',
    CORS_ORIGINS: [],
    REDIS_HOST: process.env.REDIS_HOST ?? '127.0.0.1',
    REDIS_PORT: Number(process.env.REDIS_PORT ?? 6379),
    REDIS_DB: Number(process.env.REDIS_DB ?? 0),
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_TLS: process.env.REDIS_TLS === 'true',
    REDIS_CONNECT_TIMEOUT_MS: 2_000,
    JWT_ACCESS_SECRET: makeTestSecret('r25-realtime'),
    JWT_ACCESS_TTL_SECONDS: 600,
    JWT_ISSUER: 'hsm-r25-tests',
    JWT_AUDIENCE: 'hsm-r25-tests',
    WORK_ACCESS_ENFORCED: false,
    VERIFICATION_ENFORCED: true,
  };
  const config = {
    get: (key: string) => values[key],
    isProduction: false,
  } as unknown as AppConfigService;

  async function buildReplica(): Promise<Replica> {
    const module = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt', session: false }),
        JwtModule.register({
          secret: values.JWT_ACCESS_SECRET as string,
          signOptions: {
            algorithm: 'HS256',
            issuer: values.JWT_ISSUER as string,
            audience: values.JWT_AUDIENCE as string,
          },
          verifyOptions: {
            algorithms: ['HS256'],
            issuer: values.JWT_ISSUER as string,
            audience: values.JWT_AUDIENCE as string,
          },
        }),
      ],
      controllers: [
        NotificationsController,
        ConversationsController,
        ProviderConversationsController,
        RealtimeEventsController,
      ],
      providers: [
        Reflector,
        TokenService,
        SessionValidationService,
        JwtStrategy,
        JwtAuthGuard,
        CsrfGuard,
        RolesGuard,
        ProviderCapabilityGuard,
        ProviderCapabilityService,
        SecurityEventsBus,
        UserRepository,
        RoleRepository,
        SessionRepository,
        ProviderProfileRepository,
        BookingRepository,
        ConversationRepository,
        ConversationParticipantRepository,
        MessageRepository,
        NotificationRepository,
        OutboxRepository,
        TransactionRunner,
        ConversationParticipantGate,
        RealtimeIdentityResolver,
        RealtimeGateway,
        RealtimeEventsPublisher,
        ConversationsService,
        NotificationsService,
        NotificationCreatedHandler,
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: AppConfigService, useValue: config },
      ],
    }).compile();
    const app = module.createNestApplication({ logger: false });
    app.use(cookieParser());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter(config));
    const adapter = new RealtimeSocketAdapter(app, config);
    try {
      await adapter.connectToRedis();
      app.useWebSocketAdapter(adapter);
      await app.listen(0, '127.0.0.1');
      const replica = {
        app,
        adapter,
        url: await app.getUrl(),
        gateway: app.get(RealtimeGateway),
        publisher: app.get(RealtimeEventsPublisher),
        tokens: app.get(TokenService),
      };
      startedReplicas.add(replica);
      return replica;
    } catch (error) {
      await Promise.allSettled([app.close(), adapter.close()]);
      throw error;
    }
  }

  async function actor(label: string, roles: string[] = []): Promise<Actor> {
    const id = `${P}${label}`;
    const sessionId = `${id}-session`;
    await prisma.user.create({
      data: {
        id,
        email: `${id}@r25.test.invalid`,
        firstName: 'R25',
        lastName: label,
        status: 'ACTIVE',
        isActive: true,
      },
    });
    const issued = a.tokens.signAccessToken({ userId: id, sessionId, roles });
    await prisma.session.create({
      data: {
        id: sessionId,
        userId: id,
        familyId: `${id}-family`,
        currentJti: issued.jti,
        tokenHash: randomUUID(),
        ipAddress: '127.0.0.1',
        userAgent: 'R25 isolated integration',
        clientKind: 'WEB',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const result = { id, sessionId, token: issued.token, jti: issued.jti, roles };
    actors.set(label, result);
    return result;
  }

  async function cleanup() {
    if (!prisma) return;
    const notifications = await prisma.notification.findMany({
      where: { userId: { startsWith: P } },
      select: { id: true },
    });
    await prisma.outboxEvent.deleteMany({
      where: {
        aggregateType: 'Notification',
        aggregateId: { in: notifications.map((row: any) => row.id) },
      },
    });
    await prisma.conversation.deleteMany({ where: { bookingId: { startsWith: P } } });
    await prisma.booking.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.bid.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  }

  async function eventually(
    predicate: () => boolean | Promise<boolean>,
    message: string,
    budget = 10_000,
  ) {
    const start = Date.now();
    while (Date.now() - start < budget) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(message);
  }

  async function connect(
    replica: Replica,
    user: Actor,
    transport: 'websocket' | 'polling' = 'websocket',
    options: { cookie?: boolean; origin?: string; expectedFailure?: boolean; token?: string } = {},
  ): Promise<Connection> {
    const socket = io(replica.url, {
      autoConnect: false,
      reconnection: false,
      forceNew: true,
      transports: [transport],
      upgrade: false,
      timeout: 5_000,
      auth: options.cookie ? {} : { token: options.token ?? user.token },
      extraHeaders: {
        Origin: options.origin ?? (values.FRONTEND_URL as string),
        ...(options.cookie ? { Cookie: `hsm_at=${options.token ?? user.token}` } : {}),
      },
    });
    const result: Connection = {
      socket,
      userId: user.id,
      serverSocketId: undefined,
      replica,
      events: [],
      result: {},
    };
    connections.push(result);
    socket.on('realtime.event', (event) => result.events.push(event));
    let timer: NodeJS.Timeout | undefined;
    const ready = new Promise<void>((resolve) => {
      const complete = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      socket.once('connection.ack', (ack) => {
        result.result.ack = ack;
        result.serverSocketId = socket.id;
        complete();
      });
      socket.once('error', (error: { code?: string }) => {
        result.result.error = error.code ?? 'ERROR';
        complete();
      });
      socket.once('connect_error', () => {
        result.result.error = 'CONNECT_ERROR';
        complete();
      });
      timer = setTimeout(() => {
        result.result.error = 'TIMEOUT';
        complete();
      }, 6_000);
    });
    socket.connect();
    await ready;
    if (!options.expectedFailure) {
      expect(result.result.error).toBeUndefined();
      expect(result.result.ack).toMatchObject({
        userId: user.id,
        recovery: { mode: 'rest', required: true },
      });
    }
    return result;
  }

  const bearer = (user: Actor) => `Bearer ${user.token}`;
  const messages = (replica: Replica, user: Actor, conversationId: string, provider = false) =>
    request(replica.app.getHttpServer())
      .get(`/v1/${provider ? 'provider' : 'me'}/conversations/${conversationId}/messages`)
      .set('Authorization', bearer(user));

  async function conversation(): Promise<string> {
    const seeker = actors.get('seeker')!;
    const id = `${P}b-${randomUUID()}`;
    await prisma.serviceRequest.create({
      data: {
        id: `${id}-r`,
        seekerUserId: seeker.id,
        scheduleType: 'ASAP',
        addressSnapshot: {},
        status: 'BID_ACCEPTED',
      },
    });
    await prisma.bid.create({
      data: {
        id: `${id}-bid`,
        requestId: `${id}-r`,
        providerId,
        amount: 100,
        pricingType: 'FIXED',
        status: 'ACCEPTED',
      },
    });
    await prisma.booking.create({
      data: {
        id,
        requestId: `${id}-r`,
        bidId: `${id}-bid`,
        seekerUserId: seeker.id,
        providerId,
        priceAmount: 100,
        status: 'SCHEDULED',
      },
    });
    const response = await request(a.app.getHttpServer())
      .post('/v1/me/conversations')
      .set('Authorization', bearer(seeker))
      .send({ bookingId: id });
    expect(response.status).toBe(200);
    return response.body.conversation.id;
  }

  async function subscribe(connection: Connection, conversationId: string) {
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Conversation subscription acknowledgement missing')),
        5_000,
      );
      connection.socket.emit('subscribe:conversation', { conversationId }, (response: unknown) => {
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  function shortToken(user: Actor, lifetimeSeconds = 3): { token: string; expiresAt: number } {
    const expiresAt = Math.floor(Date.now() / 1000) + lifetimeSeconds;
    const token = a.app.get(require('@nestjs/jwt').JwtService).sign({
      sub: user.id,
      sid: user.sessionId,
      roles: user.roles,
      jti: user.jti,
      exp: expiresAt,
    });
    return { token, expiresAt: expiresAt * 1000 };
  }

  async function openSse(replica: Replica, user: Actor, token = user.token, paused = false) {
    const frames: string[] = [];
    const stream = await new Promise<{ request: ClientRequest; response: IncomingMessage }>(
      (resolve, reject) => {
        const outgoing = httpGet(
          `${replica.url}/v1/me/events`,
          {
            headers: { Authorization: `Bearer ${token}`, Origin: values.FRONTEND_URL as string },
          },
          (response) => {
            response.on('error', () => undefined);
            response.on('data', (chunk: Buffer) => frames.push(chunk.toString('utf8')));
            if (paused) response.pause();
            resolve({ request: outgoing, response });
          },
        );
        streams.add(outgoing);
        outgoing.on('error', reject);
      },
    );
    expect(stream.response.statusCode).toBe(200);
    expect(stream.response.headers['content-type']).toBe('text/event-stream');
    return { ...stream, frames };
  }

  async function notify(user: Actor, label: string) {
    const row = await b.app.get(NotificationsService).createForUser({
      userId: user.id,
      type: 'SYSTEM',
      title: label,
      body: 'R25 persisted notification',
      dedupeKey: `${P}${label}-${randomUUID()}`,
      deepLink: '/home/notifications',
    });
    const outbox = await prisma.outboxEvent.findUnique({
      where: { dedupeKey: `notification.created:${row.id}` },
    });
    // Exercise the accepted post-commit handler, not a forged business event.
    // Outbox worker crash/dedup acceptance belongs to the existing R22 suite.
    const effect = await prisma.$transaction((tx: any) =>
      b.app.get(NotificationCreatedHandler).handle(outbox, tx),
    );
    await effect?.afterCommit?.();
    return row;
  }

  beforeAll(async () => {
    lock = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle', mode: 'shared' },
      { resource: 'outbox', mode: 'shared' },
      { resource: 'serviceRequests', mode: 'shared' },
    ]);
    prisma = require('@homeservicemarketplace/database').prisma;
    await cleanup();
    const admin = await prisma.role.findUnique({ where: { name: 'admin' } });
    const provider = await prisma.role.findUnique({ where: { name: 'provider' } });
    if (!admin || !provider)
      throw new Error('R25 integration requires the repository baseline seed');
    adminRoleId = admin.id;
    providerRoleId = provider.id;
    // Settle both attempts before teardown can run: an early failure on one
    // side must not leave the other listener opening after afterAll starts.
    const [first, second] = await Promise.allSettled([buildReplica(), buildReplica()]);
    if (first.status === 'rejected') throw first.reason;
    if (second.status === 'rejected') throw second.reason;
    a = first.value;
    b = second.value;
    await actor('seeker', ['seeker']);
    await actor('other', ['seeker']);
    const providerActor = await actor('provider', ['provider']);
    const adminActor = await actor('admin', ['admin']);
    await prisma.userRole.createMany({
      data: [
        { userId: providerActor.id, roleId: providerRoleId },
        { userId: adminActor.id, roleId: adminRoleId },
      ],
    });
    providerId = `${P}provider-profile`;
    await prisma.providerProfile.create({
      data: {
        id: providerId,
        userId: providerActor.id,
        displayName: 'R25 provider',
        initials: 'RT',
        status: 'ACTIVE',
        onboardingState: 'ACCEPTED',
        standingState: 'GOOD',
        verificationState: 'VERIFIED',
      },
    });
  });

  beforeEach(async () => {
    for (const user of actors.values()) {
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', isActive: true },
      });
      await prisma.session.update({
        where: { id: user.sessionId },
        data: { revokedAt: null, currentJti: user.jti },
      });
    }
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { status: 'ACTIVE', standingState: 'GOOD' },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: actors.get('admin')!.id, roleId: adminRoleId } },
      create: { userId: actors.get('admin')!.id, roleId: adminRoleId },
      update: {},
    });
  });

  afterEach(async () => {
    for (const stream of streams) stream.destroy();
    streams.clear();
    if (pausedSubscriber && pausedSubscriber.status === 'end') await pausedSubscriber.connect();
    pausedSubscriber = undefined;
    for (const connection of connections) connection.socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const connection of connections.splice(0)) {
      if (connection.serverSocketId)
        await realtimeTransport(connection.replica.gateway.server)?.release(
          connection.userId,
          connection.serverSocketId,
        );
    }
  });

  afterAll(async () => {
    for (const stream of streams) stream.destroy();
    for (const connection of connections) connection.socket.disconnect();
    const closed = await Promise.allSettled(
      [...startedReplicas].map((replica) => replica.app.close()),
    );
    try {
      await cleanup();
    } finally {
      await lock?.release();
      await prisma?.$disconnect();
    }
    expect(closed.filter((result) => result.status === 'rejected')).toEqual([]);
  });

  it('delivers B to A over websocket and polling, preserves one history row and monotonic read state after reload', async () => {
    const seeker = actors.get('seeker')!;
    const provider = actors.get('provider')!;
    const id = await conversation();
    const seekerSocket = await connect(a, seeker, 'websocket', { cookie: true });
    const providerSocket = await connect(b, provider, 'polling', { cookie: true });
    expect(await subscribe(seekerSocket, id)).toEqual({ ok: true, room: `conversation:${id}` });
    expect(await subscribe(providerSocket, id)).toEqual({ ok: true, room: `conversation:${id}` });
    const sent = await request(b.app.getHttpServer())
      .post(`/v1/provider/conversations/${id}/messages`)
      .set('Authorization', bearer(provider))
      .send({ body: 'Cross-instance durable reply', idempotencyKey: randomUUID() });
    expect(sent.status).toBe(201);
    const messageId = sent.body.message.id;
    await eventually(
      () => seekerSocket.events.some((event) => event.payload?.message?.id === messageId),
      'A missed B message',
    );
    await eventually(
      () => providerSocket.events.some((event) => event.payload?.message?.id === messageId),
      'Polling publisher socket missed its message',
    );
    const wire = seekerSocket.events.find((event) => event.payload?.message?.id === messageId);
    expect(wire.eventId).toMatch(/^[a-f0-9]{64}$/);
    b.publisher.publishToRoom(`conversation:${id}`, 'message.created', wire.payload);
    await eventually(
      () =>
        seekerSocket.events.filter((event) => event.payload?.message?.id === messageId).length >= 2,
      'Explicit replay was not delivered',
    );
    expect(
      new Set(
        seekerSocket.events
          .filter((event) => event.payload?.message?.id === messageId)
          .map((event) => event.eventId),
      ).size,
    ).toBe(1);
    expect(await prisma.message.count({ where: { conversationId: id } })).toBe(1);
    const history = await messages(a, seeker, id);
    expect(history.status).toBe(200);
    expect(history.body.items.map((item: any) => item.id)).toEqual([messageId]);
    const read = await request(a.app.getHttpServer())
      .post(`/v1/me/conversations/${id}/read`)
      .set('Authorization', bearer(seeker))
      .send({ upToMessageId: messageId });
    expect(read.status).toBe(200);
    seekerSocket.socket.disconnect();
    const reload = await messages(b, seeker, id);
    expect(reload.body.items.map((item: any) => item.id)).toEqual([messageId]);
    const list = await request(b.app.getHttpServer())
      .get('/v1/me/conversations')
      .set('Authorization', bearer(seeker));
    expect(list.body.items.find((item: any) => item.id === id).unreadCount).toBe(0);
  });

  it('rejects foreign rooms and foreign history without disclosing another user notification', async () => {
    const seeker = actors.get('seeker')!;
    const other = actors.get('other')!;
    const id = await conversation();
    const foreign = await connect(a, other);
    expect(await subscribe(foreign, id)).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect((await messages(a, other, id)).status).toBe(404);
    const row = await notify(seeker, 'private recipient');
    const history = await request(a.app.getHttpServer())
      .get('/v1/me/notifications')
      .set('Authorization', bearer(other));
    expect(history.status).toBe(200);
    expect(history.body.items.some((item: any) => item.id === row.id)).toBe(false);
    const allowed = await notify(other, 'foreign-room allowed control');
    await eventually(
      () => foreign.events.some((event) => event.payload?.id === allowed.id),
      'Authorized control delivery failed',
    );
    expect(foreign.events.some((event) => event.payload?.id === row.id)).toBe(false);
    expect(foreign.events.every((event) => event.userId === other.id)).toBe(true);
  });

  it('uses real session authority after rotation, expiration and logout on the other replica', async () => {
    const seeker = actors.get('seeker')!;
    const live = await connect(a, seeker);
    await prisma.session.update({
      where: { id: seeker.sessionId },
      data: { currentJti: randomUUID() },
    });
    // The invalid credential path emits an explicit error and closes the
    // transport immediately; a callback queued after disconnect cannot flush.
    const denied: Array<{ code: string }> = [];
    live.socket.once('error', (error: { code: string }) => denied.push(error));
    live.socket.emit('subscribe:conversation', { conversationId: 'unowned-conversation' });
    await eventually(
      () => denied.length > 0,
      'Rotated credential did not receive an explicit denial',
    );
    expect(denied).toEqual([{ code: 'AUTH_INVALID_CREDENTIALS' }]);
    await eventually(() => !live.socket.connected, 'Rotated socket survived');
    const stale = await connect(b, seeker, 'websocket', { expectedFailure: true });
    expect(stale.result.ack).toBeUndefined();
    expect(stale.result.error).toBe('AUTH_INVALID_CREDENTIALS');
    expect(
      (
        await request(b.app.getHttpServer())
          .get('/v1/me/notifications')
          .set('Authorization', bearer(seeker))
      ).status,
    ).toBe(401);
    await prisma.session.update({
      where: { id: seeker.sessionId },
      data: { currentJti: seeker.jti },
    });
    const restored = await connect(a, seeker);
    await prisma.session.update({
      where: { id: seeker.sessionId },
      data: { revokedAt: new Date() },
    });
    b.app
      .get(SecurityEventsBus)
      .emitSessionRevoked({ userId: seeker.id, sessionId: seeker.sessionId });
    await eventually(() => !restored.socket.connected, 'Cross-instance logout did not evict A');
    await prisma.session.update({ where: { id: seeker.sessionId }, data: { revokedAt: null } });
    const control = await connect(a, seeker);
    expect(control.result.ack).toBeDefined();
    const claims = a.tokens.verifyAccessToken(seeker.token);
    const signedExpired = a.app.get(require('@nestjs/jwt').JwtService).sign({
      sub: claims.sub,
      sid: claims.sid,
      roles: claims.roles,
      jti: claims.jti,
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    const expired = await connect(a, seeker, 'websocket', {
      token: signedExpired,
      expectedFailure: true,
    });
    expect(expired.result.ack).toBeUndefined();
    expect(expired.result.error).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('expires an established idle socket at its original access expiry while the database session remains valid', async () => {
    const seeker = actors.get('seeker')!;
    const issued = shortToken(seeker);
    const live = await connect(a, seeker, 'websocket', { token: issued.token });
    const denied: Array<{ code: string }> = [];
    live.socket.on('error', (error: { code: string }) => denied.push(error));
    expect(
      (await prisma.session.findUnique({ where: { id: seeker.sessionId } })).revokedAt,
    ).toBeNull();
    await eventually(() => !live.socket.connected, 'Idle socket outlived its access token', 5_000);
    expect(Date.now()).toBeGreaterThanOrEqual(issued.expiresAt);
    expect(denied).toContainEqual({ code: 'AUTH_INVALID_CREDENTIALS' });
    const stale = await connect(b, seeker, 'websocket', {
      token: issued.token,
      expectedFailure: true,
    });
    expect(stale.result.error).toBe('AUTH_INVALID_CREDENTIALS');
    const fresh = await connect(b, seeker);
    const row = await notify(seeker, 'idle-expiry live control');
    await eventually(
      () => fresh.events.some((event) => event.payload?.id === row.id),
      'Valid control did not receive delivery',
    );
    expect(live.events).toEqual([]);
  });

  it.each(['logout-all', 'password-reset'] as const)(
    'applies committed %s session authority to both replicas and leaves another user connected',
    async (reason) => {
      const owner = await actor(`revoke-${reason}`);
      const sessionId = `${owner.id}-second-session`;
      const issued = a.tokens.signAccessToken({ userId: owner.id, sessionId, roles: owner.roles });
      await prisma.session.create({
        data: {
          id: sessionId,
          userId: owner.id,
          familyId: `${owner.id}-second-family`,
          currentJti: issued.jti,
          tokenHash: randomUUID(),
          ipAddress: '127.0.0.1',
          userAgent: 'R25 second session',
          clientKind: 'WEB',
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      const second = { ...owner, sessionId, token: issued.token, jti: issued.jti };
      const firstSocket = await connect(a, owner);
      const secondSocket = await connect(b, second);
      const unaffected = await connect(a, actors.get('other')!);
      // Exercise the same durable repository and post-commit bus used by IAM.
      // Endpoint/password-hash validation remains in the existing IAM suite.
      expect(await b.app.get(SessionRepository).revokeAllForUser(owner.id)).toEqual({ count: 2 });
      b.app.get(SecurityEventsBus).emitAllSessionsRevoked({ userId: owner.id, reason });
      await eventually(
        () => !firstSocket.socket.connected && !secondSocket.socket.connected,
        'All-session revocation did not reach both replicas',
      );
      for (const user of [owner, second]) {
        const history = await request(a.app.getHttpServer())
          .get('/v1/me/notifications')
          .set('Authorization', bearer(user));
        expect(history.status).toBe(401);
        const retry = await connect(b, user, 'websocket', { expectedFailure: true });
        expect(retry.result.error).toBe('AUTH_INVALID_CREDENTIALS');
        expect(retry.result.ack).toBeUndefined();
      }
      const row = await notify(actors.get('other')!, `${reason} authorized control`);
      await eventually(
        () => unaffected.events.some((event) => event.payload?.id === row.id),
        'Unrelated recipient was affected by revocation',
      );
      expect(unaffected.socket.connected).toBe(true);
    },
  );

  it('refuses a late join and stops established delivery after the actual conversation membership is removed', async () => {
    const seeker = actors.get('seeker')!;
    const provider = actors.get('provider')!;
    const id = await conversation();
    const established = await connect(a, seeker);
    const control = await connect(a, provider);
    expect(await subscribe(established, id)).toEqual({ ok: true, room: `conversation:${id}` });
    expect(await subscribe(control, id)).toEqual({ ok: true, room: `conversation:${id}` });
    await prisma.conversationParticipant.deleteMany({
      where: { conversationId: id, userId: seeker.id },
    });
    const late = await connect(b, seeker);
    expect(await subscribe(late, id)).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect((await messages(b, seeker, id)).status).toBe(404);
    const sent = await request(b.app.getHttpServer())
      .post(`/v1/provider/conversations/${id}/messages`)
      .set('Authorization', bearer(provider))
      .send({ body: 'Authorized remaining participant', idempotencyKey: randomUUID() });
    expect(sent.status).toBe(201);
    const messageId = sent.body.message.id;
    await eventually(
      () => control.events.some((event) => event.payload?.message?.id === messageId),
      'Authorized participant control did not receive B delivery',
    );
    await eventually(
      () => (a.gateway as unknown as { activeDeliveries: number }).activeDeliveries === 0,
      'Membership checks did not drain',
    );
    expect(established.events).toEqual([]);
    expect(late.events).toEqual([]);
    expect(
      (await messages(a, provider, id, true)).body.items.map((item: any) => item.id),
    ).toContain(messageId);
  });

  it('hard-closes an established SSE response at original access expiry instead of draining a deferred queue', async () => {
    const seeker = actors.get('seeker')!;
    const issued = shortToken(seeker);
    const live = await openSse(a, seeker, issued.token);
    const row = await notify(seeker, 'SSE expiry persisted control');
    a.publisher.publishFor(seeker.id, 'notification.created', toNotificationSummary(row));
    await eventually(
      () => live.frames.join('').includes(row.id),
      'Valid SSE control frame was not received',
    );
    await eventually(
      () => live.response.destroyed,
      'SSE response outlived original token expiry',
      5_000,
    );
    expect(Date.now()).toBeGreaterThanOrEqual(issued.expiresAt);
    expect((a.publisher as unknown as { subscribers: number }).subscribers).toBe(0);
    const before = live.frames.join('');
    a.publisher.publishFor(seeker.id, 'notification.created', { id: 'after-expiry-private' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(live.frames.join('')).toBe(before);
    expect(
      (await prisma.session.findUnique({ where: { id: seeker.sessionId } })).revokedAt,
    ).toBeNull();
  });

  it('closes an actual paused SSE reader when its response becomes unwritable without retaining a downstream history', async () => {
    const seeker = actors.get('seeker')!;
    const live = await openSse(a, seeker);
    const control = await notify(seeker, 'SSE pressure authorized control');
    a.publisher.publishFor(seeker.id, 'notification.created', toNotificationSummary(control));
    await eventually(
      () => live.frames.join('').includes(control.id),
      'SSE authorization control failed',
    );
    live.response.pause();
    const row = await a.app.get(NotificationsService).createForUser({
      userId: seeker.id,
      type: 'SYSTEM',
      title: 'SSE transport pressure',
      body: 'x'.repeat(56 * 1024),
      dedupeKey: `${P}sse-pressure`,
      deepLink: '/home/notifications',
    });
    const counters = a.publisher as unknown as {
      subscribers: number;
      pendingSse: number;
      pendingSseBytes: number;
    };
    let attemptedFrames = 0;
    // One committed row replayed for transport pressure; await each auth gate
    // so this proves response backpressure, not the upstream stalled-auth cap.
    for (; attemptedFrames < 256 && counters.subscribers > 0; attemptedFrames++) {
      a.publisher.publishFor(seeker.id, 'notification.created', toNotificationSummary(row));
      await eventually(() => counters.pendingSse === 0, 'SSE authorization queue did not drain');
    }
    expect(counters.subscribers).toBe(0);
    expect(counters.pendingSse).toBe(0);
    expect(counters.pendingSseBytes).toBe(0);
    expect(attemptedFrames).toBeLessThan(256);
    live.response.resume();
    await eventually(() => live.response.destroyed, 'Slow SSE reader response was not destroyed');
    expect(await prisma.notification.count({ where: { id: row.id } })).toBe(1);
    process.stdout.write(
      JSON.stringify({
        r25SseSlowReader: {
          attemptedFrames,
          frameBodyBytes: 56 * 1024,
          remainingAuthorizationQueue: counters.pendingSse,
          remainingQueuedBytes: counters.pendingSseBytes,
        },
      }) + '\n',
    );
  });

  it('filters current admin role and provider capability loss even when the eviction notification is absent', async () => {
    const admin = actors.get('admin')!;
    const provider = actors.get('provider')!;
    const id = await conversation();
    const adminSocket = await connect(a, admin);
    const providerSocket = await connect(a, provider);
    const control = await connect(a, actors.get('other')!);
    expect(adminSocket.result.ack.joinedRooms).toContain('admin');
    expect(await subscribe(providerSocket, id)).toEqual({ ok: true, room: `conversation:${id}` });
    await prisma.userRole.delete({
      where: { userId_roleId: { userId: admin.id, roleId: adminRoleId } },
    });
    await prisma.providerProfile.update({
      where: { id: providerId },
      data: { standingState: 'SUSPENDED' },
    });
    b.publisher.publishToRoom('admin', 'provider.status_changed', {
      providerId,
      status: 'SUSPENDED',
    });
    b.publisher.publishToRoom(`conversation:${id}`, 'message.created', {
      conversationId: id,
      message: { id: 'private-after-loss', body: 'must not be delivered' },
    });
    b.publisher.publishFor(provider.id, 'request.available', { requestId: 'private-request' });
    const barrier = await notify(actors.get('other')!, 'authorized delivery control');
    await eventually(
      () => control.events.some((event) => event.payload?.id === barrier.id),
      'Authorized control delivery failed',
    );
    await eventually(
      () => (a.gateway as unknown as { activeDeliveries: number }).activeDeliveries === 0,
      'Authorization gates did not settle',
    );
    expect(adminSocket.events).toEqual([]);
    expect(providerSocket.events).toEqual([]);
    expect((await messages(b, provider, id, true)).status).toBe(403);
    const seeker = actors.get('seeker')!;
    expect((await messages(b, seeker, id)).status).toBe(200);
  });

  it('closes sockets on an adapter-only Redis partition while REST history/read recovery stays available', async () => {
    const seeker = actors.get('seeker')!;
    const live = await connect(a, seeker);
    pausedSubscriber = (a.adapter as unknown as { clients: Redis[] }).clients[1]!;
    pausedSubscriber.disconnect();
    await eventually(
      () => !realtimeTransport(a.gateway.server)?.isReady(),
      'Partition was not detected',
    );
    await eventually(() => !live.socket.connected, 'Socket survived unavailable subscription path');
    const row = await notify(seeker, 'committed while socket unavailable');
    const fallback = await request(a.app.getHttpServer())
      .get('/v1/me/notifications')
      .set('Authorization', bearer(seeker));
    expect(fallback.status).toBe(200);
    expect(fallback.body.items.filter((item: any) => item.id === row.id)).toHaveLength(1);
    await pausedSubscriber.connect();
    await eventually(
      () => Boolean(realtimeTransport(a.gateway.server)?.isReady()),
      'Redis restoration did not restore admissions',
    );
    const fresh = await connect(a, seeker);
    expect(fresh.result.ack.recovery.required).toBe(true);
    const reloaded = await request(b.app.getHttpServer())
      .get('/v1/me/notifications')
      .set('Authorization', bearer(seeker));
    expect(reloaded.body.items.filter((item: any) => item.id === row.id)).toHaveLength(1);
    const read = await request(a.app.getHttpServer())
      .post(`/v1/me/notifications/${row.id}/read`)
      .set('Authorization', bearer(seeker));
    expect(read.status).toBe(200);
    const reflected = await request(b.app.getHttpServer())
      .get('/v1/me/notifications')
      .set('Authorization', bearer(seeker));
    expect(reflected.body.items.find((item: any) => item.id === row.id).readAt).not.toBeNull();
    expect(live.events.some((event) => event.payload?.id === row.id)).toBe(false);
  });

  it('enforces an atomic per-user connection limit under simultaneous connects to both replicas', async () => {
    const seeker = actors.get('seeker')!;
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        connect(index % 2 ? a : b, seeker, 'websocket', { expectedFailure: true }),
      ),
    );
    expect(attempts.filter((connection) => connection.result.ack)).toHaveLength(
      MAX_REALTIME_CONNECTIONS_PER_USER,
    );
    expect(
      attempts.filter((connection) => connection.result.error === 'REALTIME_CONNECTION_LIMIT'),
    ).toHaveLength(4);
    expect(attempts.filter((connection) => connection.result.error === 'TIMEOUT')).toEqual([]);
  });

  it('declares and bounds a 24-connection/120-event workload with no private recipient leakage', async () => {
    const users = await Promise.all(
      Array.from({ length: 12 }, (_, index) => actor(`load-${index}`)),
    );
    const clients = (
      await Promise.all(users.map(async (user) => [await connect(a, user), await connect(b, user)]))
    ).flat();
    const startMemory = process.memoryUsage().heapUsed;
    let peakHeap = startMemory;
    const startedAt = Date.now();
    let samples = 0;
    const peaks = [
      { pendingDeliveries: 0, pendingBytes: 0 },
      { pendingDeliveries: 0, pendingBytes: 0 },
    ];
    const sample = () => {
      samples += 1;
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
      for (const [index, replica] of [a, b].entries()) {
        const counters = replica.gateway as unknown as {
          deliveries: unknown[];
          activeDeliveries: number;
          pendingBytes: number;
        };
        peaks[index]!.pendingDeliveries = Math.max(
          peaks[index]!.pendingDeliveries,
          counters.deliveries.length + counters.activeDeliveries,
        );
        peaks[index]!.pendingBytes = Math.max(peaks[index]!.pendingBytes, counters.pendingBytes);
      }
    };
    const sampling = setInterval(sample, 5);
    sampling.unref();
    const rows: any[] = [];
    try {
      for (let wave = 0; wave < 10; wave++) {
        const created = await Promise.all(
          users.map((user) =>
            prisma.notification.create({
              data: {
                userId: user.id,
                type: 'SYSTEM',
                title: `load-${wave}`,
                body: 'x'.repeat(128),
                deepLink: '/home/notifications',
              },
            }),
          ),
        );
        rows.push(...created);
        for (const row of created)
          b.publisher.publishFor(row.userId, 'notification.created', toNotificationSummary(row));
        sample(); // capture the enqueued wave in addition to the continuous samples
        await eventually(
          () => clients.every((client) => client.events.length === wave + 1),
          'Declared workload did not drain',
        );
        for (const client of clients)
          expect(client.events.every((event) => event.userId === client.userId)).toBe(true);
      }
    } finally {
      clearInterval(sampling);
      sample();
    }
    for (const peak of peaks) {
      expect(peak.pendingDeliveries).toBeLessThanOrEqual(MAX_PENDING_REALTIME_DELIVERIES);
      expect(peak.pendingBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    }
    expect(peaks[1]!.pendingDeliveries).toBeGreaterThan(0);
    expect(rows).toHaveLength(120);
    expect(clients.reduce((sum, client) => sum + client.events.length, 0)).toBe(240);
    expect(peakHeap - startMemory).toBeLessThan(64 * 1024 * 1024);
    const authoritative = await request(a.app.getHttpServer())
      .get('/v1/me/notifications')
      .set('Authorization', bearer(users[0]!));
    expect(authoritative.body.items).toHaveLength(10);
    // Declared test-process observation, not a hosted capacity/SLO claim.
    process.stdout.write(
      JSON.stringify({
        r25Workload: {
          connections: 24,
          durableEvents: 120,
          receivedPackets: 240,
          peakHeapGrowthBytes: peakHeap - startMemory,
          queueLimit: MAX_PENDING_REALTIME_DELIVERIES,
          perReplicaPendingBytesLimit: 16 * 1024 * 1024,
          durationMs: Date.now() - startedAt,
          samplingIntervalMs: 5,
          samples,
          observedReplicaPeaks: peaks,
        },
      }) + '\n',
    );
  });
});
