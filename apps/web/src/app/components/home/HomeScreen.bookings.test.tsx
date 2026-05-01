import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter } from 'react-router';
import { api } from '../../../lib/api';
import { AuthProvider, queryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { HomeScreen } from './HomeScreen';

// ─────────────────────────────────────────────────────────────────────────────
// Slice 2.3 contract: the Bookings tab reads from /v1/me/bookings, not
// from the slice-2 BOOKING_DATA constant. Empty / loading / list / error
// states are all safe and never expose raw backend error text. The card
// visuals (status pill colour, avatar pill, pro line) are unchanged from
// the slice-2 placeholder.
// ─────────────────────────────────────────────────────────────────────────────

function renderHomeOnBookings() {
  return render(
    <AuthProvider>
      <LanguageProvider>
        <EcosystemProvider>
          <MemoryRouter initialEntries={['/home/bookings']}>
            <HomeScreen isOffline={false} onServiceSelect={() => {}} onToggleOffline={() => {}} />
          </MemoryRouter>
        </EcosystemProvider>
      </LanguageProvider>
    </AuthProvider>,
  );
}

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  queryClient.clear();
});

afterEach(() => {
  mock.restore();
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
});

const MOCK_ME = {
  id: 'u1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: 'ACTIVE' as const,
  emailVerifiedAt: '2026-04-19T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer' as const],
};

const BOOKING_OMAR = {
  id: 'bk-omar',
  requestId: 'req-1',
  bidId: 'bid-1',
  status: 'SCHEDULED' as const,
  scheduledAt: '2026-04-29T15:00:00.000Z',
  priceAmount: 35,
  currency: 'USD',
  pricingType: 'HOURLY' as const,
  createdAt: '2026-04-28T02:00:00.000Z',
  service: {
    categorySlug: 'plumbing',
    categoryLabelEn: 'Plumbing',
    categoryLabelAr: 'سباكة',
    customServiceText: null,
  },
  provider: {
    id: 'pp-omar',
    displayName: 'Omar Al-Khalid',
    initials: 'OK',
    avatarUrl: null,
    ratingAvg: 4.9,
    reviewCount: 312,
    completedJobs: 540,
    verified: true,
    topPro: true,
  },
  addressSnapshot: {
    label: 'Home',
    line1: '123 Main',
    city: 'Riyadh',
    country: 'SA',
    lat: null,
    lng: null,
  },
};

describe('HomeScreen — Bookings tab (slice 2.3)', () => {
  beforeEach(() => {
    // Auth + requests are unrelated to bookings rendering but the
    // HomeScreen mounts both queries; mock them so they don't 404 the
    // tests with noisy console errors.
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/requests').reply(200, { items: [], nextCursor: null });
  });

  it('reads from /v1/me/bookings and renders provider + service from API', async () => {
    mock.onGet('/v1/me/bookings').reply(200, {
      items: [BOOKING_OMAR],
      nextCursor: null,
    });
    renderHomeOnBookings();

    await waitFor(() => {
      // Service label from category, not from the old "Plumbing Repair" placeholder.
      expect(screen.getByText('Plumbing')).toBeInTheDocument();
    });
    // Pro line uses the API displayName. (Some other surfaces — e.g.
    // the bell-badge notification body — also contain the same string;
    // we just need at least one occurrence to prove the booking card
    // rendered against API data.)
    expect(screen.getAllByText(/Omar Al-Khalid/).length).toBeGreaterThan(0);
    // Avatar pill carries the API initials, not the slice-2 hardcoded set.
    expect(screen.getByText('OK')).toBeInTheDocument();

    // The slice-2 BOOKING_DATA had hardcoded service labels "AC
    // Maintenance" / "Cabinet Install" / "Deep Cleaning" / "Plumbing
    // Repair" — none of those should appear unless the API actually
    // returned them. (Other strings like "Sara M." also appeared in
    // BOOKING_DATA but are kept around in INITIAL_NOTIFS mock data,
    // which is unrelated to this slice — those are NOT asserted.)
    expect(screen.queryByText(/AC Maintenance/)).toBeNull();
    expect(screen.queryByText(/Cabinet Install/)).toBeNull();
    expect(screen.queryByText(/Deep Cleaning/)).toBeNull();
    expect(screen.queryByText(/Plumbing Repair/)).toBeNull();
  });

  it('renders the empty state when the API returns zero bookings', async () => {
    mock.onGet('/v1/me/bookings').reply(200, { items: [], nextCursor: null });
    renderHomeOnBookings();

    await waitFor(() => {
      expect(screen.getByText(/no bookings yet/i)).toBeInTheDocument();
    });
    // Empty-state copy is the existing slice-2 idiom.
    expect(screen.getByText(/post your first job/i)).toBeInTheDocument();
  });

  it('renders the loading state while the API is in flight', async () => {
    let resolve: (v: [number, unknown]) => void = () => {};
    const pending = new Promise<[number, unknown]>((r) => {
      resolve = r;
    });
    mock.onGet('/v1/me/bookings').reply(() => pending);
    renderHomeOnBookings();

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/loading bookings/i)).toBeInTheDocument();
    resolve([200, { items: [], nextCursor: null }]);
  });

  it('renders a safe error message on 500 (no raw backend leak)', async () => {
    mock.onGet('/v1/me/bookings').reply(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'PrismaClientKnownRequestError: column bookings.foo does not exist',
      },
    });
    renderHomeOnBookings();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/couldn't load bookings/i)).toBeInTheDocument();
    // Raw backend message must never reach the DOM.
    expect(screen.queryByText(/PrismaClient/i)).toBeNull();
    expect(screen.queryByText(/column bookings/i)).toBeNull();
  });
});
