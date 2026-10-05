import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { ChatScreen } from './ChatScreen';

// ─────────────────────────────────────────────────────────────────────────────
// Slice 3.3 contract: ChatScreen reads messages from
// /v1/me/conversations/:id/messages and sends via POST. The slice-2
// SEED_MESSAGES_EN/AR seed and the 1.5s setTimeout fake provider reply
// are gone — there is no fabricated data in the production path.
// ─────────────────────────────────────────────────────────────────────────────

function renderChat(conversationId: string | null) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <ChatScreen
          conversationId={conversationId}
          contact={{
            name: 'Omar Al-Khalid',
            initials: 'OK',
            bg: 'bg-amber-100',
            textColor: 'text-amber-700',
          }}
          onBack={() => {}}
          isVisible
        />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

describe('ChatScreen — slice 3.3', () => {
  it('reads from /v1/me/conversations/:id/messages and renders persisted messages', async () => {
    mock.onGet('/v1/me/conversations/conv-1/messages').reply(200, {
      items: [
        {
          id: 'm-1',
          senderRole: 'PROVIDER',
          body: 'hello from provider',
          sentByMe: false,
          createdAt: '2026-04-29T02:30:00.000Z',
        },
        {
          id: 'm-2',
          senderRole: 'SEEKER',
          body: 'hello from seeker',
          sentByMe: true,
          createdAt: '2026-04-29T03:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    // Auto-mark-read fires when the conversation has messages.
    mock.onPost('/v1/me/conversations/conv-1/read').reply(200, {
      lastReadAt: '2026-04-29T03:00:00.000Z',
    });

    renderChat('conv-1');

    await waitFor(() => {
      expect(screen.getByText('hello from provider')).toBeInTheDocument();
    });
    expect(screen.getByText('hello from seeker')).toBeInTheDocument();

    // The slice-2 SEED text must never appear.
    expect(screen.queryByText(/I've reviewed your plumbing request/i)).toBeNull();
    expect(screen.queryByText(/3 PM works perfectly/i)).toBeNull();
    expect(screen.queryByText(/P-trap issue/i)).toBeNull();
  });

  it('renders the loading state while messages are in flight', async () => {
    let resolve: (v: [number, unknown]) => void = () => {};
    const pending = new Promise<[number, unknown]>((r) => {
      resolve = r;
    });
    mock.onGet('/v1/me/conversations/conv-1/messages').reply(() => pending);

    renderChat('conv-1');

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Loading conversation/i)).toBeInTheDocument();
    resolve([200, { items: [], nextCursor: null }]);
  });

  it('renders the empty state when the conversation has no messages', async () => {
    mock.onGet('/v1/me/conversations/conv-1/messages').reply(200, { items: [], nextCursor: null });
    renderChat('conv-1');

    await waitFor(() => {
      expect(screen.getByText(/Start the conversation/i)).toBeInTheDocument();
    });
  });

  it('send button calls POST /v1/me/conversations/:id/messages — no fake provider reply', async () => {
    mock.onGet('/v1/me/conversations/conv-1/messages').reply(200, { items: [], nextCursor: null });
    mock.onPost('/v1/me/conversations/conv-1/read').reply(200, { lastReadAt: 'x' });
    let postedUrl: string | null = null;
    let postedBody: Record<string, unknown> = {};
    mock.onPost('/v1/me/conversations/conv-1/messages').reply((config) => {
      postedUrl = config.url ?? null;
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [
        201,
        {
          message: {
            id: 'm-server',
            senderRole: 'SEEKER',
            body: 'hi from test',
            sentByMe: true,
            createdAt: '2026-04-29T04:00:00.000Z',
          },
        },
      ];
    });

    renderChat('conv-1');
    await waitFor(() => expect(screen.getByText(/Start the conversation/i)).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText(/Type a message|اكتب رسالة/i);
    fireEvent.change(textarea, { target: { value: 'hi from test' } });
    const sendButtons = screen.getAllByRole('button');
    // The send button is the last with a Send icon — easier to find
    // via fire-then-assert on the captured URL than to query the icon.
    const sendBtn = sendButtons[sendButtons.length - 1];
    fireEvent.click(sendBtn);

    await waitFor(() => expect(postedUrl).toBe('/v1/me/conversations/conv-1/messages'));
    // R12 — one logical send carries one idempotency key.
    expect(postedBody).toEqual({ body: 'hi from test', idempotencyKey: expect.any(String) });
    // The body must NOT carry senderUserId / senderRole — those come
    // from the session server-side.
    expect(postedBody).not.toHaveProperty('senderUserId');
    expect(postedBody).not.toHaveProperty('senderRole');

    // Slice-2 had a 1.5s setTimeout that injected a fake provider
    // reply. Wait long enough to prove it isn't firing.
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.queryByText(/Thanks for your message/i)).toBeNull();
    expect(screen.queryByText(/get back to you shortly/i)).toBeNull();
  });

  it('renders a safe error state on 500 (no Prisma leak in DOM)', async () => {
    mock.onGet('/v1/me/conversations/conv-1/messages').reply(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'PrismaClientKnownRequestError: column messages.foo does not exist',
      },
    });

    renderChat('conv-1');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/couldn't load this conversation/i)).toBeInTheDocument();
    expect(screen.queryByText(/PrismaClient/i)).toBeNull();
    expect(screen.queryByText(/column messages/i)).toBeNull();
  });
});

describe('ChatScreen — R12 header', () => {
  it('claims no presence and offers no call; calling says it is not available', async () => {
    mock.onGet('/v1/me/conversations/conv-1/messages').reply(200, { items: [], nextCursor: null });
    renderChat('conv-1');
    await screen.findByText('Omar Al-Khalid');
    expect(screen.queryByText(/online/i)).toBeNull();
    const call = screen.getByTestId('chat-call-unavailable');
    expect(call).toBeDisabled();
    expect(call).toHaveAccessibleName('Calls aren’t available in the app');
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  });
});

describe('ChatScreen — R12 send recovery and replies', () => {
  const ROUTE = '/v1/me/conversations/conv-1/messages';
  const serverRow = (id: string, body: string, sentByMe = true) => ({
    id,
    senderRole: sentByMe ? 'SEEKER' : 'PROVIDER',
    body,
    sentByMe,
    createdAt: '2026-10-04T10:00:00.000Z',
  });
  const input = () => screen.getByTestId('chat-input');
  const sendBtn = () => screen.getByTestId('chat-send');
  const posted = () =>
    mock.history.post
      .filter((r) => r.url === ROUTE)
      .map((r) => JSON.parse(r.data as string) as { body: string; idempotencyKey: string });

  beforeEach(() => {
    mock.onPost('/v1/me/conversations/conv-1/read').reply(200, { lastReadAt: 'x' });
  });

  it('sending the failed message again reuses its key, so it is stored once', async () => {
    // A server that stores by key. The first send IS stored but its reply is
    // lost; the second, with the same key, is answered with the stored row.
    const stored: Array<ReturnType<typeof serverRow> & { key: string }> = [];
    let loseReply = true;
    mock.onGet(ROUTE).reply(() => [200, { items: [...stored], nextCursor: null }]);
    mock.onPost(ROUTE).reply((config) => {
      const { body, idempotencyKey } = JSON.parse(config.data as string);
      let row = stored.find((m) => m.key === idempotencyKey);
      const replayed = Boolean(row);
      if (!row) {
        row = { ...serverRow(`m-${stored.length + 1}`, body), key: idempotencyKey };
        stored.push(row);
      }
      if (loseReply) {
        loseReply = false;
        return Promise.reject(Object.assign(new Error('Network Error'), { isAxiosError: true }));
      }
      return [201, { message: row, ...(replayed ? { replayed } : {}) }];
    });
    renderChat('conv-1');
    await screen.findByText(/Start the conversation/i);
    fireEvent.change(input(), { target: { value: 'Is ten good?' } });
    fireEvent.click(sendBtn());
    await screen.findByRole('alert');
    // The text is back in the box; sending it unchanged is the same message.
    expect(input()).toHaveValue('Is ten good?');
    fireEvent.click(sendBtn());
    await waitFor(() => expect(posted()).toHaveLength(2));
    expect(posted()[1].idempotencyKey).toBe(posted()[0].idempotencyKey);
    await waitFor(() => expect(screen.getAllByText('Is ten good?')).toHaveLength(1));
    expect(stored).toHaveLength(1);
  });

  it('two messages with the same text are two sends with two keys, and both are shown', async () => {
    // A server that stores every keyed send it has not seen.
    const stored: Array<ReturnType<typeof serverRow>> = [];
    mock.onGet(ROUTE).reply(() => [200, { items: [...stored], nextCursor: null }]);
    mock.onPost(ROUTE).reply((config) => {
      const row = serverRow(`m-${stored.length + 1}`, JSON.parse(config.data as string).body);
      stored.push(row);
      return [201, { message: row }];
    });
    renderChat('conv-1');
    await screen.findByText(/Start the conversation/i);
    fireEvent.change(input(), { target: { value: 'ok' } });
    fireEvent.click(sendBtn());
    await waitFor(() => expect(posted()).toHaveLength(1));
    await waitFor(() => expect(sendBtn()).toBeDisabled());
    fireEvent.change(input(), { target: { value: 'ok' } });
    await waitFor(() => expect(sendBtn()).toBeEnabled());
    fireEvent.click(sendBtn());
    await waitFor(() => expect(posted()).toHaveLength(2));
    expect(posted()[1].idempotencyKey).not.toBe(posted()[0].idempotencyKey);
    await waitFor(() => expect(screen.getAllByText('ok')).toHaveLength(2));
  });

  it('a reply appears in the open chat without reopening it, and reading stops when it closes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mock
        .onGet(ROUTE)
        .replyOnce(200, { items: [serverRow('m-1', 'Hello?')], nextCursor: null })
        .onGet(ROUTE)
        .reply(200, {
          items: [serverRow('m-1', 'Hello?'), serverRow('m-2', 'Yes, see you at ten.', false)],
          nextCursor: null,
        });
      const view = renderChat('conv-1');
      await screen.findByText('Hello?');
      expect(screen.queryByText('Yes, see you at ten.')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_100);
      });
      expect(await screen.findByText('Yes, see you at ten.')).toBeInTheDocument();
      // Shown once, not once per read.
      expect(screen.getAllByText('Yes, see you at ten.')).toHaveLength(1);

      view.unmount();
      const reads = mock.history.get.filter((r) => r.url === ROUTE).length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(mock.history.get.filter((r) => r.url === ROUTE)).toHaveLength(reads);
    } finally {
      vi.useRealTimers();
    }
  });

  it('R17: a reply in a full thread is marked read up to the newest message shown', async () => {
    // The newest page holds 50 messages. A reply that arrives while the chat is
    // open replaces the oldest row on that page, so the page length stays 50.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const page = (from: number) =>
        Array.from({ length: 50 }, (_, i) => serverRow(`m-${from + i}`, `line ${from + i}`, false));
      mock
        .onGet(ROUTE)
        .replyOnce(200, { items: page(1), nextCursor: 'm-1' })
        .onGet(ROUTE)
        .reply(200, { items: page(2), nextCursor: 'm-2' });
      mock.onPost('/v1/me/conversations/conv-1/read').reply(200, { lastReadAt: 'x' });
      const reads = () =>
        mock.history.post
          .filter((r) => r.url === '/v1/me/conversations/conv-1/read')
          .map((r) => JSON.parse((r.data as string | undefined) ?? '{}') as object);

      renderChat('conv-1');
      await screen.findByText('line 50');
      await waitFor(() => expect(reads()).toHaveLength(1));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_100);
      });
      await screen.findByText('line 51');
      // The reply is read once it is on screen, although the page length did
      // not change…
      await waitFor(() => expect(reads()).toHaveLength(2));
      // …and only up to the newest message shown: nothing newer is claimed.
      expect(reads()).toEqual([{ upToMessageId: 'm-50' }, { upToMessageId: 'm-51' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('after losing access the chat stops reading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mock.onGet(ROUTE).reply(404, { error: { code: 'NOT_FOUND' } });
      renderChat('conv-1');
      await waitFor(() =>
        expect(mock.history.get.filter((r) => r.url === ROUTE).length).toBeGreaterThan(0),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      const reads = mock.history.get.filter((r) => r.url === ROUTE).length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(mock.history.get.filter((r) => r.url === ROUTE)).toHaveLength(reads);
    } finally {
      vi.useRealTimers();
    }
  });
});
