import { Injectable, Logger } from '@nestjs/common';
import type {
  ConversationListResponse,
  ConversationOtherParticipant,
  ConversationSummary,
  CreateConversationResponse,
  MarkConversationReadResponse,
  MessageListResponse,
  MessageSummary,
  SendMessageResponse,
} from '@homeservicemarketplace/contracts';
import { ConversationParticipantRole, Prisma } from '@homeservicemarketplace/database';
import type {
  ConversationParticipant,
  Message,
  ProviderProfile,
} from '@homeservicemarketplace/database';

import { BookingRepository } from '../../infrastructure/persistence/bookings/booking.repository';
import { ProviderProfileRepository } from '../../infrastructure/persistence/bids/provider-profile.repository';
import {
  ConversationRepository,
  type ConversationWithRelations,
  type ParticipantUserSummary,
} from '../../infrastructure/persistence/conversations/conversation.repository';
import { ConversationParticipantRepository } from '../../infrastructure/persistence/conversations/conversation-participant.repository';
import { MessageRepository } from '../../infrastructure/persistence/conversations/message.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { RealtimeEventsPublisher } from '../realtime/realtime-events.publisher';
import { AppError } from '../../shared/errors/app-error';

const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class ConversationsService {
  private readonly log = new Logger(ConversationsService.name);

  constructor(
    private readonly conversations: ConversationRepository,
    private readonly participants: ConversationParticipantRepository,
    private readonly messages: MessageRepository,
    private readonly bookings: BookingRepository,
    private readonly providers: ProviderProfileRepository,
    private readonly tx: TransactionRunner,
    // Realtime publisher is optional at the service layer — it's a
    // post-commit overlay (chat fan-out for connected sockets) and a
    // failure here must never roll back the REST write. The publisher
    // itself already swallows its own errors; we only depend on it
    // being present at runtime via the @Global RealtimeModule.
    private readonly realtime: RealtimeEventsPublisher,
  ) {}

  // ─── list ──────────────────────────────────────────────────────────────────
  async list(userId: string): Promise<ConversationListResponse> {
    const rows = await this.conversations.listForUser({ userId, take: DEFAULT_PAGE_SIZE + 1 });
    const page = rows.slice(0, DEFAULT_PAGE_SIZE);
    const items = await Promise.all(page.map((row) => toSummary(row, userId, this.messages)));
    const nextCursor = rows.length > DEFAULT_PAGE_SIZE ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  // ─── getOrCreateForBooking ─────────────────────────────────────────────────
  // Idempotent and side-aware (slice 5.5 generalised for providers;
  // Sprint 7.3 added DB-level race protection).
  //
  // If the calling user already has a conversation tied to this booking,
  // return it. Otherwise create one in a transaction:
  //   1. resolve the booking — accept either the seeker side
  //      (booking.seekerUserId === userId) OR the provider side
  //      (booking.provider.userId === userId). Foreign bookingId → 404,
  //      identical to "doesn't exist", so an attacker cannot enumerate
  //      other users' bookings.
  //   2. create the Conversation
  //   3. create the seeker participant (userId = booking.seekerUserId,
  //      role = SEEKER)
  //   4. create the provider participant (userId = provider.userId
  //      when set, providerProfileId = booking.providerId, role = PROVIDER)
  //
  // Setting both userIds at creation means every existing list /
  // detail / send-message / mark-read query (which all match by
  // participants.userId) works for both roles without changes.
  // If any step fails, the whole thing rolls back.
  //
  // Race protection: a partial unique index (Sprint 7.3 migration)
  // enforces one live conversation per booking at the DB level. If
  // two requests pass the fast-path existence check concurrently,
  // one wins and the loser's INSERT raises P2002 — we catch that,
  // re-fetch the winning row, and return it. The flow is therefore
  // safe under concurrency without an advisory lock.
  async getOrCreateForBooking(
    userId: string,
    bookingId: string,
  ): Promise<CreateConversationResponse> {
    // Fast path: the conversation already exists.
    const existing = await this.conversations.findExistingForBooking(bookingId, userId);
    if (existing) {
      return { conversation: await toSummary(existing, userId, this.messages) };
    }

    let createdId: string;
    try {
      createdId = await this.tx.run(async (tx) => {
        // Try the seeker side first (cheap path).
        const seekerOwned = await this.bookings.findOwned(bookingId, userId, tx);
        if (seekerOwned) {
          return this.createConversationRows(
            {
              bookingId: seekerOwned.id,
              requestId: seekerOwned.requestId,
              seekerUserId: seekerOwned.seekerUserId,
              providerId: seekerOwned.providerId,
              providerUserId: seekerOwned.provider.userId ?? null,
            },
            tx,
          );
        }
        // Provider side: resolve the calling user's profile, then look
        // up the booking by providerId. If the profile is missing OR
        // the booking is not theirs, return 404 (indistinguishable
        // from "doesn't exist").
        const profile = await this.providers.findByUserId(userId, tx);
        if (profile) {
          const providerOwned = await this.bookings.findOwnedByProvider(bookingId, profile.id, tx);
          if (providerOwned) {
            return this.createConversationRows(
              {
                bookingId: providerOwned.id,
                requestId: providerOwned.requestId,
                seekerUserId: providerOwned.seekerUserId,
                providerId: providerOwned.providerId,
                providerUserId: userId,
              },
              tx,
            );
          }
        }
        throw new AppError('NOT_FOUND', 'Booking not found.', 404);
      });
    } catch (err) {
      // Race: another request beat us to inserting the conversation
      // for the same booking; the partial unique index fires P2002.
      // Re-fetch the winner — both participants were inserted by the
      // winning transaction so the requesting user is guaranteed to
      // see the row through the participant gate.
      if (isUniqueConversationBookingViolation(err)) {
        const winner = await this.conversations.findExistingForBooking(bookingId, userId);
        if (winner) {
          this.log.log({
            msg: 'conversation.getOrCreate.race_resolved',
            bookingId,
            userId,
            conversationId: winner.id,
          });
          return { conversation: await toSummary(winner, userId, this.messages) };
        }
        // Falling through to the catch is the safe outcome — somehow
        // the unique fired but the winner row was not visible. Map
        // to a stable CONFLICT so the client can retry rather than
        // surface a Prisma-shaped error.
        throw new AppError('CONFLICT', 'Conversation could not be created at this time.', 409);
      }
      throw err;
    }

    const reloaded = await this.conversations.findOwnedByUser(createdId, userId);
    if (!reloaded) {
      // Should be unreachable — we just created it — but defend
      // against a concurrent race.
      throw new AppError('INTERNAL_ERROR', 'Conversation could not be loaded.', 500);
    }
    return { conversation: await toSummary(reloaded, userId, this.messages) };
  }

  // Creates the conversation + both participants in one place so the
  // seeker- and provider-initiated branches above can share the writes
  // (and stay inside the same transaction).
  private async createConversationRows(
    args: {
      bookingId: string;
      requestId: string;
      seekerUserId: string;
      providerId: string;
      providerUserId: string | null;
    },
    tx: Parameters<TransactionRunner['run']>[0] extends (tx: infer T) => unknown ? T : never,
  ): Promise<string> {
    const conversation = await this.conversations.create(
      { bookingId: args.bookingId, requestId: args.requestId },
      tx,
    );
    await this.participants.create(
      {
        conversationId: conversation.id,
        userId: args.seekerUserId,
        providerProfileId: null,
        role: ConversationParticipantRole.SEEKER,
      },
      tx,
    );
    await this.participants.create(
      {
        conversationId: conversation.id,
        // Slice 5.5: when the provider has a userId, set it. Existing
        // (pre-5.5) rows where this is null remain queryable through
        // the providerProfileId slot but won't surface in /v1/me/
        // conversations until the Sprint 7.3 backfill migration runs.
        userId: args.providerUserId,
        providerProfileId: args.providerId,
        role: ConversationParticipantRole.PROVIDER,
      },
      tx,
    );
    return conversation.id;
  }

  // ─── listMessages ──────────────────────────────────────────────────────────
  async listMessages(
    userId: string,
    conversationId: string,
    args: { limit?: number; cursor?: string },
  ): Promise<MessageListResponse> {
    await this.assertParticipant(userId, conversationId);
    const take = Math.min(Math.max(args.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.messages.listForConversation({
      conversationId,
      take: take + 1,
      cursor: args.cursor,
    });
    const page = rows.slice(0, take);
    // Repository returns newest-first for cursor pagination; the
    // contract ships oldest-first so the renderer can append new
    // messages at the bottom.
    const oldestFirst = [...page].reverse();
    const items = oldestFirst.map((m) => toMessageSummary(m, userId));
    const nextCursor = rows.length > take ? page[page.length - 1].id : null;
    return { items, nextCursor };
  }

  // ─── sendMessage ───────────────────────────────────────────────────────────
  // Inside a transaction: insert the message + bump
  // Conversation.updatedAt so the conversations list re-orders this
  // conversation to the top. The sender's role is derived from the
  // resolved ConversationParticipant — NOT hardcoded — so provider
  // messages persist as PROVIDER and seeker messages as SEEKER.
  // After the commit, publish a `message.created` event into the
  // conversation room so connected clients update without polling.
  async sendMessage(
    userId: string,
    conversationId: string,
    body: string,
  ): Promise<SendMessageResponse> {
    const participant = await this.assertParticipant(userId, conversationId);
    const created = await this.tx.run(async (tx) => {
      const message = await this.messages.create(
        {
          conversationId,
          senderUserId: userId,
          senderRole: participant.role,
          body,
        },
        tx,
      );
      await this.conversations.bumpUpdatedAt(conversationId, tx);
      return message;
    });

    // Realtime fan-out — post-commit, best-effort. The publisher
    // swallows its own errors so a bus failure cannot roll back the
    // REST write. Payload mirrors the contract MessageSummary so a
    // connected client can drop it straight into its messages cache.
    // `sentByMe` is intentionally NOT included in the room broadcast
    // (the receiver's "is this mine" view is derived client-side
    // from `senderUserId` against the session); the wire DTO
    // exposes `senderRole` only.
    this.realtime.publishToRoom(`conversation:${conversationId}`, 'message.created', {
      conversationId,
      message: toMessageSummaryForBroadcast(created),
    });

    return { message: toMessageSummary(created, userId) };
  }

  // ─── markRead ──────────────────────────────────────────────────────────────
  async markRead(userId: string, conversationId: string): Promise<MarkConversationReadResponse> {
    const participant = await this.participants.findByConversationAndUser(conversationId, userId);
    if (!participant) {
      throw new AppError('NOT_FOUND', 'Conversation not found.', 404);
    }
    const at = new Date();
    await this.participants.setLastReadAt(participant.id, at);
    return { lastReadAt: at.toISOString() };
  }

  // ─── invariants ────────────────────────────────────────────────────────────
  // Primary ownership gate. Any read / write surface that takes a
  // conversationId must call this first. Returns the participant row
  // so callers can derive the user's role (seeker vs provider) without
  // a second query — `sendMessage` uses the role to stamp `senderRole`
  // on the message.
  private async assertParticipant(
    userId: string,
    conversationId: string,
  ): Promise<ConversationParticipant> {
    const participant = await this.participants.findByConversationAndUser(conversationId, userId);
    if (!participant) {
      throw new AppError('NOT_FOUND', 'Conversation not found.', 404);
    }
    return participant;
  }
}

// True when the error is the Sprint-7.3 partial unique index firing on
// Conversation.bookingId. Matched on Prisma's stable P2002 code plus
// the index name from the migration so a future, unrelated unique
// can't be misread as a booking conflict. Falls back to a `meta.target`
// check on engines that don't surface the constraint name verbatim.
function isUniqueConversationBookingViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const meta = err.meta as { target?: string | string[] } | undefined;
  const target = meta?.target;
  if (typeof target === 'string') {
    return target === 'Conversation_bookingId_live_unique' || target.includes('bookingId');
  }
  if (Array.isArray(target)) {
    return target.includes('bookingId');
  }
  // No metadata — be permissive but conservative: treat as a conflict
  // so we re-fetch rather than masking a foreign error class. The
  // re-fetch's null-check still guards against the wrong path.
  return true;
}

// ─── DTO mappers ──────────────────────────────────────────────────────────────

async function toSummary(
  row: ConversationWithRelations,
  selfUserId: string,
  messages: MessageRepository,
): Promise<ConversationSummary> {
  const self = row.participants.find((p) => p.userId === selfUserId);
  const other = row.participants.find((p) => p.userId !== selfUserId);
  const lastMessage = row.messages[0];
  const unreadCount = await messages.countUnreadForParticipant(
    row.id,
    selfUserId,
    self?.lastReadAt ?? null,
  );
  return {
    id: row.id,
    bookingId: row.bookingId,
    requestId: row.requestId,
    otherParticipant: toOtherParticipant(self, other),
    lastMessageBody: lastMessage ? lastMessage.body : null,
    lastMessageAt: lastMessage ? lastMessage.createdAt.toISOString() : null,
    unreadCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Role-aware "other participant" projection.
//
//   - When the viewer is a PROVIDER, the counterpart is the seeker —
//     render the seeker's first name + initial. Email is NOT used as
//     a fallback (PII boundary; same as the bids surface).
//   - When the viewer is a SEEKER (or has no participant row — list
//     fallback only), the counterpart is the provider profile — render
//     displayName + initials + avatar.
//
// Both branches go through the same defensive fallback if the relation
// is missing, so the wire payload always carries a complete shape.
function toOtherParticipant(
  self:
    | (ConversationParticipant & {
        provider: ProviderProfile | null;
        user: ParticipantUserSummary | null;
      })
    | undefined,
  other:
    | (ConversationParticipant & {
        provider: ProviderProfile | null;
        user: ParticipantUserSummary | null;
      })
    | undefined,
): ConversationOtherParticipant {
  if (self?.role === ConversationParticipantRole.PROVIDER) {
    return toSeekerOther(other?.user ?? null);
  }
  return toProviderOther(other?.provider ?? null);
}

function toProviderOther(
  provider: { displayName: string; initials: string; avatarUrl: string | null } | null,
): ConversationOtherParticipant {
  if (!provider) {
    return { displayName: 'Provider', initials: 'P', avatarUrl: null };
  }
  return {
    displayName: provider.displayName,
    initials: provider.initials,
    avatarUrl: provider.avatarUrl,
  };
}

function toSeekerOther(user: ParticipantUserSummary | null): ConversationOtherParticipant {
  if (!user) {
    return { displayName: 'Customer', initials: 'C', avatarUrl: null };
  }
  const first = (user.firstName ?? '').trim();
  const last = (user.lastName ?? '').trim();
  const lastInitial = last.length > 0 ? `${last[0].toUpperCase()}.` : '';
  const displayName = [first, lastInitial].filter(Boolean).join(' ') || 'Customer';
  const initials = `${first[0] ?? 'C'}${last[0] ?? ''}`.toUpperCase().slice(0, 2);
  return { displayName, initials, avatarUrl: null };
}

function toMessageSummary(row: Message, selfUserId: string): MessageSummary {
  return {
    id: row.id,
    senderRole: row.senderRole,
    body: row.body,
    sentByMe: row.senderUserId === selfUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

// Broadcast variant — same wire fields except `sentByMe` is dropped
// because the receiver derives it client-side from `senderRole`
// against its own role in the conversation. `senderUserId` is NOT
// surfaced here for the same PII reason the REST DTO hides it.
function toMessageSummaryForBroadcast(row: Message): Omit<MessageSummary, 'sentByMe'> {
  return {
    id: row.id,
    senderRole: row.senderRole,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}
