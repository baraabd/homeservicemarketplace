import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter } from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { HomeScreen } from './HomeScreen';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 7.14 — Active Leads carousel.
//   • Phase 4: completed jobs never render in Active Leads.
//   • Phase 5: the carousel is horizontally scrollable (overflow-x-auto).
//   • Phase 6: a booking-backed lead opens the BOOKING detail source.
// ─────────────────────────────────────────────────────────────────────────────

function renderHome() {
  return render(
    <AuthProvider client={qc}>
      <LanguageProvider>
        <EcosystemProvider>
          <MemoryRouter initialEntries={['/home']}>
            <HomeScreen isOffline={false} onServiceSelect={() => {}} onToggleOffline={() => {}} />
          </MemoryRouter>
        </EcosystemProvider>
      </LanguageProvider>
    </AuthProvider>,
  );
}

let mock: MockAdapter;
let qc: QueryClient;

beforeEach(() => {
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
  mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
  mock.onGet('/v1/me/bookings').reply(200, { items: [], nextCursor: null });
  mock.onGet('/v1/me/notifications').reply(200, { items: [], nextCursor: null });
  mock.onGet('/v1/me/notifications/unread-count').reply(200, { count: 0 });
  mock.onGet('/v1/me/conversations').reply(200, { items: [], nextCursor: null });
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

function makeRequest(over: {
  id: string;
  slug: string;
  status?: string;
  activeBookingStatus?: string | null;
  activeBookingId?: string | null;
  bidsCount?: number;
}) {
  return {
    id: over.id,
    status: over.status ?? 'OPEN_FOR_BIDS',
    category: {
      id: `cat-${over.slug}`,
      slug: over.slug,
      labelEn: over.slug,
      labelAr: over.slug,
    },
    customServiceText: null,
    description: null,
    scheduleType: 'ASAP' as const,
    scheduledAt: null,
    addressSnapshot: {
      label: null,
      line1: '1 St',
      city: 'Riyadh',
      country: 'SA',
      lat: null,
      lng: null,
    },
    mediaUrls: [],
    bidsCount: over.bidsCount ?? 0,
    activeBookingId: over.activeBookingId ?? null,
    activeBookingStatus: over.activeBookingStatus ?? null,
    activeBookingUpdatedAt: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
  };
}

describe('HomeScreen — Active Leads (Sprint 7.14)', () => {
  it('excludes completed jobs from the Active Leads carousel', async () => {
    mock.onGet('/v1/me/requests').reply(200, {
      items: [
        makeRequest({
          id: 'req-done',
          slug: 'plumbing',
          status: 'BID_ACCEPTED',
          activeBookingStatus: 'COMPLETED',
          activeBookingId: 'bk-done',
          bidsCount: 1,
        }),
        makeRequest({ id: 'req-open', slug: 'electrical', status: 'OPEN_FOR_BIDS' }),
        makeRequest({
          id: 'req-prog',
          slug: 'cleaning',
          status: 'BID_ACCEPTED',
          activeBookingStatus: 'IN_PROGRESS',
          activeBookingId: 'bk-prog',
          bidsCount: 1,
        }),
      ],
      nextCursor: null,
    });

    renderHome();

    const carousel = await screen.findByTestId('active-leads-carousel');
    // Two non-completed leads render; the completed one does not.
    await waitFor(() => expect(within(carousel).getAllByTestId('lead-card')).toHaveLength(2));
    const statuses = within(carousel)
      .getAllByTestId('lead-card')
      .map((el) => el.getAttribute('data-status'));
    expect(statuses).not.toContain('completed');
    expect(statuses).toEqual(expect.arrayContaining(['pending', 'active']));
  });

  it('renders no lead cards when every request is completed', async () => {
    mock.onGet('/v1/me/requests').reply(200, {
      items: [
        makeRequest({
          id: 'req-done',
          slug: 'plumbing',
          status: 'BID_ACCEPTED',
          activeBookingStatus: 'COMPLETED',
          activeBookingId: 'bk-done',
          bidsCount: 1,
        }),
      ],
      nextCursor: null,
    });

    renderHome();
    const carousel = await screen.findByTestId('active-leads-carousel');
    // Give the feed a tick to settle, then assert no lead cards.
    await waitFor(() => expect(screen.getByTestId('active-leads-carousel')).toBeInTheDocument());
    expect(within(carousel).queryAllByTestId('lead-card')).toHaveLength(0);
  });

  it('Phase 5 — the carousel is horizontally scrollable and a vertical wheel scrolls it sideways', async () => {
    mock.onGet('/v1/me/requests').reply(200, {
      items: [
        makeRequest({ id: 'r1', slug: 'plumbing' }),
        makeRequest({ id: 'r2', slug: 'electrical' }),
        makeRequest({ id: 'r3', slug: 'cleaning' }),
        makeRequest({ id: 'r4', slug: 'carpentry' }),
      ],
      nextCursor: null,
    });

    renderHome();
    const carousel = await screen.findByTestId('active-leads-carousel');
    await waitFor(() =>
      expect(within(carousel).getAllByTestId('lead-card').length).toBeGreaterThan(0),
    );
    // Scroll-enabling layout is present.
    expect(carousel.className).toContain('overflow-x-auto');
    expect(carousel.style.touchAction).toBe('pan-x');

    // A vertical mouse wheel is translated into horizontal scrolling.
    const before = carousel.scrollLeft;
    fireEvent.wheel(carousel, { deltaY: 120, deltaX: 0 });
    expect(carousel.scrollLeft).toBeGreaterThan(before);
  });

  it('Phase 6 — tapping a booking-backed lead opens the BOOKING detail source', async () => {
    mock.onGet('/v1/me/requests').reply(200, {
      items: [
        makeRequest({
          id: 'req-prog',
          slug: 'plumbing',
          status: 'BID_ACCEPTED',
          activeBookingStatus: 'IN_PROGRESS',
          activeBookingId: 'bk-prog',
          bidsCount: 1,
        }),
      ],
      nextCursor: null,
    });
    let bookingFetched = false;
    let requestDetailFetched = false;
    mock.onGet('/v1/me/bookings/bk-prog').reply(() => {
      bookingFetched = true;
      return [200, BOOKING_DETAIL];
    });
    mock.onGet('/v1/me/bookings/bk-prog/timeline').reply(200, { items: [] });
    mock.onGet('/v1/me/requests/req-prog').reply(() => {
      requestDetailFetched = true;
      return [200, {}];
    });

    renderHome();
    const carousel = await screen.findByTestId('active-leads-carousel');
    const card = (await waitFor(() => within(carousel).getAllByTestId('lead-card')))[0];
    fireEvent.click(card);

    // It opens the BOOKING detail (correct lifecycle source), NOT the
    // request-only detail.
    await waitFor(() => expect(bookingFetched).toBe(true));
    expect(requestDetailFetched).toBe(false);
  });
});

const BOOKING_DETAIL = {
  id: 'bk-prog',
  requestId: 'req-prog',
  bidId: 'bid-1',
  status: 'COMPLETED' as const,
  scheduledAt: '2026-04-29T15:00:00.000Z',
  priceAmount: 35,
  currency: 'USD',
  pricingType: 'HOURLY' as const,
  createdAt: '2026-04-28T10:30:00.000Z',
  updatedAt: '2026-04-30T10:30:00.000Z',
  description: 'Leaky tap',
  bidNote: null,
  requestCreatedAt: '2026-04-28T08:00:00.000Z',
  requestMediaUrls: [],
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
