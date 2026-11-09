import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { launchCatalog } from '../../../test-support/launch-catalog';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { AppSelector } from '../../pages/AppSelector';
import { AdminNotificationsBell } from '../admin/AdminNotificationsBell';
import { SettingsPage } from '../profile/SettingsPage';
import { HelpSupportPage } from '../profile/HelpSupportPage';
import { BidsScreen } from './BidsScreen';
import { LeadCard } from './LeadCard';
import { HomeScreen } from './HomeScreen';

// R18 fake-success inventory — every figure and control on these seeker
// surfaces is either the server's or absent. Before this:
//   - Profile showed "12 Total Jobs · 3 Active · $420 Spent" for everyone,
//     and a switch that claimed "Changes sync when reconnected";
//   - Home showed "4.9★ · 500+ Pros Online · ~1h" and a mic that said
//     "Listening…" with no speech input;
//   - bids and bookings printed "$" and "/hr" whatever the record held, and
//     a bid card's Message button did nothing;
//   - Settings offered location and usage-data switches that stored nothing
//     and a literal version "v2.4.1";
//   - the app selector advertised "Track Pro", "Payments" and "Analytics";
//   - the admin bell showed a failed unread count as "nothing unread".

const ME = {
  id: 'u1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: 'ACTIVE' as const,
  emailVerifiedAt: '2026-04-19T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer' as const],
};

const BOOKING_FIXED_EUR = {
  id: 'bk-eur',
  requestId: 'req-1',
  bidId: 'bid-1',
  status: 'SCHEDULED' as const,
  scheduledAt: '2026-04-29T15:00:00.000Z',
  priceAmount: 120,
  currency: 'EUR',
  amountScale: null, // K02 — a pre-K02 row: unit unproven
  pricingType: 'FIXED' as const,
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
    reviewCount: 3,
    completedJobs: 5,
    verified: true,
    topPro: false,
  },
  addressSnapshot: { label: 'Home', line1: '1 Main', city: 'Riyadh', country: 'SA' },
};

const bid = (
  id: string,
  amount: number,
  currency: string,
  pricingType: 'HOURLY' | 'FIXED',
  amountScale: number | null = null,
) => ({
  id,
  requestId: 'req-test-1',
  amount,
  currency,
  amountScale,
  pricingType,
  note: null,
  status: 'PENDING' as const,
  responseTimeMinutes: 10,
  badge: null,
  submittedAt: '2026-04-28T01:00:00.000Z',
  provider: {
    id: `pp-${id}`,
    displayName: `Provider ${id}`,
    initials: 'PP',
    avatarUrl: null,
    ratingAvg: 0,
    reviewCount: 0,
    completedJobs: 0,
    verified: false,
    topPro: false,
  },
});

let mock: MockAdapter;
let qc: QueryClient;
beforeEach(() => {
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
  window.localStorage.removeItem('hsm.lang');
  mock.onGet('/v1/auth/me').reply(200, ME);
  mock.onGet('/v1/me/requests').reply(200, { items: [], nextCursor: null });
  mock.onGet('/v1/me/bookings').reply(200, { items: [], nextCursor: null });
});
afterEach(() => mock.restore());

function renderHome(path: string, onServiceSelect = vi.fn()) {
  return render(
    <AuthProvider client={qc}>
      <LanguageProvider>
        <EcosystemProvider>
          <MemoryRouter initialEntries={[path]}>
            <HomeScreen isOffline={false} onServiceSelect={onServiceSelect} />
          </MemoryRouter>
        </EcosystemProvider>
      </LanguageProvider>
    </AuthProvider>,
  );
}

describe('seeker surfaces show only what the server holds', () => {
  it.each(['en', 'ar'] as const)('opens each launch specialty by ID in %s', async (lang) => {
    window.localStorage.setItem('hsm.lang', lang);
    mock.onGet('/v1/services').reply(200, { items: launchCatalog });
    const select = vi.fn();
    renderHome('/home', select);
    const grid = within(await screen.findByTestId('service-categories-grid'));
    await waitFor(() => expect(grid.getAllByRole('button')).toHaveLength(6));
    for (const item of launchCatalog) {
      const label = lang === 'ar' ? item.labelAr : item.labelEn;
      if (item.isLeaf) {
        fireEvent.click(grid.getByRole('button', { name: label }));
        expect(select).toHaveBeenLastCalledWith(label, item.id);
      } else {
        expect(grid.queryByRole('button', { name: label })).toBeNull();
      }
    }
  });

  it('home: no invented marketplace stats, no pretend microphone, no dead "View all"', async () => {
    renderHome('/home');
    await screen.findByTestId('service-categories-grid');
    for (const literal of ['4.9★', '500+', '~1h', 'Listening…', 'View all']) {
      expect(screen.queryByText(literal)).toBeNull();
    }
  });

  it('profile: no demo job/spend figures and no switch that claims to sync', async () => {
    renderHome('/home/profile');
    await screen.findByTestId('profile-hero-name');
    for (const literal of ['$420', 'Total Jobs', 'Spent', 'Offline Mode', 'Connected & synced']) {
      expect(screen.queryByText(literal)).toBeNull();
    }
    expect(screen.queryByText('Changes sync when reconnected')).toBeNull();
  });

  it('bookings: a legacy EUR booking reads "120 EUR · unverified legacy amount", never "$120/hr" or "1.20"', async () => {
    mock.onGet('/v1/me/bookings').reply(200, { items: [BOOKING_FIXED_EUR], nextCursor: null });
    renderHome('/home/bookings');
    await screen.findByText('Plumbing');
    expect(screen.getByText('120 EUR · unverified legacy amount')).toBeInTheDocument();
    expect(screen.queryByText(/1\.20/)).toBeNull();
    expect(screen.getByText('fixed price')).toBeInTheDocument();
    expect(screen.queryByText(/\$120/)).toBeNull();
    expect(screen.queryByText(/\/hr/)).toBeNull();
  });
});

describe('bid comparison is in the bid’s own currency and basis', () => {
  function renderBids() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <EcosystemProvider>
            <BidsScreen
              lead={{ id: 'req-test-1', service: 'Plumbing', status: 'pending', postedAt: 'now' }}
              onBack={() => {}}
              onBookBid={() => {}}
            />
          </EcosystemProvider>
        </LanguageProvider>
      </QueryClientProvider>,
    );
  }

  it('shows "SAR 35.00" for a verified 3500-halala bid, no "$", and no Message button that does nothing', async () => {
    mock.onGet('/v1/me/requests/req-test-1/bids').reply(200, {
      items: [bid('a', 3500, 'SAR', 'HOURLY', 2), bid('b', 4025, 'SAR', 'HOURLY', 2)],
      nextCursor: null,
    });
    renderBids();
    const exact = (text: string) => (_: string, el: Element | null) =>
      el?.children.length === 0 && el.textContent?.replace(/\u00a0/g, ' ') === text;
    await waitFor(() => expect(screen.getAllByText(exact('SAR 35.00')).length).toBeGreaterThan(0));
    expect(screen.getAllByText(exact('SAR 40.25')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$35/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^message$/i })).toBeNull();
    // Same currency and basis: the range chart compares them.
    expect(screen.getByText(/Avg:/)).toBeInTheDocument();
  });

  it('never averages bids in different currencies or on different bases', async () => {
    mock.onGet('/v1/me/requests/req-test-1/bids').reply(200, {
      items: [bid('a', 3500, 'SAR', 'HOURLY', 2), bid('b', 40, 'USD', 'FIXED')],
      nextCursor: null,
    });
    renderBids();
    await waitFor(() =>
      expect(screen.getAllByText('40 USD · unverified legacy amount').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/Avg:/)).toBeNull();
  });
});

describe('settings, launcher and admin bell', () => {
  it('settings: no privacy switches that store nothing, no literal version, no dead rows', () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    render(
      <AuthProvider client={createAuthQueryClient()}>
        <LanguageProvider>
          <MemoryRouter>
            <SettingsPage onBack={() => {}} />
          </MemoryRouter>
        </LanguageProvider>
      </AuthProvider>,
    );
    for (const literal of ['Location Services', 'Share Usage Data', 'v2.4.1', 'Rate the App']) {
      expect(screen.queryByText(literal)).toBeNull();
    }
  });

  it('launcher: advertises no tracking, payments or analytics', () => {
    render(
      <MemoryRouter>
        <LanguageProvider>
          <AppSelector />
        </LanguageProvider>
      </MemoryRouter>,
    );
    for (const literal of ['Track Pro', 'Payments', 'Analytics']) {
      expect(screen.queryByText(literal)).toBeNull();
    }
    expect(screen.getAllByText('Bookings').length).toBeGreaterThan(0);
    // R18 product-truth inventory: no claim of instant cross-app state.
    expect(screen.queryByText('Real-time Ecosystem Flow')).toBeNull();
    expect(screen.queryByText('Connected State')).toBeNull();
    expect(screen.queryByText(/reflect instantly/)).toBeNull();
  });

  it('an active lead offers its progress, not tracking', () => {
    render(
      <LanguageProvider>
        <LeadCard id="r1" service="Plumbing" status="active" postedAt="now" />
      </LanguageProvider>,
    );
    expect(screen.getByText('Progress')).toBeInTheDocument();
    expect(screen.queryByText('Track')).toBeNull();
  });

  it('help: the payments answer points to no payment details that do not exist', () => {
    mock.onGet('/v1/me/support/tickets').reply(200, { items: [] });
    render(
      <LanguageProvider>
        <HelpSupportPage onBack={() => {}} />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByText('How do payments work?'));
    expect(
      screen.getByText('The current product does not process or hold customer funds.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/payment details shown/)).toBeNull();
  });

  it('admin bell: a count that failed to load is not "nothing unread"', async () => {
    mock.onGet('/v1/me/notifications/unread-count').reply(503, {});
    mock.onGet('/v1/me/notifications').reply(200, { items: [], nextCursor: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AdminNotificationsBell lang="en" />
      </QueryClientProvider>,
    );
    const button = await screen.findByRole('button', {
      name: 'Admin notifications, unread count couldn’t be loaded',
    });
    expect(button).toHaveAttribute('data-count-state', 'unknown');
    fireEvent.click(button);
    expect(within(document.body).getByRole('dialog')).toBeInTheDocument();
  });
});
