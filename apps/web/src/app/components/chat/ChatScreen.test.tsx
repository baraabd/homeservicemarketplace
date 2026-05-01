import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
            status: 'Online',
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
    expect(postedBody).toEqual({ body: 'hi from test' });
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
