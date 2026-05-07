import type {
  Booking,
  Conversation,
  ConversationParticipant,
  Message,
  ProviderProfile,
} from '@homeservicemarketplace/database';

import type { BookingRepository } from '../../infrastructure/persistence/bookings/booking.repository';
import type { ProviderProfileRepository } from '../../infrastructure/persistence/bids/provider-profile.repository';
import type {
  ConversationRepository,
  ConversationWithRelations,
} from '../../infrastructure/persistence/conversations/conversation.repository';
import type { ConversationParticipantRepository } from '../../infrastructure/persistence/conversations/conversation-participant.repository';
import type { MessageRepository } from '../../infrastructure/persistence/conversations/message.repository';
import type { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
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
    serviceAreaCountry: null,
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: null,
    availability: 'OFFLINE',
    status: 'ACTIVE',
    reviewNotes: null,
    createdAt: new Date('2026-04-29T00:00:00.000Z'),
    updatedAt: new Date('2026-04-29T00:00:00.000Z'),
    deletedAt: null,
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

function makeConvWithRels(
  over: Partial<Conversation> = {},
  messages: Message[] = [],
): ConversationWithRelations {
  return {
    ...makeConversation(over),
    participants: [
      { ...makeParticipant({ id: 'p-self', userId: 'user-1', role: 'SEEKER' }), provider: null },
      {
        ...makeParticipant({
          id: 'p-prov',
          userId: null,
          providerProfileId: 'pp-omar',
          role: 'PROVIDER',
        }),
        provider: makeProvider(),
      },
    ],
    messages,
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
  );
}

describe('ConversationsService', () => {
  // ─── list ──────────────────────────────────────────────────────────────
  describe('list', () => {
    it('maps conversations with the other participants provider summary + unread count', async () => {
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
      // No userId / participants / raw fields leak.
      expect(dto).not.toHaveProperty('participants');
      expect(dto.otherParticipant).not.toHaveProperty('userId');
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
      // Must NOT create a new row when one already exists.
      expect(m.conversations.create).not.toHaveBeenCalled();
      expect(m.participants.create).not.toHaveBeenCalled();
    });

    it('creates conversation + 2 participants in a transaction when none exists', async () => {
      const m = makeMocks();
      const out = await makeService(m).getOrCreateForBooking('user-1', 'bk-1');
      expect(out.conversation.id).toBe('conv-1');
      // The seeker participant uses the session userId, NOT the wire.
      expect(m.participants.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          providerProfileId: null,
          role: 'SEEKER',
        }),
        undefined,
      );
      // The provider participant has a null userId (Provider app out
      // of scope) but a real providerProfileId.
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
      // Critical: no conversation / participants are written when
      // ownership fails.
      expect(m.conversations.create).not.toHaveBeenCalled();
      expect(m.participants.create).not.toHaveBeenCalled();
    });

    it('seeker-initiated: provider participant userId tracks the provider profiles userId (slice 5.5)', async () => {
      // Booking returns a provider that IS linked to a user account.
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
      // The provider participant now carries userId: 'user-prov-2'
      // so /v1/me/conversations on the provider side surfaces it.
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
      // Seeker side returns nothing for this user.
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
      // Both participants are linked to the right userIds — seeker
      // gets the booking's seekerUserId, provider gets the calling
      // userId.
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
      // Repository returned newest-first; service reversed to oldest-first.
      expect(out.items.map((x) => x.id)).toEqual(['m-1', 'm-2']);
      // sentByMe set only for the seeker's own message.
      expect(out.items[0].sentByMe).toBe(false);
      expect(out.items[1].sentByMe).toBe(true);
      // No raw senderUserId leak.
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
    });

    it('persists the message with senderUserId from the session, NOT the wire', async () => {
      const m = makeMocks();
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
      // Conversation.updatedAt is bumped so the conversations list
      // reflects the new activity.
      expect(m.conversations.bumpUpdatedAt).toHaveBeenCalledWith('conv-1', undefined);
      expect(out.message.sentByMe).toBe(true);
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
