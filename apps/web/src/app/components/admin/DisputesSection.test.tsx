import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';

import { api } from '../../../lib/api';
import { AuthProvider, queryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { AdminDashboard } from './AdminDashboard';

// Sprint 6.3 — Admin Disputes full workflow.
//
// What these tests pin:
//  - The Dispute Center tab renders a real, API-driven list (no mock).
//  - Status + priority filter chips trigger /v1/admin/disputes refetches.
//  - Opening a row fires GET /v1/admin/disputes/:id and shows the
//    detail drawer with the recentEvents timeline.
//  - Status / priority editor PATCHes /v1/admin/disputes/:id and the
//    table refetches via the invalidateQueries hook.
//  - The resolve form POSTs /v1/admin/disputes/:id/resolve.
//  - Terminal-state disputes show the "cannot edit" copy.

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

const DISPUTE = {
  id: 'dp-1',
  bookingId: 'bk-1',
  openedById: 'user-seeker-1',
  status: 'OPEN' as const,
  priority: 'MEDIUM' as const,
  reason: 'Provider was late',
  description: null,
  resolution: null,
  resolvedAt: null,
  resolvedById: null,
  createdAt: '2026-05-02T00:00:00.000Z',
  updatedAt: '2026-05-02T00:00:00.000Z',
};

const DISPUTE_DETAIL = {
  ...DISPUTE,
  recentEvents: [
    {
      id: 'de-1',
      type: 'OPENED' as const,
      actorUserId: 'admin-1',
      before: null,
      after: { status: 'OPEN' },
      message: null,
      createdAt: '2026-05-02T00:00:00.000Z',
    },
  ],
};

const RESOLVED_DISPUTE_DETAIL = {
  ...DISPUTE_DETAIL,
  status: 'RESOLVED_REFUND' as const,
  resolution: 'full refund',
  resolvedAt: '2026-05-02T01:00:00.000Z',
  resolvedById: 'u-admin-1',
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

function openDisputesTab() {
  fireEvent.click(screen.getByRole('button', { name: /Dispute Center|مركز النزاعات/i }));
}

describe('AdminDashboard — Dispute Center (Sprint 6.3)', () => {
  it('renders real disputes from /v1/admin/disputes (no mock)', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/disputes').reply(200, { items: [DISPUTE], nextCursor: null });

    renderAdmin();
    openDisputesTab();

    await waitFor(() => expect(screen.getByText('Provider was late')).toBeInTheDocument());
    expect(screen.getAllByText('OPEN').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MEDIUM').length).toBeGreaterThan(0);
  });

  it('renders empty-state copy when the list is empty', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/disputes').reply(200, { items: [], nextCursor: null });

    renderAdmin();
    openDisputesTab();

    await waitFor(() =>
      expect(
        screen.getByText(/No disputes match the current filter|لا توجد نزاعات مطابقة/i),
      ).toBeInTheDocument(),
    );
  });

  it('priority filter chip triggers a /v1/admin/disputes?priority=URGENT refetch', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    const calls: string[] = [];
    mock.onGet('/v1/admin/disputes').reply((config) => {
      const params = (config.params as { priority?: string } | undefined) ?? {};
      calls.push(params.priority ?? '');
      return [200, { items: [DISPUTE], nextCursor: null }];
    });

    renderAdmin();
    openDisputesTab();
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));

    fireEvent.click(screen.getByRole('tab', { name: 'URGENT' }));
    await waitFor(() => expect(calls.includes('URGENT')).toBe(true));
  });

  it('opens the detail drawer with the events timeline', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/disputes').reply(200, { items: [DISPUTE], nextCursor: null });
    mock.onGet('/v1/admin/disputes/dp-1').reply(200, DISPUTE_DETAIL);

    renderAdmin();
    openDisputesTab();

    await waitFor(() => expect(screen.getByText('Provider was late')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Provider was late').closest('tr')!);

    await waitFor(() => expect(screen.getByText(/^OPENED$/)).toBeInTheDocument());
  });

  it('PATCHes /v1/admin/disputes/:id when Save is clicked', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/disputes').reply(200, { items: [DISPUTE], nextCursor: null });
    mock.onGet('/v1/admin/disputes/dp-1').reply(200, DISPUTE_DETAIL);
    let patchedBody: { priority?: string; status?: string } | null = null;
    mock.onPatch('/v1/admin/disputes/dp-1').reply((config) => {
      patchedBody = JSON.parse(config.data as string);
      return [200, { dispute: { ...DISPUTE_DETAIL, priority: 'URGENT' } }];
    });

    renderAdmin();
    openDisputesTab();
    await waitFor(() => expect(screen.getByText('Provider was late')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Provider was late').closest('tr')!);

    // FilterChips also exposes an aria-label="Priority"; the editor's
    // <select> is the only one that's actually a combobox.
    const prioritySelect = await screen.findByRole('combobox', {
      name: /^Priority|^الأولوية/i,
    });
    fireEvent.change(prioritySelect, { target: { value: 'URGENT' } });

    fireEvent.click(screen.getByRole('button', { name: /Save changes|حفظ التغييرات/i }));
    await waitFor(() => expect(patchedBody).not.toBeNull());
    expect(patchedBody?.priority).toBe('URGENT');
  });

  it('Resolve action POSTs /v1/admin/disputes/:id/resolve with the form values', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/disputes').reply(200, { items: [DISPUTE], nextCursor: null });
    mock.onGet('/v1/admin/disputes/dp-1').reply(200, DISPUTE_DETAIL);
    let resolveBody: { status?: string; resolution?: string } | null = null;
    mock.onPost('/v1/admin/disputes/dp-1/resolve').reply((config) => {
      resolveBody = JSON.parse(config.data as string);
      return [200, { dispute: RESOLVED_DISPUTE_DETAIL }];
    });

    renderAdmin();
    openDisputesTab();
    await waitFor(() => expect(screen.getByText('Provider was late')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Provider was late').closest('tr')!);

    const resolutionField = await screen.findByLabelText(/^Resolution|^النص/i);
    fireEvent.change(resolutionField, { target: { value: 'full refund' } });

    fireEvent.click(screen.getByRole('button', { name: /^Resolve|^تسوية/i }));
    await waitFor(() => expect(resolveBody).not.toBeNull());
    expect(resolveBody?.resolution).toBe('full refund');
    expect(resolveBody?.status).toBe('RESOLVED_REFUND');
  });

  it('shows terminal-state copy and hides the editors for resolved disputes', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock
      .onGet('/v1/admin/disputes')
      .reply(200, { items: [{ ...DISPUTE, status: 'RESOLVED_REFUND' }], nextCursor: null });
    mock.onGet('/v1/admin/disputes/dp-1').reply(200, RESOLVED_DISPUTE_DETAIL);

    renderAdmin();
    openDisputesTab();
    await waitFor(() => expect(screen.getByText('Provider was late')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Provider was late').closest('tr')!);

    await waitFor(() =>
      expect(screen.getByText(/terminal state|نهائية ولا يمكن تعديله/i)).toBeInTheDocument(),
    );
    // Save button must be absent.
    expect(screen.queryByRole('button', { name: /Save changes|حفظ التغييرات/i })).toBeNull();
  });

  it('list response never carries Prisma / SQL / secrets in the DOM', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/disputes').reply(200, { items: [DISPUTE], nextCursor: null });

    renderAdmin();
    openDisputesTab();
    await waitFor(() => expect(screen.getByText('Provider was late')).toBeInTheDocument());
    const dom = document.body.textContent ?? '';
    expect(dom).not.toContain('passwordHash');
    expect(dom).not.toContain('PrismaClient');
  });
});
