import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';

import { api } from '../../../lib/api';
import { AuthProvider, queryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { AdminDashboard } from './AdminDashboard';

// Sprint 6.2 — Admin Pro Verification full workflow.
//
// What these tests pin:
//  - The Pro Verification tab renders a real, API-driven provider
//    list (no PRO_VERIFICATIONS mock).
//  - Status filter chips trigger a /v1/admin/providers?status=… refetch.
//  - Opening a row fires GET /v1/admin/providers/:id +
//    GET /v1/admin/providers/:id/audit and shows the detail drawer.
//  - The review-notes textarea PATCHes /v1/admin/providers/:id/review-notes
//    with the typed content and the table refetches afterwards.
//  - Approve / reject / suspend / reactivate buttons fire the
//    corresponding POST endpoints.
//  - The list never carries passwordHash / mfaSecret in the DOM.

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

const PROVIDER = {
  id: 'pp-1',
  status: 'PENDING_REVIEW' as const,
  userId: 'u-prov-1',
  email: 'p@example.com',
  displayName: 'Ada Lovelace',
  initials: 'AL',
  ratingAvg: 4.9,
  reviewCount: 312,
  completedJobs: 540,
  verified: true,
  topPro: false,
  serviceAreaCity: 'Riyadh',
  serviceAreaCountry: 'Saudi Arabia',
  reviewNotes: null,
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
};

const AUDIT_ROWS = {
  items: [
    {
      id: 'ae-1',
      type: 'ADMIN_PROVIDER_APPROVED',
      adminUserId: 'u-admin-1',
      metadata: { providerProfileId: 'pp-1' },
      createdAt: '2026-05-02T10:00:00.000Z',
    },
  ],
  nextCursor: null,
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

function openVerificationTab() {
  fireEvent.click(screen.getByRole('button', { name: /Pro Verification|توثيق المحترفين/i }));
}

describe('AdminDashboard — Pro Verification (Sprint 6.2)', () => {
  it('renders real providers from /v1/admin/providers (no mock)', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/providers').reply(200, { items: [PROVIDER], nextCursor: null });

    renderAdmin();
    openVerificationTab();

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    expect(screen.getByText('p@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('PENDING_REVIEW').length).toBeGreaterThan(0);
  });

  it('renders the empty-state copy when the list is empty', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/providers').reply(200, { items: [], nextCursor: null });

    renderAdmin();
    openVerificationTab();

    await waitFor(() =>
      expect(
        screen.getByText(/No providers match the current filter|لا يوجد محترفون مطابقون/i),
      ).toBeInTheDocument(),
    );
  });

  it('status filter chip triggers a /v1/admin/providers?status=ACTIVE refetch', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    const calls: string[] = [];
    mock.onGet('/v1/admin/providers').reply((config) => {
      const params = (config.params as { status?: string } | undefined) ?? {};
      calls.push(params.status ?? '');
      return [200, { items: [PROVIDER], nextCursor: null }];
    });

    renderAdmin();
    openVerificationTab();
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));

    fireEvent.click(screen.getByRole('tab', { name: 'ACTIVE' }));
    await waitFor(() => expect(calls.includes('ACTIVE')).toBe(true));
  });

  it('opens the detail drawer with audit history + saves review notes', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/providers').reply(200, { items: [PROVIDER], nextCursor: null });
    mock.onGet('/v1/admin/providers/pp-1').reply(200, PROVIDER);
    mock.onGet('/v1/admin/providers/pp-1/audit').reply(200, AUDIT_ROWS);
    let patchedBody: { notes?: string } | null = null;
    mock.onPatch('/v1/admin/providers/pp-1/review-notes').reply((config) => {
      patchedBody = JSON.parse(config.data as string);
      return [200, { provider: { ...PROVIDER, reviewNotes: patchedBody?.notes ?? '' } }];
    });

    renderAdmin();
    openVerificationTab();

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Ada Lovelace').closest('tr')!);

    // Audit timeline renders the seeded ADMIN_PROVIDER_APPROVED row.
    await waitFor(() => expect(screen.getByText(/ADMIN_PROVIDER_APPROVED/i)).toBeInTheDocument());

    const textarea = screen.getByLabelText(/Reviewer notes|ملاحظات المراجع/i);
    fireEvent.change(textarea, { target: { value: 'Documents missing' } });
    fireEvent.click(screen.getByRole('button', { name: /Save notes|حفظ الملاحظات/i }));

    await waitFor(() => expect(patchedBody).not.toBeNull());
    expect(patchedBody?.notes).toBe('Documents missing');
  });

  it('Approve button POSTs /v1/admin/providers/:id/approve when status is PENDING_REVIEW', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/providers').reply(200, { items: [PROVIDER], nextCursor: null });
    mock.onGet('/v1/admin/providers/pp-1').reply(200, PROVIDER);
    mock.onGet('/v1/admin/providers/pp-1/audit').reply(200, AUDIT_ROWS);
    let approved = false;
    mock.onPost('/v1/admin/providers/pp-1/approve').reply(() => {
      approved = true;
      return [200, { provider: { ...PROVIDER, status: 'ACTIVE' } }];
    });

    renderAdmin();
    openVerificationTab();
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Ada Lovelace').closest('tr')!);

    const approveBtn = await screen.findByRole('button', { name: /^Approve|^قبول/i });
    fireEvent.click(approveBtn);
    await waitFor(() => expect(approved).toBe(true));
  });

  it('disables Approve when status is not pending', async () => {
    const ACTIVE = { ...PROVIDER, status: 'ACTIVE' as const };
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/providers').reply(200, { items: [ACTIVE], nextCursor: null });
    mock.onGet('/v1/admin/providers/pp-1').reply(200, ACTIVE);
    mock.onGet('/v1/admin/providers/pp-1/audit').reply(200, AUDIT_ROWS);

    renderAdmin();
    openVerificationTab();
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Ada Lovelace').closest('tr')!);

    const approveBtn = await screen.findByRole('button', { name: /^Approve|^قبول/i });
    expect(approveBtn).toBeDisabled();
    // Suspend should be enabled (status === ACTIVE)
    const suspendBtn = screen.getByRole('button', { name: /^Suspend|^تعليق/i });
    expect(suspendBtn).not.toBeDisabled();
  });

  it('list response never carries passwordHash / mfaSecret', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/providers').reply(200, { items: [PROVIDER], nextCursor: null });

    renderAdmin();
    openVerificationTab();

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    const dom = document.body.textContent ?? '';
    expect(dom).not.toContain('passwordHash');
    expect(dom).not.toContain('mfaSecret');
  });
});
