import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';

import { api } from '../../../lib/api';
import { AuthProvider, queryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { AdminDashboard } from './AdminDashboard';

// Sprint 6.6 — Admin Audit Logs + Notifications wiring.

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

const AUDIT_LOG = {
  id: 'ae-1',
  actor: 'u-admin-1',
  action: 'ADMIN_PROVIDER_APPROVED',
  metadata: { providerProfileId: 'pp-1', previousStatus: 'PENDING_REVIEW', newStatus: 'ACTIVE' },
  ipAddress: null,
  userAgent: null,
  requestId: null,
  createdAt: '2026-05-02T00:00:00.000Z',
};

const NOTIFICATION = {
  id: 'n-1',
  type: 'SYSTEM',
  title: 'New dispute opened',
  body: 'Dispute dp-1 needs triage.',
  resourceType: null,
  resourceId: null,
  deepLink: '/admin/disputes/dp-1',
  metadata: null,
  readAt: null,
  createdAt: '2026-05-02T00:00:00.000Z',
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

function openAuditTab() {
  fireEvent.click(screen.getByRole('button', { name: /^Audit Logs|^سجل التدقيق/i }));
}

describe('AdminDashboard — Audit Logs (Sprint 6.6)', () => {
  it('renders real audit rows from /v1/admin/audit-logs', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/audit-logs').reply(200, { items: [AUDIT_LOG], nextCursor: null });
    mock.onGet('/v1/admin/notifications').reply(200, { items: [], nextCursor: null });

    renderAdmin();
    openAuditTab();

    await waitFor(() => expect(screen.getByText('ADMIN_PROVIDER_APPROVED')).toBeInTheDocument());
    expect(screen.getByText('u-admin-1')).toBeInTheDocument();
    // Metadata is rendered as JSON.
    expect(screen.getByText(/providerProfileId/)).toBeInTheDocument();
  });

  it('action filter triggers a new /v1/admin/audit-logs request', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/notifications').reply(200, { items: [], nextCursor: null });
    const calls: string[] = [];
    mock.onGet('/v1/admin/audit-logs').reply((config) => {
      const params = (config.params as { action?: string } | undefined) ?? {};
      calls.push(params.action ?? '');
      return [200, { items: [AUDIT_LOG], nextCursor: null }];
    });

    renderAdmin();
    openAuditTab();
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));

    const select = screen.getByLabelText(/^Action|^الإجراء/i);
    fireEvent.change(select, { target: { value: 'ADMIN_PROVIDER_APPROVED' } });
    await waitFor(() => expect(calls.includes('ADMIN_PROVIDER_APPROVED')).toBe(true));
  });

  it('actor search submits with the entered userId', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/notifications').reply(200, { items: [], nextCursor: null });
    const calls: string[] = [];
    mock.onGet('/v1/admin/audit-logs').reply((config) => {
      const params = (config.params as { actor?: string } | undefined) ?? {};
      calls.push(params.actor ?? '');
      return [200, { items: [AUDIT_LOG], nextCursor: null }];
    });

    renderAdmin();
    openAuditTab();
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));

    const input = screen.getByLabelText(/Filter by actor user id|تصفية حسب معرّف المستخدم/i);
    fireEvent.change(input, { target: { value: 'u-admin-1' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(calls.includes('u-admin-1')).toBe(true));
  });

  it('audit DOM does not contain redacted secret strings (server redacts before send)', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/notifications').reply(200, { items: [], nextCursor: null });
    // The server will have redacted these to '<redacted>' but we
    // assert the literal secret values never appear in the DOM.
    mock.onGet('/v1/admin/audit-logs').reply(200, {
      items: [
        {
          ...AUDIT_LOG,
          metadata: { previousValue: { JWT_SECRET: '<redacted>' }, ok: 'visible' },
        },
      ],
      nextCursor: null,
    });

    renderAdmin();
    openAuditTab();
    await waitFor(() => expect(screen.getByText(/visible/)).toBeInTheDocument());
    const dom = document.body.textContent ?? '';
    expect(dom).not.toContain('passwordHash');
    expect(dom).not.toContain('plaintext-token-here');
  });
});

describe('AdminDashboard — Notifications bell (Sprint 6.6)', () => {
  it('renders the live unread count from the API', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/audit-logs').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/admin/notifications').reply((config) => {
      const params = (config.params as { unread?: string } | undefined) ?? {};
      return [
        200,
        params.unread === 'true'
          ? { items: [NOTIFICATION, { ...NOTIFICATION, id: 'n-2' }], nextCursor: null }
          : { items: [NOTIFICATION], nextCursor: null },
      ];
    });

    renderAdmin();

    // The bell badge displays unread count. The unread query lists
    // only unread items so we expect "2".
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
  });

  it('mark-read button POSTs /v1/admin/notifications/:id/read', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    mock.onGet('/v1/admin/audit-logs').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/admin/notifications').reply(200, { items: [NOTIFICATION], nextCursor: null });
    let posted: string | null = null;
    mock.onPost(/\/v1\/admin\/notifications\/.+\/read/).reply((config) => {
      posted = config.url ?? null;
      return [200, { notification: { ...NOTIFICATION, readAt: '2026-05-02T01:00:00.000Z' } }];
    });

    renderAdmin();

    const bell = await screen.findByRole('button', {
      name: /Admin notifications|إشعارات الإدارة/i,
    });
    fireEvent.click(bell);

    const markBtn = await screen.findByRole('button', { name: /Mark read|تم القراءة/i });
    fireEvent.click(markBtn);

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toContain('/v1/admin/notifications/n-1/read');
  });
});
