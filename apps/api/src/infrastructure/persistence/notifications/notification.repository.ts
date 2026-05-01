import { Injectable } from '@nestjs/common';
import { Prisma } from '@homeservicemarketplace/database';
import type {
  Notification,
  NotificationResourceType,
  NotificationType,
  PrismaTx,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  resourceType?: NotificationResourceType | null;
  resourceId?: string | null;
  deepLink?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

export interface ListNotificationsArgs {
  userId: string;
  unread?: boolean;
  take: number;
  cursor?: string;
}

// Notification persistence. Reads always filter soft-deleted rows.
// Mutating call sites match on { id, userId, deletedAt: null } so a
// foreign id from one user can never touch another user's row.
@Injectable()
export class NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  // Always written inside the same transaction as the underlying state
  // change (accept-bid / cancel-booking) so the notification can never
  // disagree with the action that produced it.
  create(input: CreateNotificationInput, tx?: PrismaTx): Promise<Notification> {
    return this.db(tx).notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        deepLink: input.deepLink ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  }

  // Cursor-paginated list. Always filters soft-deleted rows. When
  // `unread` is true, only rows with `readAt: null` are returned.
  // Order: createdAt DESC + id DESC (deterministic tiebreak so cursor
  // pagination cannot skip / duplicate).
  listForUser(args: ListNotificationsArgs, tx?: PrismaTx): Promise<Notification[]> {
    const where: Prisma.NotificationWhereInput = {
      userId: args.userId,
      deletedAt: null,
      ...(args.unread === true ? { readAt: null } : {}),
    };
    return this.db(tx).notification.findMany({
      where,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  findOwned(notificationId: string, userId: string, tx?: PrismaTx): Promise<Notification | null> {
    return this.db(tx).notification.findFirst({
      where: { id: notificationId, userId, deletedAt: null },
    });
  }

  // Idempotent flip: only fires when the row is currently unread. A
  // re-mark returns count: 0, which the service handles by re-reading
  // the (already-read) row and returning it unchanged.
  markReadOwned(
    notificationId: string,
    userId: string,
    tx?: PrismaTx,
  ): Promise<Prisma.BatchPayload> {
    return this.db(tx).notification.updateMany({
      where: { id: notificationId, userId, deletedAt: null, readAt: null },
      data: { readAt: new Date() },
    });
  }

  // Bulk flip every unread row owned by the user. Returns the count of
  // rows that actually flipped — already-read rows are untouched.
  markAllReadOwned(userId: string, tx?: PrismaTx): Promise<Prisma.BatchPayload> {
    return this.db(tx).notification.updateMany({
      where: { userId, deletedAt: null, readAt: null },
      data: { readAt: new Date() },
    });
  }

  countUnread(userId: string, tx?: PrismaTx): Promise<number> {
    return this.db(tx).notification.count({
      where: { userId, deletedAt: null, readAt: null },
    });
  }

  // Soft delete. Idempotent at the row level — a re-delete returns
  // count: 0 which the service maps to NOT_FOUND for consistency with
  // the other "this row no longer exists for you" surfaces.
  softDeleteOwned(
    notificationId: string,
    userId: string,
    tx?: PrismaTx,
  ): Promise<Prisma.BatchPayload> {
    return this.db(tx).notification.updateMany({
      where: { id: notificationId, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
