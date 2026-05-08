import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter } from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { HomeScreen } from './HomeScreen';

// ─────────────────────────────────────────────────────────────────────────────
// Regression: the home top bar used to hardcode "AK" + "Ahmed Al-Khalid"
// regardless of who was signed in. These tests mount the real HomeScreen
// tree, feed a real /me response through axios-mock-adapter, and assert
// that (a) the rendered header reflects the authenticated user and
// (b) the demo placeholder copy never appears after auth resolves.
// ─────────────────────────────────────────────────────────────────────────────

function renderHome() {
  return render(
    <AuthProvider client={qc}>
      <LanguageProvider>
        <EcosystemProvider>
          <MemoryRouter initialEntries={['/home']}>
            <HomeScreen isOffline={false} onServiceSelect={() => {}} onToggleOffline={() => {}} />
          </MemoryRouter>
        </EcosystemProvider>
      </LanguageProvider>
    </AuthProvider>,
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

const MOCK_ME_ADA = {
  id: 'u1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: 'ACTIVE' as const,
  emailVerifiedAt: '2026-04-19T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer' as const],
};

describe('Home header — authenticated identity', () => {
  it('renders real name + initials from /v1/auth/me, not the demo placeholder', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME_ADA);

    renderHome();

    // Real identity appears…
    await waitFor(() => {
      expect(screen.getByTestId('home-header-name').textContent).toBe('Ada Lovelace');
    });
    expect(screen.getByTestId('home-header-avatar').textContent).toBe('AL');

    // …and the old hardcoded strings are nowhere to be found.
    expect(screen.queryByText(/Ahmed Al-Khalid/)).toBeNull();
    expect(screen.queryByText(/أحمد الخالد/)).toBeNull();
    expect(screen.queryByTestId('home-header-avatar')?.textContent).not.toBe('AK');
  });

  it('session restore (cold mount on /home) still produces the real identity', async () => {
    // Simulates a page refresh while cookies are present: no prior render,
    // /me resolves immediately, header binds to the authenticated user.
    mock.onGet('/v1/auth/me').reply(200, {
      ...MOCK_ME_ADA,
      firstName: 'Baraa',
      lastName: 'Abdullatif',
      email: 'baraa@example.com',
    });

    renderHome();

    await waitFor(() => {
      expect(screen.getByTestId('home-header-name').textContent).toBe('Baraa Abdullatif');
    });
    expect(screen.getByTestId('home-header-avatar').textContent).toBe('BA');
  });

  it('while auth is still loading, the header does NOT render a fake logged-in identity', () => {
    // /me is pending — no reply yet. The top bar must be neutral (empty
    // strings), NOT the old "AK / Ahmed Al-Khalid" placeholder block.
    mock.onGet('/v1/auth/me').reply(() => new Promise(() => undefined));

    renderHome();

    expect(screen.queryByText(/Ahmed Al-Khalid/)).toBeNull();
    expect(screen.queryByText(/أحمد الخالد/)).toBeNull();
    expect(screen.getByTestId('home-header-name').textContent).toBe('');
    expect(screen.getByTestId('home-header-avatar').textContent).toBe('');
  });

  it('unauthenticated (/me → 401) does not show a fake logged-in identity', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderHome();

    // Let the query settle.
    await waitFor(() => {
      expect(mock.history.get.some((r) => r.url === '/v1/auth/me')).toBe(true);
    });
    expect(screen.queryByText(/Ahmed Al-Khalid/)).toBeNull();
    expect(screen.getByTestId('home-header-name').textContent).toBe('');
    expect(screen.getByTestId('home-header-avatar').textContent).toBe('');
  });

  it('handles backend returning only a firstName — no fallback to demo copy', async () => {
    mock.onGet('/v1/auth/me').reply(200, {
      ...MOCK_ME_ADA,
      firstName: 'Ada',
      lastName: '',
    });

    renderHome();

    await waitFor(() => expect(screen.getByTestId('home-header-name').textContent).toBe('Ada'));
    // Initials fall back to the first two letters of the single name — never "AK".
    expect(screen.getByTestId('home-header-avatar').textContent).toBe('AD');
    expect(screen.queryByText(/Ahmed Al-Khalid/)).toBeNull();
  });
});
