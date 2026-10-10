import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

import { api } from '../../../../lib/api';
import { clearAuthSession } from '../../../../lib/auth-session-reset';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ProviderBookingsScreen } from './ProviderBookingsScreen';

// R17-E post-merge closure (CLOSURE-1) — the bookings list pages through the
// server's cursor. Before this, the screen rendered page one and never read
// nextCursor, so every booking after the 50th was unreachable — including the
// obligations a RESTRICTED provider is routed here to manage.
//
// These cases stub the HTTP boundary to control page timing and failure. The
// real cursor contract is proven against PostgreSQL in
// r17-e-closure.integration.spec.ts and in a real browser.

const PAGE = 50;

function booking(i: number, owner = 'a') {
  return {
    id: `bk-${owner}-${String(i).padStart(3, '0')}`,
    requestId: `req-${owner}-${i}`,
    bidId: `bid-${owner}-${i}`,
    status: 'SCHEDULED',
    scheduledAt: null,
    priceAmount: 100 + i,
    currency: 'XTS',
    pricingType: 'FIXED',
    createdAt: '2026-10-03T09:00:00.000Z',
    service: {
      categorySlug: 'plumbing',
      categoryLabelEn: `Plumbing ${owner}${i}`,
      categoryLabelAr: `سباكة ${owner}${i}`,
      customServiceText: null,
    },
    seeker: { firstName: 'Rami', city: 'Aleppo' },
  };
}
const range = (from: number, to: number, owner = 'a') =>
  Array.from({ length: to - from }, (_, k) => booking(from + k, owner));

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  window.localStorage.removeItem('hsm.lang');
});
afterEach(() => {
  mock.restore();
  vi.restoreAllMocks();
});

function renderList(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const view = render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/provider/bookings']}>
          <ProviderBookingsScreen canTakeNewWork={false} />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return { qc, ...view };
}

const rows = () => screen.queryAllByTestId(/^provider-booking-row-/);
const rowIds = () =>
  rows().map((r) => r.getAttribute('data-testid')!.replace('provider-booking-row-', ''));
/** Requests the screen sent, as their cursor (null = first page). */
const cursorsSent = () =>
  mock.history.get
    .filter((r) => r.url === '/v1/provider/bookings')
    .map((r) => (r.params as { cursor?: string }).cursor ?? null);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('ProviderBookingsScreen pagination', () => {
  it('loads every page through nextCursor, in server order, without repeating a row', async () => {
    mock.onGet('/v1/provider/bookings').reply((config) => {
      const cursor = (config.params as { cursor?: string }).cursor;
      if (!cursor) return [200, { items: range(0, PAGE), nextCursor: 'bk-a-049' }];
      if (cursor === 'bk-a-049')
        return [200, { items: range(PAGE, 2 * PAGE), nextCursor: 'bk-a-099' }];
      if (cursor === 'bk-a-099')
        return [200, { items: range(2 * PAGE, 2 * PAGE + 5), nextCursor: null }];
      return [400, {}];
    });
    renderList();
    await waitFor(() => expect(rows()).toHaveLength(PAGE));
    // The first request carries no cursor; nothing else is fetched unasked.
    expect(cursorsSent()).toEqual([null]);

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows()).toHaveLength(2 * PAGE));
    // Focus lands on the first booking that just arrived, not on the page.
    expect(document.activeElement).toBe(screen.getByTestId('provider-booking-row-bk-a-050'));

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows()).toHaveLength(2 * PAGE + 5));

    expect(rowIds()).toEqual(range(0, 2 * PAGE + 5).map((b) => b.id));
    expect(new Set(rowIds()).size).toBe(rowIds().length);
    expect(cursorsSent()).toEqual([null, 'bk-a-049', 'bk-a-099']);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.getByTestId('provider-bookings-end')).toHaveTextContent('All bookings shown');
    expect(screen.getByTestId('provider-bookings-count')).toHaveTextContent('Showing 105 bookings');
  });

  it('a single page shows no load-more control and no end marker', async () => {
    mock.onGet('/v1/provider/bookings').reply(200, { items: range(0, 3), nextCursor: null });
    renderList();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(screen.queryByTestId('provider-bookings-end')).toBeNull();
  });

  it('a later page that fails keeps the loaded rows usable and retries that same page', async () => {
    let failNext = true;
    mock.onGet('/v1/provider/bookings').reply((config) => {
      const cursor = (config.params as { cursor?: string }).cursor;
      if (!cursor) return [200, { items: range(0, PAGE), nextCursor: 'bk-a-049' }];
      if (failNext) {
        failNext = false;
        return [503, { error: { code: 'SERVICE_UNAVAILABLE' } }];
      }
      return [200, { items: range(PAGE, PAGE + 5), nextCursor: null }];
    });
    renderList();
    await waitFor(() => expect(rows()).toHaveLength(PAGE));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    const alert = await screen.findByTestId('provider-bookings-more-error');
    // Announced once, next to the control that failed.
    expect(within(alert).getByRole('alert')).toHaveTextContent('Couldn’t load more bookings.');
    // The first page is still on screen and still links to each booking.
    expect(rows()).toHaveLength(PAGE);
    expect(screen.getByTestId('provider-booking-row-bk-a-000')).toHaveAttribute(
      'href',
      '/provider/bookings/bk-a-000',
    );
    expect(screen.queryByTestId('provider-bookings-error')).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(rows()).toHaveLength(PAGE + 5));
    expect(screen.queryByTestId('provider-bookings-more-error')).toBeNull();
    // The retry asked for the page that failed, not the first page again.
    expect(cursorsSent()).toEqual([null, 'bk-a-049', 'bk-a-049']);
  });

  it('never starts a second next-page request while one is in flight', async () => {
    const page2 = deferred<[number, unknown]>();
    mock.onGet('/v1/provider/bookings').reply((config) => {
      const cursor = (config.params as { cursor?: string }).cursor;
      if (!cursor) return [200, { items: range(0, PAGE), nextCursor: 'bk-a-049' }];
      return page2.promise;
    });
    renderList();
    await waitFor(() => expect(rows()).toHaveLength(PAGE));
    const button = screen.getByRole('button', { name: 'Load more' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Loading more bookings…');
    fireEvent.click(button);
    fireEvent.click(button);
    expect(cursorsSent()).toEqual([null, 'bk-a-049']);
    await act(async () => page2.resolve([200, { items: range(PAGE, PAGE + 2), nextCursor: null }]));
    await waitFor(() => expect(rows()).toHaveLength(PAGE + 2));
    expect(cursorsSent()).toEqual([null, 'bk-a-049']);
  });

  it('a page that lands after sign-out never reaches the next account', async () => {
    const page2 = deferred<[number, unknown]>();
    mock.onGet('/v1/provider/bookings').reply((config) => {
      const cursor = (config.params as { cursor?: string }).cursor;
      if (!cursor) return [200, { items: range(0, PAGE), nextCursor: 'bk-a-049' }];
      return page2.promise;
    });
    const { qc, unmount } = renderList();
    await waitFor(() => expect(rows()).toHaveLength(PAGE));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(cursorsSent()).toHaveLength(2));

    // Session ends (logout, expiry or account switch) while page 2 is out.
    await act(async () => clearAuthSession(qc));
    unmount();
    await act(async () => page2.resolve([200, { items: range(PAGE, PAGE + 5), nextCursor: null }]));
    expect(qc.getQueryCache().findAll({ queryKey: ['provider', 'bookings'] })).toHaveLength(0);

    // The next account starts from its own first page only.
    mock.reset();
    mock.onGet('/v1/provider/bookings').reply(200, { items: range(0, 2, 'b'), nextCursor: null });
    renderList(qc);
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rowIds()).toEqual(['bk-b-000', 'bk-b-001']);
  });

  it('reports, and does not repeat, a row the server returned on two pages', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mock.onGet('/v1/provider/bookings').reply((config) => {
      const cursor = (config.params as { cursor?: string }).cursor;
      if (!cursor) return [200, { items: range(0, 3), nextCursor: 'bk-a-002' }];
      // A broken cursor contract: the boundary row comes back again.
      return [200, { items: range(2, 5), nextCursor: null }];
    });
    renderList();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(rowIds()).toEqual(range(0, 5).map((b) => b.id));
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('overlapping pages'),
      expect.objectContaining({ duplicates: 1 }),
    );
  });

  it('Arabic: the control, its progress and the end marker read in Arabic', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    mock
      .onGet('/v1/provider/bookings')
      .reply((config) =>
        (config.params as { cursor?: string }).cursor
          ? [200, { items: range(PAGE, PAGE + 1), nextCursor: null }]
          : [200, { items: range(0, PAGE), nextCursor: 'bk-a-049' }],
      );
    renderList();
    await waitFor(() => expect(rows()).toHaveLength(PAGE));
    fireEvent.click(screen.getByRole('button', { name: 'عرض المزيد' }));
    await waitFor(() => expect(rows()).toHaveLength(PAGE + 1));
    expect(screen.getByTestId('provider-bookings-end')).toHaveTextContent('تم عرض كل الحجوزات');
  });
});
