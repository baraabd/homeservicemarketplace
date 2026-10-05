/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy Prisma requires: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 * `any` on the Prisma and HTTP handles for the same reason.
 */

export {};

import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { APP_FILTER, Reflector } from '@nestjs/core';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

// R12 — the conversation behind a booking's Message action, THROUGH THE REAL
// HTTP PATH, against real Postgres.
//
// docs/production-readiness/r12/COMMUNICATION_POLICY.md
//
// One conversation per booking, between the booking's seeker and its provider,
// created the first time either of them opens it. The seeker reaches it under
// /v1/me/conversations; the provider under /v1/provider/conversations, which
// also requires the provider to be allowed to manage bookings.
//
// The role and capability GUARDS are replaced here (they have their own
// suites). What is under test is what the service lets each route family do
// once a request is through them.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

let currentUser: { id: string } | null = null;

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const named = req.headers['x-test-user'];
    const user = typeof named === 'string' ? { id: named } : currentUser;
    if (!user) return false;
    req.user = user;
    return true;
  }
}
class PassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

d('R12 - booking conversations (real HTTP, real Postgres)', () => {
  let prisma: any;
  let app: INestApplication;
  let http: any;
  let locks: HeldLock | undefined;

  const P = fixturePrefix('r12com');
  const SEEKER = `${P}seeker`;
  const OTHER_SEEKER = `${P}other-seeker`;
  const PROVIDER_USER = `${P}provider-user`;
  const PROVIDER = `${P}provider`;
  const OTHER_PROVIDER_USER = `${P}other-provider-user`;
  const OTHER_PROVIDER = `${P}other-provider`;
  const USERS = [SEEKER, OTHER_SEEKER, PROVIDER_USER, OTHER_PROVIDER_USER];
  const PROFILES = [
    [PROVIDER, PROVIDER_USER],
    [OTHER_PROVIDER, OTHER_PROVIDER_USER],
  ] as const;
  // Contact details that exist in the database and must never reach the
  // other party through a conversation.
  const SEEKER_PHONE = '+963 900 000 112';
  const PROVIDER_PHONE = '+963 900 000 113';

  const as = (userId: string | null) => {
    currentUser = userId ? { id: userId } : null;
  };
  const SEEKER_BASE = '/v1/me/conversations';
  const PROVIDER_BASE = '/v1/provider/conversations';
  const open = (base: string, bookingId: string, user?: string) => {
    const req = request(http).post(base).send({ bookingId });
    return user ? req.set('x-test-user', user) : req;
  };
  const send = (base: string, conversationId: string, body: string, user?: string) => {
    const req = request(http).post(`${base}/${conversationId}/messages`).send({ body });
    return user ? req.set('x-test-user', user) : req;
  };
  const sendKeyed = (
    base: string,
    conversationId: string,
    body: string,
    idempotencyKey: string,
    user?: string,
  ) => {
    const req = request(http)
      .post(`${base}/${conversationId}/messages`)
      .send({ body, idempotencyKey });
    return user ? req.set('x-test-user', user) : req;
  };
  const storedMessages = (conversationId: string) =>
    prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const messagesOf = (base: string, conversationId: string) =>
    request(http).get(`${base}/${conversationId}/messages`);

  async function booking(
    bookingStatus: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' = 'SCHEDULED',
    over: { seeker?: string; provider?: string } = {},
  ): Promise<string> {
    const id = `${P}b-${randomUUID()}`;
    const seekerUserId = over.seeker ?? SEEKER;
    const providerId = over.provider ?? PROVIDER;
    await prisma.serviceRequest.create({
      data: {
        id: `${id}-request`,
        seekerUserId,
        scheduleType: 'ASAP',
        addressSnapshot: {},
        status: 'BID_ACCEPTED',
      },
    });
    await prisma.bid.create({
      data: {
        id: `${id}-bid`,
        requestId: `${id}-request`,
        providerId,
        amount: 100,
        pricingType: 'FIXED',
        status: 'ACCEPTED',
      },
    });
    await prisma.booking.create({
      data: {
        id,
        requestId: `${id}-request`,
        bidId: `${id}-bid`,
        seekerUserId,
        providerId,
        priceAmount: 100,
        status: bookingStatus,
      },
    });
    return id;
  }

  const conversationsFor = (bookingId: string) =>
    prisma.conversation.findMany({ where: { bookingId }, include: { participants: true } });

  async function clearBookings(): Promise<void> {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS r12_fail_participant ON "ConversationParticipant"`,
    );
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS r12_fail_participant()`);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS r12_fail_message ON "Message"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS r12_fail_message()`);
    await prisma.conversation.deleteMany({ where: { bookingId: { startsWith: P } } });
    await prisma.booking.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.bid.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { startsWith: P } } });
  }
  async function wipe(): Promise<void> {
    await clearBookings();
    await prisma.userProfile.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  }

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle' as const, mode: 'shared' as const },
      { resource: 'serviceRequests' as const, mode: 'shared' as const },
    ]);

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    const prismaSvc = { client: prisma, isReady: () => true };

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      BookingRepository,
    } = require('../../src/infrastructure/persistence/bookings/booking.repository');
    const {
      ProviderProfileRepository,
    } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const {
      ConversationRepository,
    } = require('../../src/infrastructure/persistence/conversations/conversation.repository');
    const {
      ConversationParticipantRepository,
    } = require('../../src/infrastructure/persistence/conversations/conversation-participant.repository');
    const {
      MessageRepository,
    } = require('../../src/infrastructure/persistence/conversations/message.repository');
    const {
      RealtimeEventsPublisher,
    } = require('../../src/modules/realtime/realtime-events.publisher');
    const {
      ConversationsService,
    } = require('../../src/modules/conversations/conversations.service');
    const {
      ConversationsController,
    } = require('../../src/modules/conversations/conversations.controller');
    const {
      ProviderConversationsController,
    } = require('../../src/modules/conversations/provider-conversations.controller');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const { RolesGuard } = require('../../src/modules/iam/authorization/guards/roles.guard');
    const {
      ProviderCapabilityGuard,
    } = require('../../src/modules/provider/guards/provider-capability.guard');
    const { AppConfigService } = require('../../src/config/app-config.service');

    const FLAGS: Record<string, unknown> = { JWT_ACCESS_SECRET: makeTestSecret('r12-comms') };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };
    const realtime = { publishToRoom: () => undefined, publishToUser: () => undefined };

    const moduleRef = await Test.createTestingModule({
      controllers: [ConversationsController, ProviderConversationsController],
      providers: [
        ConversationsService,
        ConversationRepository,
        ConversationParticipantRepository,
        MessageRepository,
        BookingRepository,
        ProviderProfileRepository,
        TransactionRunner,
        Reflector,
        { provide: RealtimeEventsPublisher, useValue: realtime },
        { provide: PrismaService, useValue: prismaSvc },
        { provide: AppConfigService, useValue: config },
        { provide: AllExceptionsFilter, useValue: new AllExceptionsFilter(config) },
        { provide: APP_FILTER, useExisting: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .overrideGuard(CsrfGuard)
      .useClass(PassGuard)
      .overrideGuard(RolesGuard)
      .useClass(PassGuard)
      .overrideGuard(ProviderCapabilityGuard)
      .useClass(PassGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    await wipe();
    for (const id of USERS) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@r12com.test`,
          firstName: 'Rami',
          lastName: 'Fixture',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
    }
    await prisma.userProfile.create({ data: { userId: SEEKER, phoneNumber: SEEKER_PHONE } });
    for (const [id, userId] of PROFILES) {
      await prisma.providerProfile.create({
        data: {
          id,
          userId,
          displayName: `R12 ${id}`,
          initials: 'R1',
          status: 'ACTIVE',
          phoneNumber: PROVIDER_PHONE,
        },
      });
    }
  });

  afterAll(async () => {
    try {
      if (prisma) await wipe();
    } finally {
      try {
        await app?.close();
      } finally {
        currentUser = null;
        await locks?.release();
      }
    }
  });

  beforeEach(async () => {
    await clearBookings();
    as(SEEKER);
  });

  // ── one conversation per booking ──────────────────────────────────────────
  describe('opening Message', () => {
    it('creates the booking conversation with exactly its seeker and provider', async () => {
      const id = await booking();
      const res = await open(SEEKER_BASE, id);
      expect(res.status).toBe(200);
      expect(res.body.conversation).toMatchObject({
        bookingId: id,
        requestId: `${id}-request`,
        otherParticipant: { displayName: `R12 ${PROVIDER}`, initials: 'R1' },
        unreadCount: 0,
      });
      const rows = await conversationsFor(id);
      expect(rows).toHaveLength(1);
      const members = rows[0].participants
        .map((p: any) => [p.role, p.userId, p.providerProfileId])
        .sort();
      expect(members).toEqual([
        ['PROVIDER', PROVIDER_USER, PROVIDER],
        ['SEEKER', SEEKER, null],
      ]);
    });

    it('returns the same conversation however often, and from either side', async () => {
      const id = await booking();
      const first = await open(SEEKER_BASE, id);
      const again = await open(SEEKER_BASE, id);
      as(PROVIDER_USER);
      const fromProvider = await open(PROVIDER_BASE, id);
      expect(again.body.conversation.id).toBe(first.body.conversation.id);
      expect(fromProvider.body.conversation.id).toBe(first.body.conversation.id);
      // Each side sees the other.
      expect(fromProvider.body.conversation.otherParticipant.displayName).toBe('Rami F.');
      expect(await conversationsFor(id)).toHaveLength(1);
    });

    it('ten simultaneous opens by the seeker make one conversation', async () => {
      const id = await booking();
      const answers = await Promise.all(
        Array.from({ length: 10 }, () => open(SEEKER_BASE, id, SEEKER)),
      );
      expect(answers.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(new Set(answers.map((r) => r.body.conversation.id)).size).toBe(1);
      const rows = await conversationsFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].participants).toHaveLength(2);
    });

    it('both participants opening at once make one conversation', async () => {
      const id = await booking();
      const answers = await Promise.all([
        ...Array.from({ length: 4 }, () => open(SEEKER_BASE, id, SEEKER)),
        ...Array.from({ length: 4 }, () => open(PROVIDER_BASE, id, PROVIDER_USER)),
      ]);
      expect(answers.map((r) => r.status)).toEqual(Array(8).fill(200));
      expect(new Set(answers.map((r) => r.body.conversation.id)).size).toBe(1);
      expect(await conversationsFor(id)).toHaveLength(1);
    });

    it('accepts a booking id and nothing else', async () => {
      const id = await booking();
      for (const extra of [
        { providerId: OTHER_PROVIDER },
        { seekerUserId: OTHER_SEEKER },
        { requestId: `${id}-request` },
        { participantIds: [OTHER_SEEKER] },
      ]) {
        const res = await request(http)
          .post(SEEKER_BASE)
          .send({ bookingId: id, ...extra });
        expect(res.status).toBe(400);
      }
      expect(await conversationsFor(id)).toHaveLength(0);
    });

    it('a failure while creating it is reported, not turned into a conversation', async () => {
      const id = await booking();
      // The participant insert fails for this booking's conversation only.
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION r12_fail_participant() RETURNS trigger AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM "Conversation" c
                      WHERE c.id = NEW."conversationId" AND c."bookingId" = '${id}') THEN
            RAISE EXCEPTION 'r12 injected participant failure';
          END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER r12_fail_participant BEFORE INSERT ON "ConversationParticipant"
        FOR EACH ROW EXECUTE FUNCTION r12_fail_participant()`);
      const res = await open(SEEKER_BASE, id);
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('r12 injected');
      // The transaction left nothing behind.
      expect(await conversationsFor(id)).toHaveLength(0);
    });
  });

  // ── who may not ───────────────────────────────────────────────────────────
  describe('people outside the booking', () => {
    it('an unrelated seeker or provider cannot open, read, write or mark it', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      await send(SEEKER_BASE, conv, 'private note');

      as(OTHER_SEEKER);
      expect((await open(SEEKER_BASE, id)).status).toBe(404);
      expect((await messagesOf(SEEKER_BASE, conv)).status).toBe(404);
      expect((await send(SEEKER_BASE, conv, 'intrusion')).status).toBe(404);
      expect((await request(http).post(`${SEEKER_BASE}/${conv}/read`)).status).toBe(404);
      const listed = await request(http).get(SEEKER_BASE);
      expect(listed.body.items.map((c: any) => c.id)).not.toContain(conv);

      as(OTHER_PROVIDER_USER);
      expect((await open(PROVIDER_BASE, id)).status).toBe(404);
      expect((await messagesOf(PROVIDER_BASE, conv)).status).toBe(404);
      expect((await send(PROVIDER_BASE, conv, 'intrusion')).status).toBe(404);

      const rows = await conversationsFor(id);
      expect(rows[0].participants).toHaveLength(2);
      expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(1);
    });

    it('a guessed conversation id is not found, exactly as a missing one is not', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      as(OTHER_SEEKER);
      const guessed = await messagesOf(SEEKER_BASE, conv);
      const missing = await messagesOf(SEEKER_BASE, `${P}no-such-conversation`);
      expect(guessed.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(guessed.body.error?.code).toBe(missing.body.error?.code);
    });

    it('no session, no conversation', async () => {
      const id = await booking();
      as(null);
      expect((await open(SEEKER_BASE, id)).status).toBe(403);
      expect(await conversationsFor(id)).toHaveLength(0);
    });
  });

  // ── each route family acts for one side only ──────────────────────────────
  //
  // The provider routes require the provider to be allowed to manage
  // bookings: a suspended provider may not open or post in a booking chat.
  // The seeker routes must not be a way round that.
  describe('the seeker routes act for the seeker side only', () => {
    it('a provider cannot open their booking conversation through the seeker routes', async () => {
      const id = await booking();
      as(PROVIDER_USER);
      const res = await open(SEEKER_BASE, id);
      expect(res.status).toBe(404);
      expect(await conversationsFor(id)).toHaveLength(0);
    });

    it('a provider cannot read, write or mark it through the seeker routes', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      as(PROVIDER_USER);
      expect((await messagesOf(SEEKER_BASE, conv)).status).toBe(404);
      expect((await send(SEEKER_BASE, conv, 'around the gate')).status).toBe(404);
      expect((await request(http).post(`${SEEKER_BASE}/${conv}/read`)).status).toBe(404);
      const listed = await request(http).get(SEEKER_BASE);
      expect(listed.body.items.map((c: any) => c.id)).not.toContain(conv);
      expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(0);
      // Through its own routes, it can.
      expect((await send(PROVIDER_BASE, conv, 'on my way at ten')).status).toBe(201);
    });

    it('a seeker cannot act as the provider through the provider routes', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      expect((await open(PROVIDER_BASE, id)).status).toBe(404);
      expect((await messagesOf(PROVIDER_BASE, conv)).status).toBe(404);
      expect((await send(PROVIDER_BASE, conv, 'as provider')).status).toBe(404);
    });

    it('someone who is a seeker and a provider sees each side under its own routes', async () => {
      // PROVIDER_USER books OTHER_PROVIDER as a customer.
      const asCustomer = await booking('SCHEDULED', {
        seeker: PROVIDER_USER,
        provider: OTHER_PROVIDER,
      });
      const asProvider = await booking();
      as(PROVIDER_USER);
      const customerConv = (await open(SEEKER_BASE, asCustomer)).body.conversation;
      const providerConv = (await open(PROVIDER_BASE, asProvider)).body.conversation;
      expect(customerConv.otherParticipant.displayName).toBe(`R12 ${OTHER_PROVIDER}`);
      expect(providerConv.otherParticipant.displayName).toBe('Rami F.');
      const seekerList = (await request(http).get(SEEKER_BASE)).body.items.map((c: any) => c.id);
      const providerList = (await request(http).get(PROVIDER_BASE)).body.items.map(
        (c: any) => c.id,
      );
      expect(seekerList).toContain(customerConv.id);
      expect(seekerList).not.toContain(providerConv.id);
      expect(providerList).toContain(providerConv.id);
      expect(providerList).not.toContain(customerConv.id);
    });
  });

  // ── messages ──────────────────────────────────────────────────────────────
  describe('messages', () => {
    it('a message is stored once, with the sender the session names, and reaches the other side', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      const sent = await send(SEEKER_BASE, conv, '  Is ten o’clock still good?  ');
      expect(sent.status).toBe(201);
      expect(sent.body.message).toMatchObject({
        body: 'Is ten o’clock still good?',
        sentByMe: true,
        senderRole: 'SEEKER',
      });
      const stored = await prisma.message.findMany({ where: { conversationId: conv } });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        senderUserId: SEEKER,
        senderRole: 'SEEKER',
        body: 'Is ten o’clock still good?',
      });

      as(PROVIDER_USER);
      const list = (await request(http).get(PROVIDER_BASE)).body.items.find(
        (c: any) => c.id === conv,
      );
      expect(list).toMatchObject({ unreadCount: 1, lastMessageBody: 'Is ten o’clock still good?' });
      const read = await messagesOf(PROVIDER_BASE, conv);
      expect(read.body.items).toEqual([
        expect.objectContaining({ body: 'Is ten o’clock still good?', sentByMe: false }),
      ]);
      expect((await request(http).post(`${PROVIDER_BASE}/${conv}/read`)).status).toBe(200);
      const after = (await request(http).get(PROVIDER_BASE)).body.items.find(
        (c: any) => c.id === conv,
      );
      expect(after.unreadCount).toBe(0);

      const reply = await send(PROVIDER_BASE, conv, 'Yes, see you at ten.');
      expect(reply.body.message.senderRole).toBe('PROVIDER');
      as(SEEKER);
      const seen = await messagesOf(SEEKER_BASE, conv);
      expect(seen.body.items.map((m: any) => [m.body, m.sentByMe])).toEqual([
        ['Is ten o’clock still good?', true],
        ['Yes, see you at ten.', false],
      ]);
    });

    it('refuses an empty or oversized message and a forged sender', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      expect((await send(SEEKER_BASE, conv, '   ')).status).toBe(400);
      expect((await send(SEEKER_BASE, conv, 'x'.repeat(4001))).status).toBe(400);
      const forged = await request(http)
        .post(`${SEEKER_BASE}/${conv}/messages`)
        .send({ body: 'hello', senderUserId: PROVIDER_USER, senderRole: 'PROVIDER' });
      expect(forged.status).toBe(400);
      expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(0);
    });

    // EXISTING behaviour, recorded rather than decided: no booking status
    // closes or opens a conversation. See the policy's open decisions.
    it.each(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const)(
      'a %s booking can be messaged (no lifecycle rule exists)',
      async (bookingStatus) => {
        const id = await booking(bookingStatus);
        const conv = await open(SEEKER_BASE, id);
        expect(conv.status).toBe(200);
        expect((await send(SEEKER_BASE, conv.body.conversation.id, 'hello')).status).toBe(201);
      },
    );
  });

  // ── R17: the read position is what was shown ─────────────────────────────
  // docs/production-readiness/r17/R17_A_MESSAGING.md. `upToMessageId` names the
  // newest message the reader was shown; anything after it stays unread, and
  // the position never moves backwards.
  describe('R17 read position', () => {
    const readUpTo = (base: string, conv: string, upToMessageId: string) =>
      request(http).post(`${base}/${conv}/read`).send({ upToMessageId });
    const unreadOf = async (base: string, conv: string): Promise<number> =>
      (await request(http).get(base)).body.items.find((c: any) => c.id === conv).unreadCount;
    const lastReadAtOf = async (conv: string, userId: string): Promise<Date | null> =>
      (
        await prisma.conversationParticipant.findFirstOrThrow({
          where: { conversationId: conv, userId },
        })
      ).lastReadAt;

    it('a message that arrived after the one shown stays unread', async () => {
      const id = await booking();
      as(SEEKER);
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      as(PROVIDER_USER);
      const first = (await send(PROVIDER_BASE, conv, 'Arriving at ten.')).body.message;
      as(SEEKER);
      // The seeker's screen shows `first`. Before the read request lands, a
      // second message is committed.
      expect((await messagesOf(SEEKER_BASE, conv)).body.items.map((m: any) => m.id)).toEqual([
        first.id,
      ]);
      as(PROVIDER_USER);
      await send(PROVIDER_BASE, conv, 'Running ten minutes late.');
      as(SEEKER);

      const read = await readUpTo(SEEKER_BASE, conv, first.id);
      expect(read.status).toBe(200);
      const stored = await prisma.message.findUniqueOrThrow({ where: { id: first.id } });
      expect(read.body).toEqual({ lastReadAt: stored.createdAt.toISOString() });
      expect(await lastReadAtOf(conv, SEEKER)).toEqual(stored.createdAt);
      expect(await unreadOf(SEEKER_BASE, conv)).toBe(1);
    });

    it('a late read from another tab never moves the position backwards', async () => {
      const id = await booking();
      as(SEEKER);
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      as(PROVIDER_USER);
      const older = (await send(PROVIDER_BASE, conv, 'one')).body.message;
      const newer = (await send(PROVIDER_BASE, conv, 'two')).body.message;
      as(SEEKER);
      expect((await readUpTo(SEEKER_BASE, conv, newer.id)).status).toBe(200);
      const late = await readUpTo(SEEKER_BASE, conv, older.id);
      expect(late.status).toBe(200);
      const newerAt = (await prisma.message.findUniqueOrThrow({ where: { id: newer.id } }))
        .createdAt;
      expect(late.body).toEqual({ lastReadAt: newerAt.toISOString() });
      expect(await lastReadAtOf(conv, SEEKER)).toEqual(newerAt);
      expect(await unreadOf(SEEKER_BASE, conv)).toBe(0);
    });

    it('concurrent reads settle on the newest message read', async () => {
      const id = await booking();
      as(SEEKER);
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      as(PROVIDER_USER);
      const sent: { id: string }[] = [];
      for (let i = 0; i < 8; i += 1) {
        sent.push((await send(PROVIDER_BASE, conv, `update ${i}`)).body.message);
      }
      as(SEEKER);
      const answers = await Promise.all(
        [...sent]
          .reverse()
          .map((m) => readUpTo(SEEKER_BASE, conv, m.id).set('x-test-user', SEEKER)),
      );
      expect(answers.map((a) => a.status)).toEqual(Array(8).fill(200));
      const newestAt = (await prisma.message.findUniqueOrThrow({ where: { id: sent[7].id } }))
        .createdAt;
      expect(await lastReadAtOf(conv, SEEKER)).toEqual(newestAt);
      expect(await unreadOf(SEEKER_BASE, conv)).toBe(0);
    });

    it('a message from another conversation, or a guessed id, moves nothing', async () => {
      const mine = await booking();
      const theirs = await booking('SCHEDULED', { seeker: OTHER_SEEKER });
      as(SEEKER);
      const conv = (await open(SEEKER_BASE, mine)).body.conversation.id;
      as(OTHER_SEEKER);
      const otherConv = (await open(SEEKER_BASE, theirs)).body.conversation.id;
      const foreign = (await send(SEEKER_BASE, otherConv, 'not yours')).body.message;
      as(PROVIDER_USER);
      await send(PROVIDER_BASE, conv, 'hello');
      as(SEEKER);

      for (const guess of [foreign.id, `${P}no-such-message`]) {
        const res = await readUpTo(SEEKER_BASE, conv, guess);
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain('not yours');
      }
      expect((await readUpTo(SEEKER_BASE, conv, 'bad id!')).status).toBe(400);
      expect(
        (await request(http).post(`${SEEKER_BASE}/${conv}/read`).send({ upTo: 'x' })).status,
      ).toBe(400);
      expect(await lastReadAtOf(conv, SEEKER)).toBeNull();
      expect(await unreadOf(SEEKER_BASE, conv)).toBe(1);
      // A stranger cannot use someone else's conversation either.
      as(OTHER_SEEKER);
      expect((await readUpTo(SEEKER_BASE, conv, foreign.id)).status).toBe(404);
    });

    it('the provider side reads by the same rule, and the bodyless call still works', async () => {
      const id = await booking();
      as(SEEKER);
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      const shown = (await send(SEEKER_BASE, conv, 'first')).body.message;
      await send(SEEKER_BASE, conv, 'second');
      as(PROVIDER_USER);
      expect((await readUpTo(PROVIDER_BASE, conv, shown.id)).status).toBe(200);
      expect(await unreadOf(PROVIDER_BASE, conv)).toBe(1);
      expect((await request(http).post(`${PROVIDER_BASE}/${conv}/read`)).status).toBe(200);
      expect(await unreadOf(PROVIDER_BASE, conv)).toBe(0);
    });
  });

  // ── privacy ───────────────────────────────────────────────────────────────
  describe('what the other side learns', () => {
    it('no phone number, email address or full surname crosses a conversation', async () => {
      const id = await booking();
      const answers: unknown[] = [];
      const conv = await open(SEEKER_BASE, id);
      answers.push(conv.body);
      await send(SEEKER_BASE, conv.body.conversation.id, 'hello');
      answers.push((await request(http).get(SEEKER_BASE)).body);
      answers.push((await messagesOf(SEEKER_BASE, conv.body.conversation.id)).body);
      as(PROVIDER_USER);
      answers.push((await open(PROVIDER_BASE, id)).body);
      answers.push((await request(http).get(PROVIDER_BASE)).body);
      answers.push((await messagesOf(PROVIDER_BASE, conv.body.conversation.id)).body);
      const wire = JSON.stringify(answers);
      for (const secret of [SEEKER_PHONE, PROVIDER_PHONE, '@r12com.test', 'Fixture']) {
        expect(wire).not.toContain(secret);
      }
    });
  });

  // ── sending the same message again (R12 recovery) ─────────────────────────
  //
  // A reply can be lost after the server stored the message. The client then
  // sends the same logical message again with the same idempotency key. One
  // message must exist, and nothing about the key may widen access.
  describe('a retried send', () => {
    const KEY = 'r12-key-0000000000000001';

    it('stores one message when the same send is repeated, and says it was a replay', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      const first = await sendKeyed(SEEKER_BASE, conv, 'Is ten still good?', KEY);
      const again = await sendKeyed(SEEKER_BASE, conv, 'Is ten still good?', KEY);
      expect(first.status).toBe(201);
      expect(first.body.replayed).toBeUndefined();
      expect(again.status).toBe(201);
      expect(again.body.replayed).toBe(true);
      expect(again.body.message.id).toBe(first.body.message.id);
      const rows = await storedMessages(conv);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ senderUserId: SEEKER, idempotencyKey: KEY });
      // The other side sees one contribution.
      as(PROVIDER_USER);
      const seen = await messagesOf(PROVIDER_BASE, conv);
      expect(seen.body.items).toHaveLength(1);
    });

    it('eight simultaneous copies of one send store one message', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      const answers = await Promise.all(
        Array.from({ length: 8 }, () => sendKeyed(SEEKER_BASE, conv, 'Once only', KEY, SEEKER)),
      );
      expect(answers.map((r) => r.status)).toEqual(Array(8).fill(201));
      expect(new Set(answers.map((r) => r.body.message.id)).size).toBe(1);
      expect(answers.filter((r) => r.body.replayed !== true)).toHaveLength(1);
      expect(await storedMessages(conv)).toHaveLength(1);
    });

    it('refuses the same key with a different message and keeps the first', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      await sendKeyed(SEEKER_BASE, conv, 'The original', KEY);
      const other = await sendKeyed(SEEKER_BASE, conv, 'Something else', KEY);
      expect(other.status).toBe(409);
      expect(other.body.error?.details?.reason).toBe('IDEMPOTENCY_KEY_REUSED');
      const rows = await storedMessages(conv);
      expect(rows.map((r: any) => r.body)).toEqual(['The original']);
    });

    it('two intended messages with the same text stay two messages', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      await sendKeyed(SEEKER_BASE, conv, 'ok', 'r12-key-0000000000000010');
      await sendKeyed(SEEKER_BASE, conv, 'ok', 'r12-key-0000000000000011');
      await send(SEEKER_BASE, conv, 'ok');
      await send(SEEKER_BASE, conv, 'ok');
      expect((await storedMessages(conv)).map((r: any) => r.body)).toEqual([
        'ok',
        'ok',
        'ok',
        'ok',
      ]);
    });

    it('a key belongs to its sender: the other participant using it gets nothing of the first', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      await sendKeyed(SEEKER_BASE, conv, 'From the seeker', KEY);
      as(PROVIDER_USER);
      const providers = await sendKeyed(PROVIDER_BASE, conv, 'From the provider', KEY);
      expect(providers.status).toBe(201);
      expect(providers.body.replayed).toBeUndefined();
      expect(providers.body.message.body).toBe('From the provider');
      expect((await storedMessages(conv)).map((r: any) => [r.senderUserId, r.body])).toEqual([
        [SEEKER, 'From the seeker'],
        [PROVIDER_USER, 'From the provider'],
      ]);
    });

    it('a key opens no door: a stranger with a known key is not found', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      await sendKeyed(SEEKER_BASE, conv, 'Private', KEY);
      as(OTHER_SEEKER);
      const res = await sendKeyed(SEEKER_BASE, conv, 'Private', KEY);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('Private');
      // The provider route with a fresh key does not let the seeker in either.
      as(SEEKER);
      const sideways = await sendKeyed(PROVIDER_BASE, conv, 'x', 'r12-key-0000000000000099');
      expect(sideways.status).toBe(404);
      expect(await storedMessages(conv)).toHaveLength(1);
    });

    it.each([
      ['too short', 'short'],
      ['unsafe characters', 'r12-key-0000000000/../'],
      ['too long', 'k'.repeat(129)],
    ])('refuses a malformed key (%s)', async (_label, key) => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      expect((await sendKeyed(SEEKER_BASE, conv, 'hi', key)).status).toBe(400);
      expect(await storedMessages(conv)).toHaveLength(0);
    });

    it('a failure while storing is reported, not turned into a replay', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION r12_fail_message() RETURNS trigger AS $$
        BEGIN
          IF NEW."conversationId" = '${conv}' THEN
            RAISE EXCEPTION 'r12 injected message failure';
          END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER r12_fail_message BEFORE INSERT ON "Message"
        FOR EACH ROW EXECUTE FUNCTION r12_fail_message()`);
      const res = await sendKeyed(SEEKER_BASE, conv, 'Will fail', KEY);
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('r12 injected');
      expect(await storedMessages(conv)).toHaveLength(0);
      await prisma.$executeRawUnsafe(`DROP TRIGGER r12_fail_message ON "Message"`);
      // The same send, retried once storage works, is stored once.
      const retried = await sendKeyed(SEEKER_BASE, conv, 'Will fail', KEY);
      expect(retried.status).toBe(201);
      expect(retried.body.replayed).toBeUndefined();
      expect(await storedMessages(conv)).toHaveLength(1);
    });
  });

  // ── the realtime room (R12) ───────────────────────────────────────────────
  //
  // REALTIME_SOCKET_IO is off by default and in every deployed configuration;
  // only CI's production-image boot turns it on. When on, joining a
  // conversation room must give no more than REST gives: the real gate, the
  // real capability service (default flags) and the real gateway handler,
  // against real rows. Mutations never go through the socket.
  describe('the realtime conversation room', () => {
    let gate: any;
    let gateway: any;

    beforeAll(() => {
      const prismaSvc = { client: prisma, isReady: () => true };
      const {
        ConversationParticipantRepository,
      } = require('../../src/infrastructure/persistence/conversations/conversation-participant.repository');
      const {
        ProviderProfileRepository,
      } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
      const {
        ProviderCapabilityService,
      } = require('../../src/modules/provider/capability/provider-capability.service');
      const {
        ConversationParticipantGate,
      } = require('../../src/modules/realtime/conversation-participant.gate');
      const { RealtimeGateway } = require('../../src/modules/realtime/realtime.gateway');
      const { SecurityEventsBus } = require('../../src/shared/security-events/security-events.bus');
      // The environment's defaults: VERIFICATION_ENFORCED and
      // WORK_ACCESS_ENFORCED are off (env.schema.ts).
      const config = { get: () => undefined };
      gate = new ConversationParticipantGate(
        new ProviderProfileRepository(prismaSvc),
        new ConversationParticipantRepository(prismaSvc),
        { findByIdWithUserStanding: async () => ({ revokedAt: null, currentJti: 'jti' }) },
        new ProviderCapabilityService(prismaSvc, config),
      );
      gateway = new RealtimeGateway(
        {} as never,
        { get: () => true } as never,
        gate,
        { assertSessionActive: async () => undefined } as never,
        {} as never,
        new SecurityEventsBus(),
      );
    });

    const socketOf = (userId: string) => {
      const joined: string[] = [];
      return {
        joined,
        data: { userId, sessionId: `${userId}-session`, joinedRooms: [] as string[] },
        join: async (room: string) => {
          joined.push(room);
        },
        disconnect: () => undefined,
      };
    };
    const subscribe = async (userId: string, conversationId: string) => {
      const sock = socketOf(userId);
      const res = await gateway.handleSubscribeConversation(sock, { conversationId });
      return { res, sock };
    };
    const setStanding = (standing: 'GOOD' | 'SUSPENDED') =>
      prisma.providerProfile.update({ where: { id: PROVIDER }, data: { standingState: standing } });
    const setLegacyStatus = (status: 'ACTIVE' | 'SUSPENDED') =>
      prisma.providerProfile.update({ where: { id: PROVIDER }, data: { status } });

    afterEach(async () => {
      await setStanding('GOOD');
      await setLegacyStatus('ACTIVE');
    });

    it('both participants of a booking may share its room', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      const seeker = await subscribe(SEEKER, conv);
      const provider = await subscribe(PROVIDER_USER, conv);
      expect(seeker.res).toEqual({ ok: true, room: `conversation:${conv}` });
      expect(provider.res).toEqual({ ok: true, room: `conversation:${conv}` });
      expect(provider.sock.joined).toContain(`provider-conversations:${PROVIDER}`);
      expect(seeker.sock.joined).not.toContain(`provider-conversations:${PROVIDER}`);
    });

    it('a stranger may not join, whoever they are', async () => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      for (const user of [OTHER_SEEKER, OTHER_PROVIDER_USER]) {
        const { res, sock } = await subscribe(user, conv);
        expect(res).toEqual({ ok: false, code: 'FORBIDDEN' });
        expect(sock.joined).toEqual([]);
      }
    });

    it.each([
      ['a suspended standing', () => setStanding('SUSPENDED')],
      ['a suspended provider status', () => setLegacyStatus('SUSPENDED')],
    ])('after %s the provider may not join, exactly as REST refuses', async (_label, suspend) => {
      const id = await booking();
      const conv = (await open(SEEKER_BASE, id)).body.conversation.id;
      // Joined before access was lost: allowed.
      expect((await subscribe(PROVIDER_USER, conv)).res.ok).toBe(true);
      await suspend();
      // Joining (or re-joining after a reconnect) after the loss: refused.
      const after = await subscribe(PROVIDER_USER, conv);
      expect(after.res).toEqual({ ok: false, code: 'FORBIDDEN' });
      expect(after.sock.joined).toEqual([]);
      // The seeker of the same booking is unaffected.
      expect((await subscribe(SEEKER, conv)).res.ok).toBe(true);
    });

    it('a suspended provider who is also a customer still receives their own customer conversations', async () => {
      const asCustomer = await booking('SCHEDULED', {
        seeker: PROVIDER_USER,
        provider: OTHER_PROVIDER,
      });
      as(PROVIDER_USER);
      const conv = (await open(SEEKER_BASE, asCustomer)).body.conversation.id;
      await setStanding('SUSPENDED');
      const { res, sock } = await subscribe(PROVIDER_USER, conv);
      expect(res).toEqual({ ok: true, room: `conversation:${conv}` });
      expect(sock.joined.filter((r) => r.startsWith('provider-conversations:'))).toEqual([]);
    });
  });
});
