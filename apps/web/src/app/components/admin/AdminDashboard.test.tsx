import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../../../lib/api';
import { AuthProvider, queryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { AdminDashboard } from './AdminDashboard';

// ─────────────────────────────────────────────────────────────────────────────
// Admin identity binding patch.
//
// Pin that the dashboard never renders the legacy hardcoded identity
// (AD / "System Admin" / "مدير النظام" / admin@fixnow.app) and instead
// binds to the authenticated user from /auth/me through the existing
// useAuthIdentity hook. RequireAdmin already gated the route, so this
// suite only renders <AdminDashboard /> directly with a controlled
// /auth/me mock to assert the in-shell identity surface.
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ME = {
  id: 'u-admin-1',
  email: 'admin@admin.com',
  firstName: 'Admin',
  lastName: 'Admin',
  status: 'ACTIVE' as const,
  emailVerifiedAt: '2026-04-29T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer' as const, 'provider' as const, 'admin' as const],
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

describe('AdminDashboard — identity binding', () => {
  it("renders the authenticated admin's real displayName, email, and initials", async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    renderAdmin();

    await waitFor(() =>
      expect(screen.getByTestId('admin-sidebar-name').textContent).toBe('Admin Admin'),
    );
    expect(screen.getByTestId('admin-sidebar-email').textContent).toBe('admin@admin.com');
    // Both avatars render the same derived initials.
    expect(screen.getByTestId('admin-sidebar-avatar').textContent).toBe('AA');
    expect(screen.getByTestId('admin-topbar-avatar').textContent).toBe('AA');
  });

  it('never renders the legacy hardcoded identity strings', async () => {
    mock.onGet('/v1/auth/me').reply(200, ADMIN_ME);
    renderAdmin();

    await waitFor(() => expect(screen.getByTestId('admin-sidebar-name')).toBeInTheDocument());
    // The four legacy hardcoded markers must be absent — none of them is
    // the user's real identity.
    expect(screen.queryByText(/admin@fixnow\.app/i)).toBeNull();
    expect(screen.queryByText(/^System Admin$/)).toBeNull();
    expect(screen.queryByText(/^مدير النظام$/)).toBeNull();
    // "AD" is acceptable only as a substring (it appears inside many
    // English words rendered around the dashboard). What matters is that
    // the avatar renders the derived initials, which we already asserted
    // explicitly above.
  });

  it('falls back to email local-part as displayName when first/last names are missing', async () => {
    mock.onGet('/v1/auth/me').reply(200, {
      ...ADMIN_ME,
      firstName: '',
      lastName: '',
    });
    renderAdmin();

    await waitFor(() => expect(screen.getByTestId('admin-sidebar-name').textContent).toBe('admin'));
    expect(screen.getByTestId('admin-sidebar-email').textContent).toBe('admin@admin.com');
    // Initials derive from the email local part: "ad".toUpperCase() → "AD".
    expect(screen.getByTestId('admin-sidebar-avatar').textContent).toBe('AD');
  });

  it('renders a safe empty fallback while /auth/me is loading (no fake identity flash)', async () => {
    // Never resolve /me — the auth provider stays in isLoading.
    mock.onGet('/v1/auth/me').reply(() => new Promise(() => {}));
    renderAdmin();

    // Containers exist; their textual identity slots are empty (not the
    // legacy fake values). The role label may appear as an email
    // fallback only when the user truly has no email — during loading
    // both are empty strings.
    expect(screen.getByTestId('admin-sidebar-avatar').textContent).toBe('');
    expect(screen.getByTestId('admin-sidebar-name').textContent).toBe('');
    expect(screen.queryByText(/admin@fixnow\.app/i)).toBeNull();
    expect(screen.queryByText(/^System Admin$/)).toBeNull();
  });
});
