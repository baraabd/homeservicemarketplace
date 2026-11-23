import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import MockAdapter from 'axios-mock-adapter';

import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { ProviderApp } from './ProviderApp';
import { WORKING_CAPABILITIES } from '../../../test-support/provider-capability-fixtures';

// Sprint 09B.29 — resolve the code-split screen BEFORE any assertion window.
//
// `ProviderApp` loads its tabs with `React.lazy(() => import('./screens/...'))`.
// In a browser that is a fetch of an already-built chunk. Under Vitest it is an
// on-demand ESM transform, and its cost lands inside whichever `findBy*` window
// happens to be open when the tab is clicked — here the 5s wait in
// `openWalletTab()`. At full worker concurrency (measured: 19 node processes,
// ~2 GB peak) that transform has exceeded the budget, and the test then failed
// reporting "Unable to find an element with the text: /Available Balance/" —
// blaming the product for what was actually the bundler.
//
// Awaiting the import here moves the transform outside the assertion window.
// Nothing is concealed: no timeout is raised, no test is skipped, concurrency
// is untouched and no retry is added. The assertions still prove the screen
// renders the values the API gave it; they simply no longer race the module
// loader to do it.
await import('./screens/WalletScreen');

// Sprint 5.6 (refined) — wallet is wired to /v1/provider/earnings/*.
//
// What these tests pin:
//  - Summary tile values come from the API, not hardcoded constants.
//  - Empty state renders when there are zero transactions.
//  - Chart renders the API buckets (the SVG path is asserted by rendering;
//    the test confirms the chart container is present and the loading state
//    has cleared, since recharts paints its SVG inside ResponsiveContainer
//    which doesn't measure in jsdom — we check for the absence of the
//    loading copy rather than the rendered geometry).
//  - Transactions render the canonical shape (netAmount + amount + fee).
//  - Withdraw button is disabled (no fake setTimeout success).
//  - Summary error state surfaces a safe copy, not the raw payload.

// MemoryRouter, because ProviderApp is a ROUTE component: it reads router
// context directly (Sprint 9B.16 added the navigation to the onboarding
// route), and every other ProviderApp suite already mounts it inside one.
// Mounting it bare was this file being the outlier, and the harness is what
// was unrealistic — in the product there is no way to reach this screen from
// outside the router.
function renderProvider() {
  return render(
    <MemoryRouter initialEntries={['/provider']}>
      <AuthProvider client={qc}>
        <LanguageProvider>
          <EcosystemProvider>
            <Routes>
              <Route path="/provider/*" element={<ProviderApp />} />
            </Routes>
          </EcosystemProvider>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

let mock: MockAdapter;
let qc: QueryClient;
beforeEach(() => {
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
  mock.onGet('/v1/me/provider/capabilities').reply(200, WORKING_CAPABILITIES);
});
afterEach(() => {
  mock.restore();
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
});

const MOCK_ME = {
  id: 'u-1',
  email: 'grace@example.com',
  firstName: 'Grace',
  lastName: 'Hopper',
  status: 'ACTIVE' as const,
  emailVerifiedAt: '2026-04-29T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer' as const, 'provider' as const],
};

const MOCK_PROFILE = {
  id: 'pp-1',
  displayName: 'Grace Hopper',
  initials: 'GH',
  avatarUrl: null,
  bio: null,
  headline: null,
  phoneNumber: null,
  ratingAvg: 4.9,
  reviewCount: 312,
  completedJobs: 540,
  verified: true,
  topPro: true,
  availability: 'ONLINE' as const,
  status: 'ACTIVE' as const,
  serviceAreaCity: 'Riyadh',
  serviceAreaCountry: 'Saudi Arabia',
  serviceAreaLat: 24.7136,
  serviceAreaLng: 46.6753,
  serviceAreaRadiusKm: 25,
  serviceCategories: [],
  createdAt: '2024-06-15T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
};

// K02 — hsm.amount-unit.v1 shapes: per-currency booked value in halalas,
// exclusions counted, no fee.
const SAR_VALUE = {
  currency: 'SAR',
  amountScale: 2,
  completedValue: 12_000_00, // SAR 12,000.00
  completedCount: 17,
  currentMonthValue: 4_500_00,
  inFlightValue: 800_00, // SAR 800.00
  inFlightCount: 2,
};
const SUMMARY = {
  byCurrency: [SAR_VALUE],
  excluded: [] as Array<{
    currency: string;
    reason: string;
    completedCount: number;
    inFlightCount: number;
  }>,
  completedBookingsCount: 17,
  feeStatus: 'NOT_APPROVED' as const,
  platformFeeRateBps: null,
  ratingAvg: 4.9,
  reviewCount: 312,
};

/** Exact text of a <bdi> money figure, NBSP-normalised. */
const money = (text: string) => (_: string, el: Element | null) =>
  el?.tagName === 'BDI' && el.textContent?.replace(/\u00a0/g, ' ') === text;

const CHART = {
  range: '30d' as const,
  windowStart: '2026-04-03T00:00:00.000Z',
  windowEnd: '2026-05-03T00:00:00.000Z',
  currency: 'SAR',
  amountScale: 2,
  buckets: [
    { date: '2026-04-29', grossEarnings: 4500_00, completedBookings: 1 },
    { date: '2026-05-01', grossEarnings: 7500_00, completedBookings: 1 },
  ],
};

const TX_FIXTURE = {
  id: 'bk-1',
  bookingId: 'bk-1',
  kind: 'BOOKING_COMPLETED' as const,
  amount: 4500_00,
  pricingType: 'FIXED' as const,
  currency: 'SAR',
  amountScale: 2,
  occurredAt: '2026-05-02T10:00:00.000Z',
  service: {
    categorySlug: 'plumbing',
    categoryLabelEn: 'Plumbing',
    categoryLabelAr: 'سباكة',
    customServiceText: null,
  },
  city: 'Riyadh',
};

async function openWalletTab() {
  // Phase 4: the shell mounts only once the provider profile query has
  // settled (no marketplace flash), so the nav has to be AWAITED.
  fireEvent.click(await screen.findByRole('link', { name: /^wallet|المحفظة/i }));

  // Mode B: the wallet is a code-split route, so the click starts a dynamic
  // import and the screen arrives a tick later behind Suspense. Wait for the
  // screen ITSELF rather than giving the value assertions a longer timeout —
  // waiting on the thing that has to happen is deterministic, whereas a bigger
  // timeout just makes a race take longer to lose.
  await screen.findByText(/Completed booking value|قيمة الحجوزات المنجزة/i, undefined, {
    timeout: 5000,
  });
}

describe('WalletScreen — Sprint 5.6 (refined)', () => {
  it('renders the canonical summary fields from /v1/provider/earnings/summary', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/earnings/summary').reply(200, SUMMARY);
    mock.onGet('/v1/provider/earnings/transactions').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/provider/earnings/chart').reply(200, CHART);

    renderProvider();
    await openWalletTab();

    // R18 — the headline is the value of completed bookings (gross), not a
    // balance: no fee is approved and nothing is held or paid out.
    // K02 — 1,200,000 halalas is exactly SAR 12,000.00 (never "$12,000").
    await waitFor(() => expect(screen.getByText(money('SAR 12,000.00'))).toBeInTheDocument());
    expect(screen.getByText(money('SAR 800.00'))).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(
      screen.getByText(/Fixed-price booking values, not a balance. No platform fee is approved/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
    expect(screen.queryByText(/platform fee$/i)).toBeNull();
    expect(screen.queryByText(/Available Balance/i)).toBeNull();
  });

  it('renders the empty-transactions state when /transactions returns []', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/earnings/summary').reply(200, {
      ...SUMMARY,
      byCurrency: [],
      completedBookingsCount: 0,
    });
    mock.onGet('/v1/provider/earnings/transactions').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/provider/earnings/chart').reply(200, { ...CHART, buckets: [] });

    renderProvider();
    await openWalletTab();

    await waitFor(() =>
      expect(screen.getByText(/No transactions yet|لا توجد معاملات بعد/i)).toBeInTheDocument(),
    );
  });

  it('renders each transaction at its booking amount, with no fee deducted', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/earnings/summary').reply(200, SUMMARY);
    mock.onGet('/v1/provider/earnings/transactions').reply(200, {
      items: [TX_FIXTURE],
      nextCursor: null,
    });
    mock.onGet('/v1/provider/earnings/chart').reply(200, CHART);

    renderProvider();
    await openWalletTab();

    await waitFor(() => expect(screen.getByText('Plumbing')).toBeInTheDocument());
    expect(screen.getByText(money('SAR 4,500.00'))).toBeInTheDocument();
    expect(screen.queryByText(/4,050/)).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('keeps the withdraw CTA disabled (no fake success)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/earnings/summary').reply(200, SUMMARY);
    mock.onGet('/v1/provider/earnings/transactions').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/provider/earnings/chart').reply(200, CHART);

    renderProvider();
    await openWalletTab();

    await waitFor(() => expect(screen.getByText(money('SAR 12,000.00'))).toBeInTheDocument());

    const withdraw = screen.getByRole('button', { name: /Withdrawals are not available/i });
    expect(withdraw).toBeDisabled();
    // Click should not raise an exception, change state, or invoke any
    // POST handler — there is no withdraw endpoint yet.
    fireEvent.click(withdraw);

    // R16: payouts are policy- and funding-blocked (docs/production-readiness/
    // r16/PAYOUT_POLICY.md). Prove the click sent no write of any kind rather
    // than relying on an unmocked route surfacing as a 404.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mock.history.post).toHaveLength(0);
    expect(mock.history.put).toHaveLength(0);
    expect(mock.history.patch).toHaveLength(0);
    expect(mock.history.delete).toHaveLength(0);
    expect(withdraw).toBeDisabled();
  });

  it('honours the chart range toggle and fires another /chart request', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/earnings/summary').reply(200, SUMMARY);
    mock.onGet('/v1/provider/earnings/transactions').reply(200, { items: [], nextCursor: null });
    const chartUrls: string[] = [];
    mock.onGet('/v1/provider/earnings/chart').reply((config) => {
      chartUrls.push(config.url ?? '');
      const range = (config.params as { range?: string } | undefined)?.range ?? '30d';
      return [200, { ...CHART, range }];
    });

    renderProvider();
    await openWalletTab();

    await waitFor(() => expect(chartUrls.length).toBeGreaterThanOrEqual(1));
    // Default range hit on first paint.
    const initialCount = chartUrls.length;
    fireEvent.click(screen.getByRole('button', { name: /^7d$/i, pressed: false }));
    await waitFor(() => expect(chartUrls.length).toBeGreaterThan(initialCount));
  });

  it('surfaces a safe copy when /summary errors (no raw payload leak)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/earnings/summary').reply(500, {
      error: { code: 'INTERNAL_ERROR', message: 'PrismaClientKnownRequestError: boom' },
    });
    mock.onGet('/v1/provider/earnings/transactions').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/provider/earnings/chart').reply(200, CHART);

    renderProvider();
    await openWalletTab();

    await waitFor(() =>
      expect(screen.getByText(/Could not load earnings|تعذّر تحميل الأرباح/i)).toBeInTheDocument(),
    );
    // The raw Prisma message must not be rendered.
    const dom = document.body.textContent ?? '';
    expect(dom).not.toMatch(/PrismaClient/i);
  });

  it('K02: shows each currency separately and counts — never sums — legacy and hourly bookings', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/earnings/summary').reply(200, {
      ...SUMMARY,
      byCurrency: [{ ...SAR_VALUE, currency: 'AED', completedValue: 99_99 }, SAR_VALUE],
      excluded: [
        { currency: 'USD', reason: 'LEGACY_UNVERIFIED', completedCount: 3, inFlightCount: 1 },
        { currency: 'SAR', reason: 'HOURLY_RATE', completedCount: 2, inFlightCount: 0 },
      ],
    });
    mock.onGet('/v1/provider/earnings/transactions').reply(200, {
      items: [
        TX_FIXTURE,
        {
          ...TX_FIXTURE,
          id: 'bk-2',
          bookingId: 'bk-2',
          amount: 1000,
          currency: 'USD',
          amountScale: null,
        },
        {
          ...TX_FIXTURE,
          id: 'bk-3',
          bookingId: 'bk-3',
          amount: 150_00,
          pricingType: 'HOURLY' as const,
        },
      ],
      nextCursor: null,
    });
    mock.onGet('/v1/provider/earnings/chart').reply(200, CHART);

    renderProvider();
    await openWalletTab();

    // The launch currency leads; the other currency is its own figure.
    await waitFor(() => expect(screen.getByText(money('SAR 12,000.00'))).toBeInTheDocument());
    const others = screen.getByTestId('wallet-other-currencies');
    expect(within(others).getByText(money('AED 99.99'))).toBeInTheDocument();
    // No combined figure exists anywhere.
    expect(screen.queryByText(/12,099\.99|12,100/)).toBeNull();
    expect(
      screen.getByText(/4 booking\(s\) with an unverified legacy amount are not included/),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 hourly-rate booking\(s\) are not included/)).toBeInTheDocument();
    // Each transaction in its own unit; a legacy amount is never divided.
    expect(
      await screen.findByText(money('1,000 USD · unverified legacy amount')),
    ).toBeInTheDocument();
    expect(screen.queryByText(/USD 10\.00|\$10/)).toBeNull();
    expect(screen.getByText(money('SAR 150.00')).parentElement).toHaveTextContent('SAR 150.00/hr');
  });

  it('renders within is bound — the test only inspects the wallet panel', async () => {
    // Sanity: confirm the wallet panel is the ancestor of the summary
    // tiles so other tabs are excluded from queries. Guards against
    // future ProviderApp refactors that might change the routing.
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/earnings/summary').reply(200, SUMMARY);
    mock.onGet('/v1/provider/earnings/transactions').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/provider/earnings/chart').reply(200, CHART);

    renderProvider();
    await openWalletTab();

    const headline = await screen.findByText(money('SAR 12,000.00'));
    expect(headline).toBeInTheDocument();
    const card = headline.closest('div');
    expect(card).not.toBeNull();
    if (card) {
      // Inside the same card, the gross + jobs-done numbers are also present.
      const inCard = within(card.parentElement as HTMLElement);
      expect(inCard.getByText('17')).toBeInTheDocument();
    }
  });
});
