import { Injectable } from '@nestjs/common';
import type {
  ListNotificationsQuery,
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  NotificationListResponse,
  NotificationResourceType as ContractResourceType,
  NotificationSummary,
  NotificationType as ContractNotificationType,
  NotificationUnreadCountResponse,
} from '@homeservicemarketplace/contracts';
import type {
  Notification,
  NotificationResourceType,
  NotificationType,
  Prisma,
  PrismaTx,
} from '@homeservicemarketplace/database';

import { NotificationRepository } from '../../infrastructure/persistence/notifications/notification.repository';
import { AppError } from '../../shared/errors/app-error';
import { RealtimeEventsPublisher } from '../realtime/realtime-events.publisher';

const DEFAULT_PAGE_SIZE = 50;

export interface CreateNotificationForUserInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  resourceType?: NotificationResourceType | null;
  resourceId?: string | null;
  deepLink?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  // Sprint 7.6 — actor of the action that triggered this notification.
  // Threaded into the realtime envelope's `actorUserId` so the
  // recipient's client bridge can suppress UX feedback when actor ===
  // self (anti-echo). Persistence is unchanged — `actorUserId` is NOT
  // a Notification column; the audit trail lives in domain timeline
  // tables (BookingEvent, ServiceRequestEvent, BidEvent).
  actorUserId?: string | null;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly realtime: RealtimeEventsPublisher,
  ) {}

  // ─── list ──────────────────────────────────────────────────────────────────
  async list(userId: string, query: ListNotificationsQuery): Promise<NotificationListResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.notifications.listForUser({
      userId,
      unread: query.unread,
      deepLinkPrefix: experienceToDeepLinkPrefix(query.experience),
      take: take + 1,
      cursor: query.cursor,
    });
    const items = rows.slice(0, take).map(toSummary);
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  // ─── unreadCount ───────────────────────────────────────────────────────────
  async unreadCount(
    userId: string,
    experience?: ListNotificationsQuery['experience'],
  ): Promise<NotificationUnreadCountResponse> {
    const count = await this.notifications.countUnread(
      userId,
      experienceToDeepLinkPrefix(experience),
    );
    return { count };
  }

  // ─── markRead ──────────────────────────────────────────────────────────────
  // Idempotent: a re-mark on an already-read row is NOT an error — the
  // repository's conditional update returns count: 0, and we re-read the
  // (already-read) row and return it unchanged. That matches the
  // user-visible expectation: "tap; it's read" regardless of state.
  async markRead(userId: string, notificationId: string): Promise<MarkNotificationReadResponse> {
    const existing = await this.notifications.findOwned(notificationId, userId);
    if (!existing) {
      // Cross-user / soft-deleted / never-existed all surface as 404 —
      // identical response so a probing attacker cannot distinguish
      // them.
      throw new AppError('NOT_FOUND', 'Notification not found.', 404);
    }
    if (!existing.readAt) {
      const result = await this.notifications.markReadOwned(notificationId, userId);
      // result.count: 0 means a concurrent writer marked it between our
      // findOwned and updateMany; harmless — we re-read below.
      void result;
    }
    const reloaded = await this.notifications.findOwned(notificationId, userId);
    if (!reloaded) {
      // Should be unreachable — we just verified ownership — but
      // defend against a concurrent soft-delete.
      throw new AppError('NOT_FOUND', 'Notification not found.', 404);
    }
    return { notification: toSummary(reloaded) };
  }

  // ─── markAllRead ───────────────────────────────────────────────────────────
  async markAllRead(
    userId: string,
    experience?: ListNotificationsQuery['experience'],
  ): Promise<MarkAllNotificationsReadResponse> {
    // Sprint 5.5: when an experience filter is supplied, only flip
    // notifications whose deepLink lives under that experience's
    // tree. The provider drawer's "mark all read" must NOT silence
    // the seeker's unread badge.
    const result = await this.notifications.markAllReadOwned(
      userId,
      experienceToDeepLinkPrefix(experience),
    );
    return { updatedCount: result.count };
  }

  // ─── delete ────────────────────────────────────────────────────────────────
  // Soft delete. Idempotent for the same reason as markRead — a foreign
  // / already-deleted id is mapped to NOT_FOUND so an attacker cannot
  // probe the existence surface.
  async delete(userId: string, notificationId: string): Promise<void> {
    const result = await this.notifications.softDeleteOwned(notificationId, userId);
    if (result.count === 0) {
      throw new AppError('NOT_FOUND', 'Notification not found.', 404);
    }
  }

  // ─── createForUser (internal) ──────────────────────────────────────────────
  // Called from BidsService.accept and BookingsService.cancel inside their
  // existing $transactions. Accepting a Prisma tx makes the notification
  // write part of the atomic action — if the underlying state change rolls
  // back, the notification disappears with it.
  //
  // NOT exposed via HTTP — there is no "post a notification" endpoint.
  // Marketplace events are the only legitimate writers; a client-driven
  // create surface would let callers spoof system messages.
  async createForUser(input: CreateNotificationForUserInput, tx?: PrismaTx): Promise<Notification> {
    const created = await this.notifications.create(
      {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        deepLink: input.deepLink ?? null,
        metadata: input.metadata ?? null,
      },
      tx,
    );
    // Sprint 7.0 — realtime fan-out. Publishes the wire-shape summary
    // so the SSE client can drop it straight into the React Query
    // notifications cache. The publisher swallows its own errors so
    // a bus failure can never roll back the calling transaction.
    //
    // Sprint 7.6 — also threads `actorUserId` onto the envelope when
    // the caller supplied one (e.g. BidsService.accept passes the
    // seekerUserId; ProviderBookingsService passes the providerUserId).
    // The client side-effects bridge uses this to silence UX feedback
    // when actor === self. The persisted Notification row itself does
    // NOT carry actorUserId — the realtime envelope is the only
    // surface that needs it.
    this.realtime.publishFor(input.userId, 'notification.created', toSummary(created), {
      actorUserId: input.actorUserId ?? null,
    });
    return created;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────
// Sprint 5.5: map the wire `experience` query value to the
// deepLink prefix that scopes a notification to that user-
// experience. Every notification creator across the codebase
// already encodes the target experience in its deepLink — the
// seeker side uses `/home/...`, the provider side `/provider/...`,
// the admin side `/admin/...` — so we filter by `startsWith` and
// avoid a schema column.
function experienceToDeepLinkPrefix(
  experience: ListNotificationsQuery['experience'],
): string | undefined {
  if (experience === 'seeker') return '/home/';
  if (experience === 'provider') return '/provider/';
  if (experience === 'admin') return '/admin/';
  return undefined;
}

// ─── DTO mapper ──────────────────────────────────────────────────────────────
// Persistence row → wire DTO. Drops infra-only fields (userId, deletedAt)
// and serialises the timestamps to ISO-8601 strings so the wire payload
// is JSON-portable.
function toSummary(row: Notification): NotificationSummary {
  return {
    id: row.id,
    type: row.type as ContractNotificationType,
    title: row.title,
    body: row.body,
    resourceType: (row.resourceType as ContractResourceType | null) ?? null,
    resourceId: row.resourceId,
    deepLink: row.deepLink,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
