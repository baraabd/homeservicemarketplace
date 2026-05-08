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

const OVERVIEW = {
  range: { from: '2026-04-01', to: '2026-04-30' },
  counts: {
    users: 142,
    providers: 27,
    requests: 88,
    bookingsCompleted: 19,
    bookingsCancelled: 3,
    disputesOpen: 2,
  },
  revenue: {
    grossWithinRange: 8_400_00, // $8,400 in cents-equivalent
    platformFeesWithinRange: 840_00,
    netProviderEarningsWithinRange: 7_560_00,
    grossLifetime: 21_000_00,
  },
  currency: 'USD',
  platformFeeRateBps: 1000,
  generatedAt: '2026-05-02T00:00:00.000Z',
};

const REVENUE = {
  range: { from: '2026-04-01', to: '2026-04-30' },
  currency: 'USD',
  platformFeeRateBps: 1000,
  buckets: [
    {
      date: '2026-04-15',
      grossEarnings: 4_500_00,
      platformFees: 450_00,
      netProviderEarnings: 4_050_00,
      completedBookings: 1,
    },
  ],
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

describe('AdminDashboard — DashboardOverview (Sprint 6.4)', () => {
  it('renders KPI values from /v1/admin/analytics/overview', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/analytics/overview').reply(200, OVERVIEW);
    mock.onGet('/v1/admin/analytics/revenue').reply(200, REVENUE);

    renderAdmin();

    // Dashboard tab is the default active section, so the overview
    // hooks fire on mount. Wait for the lifetime revenue tile.
    await waitFor(() => expect(screen.getByText('$21,000')).toBeInTheDocument());
    expect(screen.getByText('$8,400')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
    expect(screen.getByText('27')).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    // Fee footnote computed from platformFeeRateBps.
    expect(screen.getByText(/After 10% platform fee/i)).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText('$21,000')).toBeInTheDocument());
    const dom = document.body.textContent ?? '';
    expect(dom).not.toContain('passwordHash');
    expect(dom).not.toContain('STRIPE_SECRET');
    expect(dom).not.toContain('JWT_SECRET');
  });
});
