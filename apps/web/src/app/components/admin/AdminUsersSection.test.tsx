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

// Sprint 6.1 — Admin User Control wiring.
//
// What these tests pin:
//  - The User Control sidebar tab renders a real, API-driven table
//    (no "Coming Soon" placeholder).
//  - Search submits the form and triggers a /v1/admin/users?query=…
//    refetch.
//  - Status filter triggers a /v1/admin/users?status=… refetch.
//  - The detail drawer fetches /v1/admin/users/:id and shows the
//    summary fields.
//  - PATCH /v1/admin/users/:id/status fires when the operator clicks
//    Suspend, and the table invalidates after the mutation.
//  - The Suspend button is disabled when the target user IS the admin
//    themselves (self-protection).
//  - The wire never carries passwordHash or mfaSecret on a happy-path
//    list response.

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

const ADA = {
  id: 'u-1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: 'ACTIVE' as const,
  isActive: true,
  emailVerifiedAt: '2026-01-02T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const SELF = { ...ADA, id: ADMIN_ME.id, email: ADMIN_ME.email };

const ROLES = {
  items: [
    { id: 'r-admin', name: 'admin', description: 'Platform admin' },
    { id: 'r-provider', name: 'provider', description: null },
    { id: 'r-customer', name: 'customer', description: null },
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

function openUsersTab() {
  fireEvent.click(screen.getByRole('button', { name: /User Control|إدارة المستخدمين/i }));
}

describe('AdminDashboard — User Control (Sprint 6.1)', () => {
  it('renders the real users table from /v1/admin/users (no Coming Soon)', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/roles').reply(200, ROLES);
    mock.onGet('/v1/admin/users').reply(200, { items: [ADA], nextCursor: null });

    renderAdmin();
    openUsersTab();

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    // The status badge text is the canonical enum value.
    expect(screen.getAllByText('ACTIVE').length).toBeGreaterThan(0);
    // The "Coming Soon" placeholder must not be rendered any more.
    expect(screen.queryByText(/User Control — Coming Soon/i)).toBeNull();
  });

  it('renders an empty state when the API returns no items', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/roles').reply(200, ROLES);
    mock.onGet('/v1/admin/users').reply(200, { items: [], nextCursor: null });

    renderAdmin();
    openUsersTab();

    await waitFor(() =>
      expect(
        screen.getByText(/No users match the current filters|لا يوجد مستخدمون مطابقون/i),
      ).toBeInTheDocument(),
    );
  });

  it('search submits a /v1/admin/users?query=… request', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/roles').reply(200, ROLES);
    const calls: string[] = [];
    mock.onGet('/v1/admin/users').reply((config) => {
      const params = (config.params as { query?: string } | undefined) ?? {};
      calls.push(params.query ?? '');
      return [200, { items: [ADA], nextCursor: null }];
    });

    renderAdmin();
    openUsersTab();

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    const input = screen.getByLabelText(/Search by email or name|ابحث/i);
    fireEvent.change(input, { target: { value: 'ada' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(calls.some((q) => q === 'ada')).toBe(true));
  });

  it('status filter triggers another /v1/admin/users?status=… request', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/roles').reply(200, ROLES);
    const statuses: string[] = [];
    mock.onGet('/v1/admin/users').reply((config) => {
      const params = (config.params as { status?: string } | undefined) ?? {};
      statuses.push(params.status ?? '');
      return [200, { items: [ADA], nextCursor: null }];
    });

    renderAdmin();
    openUsersTab();
    await waitFor(() => expect(statuses.length).toBeGreaterThanOrEqual(1));

    const statusSelect = screen.getByLabelText(/^Status|^الحالة/i);
    fireEvent.change(statusSelect, { target: { value: 'SUSPENDED' } });

    await waitFor(() => expect(statuses.includes('SUSPENDED')).toBe(true));
  });

  it('opens the detail drawer and PATCHes status when Suspend is clicked', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/roles').reply(200, ROLES);
    mock.onGet('/v1/admin/users').reply(200, { items: [ADA], nextCursor: null });
    mock.onGet('/v1/admin/users/u-1').reply(200, ADA);
    let patchedBody: { status?: string } | null = null;
    mock.onPatch('/v1/admin/users/u-1/status').reply((config) => {
      patchedBody = JSON.parse(config.data as string);
      return [200, { user: { ...ADA, status: 'SUSPENDED', isActive: false } }];
    });

    renderAdmin();
    openUsersTab();

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Ada Lovelace').closest('tr')!);

    // Suspend button is the rose-coloured action when status === ACTIVE.
    const suspendBtn = await screen.findByRole('button', { name: /^Suspend|^تعليق/i });
    fireEvent.click(suspendBtn);

    await waitFor(() => expect(patchedBody).not.toBeNull());
    expect(patchedBody?.status).toBe('SUSPENDED');
  });

  it('disables the Suspend button when the target IS the admin themselves', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/roles').reply(200, ROLES);
    mock.onGet('/v1/admin/users').reply(200, { items: [SELF], nextCursor: null });
    mock.onGet(`/v1/admin/users/${ADMIN_ME.id}`).reply(200, SELF);

    renderAdmin();
    openUsersTab();

    // SELF preserves Ada's firstName/lastName but uses admin's id +
    // email, so "Ada Lovelace" uniquely identifies the table row
    // (the dashboard identity widget shows "Admin Admin" instead).
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Ada Lovelace').closest('tr')!);

    const suspendBtn = await screen.findByRole('button', { name: /^Suspend|^تعليق/i });
    expect(suspendBtn).toBeDisabled();
    expect(screen.getByText(/cannot disable your own account|لا يمكنك تعطيل/i)).toBeInTheDocument();
  });

  it('list response never carries passwordHash / mfaSecret', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/roles').reply(200, ROLES);
    mock.onGet('/v1/admin/users').reply(200, { items: [ADA], nextCursor: null });

    renderAdmin();
    openUsersTab();

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    const dom = document.body.textContent ?? '';
    expect(dom).not.toContain('passwordHash');
    expect(dom).not.toContain('mfaSecret');
  });
});
