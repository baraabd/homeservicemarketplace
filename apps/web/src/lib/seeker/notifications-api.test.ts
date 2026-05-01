import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../api';
import {
  deleteNotification,
  getUnreadNotificationsCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications-api';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

const ROW = {
  id: 'n-1',
  type: 'BID_ACCEPTED' as const,
  title: 'Bid accepted',
  body: "You accepted Omar's bid.",
  resourceType: 'BID' as const,
  resourceId: 'bid-1',
  deepLink: '/home/requests/req-1/bids/bid-1',
  metadata: null,
  readAt: null,
  createdAt: '2026-04-29T10:00:00.000Z',
};

describe('notifications-api — listNotifications', () => {
  it('GETs /v1/me/notifications and unwraps the envelope', async () => {
    mock.onGet('/v1/me/notifications').reply(200, { items: [ROW], nextCursor: null });
    const out = await listNotifications();
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe('n-1');
  });

  it('forwards unread filter on the wire', async () => {
    let captured: Record<string, unknown> = {};
    mock.onGet('/v1/me/notifications').reply((config) => {
      captured = (config.params ?? {}) as Record<string, unknown>;
      return [200, { items: [], nextCursor: null }];
    });
    await listNotifications({ unread: true });
    expect(captured).toEqual({ unread: true });
  });

  it('does NOT send userId on the wire', async () => {
    let captured: Record<string, unknown> = {};
    mock.onGet('/v1/me/notifications').reply((config) => {
      captured = (config.params ?? {}) as Record<string, unknown>;
      return [200, { items: [], nextCursor: null }];
    });
    await listNotifications({ unread: true });
    expect(captured).not.toHaveProperty('userId');
    expect(captured).not.toHaveProperty('seekerUserId');
  });
});

describe('notifications-api — getUnreadNotificationsCount', () => {
  it('GETs /v1/me/notifications/unread-count and returns the count envelope', async () => {
    mock.onGet('/v1/me/notifications/unread-count').reply(200, { count: 7 });
    const out = await getUnreadNotificationsCount();
    expect(out).toEqual({ count: 7 });
  });
});

describe('notifications-api — markNotificationRead', () => {
  it('POSTs /v1/me/notifications/:id/read with no body', async () => {
    let bodyLen: number | undefined;
    mock.onPost('/v1/me/notifications/n-1/read').reply((config) => {
      bodyLen = (config.data as string | undefined)?.length;
      return [200, { notification: { ...ROW, readAt: '2026-04-29T11:00:00.000Z' } }];
    });
    const out = await markNotificationRead('n-1');
    expect(out.notification.readAt).toBe('2026-04-29T11:00:00.000Z');
    expect(bodyLen === undefined || bodyLen === 0).toBe(true);
  });

  it('propagates a 404 (foreign id) so React Query can surface it', async () => {
    mock.onPost('/v1/me/notifications/n-1/read').reply(404, {
      error: { code: 'NOT_FOUND' },
    });
    await expect(markNotificationRead('n-1')).rejects.toMatchObject({
      response: { status: 404 },
    });
  });
});

describe('notifications-api — markAllNotificationsRead', () => {
  it('POSTs /v1/me/notifications/read-all and returns the count', async () => {
    mock.onPost('/v1/me/notifications/read-all').reply(200, { updatedCount: 5 });
    const out = await markAllNotificationsRead();
    expect(out).toEqual({ updatedCount: 5 });
  });
});

describe('notifications-api — deleteNotification', () => {
  it('DELETEs /v1/me/notifications/:id and resolves on 204', async () => {
    mock.onDelete('/v1/me/notifications/n-1').reply(204);
    await expect(deleteNotification('n-1')).resolves.toBeUndefined();
  });
});
