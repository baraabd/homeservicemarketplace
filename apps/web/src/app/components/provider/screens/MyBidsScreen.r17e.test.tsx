import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { MyBidsScreen } from './MyBidsScreen';

// R17-E — My Bids says what the server holds: a failed load is not "no bids",
// a withdrawn bid is shown as withdrawn, withdrawal is confirmed and reported,
// and the price is the stored amount, currency and pricing type.

const bid = (
  id: string,
  status: 'PENDING' | 'ACCEPTED' | 'WITHDRAWN',
  pricingType: 'HOURLY' | 'FIXED' = 'FIXED',
) => ({
  id,
  amount: 120,
  currency: 'XTS',
  pricingType,
  note: null,
  status,
  responseTimeMinutes: 30,
  submittedAt: '2026-10-03T09:00:00.000Z',
  request: {
    id: `req-${id}`,
    category: { id: 'c', slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
    customServiceText: null,
    description: null,
    city: 'Aleppo',
    country: 'SY',
  },
});

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api, { delayResponse: 10 });
  mock.onGet('/v1/provider/bookings').reply(200, { items: [], nextCursor: null });
  window.localStorage.removeItem('hsm.lang');
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
            <Route path="/provider/bookings" element={<p>Bookings list</p>} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('MyBidsScreen — R17-E', () => {
  it('a failed load is an error with a retry, not an empty list', async () => {
    mock.onGet('/v1/provider/bids').reply(500, { error: { code: 'INTERNAL_ERROR' } });
    renderScreen();
    expect(await screen.findByTestId('provider-bids-error')).toBeInTheDocument();
    expect(screen.queryByText('No bids submitted yet')).toBeNull();
  });

  it('prints the stored amount, currency and pricing type — no "$", no invented "/hr"', async () => {
    mock.onGet('/v1/provider/bids').reply(200, {
      items: [bid('b-fixed', 'PENDING', 'FIXED'), bid('b-hourly', 'PENDING', 'HOURLY')],
      nextCursor: null,
    });
    renderScreen();
    const fixed = await screen.findByTestId('provider-bid-price-b-fixed');
    expect(fixed).toHaveTextContent('120 XTS');
    expect(fixed).toHaveTextContent('fixed price');
    expect(fixed.textContent).not.toMatch(/\$|\/hr/);
    expect(screen.getByTestId('provider-bid-price-b-hourly')).toHaveTextContent('per hour');
  });

  it('shows a withdrawn bid as withdrawn, with no actions', async () => {
    mock.onGet('/v1/provider/bids').reply(200, {
      items: [bid('b-gone', 'WITHDRAWN')],
      nextCursor: null,
    });
    renderScreen();
    expect(await screen.findByTestId('provider-bid-status-b-gone')).toHaveTextContent('Withdrawn');
    expect(screen.queryByTestId('provider-bid-withdraw-b-gone')).toBeNull();
  });

  it('withdrawal needs confirmation, then reports the server outcome', async () => {
    mock
      .onGet('/v1/provider/bids')
      .reply(200, { items: [bid('b-1', 'PENDING')], nextCursor: null });
    mock.onPost('/v1/provider/bids/b-1/withdraw').reply(200, { bid: bid('b-1', 'WITHDRAWN') });
    renderScreen();
    fireEvent.click(await screen.findByTestId('provider-bid-withdraw-b-1'));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Withdraw this bid?');
    expect(mock.history.post).toHaveLength(0);
    fireEvent.click(screen.getByTestId('provider-bid-withdraw-dialog-b-1-confirm'));
    expect(await screen.findByTestId('provider-bid-withdraw-result-b-1')).toHaveAttribute(
      'data-result',
      'done',
    );
    expect(
      mock.history.post.filter((r) => r.url === '/v1/provider/bids/b-1/withdraw'),
    ).toHaveLength(1);
  });

  it('a withdrawal the server refuses as stale says so', async () => {
    mock
      .onGet('/v1/provider/bids')
      .reply(200, { items: [bid('b-1', 'PENDING')], nextCursor: null });
    mock.onPost('/v1/provider/bids/b-1/withdraw').reply(409, { error: { code: 'CONFLICT' } });
    renderScreen();
    fireEvent.click(await screen.findByTestId('provider-bid-withdraw-b-1'));
    fireEvent.click(await screen.findByTestId('provider-bid-withdraw-dialog-b-1-confirm'));
    const result = await screen.findByTestId('provider-bid-withdraw-result-b-1');
    expect(result).toHaveAttribute('data-result', 'CONFLICT');
    expect(result).toHaveAttribute('role', 'alert');
  });

  it('links to the bookings list', async () => {
    mock.onGet('/v1/provider/bids').reply(200, { items: [], nextCursor: null });
    renderScreen();
    fireEvent.click(await screen.findByTestId('provider-bids-bookings-link'));
    expect(await screen.findByText('Bookings list')).toBeInTheDocument();
  });

  it('keeps amount and currency as one LTR run in Arabic', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    mock
      .onGet('/v1/provider/bids')
      .reply(200, { items: [bid('b-1', 'PENDING')], nextCursor: null });
    renderScreen();
    const price = await screen.findByTestId('provider-bid-price-b-1');
    expect(price.querySelector('bdi')).toHaveAttribute('dir', 'ltr');
    expect(price).toHaveTextContent('سعر ثابت');
    await waitFor(() =>
      expect(screen.getByTestId('provider-bid-status-b-1')).toHaveTextContent('قيد الانتظار'),
    );
  });
});
