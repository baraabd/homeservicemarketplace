import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ProviderBookingDetailScreen } from './ProviderBookingDetailScreen';

// R17-E (E-7) — the booking detail renders the provider projection and the
// persisted timeline, and nothing the server did not send.

const DETAIL = {
  id: 'bk-1',
  requestId: 'req-1',
  bidId: 'bid-1',
  status: 'IN_PROGRESS',
  scheduledAt: null,
  priceAmount: 150,
  currency: 'XTS',
  pricingType: 'HOURLY',
  bidNote: 'Bring the long ladder',
  createdAt: '2026-10-03T09:00:00.000Z',
  updatedAt: '2026-10-03T10:00:00.000Z',
  service: {
    categorySlug: 'plumbing',
    categoryLabelEn: 'Plumbing',
    categoryLabelAr: 'سباكة',
    customServiceText: null,
  },
  seeker: { firstName: 'Rami', city: 'Aleppo' },
  addressSnapshot: {
    label: null,
    line1: '12 Baron Street',
    city: 'Aleppo',
    country: 'SY',
    lat: 36.2021,
    lng: 37.1343,
  },
  description: 'Kitchen tap leaks',
  requestMediaUrls: [],
};
const TIMELINE = {
  items: [
    { id: 'e1', type: 'BOOKING_CREATED', metadata: null, createdAt: '2026-10-03T09:00:00.000Z' },
    {
      id: 'e2',
      type: 'BOOKING_STATUS_CHANGED',
      metadata: { from: 'SCHEDULED', to: 'IN_PROGRESS' },
      createdAt: '2026-10-03T10:00:00.000Z',
    },
  ],
};

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  window.localStorage.removeItem('hsm.lang');
});
afterEach(() => mock.restore());

function renderDetail() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/provider/bookings/bk-1']}>
          <Routes>
            <Route path="/provider/bookings/:bookingId" element={<ProviderBookingDetailScreen />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('ProviderBookingDetailScreen', () => {
  it('renders the projection, the persisted history and the actions the status allows', async () => {
    mock.onGet('/v1/provider/bookings/bk-1').reply(200, DETAIL);
    mock.onGet('/v1/provider/bookings/bk-1/timeline').reply(200, TIMELINE);
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Plumbing' })).toBeInTheDocument();
    expect(screen.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'IN_PROGRESS',
    );
    expect(screen.getByText('Rami · Aleppo')).toBeInTheDocument();
    expect(screen.getByTestId('provider-booking-offer')).toHaveTextContent('150 XTS per hour');
    expect(screen.getByText('12 Baron Street, Aleppo')).toBeInTheDocument();
    expect(screen.getByText('As soon as possible')).toBeInTheDocument();
    expect(screen.getByText('Bring the long ladder')).toBeInTheDocument();
    // In progress → Complete only.
    expect(screen.getByTestId('provider-booking-complete-bk-1')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-booking-start-bk-1')).toBeNull();
    const history = await screen.findByTestId('provider-timeline');
    const entries = within(history)
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '');
    expect(entries[0]).toContain('Booking created');
    expect(entries[1]).toContain('In progress');
    // Coordinates are in the projection, but this surface does not show them.
    expect(document.body.textContent).not.toMatch(/36\.2021|37\.1343/);
  });

  it('a booking the server does not give this provider is "not available", with no actions', async () => {
    mock.onGet('/v1/provider/bookings/bk-1').reply(404, { error: { code: 'NOT_FOUND' } });
    mock.onGet('/v1/provider/bookings/bk-1/timeline').reply(404, { error: { code: 'NOT_FOUND' } });
    renderDetail();
    expect(await screen.findByTestId('provider-booking-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-booking-actions-bk-1')).toBeNull();
  });

  it('a failed load offers a retry instead of an empty page', async () => {
    mock.onGet('/v1/provider/bookings/bk-1').reply(500, { error: { code: 'INTERNAL_ERROR' } });
    mock.onGet('/v1/provider/bookings/bk-1/timeline').reply(500, {});
    renderDetail();
    expect(await screen.findByTestId('provider-booking-error')).toBeInTheDocument();
  });

  it('renders in Arabic', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    mock.onGet('/v1/provider/bookings/bk-1').reply(200, DETAIL);
    mock.onGet('/v1/provider/bookings/bk-1/timeline').reply(200, TIMELINE);
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'سباكة' })).toBeInTheDocument();
    expect(screen.getByTestId('provider-booking-offer')).toHaveTextContent('للساعة');
    expect(screen.getByTestId('provider-booking-complete-bk-1')).toHaveTextContent('إنهاء العمل');
  });
});
