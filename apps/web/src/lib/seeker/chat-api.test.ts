import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../api';
import {
  getOrCreateConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
} from './chat-api';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

const CONV = {
  id: 'conv-1',
  bookingId: 'bk-1',
  requestId: 'req-1',
  otherParticipant: {
    displayName: 'Omar Al-Khalid',
    initials: 'OK',
    avatarUrl: null,
  },
  lastMessageBody: 'hello',
  lastMessageAt: '2026-04-29T03:00:00.000Z',
  unreadCount: 1,
  createdAt: '2026-04-29T02:00:00.000Z',
  updatedAt: '2026-04-29T03:00:00.000Z',
};

describe('chat-api — listConversations', () => {
  it('GETs /v1/me/conversations and unwraps the envelope', async () => {
    mock.onGet('/v1/me/conversations').reply(200, { items: [CONV], nextCursor: null });
    const out = await listConversations();
    expect(out.items).toHaveLength(1);
    expect(out.items[0].otherParticipant.displayName).toBe('Omar Al-Khalid');
  });

  it('rejects on 5xx so React Query can surface an error', async () => {
    mock.onGet('/v1/me/conversations').reply(503, {});
    await expect(listConversations()).rejects.toBeDefined();
  });
});

describe('chat-api — getOrCreateConversation', () => {
  it('POSTs /v1/me/conversations with bookingId only (no senderUserId smuggling)', async () => {
    let postedBody: Record<string, unknown> = {};
    mock.onPost('/v1/me/conversations').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { conversation: CONV }];
    });
    const out = await getOrCreateConversation({ bookingId: 'bk-1' });
    expect(postedBody).toEqual({ bookingId: 'bk-1' });
    expect(postedBody).not.toHaveProperty('senderUserId');
    expect(postedBody).not.toHaveProperty('userId');
    expect(out.conversation.id).toBe('conv-1');
  });
});

describe('chat-api — listMessages', () => {
  it('GETs /v1/me/conversations/:id/messages', async () => {
    mock.onGet('/v1/me/conversations/conv-1/messages').reply(200, {
      items: [
        {
          id: 'm-1',
          senderRole: 'SEEKER',
          body: 'hi',
          sentByMe: true,
          createdAt: '2026-04-29T03:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    const out = await listMessages('conv-1');
    expect(out.items).toHaveLength(1);
    expect(out.items[0].sentByMe).toBe(true);
  });

  it('forwards limit + cursor on the wire', async () => {
    let captured: Record<string, unknown> = {};
    mock.onGet('/v1/me/conversations/conv-1/messages').reply((config) => {
      captured = (config.params ?? {}) as Record<string, unknown>;
      return [200, { items: [], nextCursor: null }];
    });
    await listMessages('conv-1', { limit: 25, cursor: 'm-99' });
    expect(captured).toEqual({ limit: 25, cursor: 'm-99' });
  });
});

describe('chat-api — sendMessage', () => {
  it('POSTs /v1/me/conversations/:id/messages with only the body field', async () => {
    let postedBody: Record<string, unknown> = {};
    mock.onPost('/v1/me/conversations/conv-1/messages').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [
        201,
        {
          message: {
            id: 'm-1',
            senderRole: 'SEEKER',
            body: 'hi',
            sentByMe: true,
            createdAt: '2026-04-29T03:00:00.000Z',
          },
        },
      ];
    });
    const out = await sendMessage('conv-1', { body: 'hi' });
    expect(postedBody).toEqual({ body: 'hi' });
    expect(postedBody).not.toHaveProperty('senderUserId');
    expect(postedBody).not.toHaveProperty('senderRole');
    expect(out.message.id).toBe('m-1');
  });

  it('propagates a 400 (validation) so the UI can surface a safe message', async () => {
    mock.onPost('/v1/me/conversations/conv-1/messages').reply(400, {
      error: { code: 'VALIDATION_ERROR' },
    });
    await expect(sendMessage('conv-1', { body: '' })).rejects.toMatchObject({
      response: { status: 400 },
    });
  });
});

describe('chat-api — markConversationRead', () => {
  it('POSTs /v1/me/conversations/:id/read with no body', async () => {
    let bodyLen: number | undefined;
    mock.onPost('/v1/me/conversations/conv-1/read').reply((config) => {
      bodyLen = (config.data as string | undefined)?.length;
      return [200, { lastReadAt: '2026-04-29T03:30:00.000Z' }];
    });
    const out = await markConversationRead('conv-1');
    expect(out.lastReadAt).toBe('2026-04-29T03:30:00.000Z');
    expect(bodyLen === undefined || bodyLen === 0).toBe(true);
  });
});
