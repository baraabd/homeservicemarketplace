import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
});
