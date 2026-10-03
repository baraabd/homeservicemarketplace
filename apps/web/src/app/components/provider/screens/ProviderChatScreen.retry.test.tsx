import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ProviderChatScreen } from './ProviderChatScreen';

// R12 — a provider's send whose reply is lost is sent again with the same key,
// so the server returns the stored message instead of storing it twice. A new
// message after an acknowledged one gets a new key.

const ROUTE = '/v1/provider/conversations/conv-9/messages';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet('/v1/provider/conversations').reply(200, {
    items: [
      {
        id: 'conv-9',
        bookingId: 'bk-9',
        requestId: 'req-9',
        otherParticipant: { displayName: 'Rami F.', initials: 'RF', avatarUrl: null },
        lastMessageBody: null,
        lastMessageAt: null,
        unreadCount: 0,
        createdAt: '2026-10-04T09:00:00.000Z',
        updatedAt: '2026-10-04T09:00:00.000Z',
      },
    ],
    nextCursor: null,
  });
});
afterEach(() => mock.restore());

function renderThread() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/provider/messages/conv-9']}>
          <Routes>
            <Route path="/provider/messages/:threadId" element={<ProviderChatScreen />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const posted = () =>
  mock.history.post
    .filter((r) => r.url === ROUTE)
    .map((r) => JSON.parse(r.data as string) as { body: string; idempotencyKey: string });

describe('ProviderChatScreen — send recovery (R12)', () => {
  it('sending the failed draft again reuses its key; the next message gets a new one', async () => {
    const stored: Array<{ id: string; body: string; key: string }> = [];
    let loseReply = true;
    mock.onGet(ROUTE).reply(() => [
      200,
      {
        items: stored.map((m) => ({
          id: m.id,
          senderRole: 'PROVIDER',
          body: m.body,
          sentByMe: true,
          createdAt: '2026-10-04T10:00:00.000Z',
        })),
        nextCursor: null,
      },
    ]);
    mock.onPost(ROUTE).reply((config) => {
      const { body, idempotencyKey } = JSON.parse(config.data as string);
      let row = stored.find((m) => m.key === idempotencyKey);
      if (!row) {
        row = { id: `m-${stored.length + 1}`, body, key: idempotencyKey };
        stored.push(row);
      }
      if (loseReply) {
        loseReply = false;
        return Promise.reject(Object.assign(new Error('Network Error'), { isAxiosError: true }));
      }
      return [
        201,
        {
          message: {
            id: row.id,
            senderRole: 'PROVIDER',
            body: row.body,
            sentByMe: true,
            createdAt: '2026-10-04T10:00:00.000Z',
          },
        },
      ];
    });

    renderThread();
    const input = await screen.findByLabelText('Type a message…');
    fireEvent.change(input, { target: { value: 'On my way at ten' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send the message.');
    // The draft is kept; sending it unchanged is the same message.
    expect(input).toHaveValue('On my way at ten');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(posted()).toHaveLength(2);
    expect(posted()[1].idempotencyKey).toBe(posted()[0].idempotencyKey);
    expect(stored).toHaveLength(1);

    // A new message, even with the same text, is a new send.
    fireEvent.change(input, { target: { value: 'On my way at ten' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(posted()).toHaveLength(3));
    expect(posted()[2].idempotencyKey).not.toBe(posted()[0].idempotencyKey);
    await waitFor(() => expect(stored).toHaveLength(2));
  });
});
