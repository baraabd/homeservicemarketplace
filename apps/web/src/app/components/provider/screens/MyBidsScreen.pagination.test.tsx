import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { flattenBidPages } from '../../../hooks/provider/useMyBids';
import { MyBidsScreen } from './MyBidsScreen';

// E-18 — My Bids pages through the server's cursor. Before this, the screen
// rendered the first 20 bids and never read nextCursor, and it linked each
// accepted bid to a booking only when that booking was on the first page of
// the bookings list — any other accepted bid said "Waiting for booking…".
//
// These cases stub the HTTP boundary to control page timing and failure. The
// real cursor contract is proven against PostgreSQL in
// provider-my-bids.integration.spec.ts and in a real browser.

const PAGE = 20;

function bid(i: number, status: 'PENDING' | 'ACCEPTED' | 'REJECTED' = 'PENDING') {
  const id = `bid-${String(i).padStart(3, '0')}`;
  return {
    id,
    amount: 100 + i,
    currency: 'XTS',
    pricingType: 'FIXED',
    note: null,
    status,
    responseTimeMinutes: 30,
    submittedAt: '2026-10-03T09:00:00.000Z',
    request: {
      id: `req-${i}`,
      category: { id: 'c', slug: 'plumbing', labelEn: `Plumbing ${i}`, labelAr: `سباكة ${i}` },
      customServiceText: null,
      description: null,
      city: 'Aleppo',
      country: 'SY',
    },
    booking: status === 'ACCEPTED' ? { id: `bk-${i}`, status: 'SCHEDULED' } : null,
  };
}
const range = (from: number, to: number, accepted: number[] = []) =>
  Array.from({ length: to - from }, (_, k) =>
    bid(from + k, accepted.includes(from + k) ? 'ACCEPTED' : 'PENDING'),
  );

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  window.localStorage.removeItem('hsm.lang');
});
afterEach(() => {
  mock.restore();
  vi.restoreAllMocks();
});

function renderBids() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/provider/bids']}>
          <MyBidsScreen />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const cards = () => screen.queryAllByTestId(/^provider-bid-bid-/);
const cardIds = () =>
  cards().map((c) => c.getAttribute('data-testid')!.replace('provider-bid-', ''));
const cursorsSent = () =>
  mock.history.get
    .filter((r) => r.url === '/v1/provider/bids')
    .map((r) => (r.params as { cursor?: string }).cursor ?? null);

describe('MyBidsScreen pagination (E-18)', () => {
  it('loads every page through nextCursor, in server order, with partial counts marked', async () => {
    mock.onGet('/v1/provider/bids').reply((config) => {
      const cursor = (config.params as { cursor?: string }).cursor;
      if (!cursor) return [200, { items: range(0, PAGE), nextCursor: 'bid-019' }];
      if (cursor === 'bid-019')
        return [200, { items: range(PAGE, 2 * PAGE), nextCursor: 'bid-039' }];
      if (cursor === 'bid-039')
        return [200, { items: range(2 * PAGE, 2 * PAGE + 3), nextCursor: null }];
      return [400, {}];
    });
    renderBids();
    await waitFor(() => expect(cards()).toHaveLength(PAGE));
    expect(cursorsSent()).toEqual([null]);
    // While more pages exist the count is of the bids loaded, and says so.
    const pending = screen.getByTestId('provider-bids-count-pending');
    expect(pending).toHaveTextContent('20+');
    expect(pending).toHaveTextContent('at least 20');

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(cards()).toHaveLength(2 * PAGE));
    // Focus continues at the first bid that just arrived.
    expect(document.activeElement).toBe(screen.getByTestId('provider-bid-bid-020'));

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(cards()).toHaveLength(2 * PAGE + 3));

    expect(cardIds()).toEqual(range(0, 2 * PAGE + 3).map((b) => b.id));
    expect(cursorsSent()).toEqual([null, 'bid-019', 'bid-039']);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.getByTestId('provider-bids-end')).toHaveTextContent('All bids shown');
    expect(screen.getByTestId('provider-bids-shown')).toHaveTextContent('Showing 43 bids');
    // Every page read: the count is now the total, with no marker.
    expect(screen.getByTestId('provider-bids-count-pending')).toHaveTextContent(/^Pending43$/);
  });

  it('an accepted bid on a later page opens its own booking, without reading the bookings list', async () => {
    mock.onGet('/v1/provider/bids').reply((config) => {
      const cursor = (config.params as { cursor?: string }).cursor;
      if (!cursor) return [200, { items: range(0, PAGE), nextCursor: 'bid-019' }];
      return [200, { items: range(PAGE, PAGE + 5, [PAGE + 2]), nextCursor: null }];
    });
    renderBids();
    await waitFor(() => expect(cards()).toHaveLength(PAGE));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    const card = await screen.findByTestId('provider-bid-bid-022');
    expect(card).toHaveAttribute('data-status', 'accepted');
    expect(within(card).getByTestId('provider-bid-booking-status-bid-022')).toHaveAttribute(
      'data-status',
      'SCHEDULED',
    );
    expect(within(card).getByTestId('provider-bid-open-booking-bid-022')).toHaveAttribute(
      'href',
      '/provider/bookings/bk-22',
    );
    expect(within(card).queryByText('Waiting for booking…')).toBeNull();
    expect(mock.history.get.filter((r) => r.url === '/v1/provider/bookings')).toHaveLength(0);
  });

  it('a later page that fails keeps the loaded bids usable and retries that same page', async () => {
    let failNext = true;
    mock.onGet('/v1/provider/bids').reply((config) => {
      const cursor = (config.params as { cursor?: string }).cursor;
      if (!cursor) return [200, { items: range(0, PAGE), nextCursor: 'bid-019' }];
      if (failNext) {
        failNext = false;
        return [503, { error: { code: 'SERVICE_UNAVAILABLE' } }];
      }
      return [200, { items: range(PAGE, PAGE + 2), nextCursor: null }];
    });
    renderBids();
    await waitFor(() => expect(cards()).toHaveLength(PAGE));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    const alert = await screen.findByTestId('provider-bids-more-error');
    expect(within(alert).getByRole('alert')).toHaveTextContent('Couldn’t load more bids.');
    // The loaded bids stay, and the first-page error state is not shown.
    expect(cards()).toHaveLength(PAGE);
    expect(screen.queryByTestId('provider-bids-error')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(cards()).toHaveLength(PAGE + 2));
    expect(screen.queryByTestId('provider-bids-more-error')).toBeNull();
    expect(cursorsSent()).toEqual([null, 'bid-019', 'bid-019']);
  });

  it('never sends a second page request while one is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mock.onGet('/v1/provider/bids').reply(async (config) => {
      const cursor = (config.params as { cursor?: string }).cursor;
      if (!cursor) return [200, { items: range(0, PAGE), nextCursor: 'bid-019' }];
      await gate;
      return [200, { items: range(PAGE, PAGE + 1), nextCursor: null }];
    });
    renderBids();
    await waitFor(() => expect(cards()).toHaveLength(PAGE));
    const button = screen.getByRole('button', { name: 'Load more' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Loading more bids…');
    fireEvent.click(button);
    release();
    await waitFor(() => expect(cards()).toHaveLength(PAGE + 1));
    expect(cursorsSent()).toEqual([null, 'bid-019']);
  });

  it('speaks Arabic: control, end marker and partial count', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    mock.onGet('/v1/provider/bids').reply((config) => {
      const cursor = (config.params as { cursor?: string }).cursor;
      if (!cursor) return [200, { items: range(0, PAGE), nextCursor: 'bid-019' }];
      return [200, { items: range(PAGE, PAGE + 1), nextCursor: null }];
    });
    renderBids();
    await waitFor(() => expect(cards()).toHaveLength(PAGE));
    expect(screen.getByTestId('provider-bids-count-pending')).toHaveTextContent('20 على الأقل');
    fireEvent.click(screen.getByRole('button', { name: 'عرض المزيد' }));
    expect(await screen.findByTestId('provider-bids-end')).toHaveTextContent('تم عرض كل العروض');
    expect(screen.getByTestId('provider-bids-shown')).toHaveTextContent('عدد العروض المعروضة: 21');
  });
});

describe('flattenBidPages', () => {
  it('keeps server order, shows a repeated id once and reports the overlap', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pages = [
      { items: range(0, 3), nextCursor: 'bid-002' },
      { items: [bid(2), bid(3)], nextCursor: null },
    ];
    expect(flattenBidPages(pages as never).map((b) => b.id)).toEqual([
      'bid-000',
      'bid-001',
      'bid-002',
      'bid-003',
    ]);
    expect(error).toHaveBeenCalledWith('provider bids: the server returned overlapping pages', {
      duplicates: 1,
    });
  });
});
