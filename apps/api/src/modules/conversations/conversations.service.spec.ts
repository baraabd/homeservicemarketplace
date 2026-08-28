import type {
  Booking,
  Conversation,
  ConversationParticipant,
  Message,
  ProviderProfile,
} from '@homeservicemarketplace/database';
import { Prisma } from '@homeservicemarketplace/database';

import type { BookingRepository } from '../../infrastructure/persistence/bookings/booking.repository';
import type { ProviderProfileRepository } from '../../infrastructure/persistence/bids/provider-profile.repository';
import type {
  ConversationRepository,
  ConversationWithRelations,
} from '../../infrastructure/persistence/conversations/conversation.repository';
import type { ConversationParticipantRepository } from '../../infrastructure/persistence/conversations/conversation-participant.repository';
import type { MessageRepository } from '../../infrastructure/persistence/conversations/message.repository';
import type { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import type { RealtimeEventsPublisher } from '../realtime/realtime-events.publisher';
import { AppError } from '../../shared/errors/app-error';
import { ConversationsService } from './conversations.service';

function makeTx(): TransactionRunner {
  return {
    run: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
  } as unknown as TransactionRunner;
}

function makeProvider(over: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'pp-omar',
    userId: null,
    displayName: 'Omar Al-Khalid',
    initials: 'OK',
    avatarUrl: null,
    ratingAvg: 4.9,
    reviewCount: 312,
    completedJobs: 540,
    verified: true,
    topPro: true,
    bio: null,
    headline: null,
    phoneNumber: null,
    serviceAreaCity: null,
    serviceAreaCityKey: null,
    // Sprint 7 — lifecycle axes; null until the backfill runs.
    onboardingState: null,
    verificationState: null,
    standingState: null,
    subscriptionTier: null,
    lifecycleSource: null,
    lifecycleSyncedAt: null,
    // Sprint 8 — onboarding journey fields; null until the wizard runs.
    providerType: null,
    legalBusinessName: null,
    phoneVerifiedAt: null,
    profileImageUrl: null,
    yearsOfExperience: null,
    professionSince: null,
    transportMode: null,
    // Sprint 9B.18 — the full set alongside the primary. Empty here: this
    // fixture predates the concept and asserts nothing about transport.
    // Sprint 9B.19 — the normalised country code beside the display name.
    serviceAreaCountryCode: null,
    transportModes: [],
    primaryServiceCategoryId: null,
    workshopAddressLine: null,
    workshopLat: null,
    workshopLng: null,
    additionalInformation: null,
    acceptedConsentVersion: null,
    consentAcceptedAt: null,
    serviceAreaCountry: null,
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: null,
    availability: 'OFFLINE',
    status: 'ACTIVE',
    reviewNotes: null,
    // Phase 4 onboarding lifecycle columns. An ACTIVE fixture is a provider
    // that already went through submit → approve, so it carries both stamps.
    submittedForReviewAt: new Date('2026-04-28T00:00:00.000Z'),
    reviewedAt: new Date('2026-04-28T00:00:00.000Z'),
    reviewedByUserId: null,
    rejectionReason: null,
    createdAt: new Date('2026-04-29T00:00:00.000Z'),
    updatedAt: new Date('2026-04-29T00:00:00.000Z'),
    deletedAt: null,
    ...over,
  };
}

function makeSeekerUser(over: Partial<{ id: string; firstName: string; lastName: string }> = {}): {
  id: string;
  firstName: string;
  lastName: string;
} {
  return {
    id: 'user-1',
    firstName: 'Layla',
    lastName: 'Mansour',
    ...over,
  };
}

function makeBooking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'bk-1',
    requestId: 'req-1',
    bidId: 'bid-1',
    seekerUserId: 'user-1',
    providerId: 'pp-omar',
    status: 'SCHEDULED',
    scheduledAt: null,
    priceAmount: 35,
    currency: 'USD',
    createdAt: new Date('2026-04-29T01:00:00.000Z'),
    updatedAt: new Date('2026-04-29T01:00:00.000Z'),
    deletedAt: null,
    ...over,
  } as Booking;
}

function makeConversation(over: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    requestId: 'req-1',
    bookingId: 'bk-1',
    createdAt: new Date('2026-04-29T02:00:00.000Z'),
    updatedAt: new Date('2026-04-29T02:00:00.000Z'),
    deletedAt: null,
    ...over,
  } as Conversation;
}

function makeParticipant(over: Partial<ConversationParticipant> = {}): ConversationParticipant {
  return {
    id: 'pcp-self',
    conversationId: 'conv-1',
    userId: 'user-1',
    providerProfileId: null,
    role: 'SEEKER',
    lastReadAt: null,
    createdAt: new Date('2026-04-29T02:00:00.000Z'),
    ...over,
  } as ConversationParticipant;
}

// Default fixture: a SEEKER and PROVIDER both participate, the
// provider has a linked userId (slice 5.5 onwards), and the seeker's
// User row is loaded onto the participant for the role-aware summary.
function makeConvWithRels(
  over: Partial<Conversation> = {},
  messages: Message[] = [],
): ConversationWithRelations {
  return {
    ...makeConversation(over),
    participants: [
      {
        ...makeParticipant({ id: 'p-self', userId: 'user-1', role: 'SEEKER' }),
        provider: null,
        user: makeSeekerUser(),
      },
      {
        ...makeParticipant({
          id: 'p-prov',
          userId: 'user-prov-2',
          providerProfileId: 'pp-omar',
          role: 'PROVIDER',
        }),
        provider: makeProvider({ userId: 'user-prov-2' }),
        user: { id: 'user-prov-2', firstName: 'Omar', lastName: 'Al-Khalid' },
      },
    ],
    messages,
  } as unknown as ConversationWithRelations;
}

// Variant where the provider participant has NO linked userId — used
// for the legacy / unbacked branch of the toSummary mapper.
function makeConvWithUnlinkedProvider(): ConversationWithRelations {
  return {
    ...makeConversation(),
    participants: [
      {
        ...makeParticipant({ id: 'p-self', userId: 'user-1', role: 'SEEKER' }),
        provider: null,
        user: makeSeekerUser(),
      },
      {
        ...makeParticipant({
          id: 'p-prov',
          userId: null,
          providerProfileId: 'pp-omar',
          role: 'PROVIDER',
        }),
        provider: makeProvider(),
        user: null,
      },
    ],
    messages: [],
  } as unknown as ConversationWithRelations;
}

interface Mocks {
  conversations: {
    create: jest.Mock;
    findOwnedByUser: jest.Mock;
    findExistingForBooking: jest.Mock;
    listForUser: jest.Mock;
    bumpUpdatedAt: jest.Mock;
  };
  participants: {
    create: jest.Mock;
    findByConversationAndUser: jest.Mock;
    setLastReadAt: jest.Mock;
  };
  messages: {
    create: jest.Mock;
    listForConversation: jest.Mock;
    countUnreadForParticipant: jest.Mock;
  };
  bookings: {
    findOwned: jest.Mock;
    findOwnedByProvider: jest.Mock;
  };
  providers: {
    findByUserId: jest.Mock;
  };
  realtime: {
    publishToRoom: jest.Mock;
    publishFor: jest.Mock;
    publish: jest.Mock;
  };
}

type MocksOverride = { [K in keyof Mocks]?: Partial<Mocks[K]> };

function makeMocks(over: MocksOverride = {}): Mocks {
  return {
    conversations: {
      create: jest.fn().mockResolvedValue(makeConversation()),
      findOwnedByUser: jest.fn().mockResolvedValue(makeConvWithRels()),
      findExistingForBooking: jest.fn().mockResolvedValue(null),
      listForUser: jest.fn().mockResolvedValue([]),
      bumpUpdatedAt: jest.fn().mockResolvedValue(makeConversation()),
      ...(over.conversations ?? {}),
    },
    participants: {
      create: jest.fn().mockResolvedValue(makeParticipant()),
      findByConversationAndUser: jest.fn().mockResolvedValue(makeParticipant()),
      setLastReadAt: jest.fn().mockResolvedValue(makeParticipant()),
      ...(over.participants ?? {}),
    },
    messages: {
      create: jest.fn().mockResolvedValue({
        id: 'msg-1',
        conversationId: 'conv-1',
        senderUserId: 'user-1',
        senderRole: 'SEEKER',
        body: 'hi',
        createdAt: new Date('2026-04-29T03:00:00.000Z'),
        deletedAt: null,
      } as unknown as Message),
      listForConversation: jest.fn().mockResolvedValue([]),
      countUnreadForParticipant: jest.fn().mockResolvedValue(0),
      ...(over.messages ?? {}),
    },
    bookings: {
      findOwned: jest.fn().mockResolvedValue({
        ...makeBooking(),
        provider: makeProvider(),
      }),
      findOwnedByProvider: jest.fn().mockResolvedValue(null),
      ...(over.bookings ?? {}),
    },
    providers: {
      findByUserId: jest.fn().mockResolvedValue(null),
      ...(over.providers ?? {}),
    },
    realtime: {
      publishToRoom: jest.fn(),
      publishFor: jest.fn(),
      publish: jest.fn(),
      ...(over.realtime ?? {}),
    },
  };
}

function makeService(m: Mocks) {
  return new ConversationsService(
    m.conversations as unknown as ConversationRepository,
    m.participants as unknown as ConversationParticipantRepository,
    m.messages as unknown as MessageRepository,
    m.bookings as unknown as BookingRepository,
    m.providers as unknown as ProviderProfileRepository,
    makeTx(),
    m.realtime as unknown as RealtimeEventsPublisher,
  );
}

describe('ConversationsService', () => {
  // ─── list ──────────────────────────────────────────────────────────────
  describe('list', () => {
    it('seeker viewer sees the provider profile as the other participant', async () => {
      const m = makeMocks({
        conversations: { listForUser: jest.fn().mockResolvedValue([makeConvWithRels()]) },
        messages: { countUnreadForParticipant: jest.fn().mockResolvedValue(2) },
      });
      const out = await makeService(m).list('user-1');
      expect(out.items).toHaveLength(1);
      const dto = out.items[0];
      expect(dto.otherParticipant.displayName).toBe('Omar Al-Khalid');
      expect(dto.otherParticipant.initials).toBe('OK');
      expect(dto.unreadCount).toBe(2);
      expect(dto).not.toHaveProperty('participants');
      expect(dto.otherParticipant).not.toHaveProperty('userId');
    });

    it('provider viewer sees a seeker label (first name + last initial), not a provider placeholder', async () => {
      const m = makeMocks({
        conversations: { listForUser: jest.fn().mockResolvedValue([makeConvWithRels()]) },
      });
      const out = await makeService(m).list('user-prov-2');
      expect(out.items).toHaveLength(1);
      const dto = out.items[0];
      // Seeker is Layla Mansour — provider sees a privacy-friendly
      // "Layla M." label, NOT the legacy "Provider" placeholder and
      // NOT the seeker's full last name.
      expect(dto.otherParticipant.displayName).toBe('Layla M.');
      expect(dto.otherParticipant.initials).toBe('LM');
      expect(dto.otherParticipant.avatarUrl).toBeNull();
      // The seeker user's id and email are never on the wire.
      expect(dto.otherParticipant).not.toHaveProperty('userId');
      expect(dto.otherParticipant).not.toHaveProperty('email');
    });

    it('legacy unlinked provider participant still maps to provider profile for the seeker', async () => {
      const m = makeMocks({
        conversations: {
          listForUser: jest.fn().mockResolvedValue([makeConvWithUnlinkedProvider()]),
        },
      });
      const out = await makeService(m).list('user-1');
      const dto = out.items[0];
      expect(dto.otherParticipant.displayName).toBe('Omar Al-Khalid');
    });

    it('empty list returns 200-shape with empty items', async () => {
      const m = makeMocks();
      const out = await makeService(m).list('user-1');
      expect(out).toEqual({ items: [], nextCursor: null });
    });
  });

  // ─── getOrCreateForBooking ─────────────────────────────────────────────
  describe('getOrCreateForBooking', () => {
    it('returns the existing conversation when one already exists (idempotent)', async () => {
      const existing = makeConvWithRels();
      const m = makeMocks({
        conversations: { findExistingForBooking: jest.fn().mockResolvedValue(existing) },
      });
      const out = await makeService(m).getOrCreateForBooking('user-1', 'bk-1');
      expect(out.conversation.id).toBe('conv-1');
      expect(m.conversations.create).not.toHaveBeenCalled();
      expect(m.participants.create).not.toHaveBeenCalled();
    });

    it('creates conversation + 2 participants in a transaction when none exists', async () => {
      const m = makeMocks();
      const out = await makeService(m).getOrCreateForBooking('user-1', 'bk-1');
      expect(out.conversation.id).toBe('conv-1');
      expect(m.participants.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          providerProfileId: null,
          role: 'SEEKER',
        }),
        undefined,
      );
      // Default provider fixture has no linked userId — null is OK.
      expect(m.participants.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          providerProfileId: 'pp-omar',
          role: 'PROVIDER',
        }),
        undefined,
      );
    });

    it('rejects with NOT_FOUND on a foreign booking (no leak)', async () => {
      const m = makeMocks({
        conversations: { findExistingForBooking: jest.fn().mockResolvedValue(null) },
        bookings: {
          findOwned: jest.fn().mockResolvedValue(null),
          findOwnedByProvider: jest.fn().mockResolvedValue(null),
        },
        providers: { findByUserId: jest.fn().mockResolvedValue(null) },
      });
      await expect(
        makeService(m).getOrCreateForBooking('user-attacker', 'bk-victim'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(m.conversations.create).not.toHaveBeenCalled();
      expect(m.participants.create).not.toHaveBeenCalled();
    });

    it('seeker-initiated: provider participant userId tracks the provider profiles userId (slice 5.5)', async () => {
      const linkedProvider = makeProvider({ id: 'pp-linked', userId: 'user-prov-2' });
      const m = makeMocks({
        bookings: {
          findOwned: jest.fn().mockResolvedValue({
            ...makeBooking({ providerId: 'pp-linked' }),
            provider: linkedProvider,
          }),
        },
      });
      await makeService(m).getOrCreateForBooking('user-1', 'bk-1');
      expect(m.participants.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-prov-2',
          providerProfileId: 'pp-linked',
          role: 'PROVIDER',
        }),
        undefined,
      );
    });

    it('provider-initiated: resolves the booking via providerProfile and creates participants', async () => {
      const linkedProvider = makeProvider({ id: 'pp-prov', userId: 'user-prov-2' });
      const m = makeMocks({
        bookings: {
          findOwned: jest.fn().mockResolvedValue(null),
          findOwnedByProvider: jest.fn().mockResolvedValue({
            ...makeBooking({ providerId: 'pp-prov', seekerUserId: 'user-1' }),
            provider: linkedProvider,
          }),
        },
        providers: {
          findByUserId: jest.fn().mockResolvedValue({ id: 'pp-prov', userId: 'user-prov-2' }),
        },
      });
      const out = await makeService(m).getOrCreateForBooking('user-prov-2', 'bk-1');
      expect(out.conversation.id).toBe('conv-1');
      expect(m.bookings.findOwnedByProvider).toHaveBeenCalledWith('bk-1', 'pp-prov', undefined);
      expect(m.participants.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', role: 'SEEKER' }),
        undefined,
      );
      expect(m.participants.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-prov-2',
          providerProfileId: 'pp-prov',
          role: 'PROVIDER',
        }),
        undefined,
      );
    });

    // Sprint 7.3 — DB-level race protection. Two concurrent
    // getOrCreate requests pass the fast-path existence check; the
    // loser's INSERT fires P2002 on the partial unique index and the
    // service re-fetches the winner instead of bubbling a Prisma
    // error to the client.
    it('resolves the concurrent-create race by re-fetching the winner on P2002', async () => {
      const winner = makeConvWithRels();
      // First call: existence check finds nothing (we're racing).
      // Second call: post-conflict re-fetch finds the winner.
      const findExisting = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(winner);

      // The conversation.create raises Prisma's unique-constraint
      // error tagged with the partial index name from the migration.
      const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'Conversation_bookingId_live_unique' },
      });
      const createConv = jest.fn().mockRejectedValue(conflict);

      const m = makeMocks({
        conversations: {
          findExistingForBooking: findExisting,
          create: createConv,
        },
      });

      const out = await makeService(m).getOrCreateForBooking('user-1', 'bk-1');
      expect(out.conversation.id).toBe('conv-1');
      // Loser must NOT call participants.create on the second pass —
      // the create call raised before participants were inserted.
      // We also expect the existence check to have run twice (fast
      // path + post-conflict re-fetch).
      expect(findExisting).toHaveBeenCalledTimes(2);
    });

    it('falls back to a stable CONFLICT when the post-race re-fetch returns nothing', async () => {
      const findExisting = jest.fn().mockResolvedValue(null);
      const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: 'Conversation_bookingId_live_unique' },
      });
      const m = makeMocks({
        conversations: {
          findExistingForBooking: findExisting,
          create: jest.fn().mockRejectedValue(conflict),
        },
      });
      await expect(makeService(m).getOrCreateForBooking('user-1', 'bk-1')).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
    });
  });

  // ─── listMessages ──────────────────────────────────────────────────────
  describe('listMessages', () => {
    it('rejects with NOT_FOUND on a non-participant conversation (no message leak)', async () => {
      const m = makeMocks({
        participants: { findByConversationAndUser: jest.fn().mockResolvedValue(null) },
      });
      await expect(
        makeService(m).listMessages('user-attacker', 'conv-victim', {}),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(m.messages.listForConversation).not.toHaveBeenCalled();
    });

    it('returns oldest-first order with sentByMe derived from session', async () => {
      const messages: Message[] = [
        {
          id: 'm-2',
          conversationId: 'conv-1',
          senderUserId: 'user-1',
          senderRole: 'SEEKER',
          body: 'hello',
          createdAt: new Date('2026-04-29T03:00:00.000Z'),
          deletedAt: null,
        } as unknown as Message,
        {
          id: 'm-1',
          conversationId: 'conv-1',
          senderUserId: null,
          senderRole: 'PROVIDER',
          body: 'welcome',
          createdAt: new Date('2026-04-29T02:30:00.000Z'),
          deletedAt: null,
        } as unknown as Message,
      ];
      const m = makeMocks({
        messages: { listForConversation: jest.fn().mockResolvedValue(messages) },
      });
      const out = await makeService(m).listMessages('user-1', 'conv-1', {});
      expect(out.items.map((x) => x.id)).toEqual(['m-1', 'm-2']);
      expect(out.items[0].sentByMe).toBe(false);
      expect(out.items[1].sentByMe).toBe(true);
      expect(out.items[0]).not.toHaveProperty('senderUserId');
    });
  });

  // ─── sendMessage ───────────────────────────────────────────────────────
  describe('sendMessage', () => {
    it('rejects with NOT_FOUND when the user is not a participant', async () => {
      const m = makeMocks({
        participants: { findByConversationAndUser: jest.fn().mockResolvedValue(null) },
      });
      await expect(
        makeService(m).sendMessage('user-attacker', 'conv-victim', 'hi'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(m.messages.create).not.toHaveBeenCalled();
      expect(m.conversations.bumpUpdatedAt).not.toHaveBeenCalled();
      // No realtime fan-out on the rejection path.
      expect(m.realtime.publishToRoom).not.toHaveBeenCalled();
    });

    it('seeker send: persists with senderRole=SEEKER derived from participant + publishes message.created', async () => {
      const m = makeMocks({
        participants: {
          findByConversationAndUser: jest
            .fn()
            .mockResolvedValue(makeParticipant({ userId: 'user-1', role: 'SEEKER' })),
        },
        messages: {
          create: jest.fn().mockResolvedValue({
            id: 'msg-1',
            conversationId: 'conv-1',
            senderUserId: 'user-1',
            senderRole: 'SEEKER',
            body: 'hi from seeker',
            createdAt: new Date('2026-04-29T03:00:00.000Z'),
            deletedAt: null,
          } as unknown as Message),
        },
      });
      const out = await makeService(m).sendMessage('user-1', 'conv-1', 'hi from seeker');
      expect(m.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          senderUserId: 'user-1',
          senderRole: 'SEEKER',
          body: 'hi from seeker',
        }),
        undefined,
      );
      expect(m.conversations.bumpUpdatedAt).toHaveBeenCalledWith('conv-1', undefined);
      expect(out.message.sentByMe).toBe(true);
      // Realtime fan-out targets the conversation room, not a user
      // room (so both seeker + provider sockets receive it).
      expect(m.realtime.publishToRoom).toHaveBeenCalledWith(
        'conversation:conv-1',
        'message.created',
        expect.objectContaining({
          conversationId: 'conv-1',
          message: expect.objectContaining({
            id: 'msg-1',
            senderRole: 'SEEKER',
            body: 'hi from seeker',
          }),
        }),
      );
      // Broadcast payload MUST NOT leak senderUserId (PII boundary).
      const [, , payload] = m.realtime.publishToRoom.mock.calls[0];
      expect(payload.message).not.toHaveProperty('senderUserId');
      // Broadcast also drops sentByMe — receivers derive it client-side.
      expect(payload.message).not.toHaveProperty('sentByMe');
    });

    it('provider send: persists with senderRole=PROVIDER (NOT hardcoded SEEKER)', async () => {
      const providerParticipant = makeParticipant({
        id: 'p-prov',
        userId: 'user-prov-2',
        providerProfileId: 'pp-omar',
        role: 'PROVIDER',
      });
      const m = makeMocks({
        participants: {
          findByConversationAndUser: jest.fn().mockResolvedValue(providerParticipant),
        },
        messages: {
          create: jest.fn().mockResolvedValue({
            id: 'msg-prov-1',
            conversationId: 'conv-1',
            senderUserId: 'user-prov-2',
            senderRole: 'PROVIDER',
            body: 'on my way',
            createdAt: new Date('2026-04-29T03:30:00.000Z'),
            deletedAt: null,
          } as unknown as Message),
        },
      });
      const out = await makeService(m).sendMessage('user-prov-2', 'conv-1', 'on my way');
      expect(m.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          senderUserId: 'user-prov-2',
          senderRole: 'PROVIDER',
          body: 'on my way',
        }),
        undefined,
      );
      expect(out.message.sentByMe).toBe(true);
      expect(out.message.senderRole).toBe('PROVIDER');
      // Realtime envelope reflects the provider role.
      expect(m.realtime.publishToRoom).toHaveBeenCalledWith(
        'conversation:conv-1',
        'message.created',
        expect.objectContaining({
          message: expect.objectContaining({ senderRole: 'PROVIDER' }),
        }),
      );
    });
  });

  // ─── markRead ──────────────────────────────────────────────────────────
  describe('markRead', () => {
    it('sets the participants lastReadAt and returns ISO timestamp', async () => {
      const m = makeMocks();
      const out = await makeService(m).markRead('user-1', 'conv-1');
      expect(m.participants.setLastReadAt).toHaveBeenCalled();
      expect(typeof out.lastReadAt).toBe('string');
      expect(() => new Date(out.lastReadAt).toISOString()).not.toThrow();
    });

    it('rejects with NOT_FOUND when the user is not a participant', async () => {
      const m = makeMocks({
        participants: { findByConversationAndUser: jest.fn().mockResolvedValue(null) },
      });
      await expect(makeService(m).markRead('user-attacker', 'conv-victim')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(m.participants.setLastReadAt).not.toHaveBeenCalled();
    });
  });

  // ─── error contract ────────────────────────────────────────────────────
  it('throws AppError on every error path (no raw Prisma errors leak)', async () => {
    const m = makeMocks({
      participants: { findByConversationAndUser: jest.fn().mockResolvedValue(null) },
      conversations: { findExistingForBooking: jest.fn().mockResolvedValue(null) },
      bookings: { findOwned: jest.fn().mockResolvedValue(null) },
    });
    const svc = makeService(m);
    await Promise.all([
      expect(svc.getOrCreateForBooking('u', 'b')).rejects.toBeInstanceOf(AppError),
      expect(svc.listMessages('u', 'c', {})).rejects.toBeInstanceOf(AppError),
      expect(svc.sendMessage('u', 'c', 'x')).rejects.toBeInstanceOf(AppError),
      expect(svc.markRead('u', 'c')).rejects.toBeInstanceOf(AppError),
    ]);
  });
});
