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

const SUMMARY = {
  totalRevenue: 21_000_00,
  totalPlatformFees: 2_100_00,
  totalProviderEarnings: 18_900_00,
  totalRefunds: 0,
  pendingBalance: 800_00,
  completedBookingsCount: 19,
  currency: 'USD',
  platformFeeRateBps: 1000,
  generatedAt: '2026-05-02T00:00:00.000Z',
};

const BOOKINGS_PAGE = {
  items: [
    {
      id: 'bk-1',
      bookingId: 'bk-1',
      amount: 4_500_00,
      platformFee: 450_00,
      netAmount: 4_050_00,
      currency: 'USD',
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
      platformFees: 2_250_00,
      netEarnings: 20_250_00,
      currency: 'USD',
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
    await waitFor(() => expect(screen.getByText('$21,000')).toBeInTheDocument());
    expect(screen.getByText('−$2,100')).toBeInTheDocument();
    expect(screen.getByText('$18,900')).toBeInTheDocument();
    expect(screen.getByText('$800')).toBeInTheDocument();

    // Bookings table — Plumbing row appears (provider Ada).
    expect(screen.getByText('Plumbing')).toBeInTheDocument();
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
    expect(screen.getByText('$4,500')).toBeInTheDocument(); // gross
    expect(screen.getByText('$4,050')).toBeInTheDocument(); // net

    // Provider-earnings table — top earner row.
    expect(screen.getByText('$22,500')).toBeInTheDocument(); // gross
    expect(screen.getByText('$20,250')).toBeInTheDocument(); // net
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
      totalRevenue: 0,
      totalPlatformFees: 0,
      totalProviderEarnings: 0,
      pendingBalance: 0,
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
    await waitFor(() => expect(screen.getByText('$21,000')).toBeInTheDocument());
    const dom = document.body.textContent ?? '';
    expect(dom).not.toContain('passwordHash');
    expect(dom).not.toContain('STRIPE_SECRET');
    expect(dom).not.toContain('JWT_SECRET');
  });
});
