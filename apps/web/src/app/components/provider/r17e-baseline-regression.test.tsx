// R17-E — the E-4/E-5 defects as first reproduced. These three cases failed
// against the develop@2710d25 MyBidsScreen and realtime bridge (silent Start
// failure, Cancel without confirmation, status event without a capability
// refetch) and pass on the repaired code. Kept as the regression they pin.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';

import { api } from '../../../lib/api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';
import { dispatchInvalidations } from '../../../lib/realtime/use-realtime-socket';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { MyBidsScreen } from './screens/MyBidsScreen';

const accepted = {
  id: 'bid-1',
  amount: 120,
  currency: 'USD',
  pricingType: 'FIXED',
  note: null,
  status: 'ACCEPTED',
  responseTimeMinutes: 30,
  submittedAt: '2026-10-03T09:00:00.000Z',
  booking: { id: 'bk-1', status: 'SCHEDULED' },
  request: {
    id: 'req-1',
    category: { id: 'c', slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
    customServiceText: null,
    description: null,
    city: 'Aleppo',
    country: 'SY',
  },
};
const booking = {
  id: 'bk-1',
  requestId: 'req-1',
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
};

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet('/v1/provider/bids').reply(200, { items: [accepted], nextCursor: null });
  mock.onGet('/v1/provider/bookings').reply(200, { items: [booking], nextCursor: null });
});
afterEach(() => mock.restore());

function renderBids() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/provider/bids']}>
          <Routes>
            <Route path="/provider/bids" element={<MyBidsScreen />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('R17-E baseline reproduction', () => {
  it('E-4a: a failed Start is reported to the provider', async () => {
    mock
      .onPost('/v1/provider/bookings/bk-1/start')
      .reply(500, { error: { code: 'INTERNAL_ERROR' } });
    renderBids();
    fireEvent.click(await screen.findByRole('button', { name: /start job/i }));
    expect(await screen.findByRole('alert', {}, { timeout: 2000 })).toBeInTheDocument();
  });

  it('E-4b: Cancel asks for confirmation before sending anything', async () => {
    mock
      .onPost('/v1/provider/bookings/bk-1/cancel')
      .reply(200, { booking: { ...booking, status: 'CANCELLED' } });
    renderBids();
    fireEvent.click(await screen.findByRole('button', { name: /cancel booking/i }));
    await new Promise((r) => setTimeout(r, 200));
    expect(mock.history.post).toHaveLength(0);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('E-5: a provider status event refetches the capability decision', () => {
    const qc = new QueryClient();
    const keys: unknown[] = [];
    qc.invalidateQueries = ((f: { queryKey?: unknown }) => {
      keys.push(f.queryKey);
      return Promise.resolve();
    }) as never;
    dispatchInvalidations(qc, {
      v: 1,
      type: 'provider.status_changed',
      userId: 'u',
      occurredAt: '2026-10-09T00:00:00Z',
      payload: {},
    } as never);
    expect(keys).toContainEqual(providerQueryKeys.capabilities.get());
  });
});
