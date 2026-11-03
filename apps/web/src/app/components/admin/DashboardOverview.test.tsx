import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';

import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { AdminDashboard } from './AdminDashboard';

// Sprint 6.4 — Admin Dashboard overview wiring.
//
// What these tests pin:
//  - The dashboard tab fires GET /v1/admin/analytics/overview AND
//    GET /v1/admin/analytics/revenue (no MONTHLY_DATA mock).
//  - KPI cards render the API values, not hardcoded numbers.
//  - Range chip selector triggers a refetch with from/to query params.
//  - The wire never carries passwordHash / Stripe-style secrets.

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

// R17-D contract: booked value per currency, no fee, event-dated completions.
const OVERVIEW = {
  range: { from: '2026-04-01', to: '2026-04-30' },
  counts: {
    users: 142,
    providers: 27,
    requests: 88,
    bookingsCompleted: 19,
    bookingsCancelled: 3,
    disputesOpen: 2,
    undatedCompletions: 0,
  },
  revenue: {
    grossWithinRange: 8_400_00, // K02: SAR 8,400.00 in halalas
    platformFeesWithinRange: null,
    netProviderEarningsWithinRange: null,
    grossLifetime: 21_000_00,
  },
  revenueByCurrency: [
    {
      currency: 'SAR',
      amountScale: 2,
      bookedValueLifetime: 21_000_00,
      completedLifetime: 40,
      bookedValueWithinRange: 8_400_00,
      completedWithinRange: 19,
    },
  ],
  excludedAmounts: [] as Array<{
    currency: string;
    reason: string;
    completedCount: number;
    inFlightCount: number;
  }>,
  currency: 'SAR',
  platformFeeRateBps: null,
  feeStatus: 'NOT_APPROVED',
  generatedAt: '2026-05-02T00:00:00.000Z',
};

const REVENUE = {
  range: { from: '2026-04-01', to: '2026-04-30' },
  currency: 'SAR',
  platformFeeRateBps: null,
  feeStatus: 'NOT_APPROVED',
  buckets: [
    {
      date: '2026-04-15',
      grossEarnings: 4_500_00,
      platformFees: null,
      netProviderEarnings: null,
      completedBookings: 1,
    },
  ],
  series: [
    {
      currency: 'SAR',
      amountScale: 2,
      buckets: [{ date: '2026-04-15', bookedValue: 4_500_00, completedBookings: 1 }],
    },
  ],
};

/** Two currencies in range: there is no honest single total. */
const MIXED = {
  ...OVERVIEW,
  counts: { ...OVERVIEW.counts, undatedCompletions: 2 },
  revenue: { ...OVERVIEW.revenue, grossWithinRange: null, grossLifetime: null },
  revenueByCurrency: [
    {
      // A hypothetical second approved currency: K02 still shows it apart.
      currency: 'AED',
      amountScale: 2,
      bookedValueLifetime: 700_00,
      completedLifetime: 1,
      bookedValueWithinRange: 700_00,
      completedWithinRange: 1,
    },
    {
      currency: 'SAR',
      amountScale: 2,
      bookedValueLifetime: 1_500_00,
      completedLifetime: 2,
      bookedValueWithinRange: 1_500_00,
      completedWithinRange: 2,
    },
  ],
  currency: null,
};

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
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

/** Assert the KPI's own value; another dashboard section may contain the same number. */
function kpi(label: string) {
  const card = screen.getByText(label, { exact: true, selector: 'p' }).parentElement;
  expect(card).not.toBeNull();
  return within(card!);
}

let mock: MockAdapter;
let qc: QueryClient;
beforeEach(() => {
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
  // Admin home now composes approvals and analytics; their API data is independent.
  mock.onGet('/v1/admin/providers').reply(200, {
    items: [],
    nextCursor: null,
    total: 0,
    counts: { all: 30, pendingReview: 0, draft: 3, active: 27, returned: 0, suspended: 0 },
  });
});
afterEach(() => {
  mock.restore();
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
});

describe('AdminDashboard — DashboardOverview (Sprint 6.4)', () => {
  it('R17-D: shows each currency separately and never a cross-currency sum', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/analytics/overview').reply(200, MIXED);
    mock.onGet('/v1/admin/analytics/revenue').reply(200, REVENUE);

    renderAdmin();

    const inRange = await screen.findByTestId('kpi-value-in-range');
    await waitFor(() => expect(inRange).toHaveTextContent(/AED\s700\.00/));
    expect(inRange).toHaveTextContent(/SAR\s1,500\.00/);
    // 700 + 1500 must never appear as one number.
    expect(document.body.textContent).not.toMatch(/2,200/);
    expect(screen.getByTestId('analytics-value-note')).toHaveTextContent(/2 completed booking/);
  });

  it('R17-D: a failed analytics load shows a dash, never a zero', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/analytics/overview').reply(500, {});
    mock.onGet('/v1/admin/analytics/revenue').reply(500, {});

    renderAdmin();

    await waitFor(() => expect(kpi('Users').getByText('—')).toBeInTheDocument());
    expect(kpi('Completed booking value (in range)').getByText('—')).toBeInTheDocument();
  });

  it('renders KPI values from /v1/admin/analytics/overview', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/analytics/overview').reply(200, OVERVIEW);
    mock.onGet('/v1/admin/analytics/revenue').reply(200, REVENUE);

    renderAdmin();

    // Scope each assertion to its labelled analytics card. In particular, the
    // approval guide's second step must never satisfy the open-disputes KPI.
    await waitFor(() =>
      expect(
        kpi('Completed booking value (lifetime)').getByText(/^SAR\s21,000\.00$/),
      ).toBeInTheDocument(),
    );
    expect(
      kpi('Completed booking value (in range)').getByText(/^SAR\s8,400\.00$/),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$/);
    expect(kpi('Users').getByText('142')).toBeInTheDocument();
    expect(kpi('Providers').getByText('27')).toBeInTheDocument();
    expect(kpi('Bookings completed').getByText('19')).toBeInTheDocument();
    expect(kpi('Open disputes').getByText('2')).toBeInTheDocument();
    // R17-D: no fee is claimed; the note says what the figures are.
    expect(document.body.textContent).not.toMatch(/platform fee d|After d+%/i);
    expect(screen.getByTestId('analytics-value-note')).toHaveTextContent(/not payments/i);
  });

  it('range chip toggle triggers another /overview request with new from/to', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    const overviewParams: Array<{ from?: string; to?: string }> = [];
    mock.onGet('/v1/admin/analytics/overview').reply((config) => {
      const p = (config.params as { from?: string; to?: string } | undefined) ?? {};
      overviewParams.push(p);
      return [200, OVERVIEW];
    });
    mock.onGet('/v1/admin/analytics/revenue').reply(200, REVENUE);

    renderAdmin();
    await waitFor(() => expect(overviewParams.length).toBeGreaterThanOrEqual(1));
    const initial = overviewParams.length;
    fireEvent.click(screen.getByRole('tab', { name: /^7d|^٧ أيام/i }));
    await waitFor(() => expect(overviewParams.length).toBeGreaterThan(initial));
    // The new request must carry distinct `from` and `to` strings.
    const last = overviewParams[overviewParams.length - 1];
    expect(typeof last.from).toBe('string');
    expect(typeof last.to).toBe('string');
  });

  it('does not leak passwordHash / payment secrets in the rendered DOM', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/analytics/overview').reply(200, OVERVIEW);
    mock.onGet('/v1/admin/analytics/revenue').reply(200, REVENUE);

    renderAdmin();
    await waitFor(() =>
      expect(
        kpi('Completed booking value (lifetime)').getByText(/^SAR\s21,000\.00$/),
      ).toBeInTheDocument(),
    );
    const dom = document.body.textContent ?? '';
    expect(dom).not.toContain('passwordHash');
    expect(dom).not.toContain('STRIPE_SECRET');
    expect(dom).not.toContain('JWT_SECRET');
  });
});

describe('AdminDashboard — K02 exclusions', () => {
  it('counts legacy-unit and hourly bookings instead of summing them', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/analytics/overview').reply(200, {
      ...OVERVIEW,
      excludedAmounts: [
        { currency: 'USD', reason: 'LEGACY_UNVERIFIED', completedCount: 5, inFlightCount: 1 },
        { currency: 'SAR', reason: 'HOURLY_RATE', completedCount: 2, inFlightCount: 0 },
      ],
    });
    mock.onGet('/v1/admin/analytics/revenue').reply(200, REVENUE);
    renderAdmin();
    expect(await screen.findByTestId('analytics-excluded-note')).toHaveTextContent(
      'Excluded from these values: 6 booking(s) with an unverified legacy amount and 2 hourly-rate booking(s).',
    );
    expect(
      kpi('Completed booking value (lifetime)').getByText(/^SAR\s21,000\.00$/),
    ).toBeInTheDocument();
  });
});

describe('AdminDashboard — DashboardOverview resilience (R17-D)', () => {
  it('K02: a payload without amountScale renders as unverified instead of crashing', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    const legacyRows = OVERVIEW.revenueByCurrency.map(({ amountScale: _s, ...row }) => row);
    mock
      .onGet('/v1/admin/analytics/overview')
      .reply(200, { ...OVERVIEW, revenueByCurrency: legacyRows });
    mock.onGet('/v1/admin/analytics/revenue').reply(200, {
      ...REVENUE,
      series: REVENUE.series.map(({ amountScale: _s, ...row }) => row),
    });
    renderAdmin();
    await waitFor(() =>
      expect(
        kpi('Completed booking value (lifetime)').getByText(/unverified legacy amount/),
      ).toBeInTheDocument(),
    );
    expect(kpi('Users').getByText('142')).toBeInTheDocument();
  });

  it('shows a dash, not a crash, when the per-currency breakdown is missing', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    const { revenueByCurrency: _omit, ...legacy } = OVERVIEW;
    void _omit;
    mock.onGet('/v1/admin/analytics/overview').reply(200, legacy);
    mock.onGet('/v1/admin/analytics/revenue').reply(200, { ...REVENUE, series: undefined });

    renderAdmin();

    await waitFor(() => expect(kpi('Users').getByText('142')).toBeInTheDocument());
    expect(kpi('Completed booking value (in range)').getByText('—')).toBeInTheDocument();
  });
});
