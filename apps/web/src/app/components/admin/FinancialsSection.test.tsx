import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';

import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { AdminDashboard } from './AdminDashboard';

// Sprint 6.4 — Admin Financials wiring.
//
// What these tests pin:
//  - Tab fires /v1/admin/financials/{summary,bookings,provider-earnings}
//  - Summary tiles render real $ values (no $14,820 mock).
//  - Bookings table renders rows from the API.
//  - Provider earnings table renders rows from the API.
//  - No payment secrets in DOM.

const ADMIN_ME = {
  id: 'u-admin-1',
  email: 'admin@admin.com',
  firstName: 'Admin',
  lastName: 'Admin',
  status: 'ACTIVE' as const,
  emailVerifiedAt: '2026-04-29T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['admin' as const],
};

// K02 — hsm.amount-unit.v1: per-currency booked value in halalas.
const SUMMARY = {
  byCurrency: [
    {
      currency: 'SAR',
      amountScale: 2,
      completedValue: 21_000_00,
      completedCount: 19,
      currentMonthValue: 0,
      inFlightValue: 800_00,
      inFlightCount: 1,
    },
  ],
  excluded: [] as Array<{
    currency: string;
    reason: string;
    completedCount: number;
    inFlightCount: number;
  }>,
  completedBookingsCount: 19,
  feeStatus: 'NOT_APPROVED' as const,
  platformFeeRateBps: null,
  generatedAt: '2026-05-02T00:00:00.000Z',
};

/** Exact text of an element, NBSP-normalised. */
const exact = (text: string) => (_: string, el: Element | null) =>
  !!el && el.children.length === 0 && el.textContent?.replace(/\u00a0/g, ' ') === text;

const BOOKINGS_PAGE = {
  items: [
    {
      id: 'bk-1',
      bookingId: 'bk-1',
      amount: 4_500_00,
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
      provider: {
        id: 'pp-1',
        displayName: 'Ada Lovelace',
        userId: 'u-prov-1',
        email: 'p@example.com',
      },
      seeker: { id: 'u-seeker-1', firstName: 'Ahmed' },
    },
  ],
  nextCursor: null,
};

const PROVIDER_EARNINGS_PAGE = {
  items: [
    {
      providerId: 'pp-1',
      displayName: 'Ada Lovelace',
      userId: 'u-prov-1',
      email: 'p@example.com',
      completedBookings: 5,
      grossEarnings: 22_500_00,
      currency: 'SAR',
      amountScale: 2,
    },
  ],
  nextCursor: null,
};

function renderAdmin() {
  return render(
    <MemoryRouter>
      <AuthProvider client={qc}>
        <LanguageProvider>
          <EcosystemProvider>
            <AdminDashboard />
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
});
afterEach(() => {
  mock.restore();
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
});

function openFinancialsTab() {
  fireEvent.click(screen.getByRole('button', { name: /^Financials|^الماليات/i }));
}

describe('AdminDashboard — Financials (Sprint 6.4)', () => {
  it('renders summary tiles + bookings table + provider-earnings table from API', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/analytics/overview').reply(200, {
      // Provided so the dashboard tab on first paint doesn't break.
      range: { from: '2026-04-01', to: '2026-04-30' },
      counts: {
        users: 0,
        providers: 0,
        requests: 0,
        bookingsCompleted: 0,
        bookingsCancelled: 0,
        disputesOpen: 0,
      },
      revenue: {
        grossWithinRange: 0,
        platformFeesWithinRange: 0,
        netProviderEarningsWithinRange: 0,
        grossLifetime: 0,
      },
      currency: 'USD',
      platformFeeRateBps: 1000,
      generatedAt: '2026-05-02T00:00:00.000Z',
    });
    mock.onGet('/v1/admin/analytics/revenue').reply(200, {
      range: { from: '2026-04-01', to: '2026-04-30' },
      currency: 'USD',
      platformFeeRateBps: 1000,
      buckets: [],
    });
    mock.onGet('/v1/admin/financials/summary').reply(200, SUMMARY);
    mock.onGet('/v1/admin/financials/bookings').reply(200, BOOKINGS_PAGE);
    mock.onGet('/v1/admin/financials/provider-earnings').reply(200, PROVIDER_EARNINGS_PAGE);

    renderAdmin();
    openFinancialsTab();

    // Summary tiles.
    await waitFor(() => expect(screen.getByText(exact('SAR 21,000.00'))).toBeInTheDocument());
    expect(screen.getByText(exact('SAR 800.00'))).toBeInTheDocument();
    // R18/K02 — booking values only: no fee, no "net" figure, no "$".
    expect(screen.queryByText(/2,100|18,900/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$/);
    expect(screen.getByTestId('admin-financials-refunds')).toHaveTextContent(
      'Refunds: not tracked; no refund is executed',
    );
    expect(screen.getByTestId('admin-financials-note')).toHaveTextContent(
      'Booking values, not payments. No platform fee is approved',
    );

    // Bookings table — Plumbing row appears (provider Ada).
    expect(screen.getByText('Plumbing')).toBeInTheDocument();
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
    expect(screen.getByText(exact('SAR 4,500.00'))).toBeInTheDocument();
    expect(screen.queryByText(/4,050/)).toBeNull(); // no net column

    // Provider-earnings table — top earner row.
    expect(screen.getByText(exact('SAR 22,500.00'))).toBeInTheDocument();
    expect(screen.queryByText(/20,250/)).toBeNull(); // no net column
    expect(screen.getByText('5')).toBeInTheDocument(); // completed bookings
  });

  it('renders empty-state copy when bookings + provider-earnings are empty', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/analytics/overview').reply(200, {
      range: { from: '2026-04-01', to: '2026-04-30' },
      counts: {
        users: 0,
        providers: 0,
        requests: 0,
        bookingsCompleted: 0,
        bookingsCancelled: 0,
        disputesOpen: 0,
      },
      revenue: {
        grossWithinRange: 0,
        platformFeesWithinRange: 0,
        netProviderEarningsWithinRange: 0,
        grossLifetime: 0,
      },
      currency: 'USD',
      platformFeeRateBps: 1000,
      generatedAt: '2026-05-02T00:00:00.000Z',
    });
    mock.onGet('/v1/admin/analytics/revenue').reply(200, {
      range: { from: '2026-04-01', to: '2026-04-30' },
      currency: 'USD',
      platformFeeRateBps: 1000,
      buckets: [],
    });
    mock.onGet('/v1/admin/financials/summary').reply(200, {
      ...SUMMARY,
      byCurrency: [],
      completedBookingsCount: 0,
    });
    mock.onGet('/v1/admin/financials/bookings').reply(200, { items: [], nextCursor: null });
    mock
      .onGet('/v1/admin/financials/provider-earnings')
      .reply(200, { items: [], nextCursor: null });

    renderAdmin();
    openFinancialsTab();

    await waitFor(() =>
      expect(
        screen.getByText(/No completed bookings yet|لا توجد حجوزات منجزة بعد/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/No data yet|لا توجد بيانات بعد/i)).toBeInTheDocument();
  });

  it('K02: legacy and hourly bookings are counted, never summed; a provider gets one row per currency', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/analytics/overview').reply(500, {});
    mock.onGet('/v1/admin/analytics/revenue').reply(500, {});
    mock.onGet('/v1/admin/financials/summary').reply(200, {
      ...SUMMARY,
      excluded: [
        { currency: 'USD', reason: 'LEGACY_UNVERIFIED', completedCount: 3, inFlightCount: 0 },
        { currency: 'SAR', reason: 'HOURLY_RATE', completedCount: 1, inFlightCount: 1 },
      ],
    });
    mock.onGet('/v1/admin/financials/bookings').reply(200, {
      items: [
        {
          ...BOOKINGS_PAGE.items[0],
          id: 'bk-legacy',
          amount: 1000,
          currency: 'USD',
          amountScale: null,
        },
      ],
      nextCursor: null,
    });
    mock.onGet('/v1/admin/financials/provider-earnings').reply(200, {
      items: [
        PROVIDER_EARNINGS_PAGE.items[0],
        { ...PROVIDER_EARNINGS_PAGE.items[0], currency: 'AED', grossEarnings: 10_00 },
      ],
      nextCursor: null,
    });
    renderAdmin();
    openFinancialsTab();
    expect(
      await screen.findByText(
        /3 booking\(s\) with an unverified legacy amount are excluded and await reconciliation/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 hourly-rate booking\(s\) are excluded/)).toBeInTheDocument();
    expect(
      await screen.findByText(exact('1,000 USD · unverified legacy amount')),
    ).toBeInTheDocument();
    expect(screen.getByText(exact('SAR 22,500.00'))).toBeInTheDocument();
    expect(screen.getByText(exact('AED 10.00'))).toBeInTheDocument();
    expect(screen.queryByText(/22,510/)).toBeNull();
  });

  it('does not leak passwordHash / payment secrets in the DOM', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/analytics/overview').reply(200, {
      range: { from: '2026-04-01', to: '2026-04-30' },
      counts: {
        users: 0,
        providers: 0,
        requests: 0,
        bookingsCompleted: 0,
        bookingsCancelled: 0,
        disputesOpen: 0,
      },
      revenue: {
        grossWithinRange: 0,
        platformFeesWithinRange: 0,
        netProviderEarningsWithinRange: 0,
        grossLifetime: 0,
      },
      currency: 'USD',
      platformFeeRateBps: 1000,
      generatedAt: '2026-05-02T00:00:00.000Z',
    });
    mock.onGet('/v1/admin/analytics/revenue').reply(200, {
      range: { from: '2026-04-01', to: '2026-04-30' },
      currency: 'USD',
      platformFeeRateBps: 1000,
      buckets: [],
    });
    mock.onGet('/v1/admin/financials/summary').reply(200, SUMMARY);
    mock.onGet('/v1/admin/financials/bookings').reply(200, BOOKINGS_PAGE);
    mock.onGet('/v1/admin/financials/provider-earnings').reply(200, PROVIDER_EARNINGS_PAGE);

    renderAdmin();
    openFinancialsTab();
    await waitFor(() => expect(screen.getByText(exact('SAR 21,000.00'))).toBeInTheDocument());
    const dom = document.body.textContent ?? '';
    expect(dom).not.toContain('passwordHash');
    expect(dom).not.toContain('STRIPE_SECRET');
    expect(dom).not.toContain('JWT_SECRET');
  });
});
