import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { MyBidsScreen } from './MyBidsScreen';

// R12 — the provider's Message action on an accepted booking opens the
// booking's conversation as the server resolves it for the provider side,
// under /provider/messages/:id. A bid that is not accepted has no booking and
// no Message action.

const bid = (id: string, status: 'PENDING' | 'ACCEPTED') => ({
  id,
  amount: 120,
  currency: 'USD',
  pricingType: 'FIXED',
  note: null,
  status,
  responseTimeMinutes: 30,
  submittedAt: '2026-10-03T09:00:00.000Z',
  // The server links an accepted bid to its booking (E-18).
  booking: status === 'ACCEPTED' ? { id: 'bk-1', status: 'SCHEDULED' } : null,
  request: {
    id: `req-${id}`,
    category: { id: 'c', slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
    customServiceText: null,
    description: null,
    city: 'Aleppo',
    country: 'SY',
  },
});

function Thread() {
  const { threadId } = useParams();
  return <p data-testid="thread">{threadId}</p>;
}

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet('/v1/provider/bids').reply(200, {
    items: [bid('bid-1', 'ACCEPTED'), bid('bid-2', 'PENDING')],
    nextCursor: null,
  });
  mock.onGet('/v1/provider/bookings').reply(200, {
    items: [
      {
        id: 'bk-1',
        requestId: 'req-bid-1',
        bidId: 'bid-1',
        status: 'SCHEDULED',
        scheduledAt: null,
        priceAmount: 120,
        currency: 'USD',
        pricingType: 'FIXED',
        bidNote: null,
        createdAt: '2026-10-03T09:00:00.000Z',
        updatedAt: '2026-10-03T09:00:00.000Z',
        service: {
          categorySlug: 'plumbing',
          categoryLabelEn: 'Plumbing',
          categoryLabelAr: 'سباكة',
          customServiceText: null,
        },
        seeker: { firstName: 'Rami', city: 'Aleppo' },
      },
    ],
    nextCursor: null,
  });
});
afterEach(() => mock.restore());

function renderScreen() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/provider/bids']}>
          <Routes>
            <Route path="/provider/bids" element={<MyBidsScreen />} />
            <Route path="/provider/messages/:threadId" element={<Thread />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('MyBidsScreen — Message (R12)', () => {
  it('opens the server-resolved conversation of the accepted booking', async () => {
    mock.onPost('/v1/provider/conversations').reply(200, {
      conversation: {
        id: 'conv-77',
        bookingId: 'bk-1',
        requestId: 'req-bid-1',
        otherParticipant: { displayName: 'Rami F.', initials: 'RF', avatarUrl: null },
        lastMessageBody: null,
        lastMessageAt: null,
        unreadCount: 0,
        createdAt: '2026-10-03T10:00:00.000Z',
        updatedAt: '2026-10-03T10:00:00.000Z',
      },
    });
    renderScreen();
    fireEvent.click(await screen.findByTestId('provider-booking-message-bk-1'));
    expect(await screen.findByTestId('thread')).toHaveTextContent('conv-77');
    const posts = mock.history.post.filter((r) => r.url === '/v1/provider/conversations');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0].data as string)).toEqual({ bookingId: 'bk-1' });
  });

  it('shows a refusal instead of opening anything', async () => {
    mock.onPost('/v1/provider/conversations').reply(403, { error: { code: 'FORBIDDEN' } });
    renderScreen();
    fireEvent.click(await screen.findByTestId('provider-booking-message-bk-1'));
    expect(await screen.findByTestId('provider-booking-message-error-bk-1')).toHaveAttribute(
      'data-error',
      'SESSION',
    );
    expect(screen.queryByTestId('thread')).toBeNull();
  });

  it('a bid without a booking has no Message action', async () => {
    renderScreen();
    await screen.findByTestId('provider-booking-message-bk-1');
    await waitFor(() =>
      expect(screen.queryAllByTestId(/^provider-booking-message-/)).toHaveLength(1),
    );
  });
});
