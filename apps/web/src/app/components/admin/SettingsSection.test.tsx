import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';

import { api } from '../../../lib/api';
import { AuthProvider, queryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { AdminDashboard } from './AdminDashboard';

// Sprint 6.5 — Admin Settings wiring.
//
// What these tests pin:
//  - Settings tab fires GET /v1/admin/settings (bulk envelope).
//  - Editor renders one input per schema field with the current value.
//  - Save calls PATCH /v1/admin/settings with only the changed keys.
//  - Validation error is shown without firing the request.
//  - Success state surfaces "Saved" copy after a mutation.

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

const SCHEMA = [
  {
    key: 'platform_fee_bps',
    type: 'integer' as const,
    description: 'Platform fee bps',
    default: 1000,
    min: 0,
    max: 10000,
  },
  {
    key: 'default_currency',
    type: 'currency' as const,
    description: 'Default currency code',
    default: 'USD',
  },
  {
    key: 'support_email',
    type: 'email' as const,
    description: 'Support inbox',
    default: 'support@homeservicemarketplace.local',
  },
  {
    key: 'feature_show_hourly_rate',
    type: 'boolean' as const,
    description: 'Show hourly rate option',
    default: false,
  },
];

const BULK = {
  values: {
    platform_fee_bps: 1000,
    default_currency: 'USD',
    support_email: 'support@example.com',
    feature_show_hourly_rate: false,
  },
  defaults: {
    platform_fee_bps: 1000,
    default_currency: 'USD',
    support_email: 'support@homeservicemarketplace.local',
    feature_show_hourly_rate: false,
  },
  schema: SCHEMA,
  lastUpdatedAt: '2026-05-02T00:00:00.000Z',
};

function renderAdmin() {
  return render(
    <MemoryRouter>
      <AuthProvider>
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

function openSettingsTab() {
  fireEvent.click(screen.getByRole('button', { name: /^Settings|^الإعدادات/i }));
}

describe('AdminDashboard — Settings (Sprint 6.5)', () => {
  it('renders editors from /v1/admin/settings (no setTimeout fake)', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/settings').reply(200, BULK);

    renderAdmin();
    openSettingsTab();

    // Wait until the integer editor has hydrated (the useEffect that
    // copies bulk values into the draft fires one tick after the
    // schema renders).
    await waitFor(() => {
      const feeInput = screen.getByLabelText('platform_fee_bps') as HTMLInputElement;
      expect(feeInput.value).toBe('1000');
    });
    expect(screen.getByText('default_currency')).toBeInTheDocument();
    expect(screen.getByText('support_email')).toBeInTheDocument();
    expect(screen.getByText('feature_show_hourly_rate')).toBeInTheDocument();
  });

  it('PATCHes /v1/admin/settings with only the changed keys', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/settings').reply(200, BULK);
    let patched: { values?: Record<string, unknown> } | null = null;
    mock.onPatch('/v1/admin/settings').reply((config) => {
      patched = JSON.parse(config.data as string);
      return [
        200,
        {
          values: { ...BULK.values, platform_fee_bps: 1500 },
          changedKeys: ['platform_fee_bps'],
          lastUpdatedAt: '2026-05-02T01:00:00.000Z',
        },
      ];
    });

    renderAdmin();
    openSettingsTab();

    await waitFor(() => expect(screen.getByText('platform_fee_bps')).toBeInTheDocument());
    const feeInput = screen.getByLabelText('platform_fee_bps') as HTMLInputElement;
    fireEvent.change(feeInput, { target: { value: '1500' } });

    fireEvent.click(screen.getByRole('button', { name: /Save changes|حفظ التغييرات/i }));
    await waitFor(() => expect(patched).not.toBeNull());
    // Only the dirty key is sent.
    expect(patched?.values).toEqual({ platform_fee_bps: 1500 });
  });

  it('shows a client-side validation error for an invalid value (no PATCH)', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/settings').reply(200, BULK);
    let patched = false;
    mock.onPatch('/v1/admin/settings').reply(() => {
      patched = true;
      return [200, { values: BULK.values, changedKeys: [], lastUpdatedAt: null }];
    });

    renderAdmin();
    openSettingsTab();

    await waitFor(() => expect(screen.getByText('platform_fee_bps')).toBeInTheDocument());
    // 99999 violates max=10000.
    const feeInput = screen.getByLabelText('platform_fee_bps') as HTMLInputElement;
    fireEvent.change(feeInput, { target: { value: '99999' } });

    fireEvent.click(screen.getByRole('button', { name: /Save changes|حفظ التغييرات/i }));
    // The field-level alert renders with role="alert" — disambiguates
    // from the bottom-line "fix errors" status pill.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Must be ≤ 10000/i));
    expect(patched).toBe(false);
  });

  it('shows success copy after a successful save', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/settings').reply(200, BULK);
    mock.onPatch('/v1/admin/settings').reply(200, {
      values: { ...BULK.values, platform_fee_bps: 1500 },
      changedKeys: ['platform_fee_bps'],
      lastUpdatedAt: '2026-05-02T01:00:00.000Z',
    });

    renderAdmin();
    openSettingsTab();
    await waitFor(() => expect(screen.getByText('platform_fee_bps')).toBeInTheDocument());
    const feeInput = screen.getByLabelText('platform_fee_bps') as HTMLInputElement;
    fireEvent.change(feeInput, { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes|حفظ التغييرات/i }));

    // Refetch will now return the new value, which after the
    // invalidate cycle clears the dirty state and surfaces "Saved".
    mock.onGet('/v1/admin/settings').reply(200, {
      ...BULK,
      values: { ...BULK.values, platform_fee_bps: 1500 },
    });
    await waitFor(() => expect(screen.getByText(/✓ Saved|تم الحفظ/i)).toBeInTheDocument());
  });

  it('does not leak server env secrets in the DOM', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/settings').reply(200, BULK);

    renderAdmin();
    openSettingsTab();
    await waitFor(() => expect(screen.getByText('platform_fee_bps')).toBeInTheDocument());
    const dom = document.body.textContent ?? '';
    expect(dom).not.toContain('JWT_SECRET');
    expect(dom).not.toContain('DATABASE_URL');
    expect(dom).not.toContain('passwordHash');
  });
});
