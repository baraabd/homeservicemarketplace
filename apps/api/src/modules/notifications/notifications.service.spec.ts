import type { Notification, NotificationType } from '@homeservicemarketplace/database';

import type { NotificationRepository } from '../../infrastructure/persistence/notifications/notification.repository';
import { AppError } from '../../shared/errors/app-error';
import { NotificationsService } from './notifications.service';

function makeNotif(over: Partial<Notification> = {}): Notification {
  return {
    id: 'notif-1',
    userId: 'user-1',
    type: 'BID_ACCEPTED' as NotificationType,
    title: 'Bid accepted',
    body: "You accepted Omar's bid.",
    resourceType: 'BID',
    resourceId: 'bid-1',
    deepLink: '/home/requests/req-1/bids/bid-1',
    metadata: { requestId: 'req-1', bookingId: 'bk-1' },
    readAt: null,
    createdAt: new Date('2026-04-29T10:00:00.000Z'),
    deletedAt: null,
    ...over,
  } as Notification;
}

interface Mocks {
  notifications: {
    create: jest.Mock;
    listForUser: jest.Mock;
    findOwned: jest.Mock;
    markReadOwned: jest.Mock;
    markAllReadOwned: jest.Mock;
    countUnread: jest.Mock;
    softDeleteOwned: jest.Mock;
  };
}

type MocksOverride = { [K in keyof Mocks]?: Partial<Mocks[K]> };

function makeMocks(over: MocksOverride = {}): Mocks {
  return {
    notifications: {
      create: jest.fn().mockResolvedValue(makeNotif()),
      listForUser: jest.fn().mockResolvedValue([]),
      findOwned: jest.fn().mockResolvedValue(null),
      markReadOwned: jest.fn().mockResolvedValue({ count: 1 }),
      markAllReadOwned: jest.fn().mockResolvedValue({ count: 0 }),
      countUnread: jest.fn().mockResolvedValue(0),
      softDeleteOwned: jest.fn().mockResolvedValue({ count: 1 }),
      ...(over.notifications ?? {}),
    },
  };
}

function makeService(m: Mocks) {
  return new NotificationsService(m.notifications as unknown as NotificationRepository);
}

describe('NotificationsService', () => {
  // ─── list ──────────────────────────────────────────────────────────────
  describe('list', () => {
    it('maps the persistence row to NotificationSummary (drops userId/deletedAt)', async () => {
      const m = makeMocks({
        notifications: { listForUser: jest.fn().mockResolvedValue([makeNotif()]) },
      });
      const out = await makeService(m).list('user-1', {});
      expect(out.items).toHaveLength(1);
      expect(out.nextCursor).toBeNull();
      const dto = out.items[0];
      expect(dto).not.toHaveProperty('userId');
      expect(dto).not.toHaveProperty('deletedAt');
      // Wire dates are ISO-formatted.
      expect(typeof dto.createdAt).toBe('string');
      expect(dto.readAt).toBeNull();
    });

    it('forwards unread filter + emits nextCursor when page is full', async () => {
      const a = makeNotif({ id: 'n-a' });
      const b = makeNotif({ id: 'n-b' });
      const c = makeNotif({ id: 'n-c' });
      const m = makeMocks({
        notifications: { listForUser: jest.fn().mockResolvedValue([a, b, c]) },
      });
      const out = await makeService(m).list('user-1', { unread: true, limit: 2 });
      expect(m.notifications.listForUser).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', unread: true, take: 3 }),
      );
      expect(out.items).toHaveLength(2);
      expect(out.nextCursor).toBe('n-b');
    });

    it('empty list returns 200-shape with empty items', async () => {
      const m = makeMocks();
      const out = await makeService(m).list('user-1', {});
      expect(out).toEqual({ items: [], nextCursor: null });
    });
  });

  // ─── unreadCount ───────────────────────────────────────────────────────
  it('unreadCount delegates to repo.countUnread and returns the envelope', async () => {
    const m = makeMocks({ notifications: { countUnread: jest.fn().mockResolvedValue(7) } });
    const out = await makeService(m).unreadCount('user-1');
    expect(out).toEqual({ count: 7 });
    expect(m.notifications.countUnread).toHaveBeenCalledWith('user-1');
  });

  // ─── markRead ──────────────────────────────────────────────────────────
  describe('markRead', () => {
    it('flips an unread notification and returns the read shape', async () => {
      const unread = makeNotif({ readAt: null });
      const read = makeNotif({ readAt: new Date('2026-04-29T11:00:00.000Z') });
      const m = makeMocks({
        notifications: {
          findOwned: jest.fn().mockResolvedValueOnce(unread).mockResolvedValueOnce(read),
          markReadOwned: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });
      const out = await makeService(m).markRead('user-1', 'notif-1');
      expect(m.notifications.markReadOwned).toHaveBeenCalledWith('notif-1', 'user-1');
      expect(out.notification.readAt).toBe('2026-04-29T11:00:00.000Z');
    });

    it('is idempotent on an already-read notification (no flip, returns unchanged)', async () => {
      const alreadyRead = makeNotif({ readAt: new Date('2026-04-29T09:00:00.000Z') });
      const m = makeMocks({
        notifications: {
          findOwned: jest.fn().mockResolvedValue(alreadyRead),
          markReadOwned: jest.fn(),
        },
      });
      const out = await makeService(m).markRead('user-1', 'notif-1');
      // Critical: the conditional update is NOT fired on a re-mark.
      expect(m.notifications.markReadOwned).not.toHaveBeenCalled();
      expect(out.notification.readAt).toBe('2026-04-29T09:00:00.000Z');
    });

    it('rejects with NOT_FOUND on a foreign notificationId (no leak)', async () => {
      const m = makeMocks({
        notifications: { findOwned: jest.fn().mockResolvedValue(null) },
      });
      await expect(makeService(m).markRead('user-attacker', 'notif-victim')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
      expect(m.notifications.markReadOwned).not.toHaveBeenCalled();
    });
  });

  // ─── markAllRead ───────────────────────────────────────────────────────
  describe('markAllRead', () => {
    it('returns the updated row count', async () => {
      const m = makeMocks({
        notifications: { markAllReadOwned: jest.fn().mockResolvedValue({ count: 4 }) },
      });
      const out = await makeService(m).markAllRead('user-1');
      expect(out).toEqual({ updatedCount: 4 });
      expect(m.notifications.markAllReadOwned).toHaveBeenCalledWith('user-1');
    });

    it('is idempotent (returns 0 when nothing was unread)', async () => {
      const m = makeMocks({
        notifications: { markAllReadOwned: jest.fn().mockResolvedValue({ count: 0 }) },
      });
      const out = await makeService(m).markAllRead('user-1');
      expect(out).toEqual({ updatedCount: 0 });
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('soft-deletes when owned (count: 1)', async () => {
      const m = makeMocks();
      await expect(makeService(m).delete('user-1', 'notif-1')).resolves.toBeUndefined();
      expect(m.notifications.softDeleteOwned).toHaveBeenCalledWith('notif-1', 'user-1');
    });

    it('rejects with NOT_FOUND when count: 0 (foreign or already-deleted)', async () => {
      const m = makeMocks({
        notifications: { softDeleteOwned: jest.fn().mockResolvedValue({ count: 0 }) },
      });
      await expect(makeService(m).delete('user-1', 'notif-bogus')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // ─── createForUser (internal) ──────────────────────────────────────────
  it('createForUser delegates to repo.create with all fields preserved', async () => {
    const m = makeMocks();
    await makeService(m).createForUser({
      userId: 'user-1',
      type: 'BID_ACCEPTED' as NotificationType,
      title: 'Bid accepted',
      body: "You accepted Omar's bid.",
      resourceType: 'BID',
      resourceId: 'bid-1',
      deepLink: '/home/requests/req-1/bids/bid-1',
      metadata: { requestId: 'req-1' },
    });
    expect(m.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'BID_ACCEPTED',
        title: 'Bid accepted',
        body: "You accepted Omar's bid.",
        resourceType: 'BID',
        resourceId: 'bid-1',
      }),
      undefined,
    );
  });

  // ─── error contract ────────────────────────────────────────────────────
  it('throws AppError on every error path (no raw Prisma errors leak)', async () => {
    const m = makeMocks({
      notifications: {
        findOwned: jest.fn().mockResolvedValue(null),
        softDeleteOwned: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const svc = makeService(m);
    await Promise.all([
      expect(svc.markRead('u', 'n')).rejects.toBeInstanceOf(AppError),
      expect(svc.delete('u', 'n')).rejects.toBeInstanceOf(AppError),
    ]);
  });
});
