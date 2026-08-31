import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import type { ProviderProfileStatus } from '@homeservicemarketplace/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { ProviderApp } from './ProviderApp';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 5.1.2 — non-ACTIVE provider state surface.
//
// Pin the gating contract:
//   • status === 'ACTIVE' → live shell renders (LiveJobsScreen mounts).
//   • status DRAFT/PENDING_REVIEW/SUSPENDED/REJECTED → the live shell is
//     NOT mounted; ProviderStatusState shows the right copy.
//
// The MOCK_ME has both `customer` and `provider` roles so the route
// guard's role check is not the test under examination — the focus is
// the in-shell status branch.
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_ME = {
  id: 'u-1',
  email: 'grace@example.com',
  firstName: 'Grace',
  lastName: 'Hopper',
  status: 'ACTIVE' as const,
  emailVerifiedAt: '2026-04-29T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer' as const, 'provider' as const],
};

const BASE_PROFILE = {
  id: 'pp-1',
  displayName: 'Grace Hopper',
  initials: 'GH',
  avatarUrl: null,
  bio: null,
  headline: null,
  phoneNumber: null,
  ratingAvg: 0,
  reviewCount: 0,
  completedJobs: 0,
  verified: false,
  topPro: false,
  availability: 'OFFLINE' as const,
  serviceAreaCity: null,
  serviceAreaCountry: null,
  serviceAreaLat: null,
  serviceAreaLng: null,
  serviceAreaRadiusKm: null,
  serviceCategories: [],
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
};

function renderProvider() {
  // Mounted under `provider/*`, as production mounts it: the workspace owns
  // real routes now, and rendering it bare resolves its inner <Routes>
  // against "/" instead of "/provider".
  return render(
    <MemoryRouter initialEntries={['/provider']}>
      <AuthProvider client={qc}>
        <LanguageProvider>
          <EcosystemProvider>
            <Routes>
              <Route path="/provider/*" element={<ProviderApp />} />
            </Routes>
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

describe('ProviderApp — status gate', () => {
  it('renders the live shell when status is ACTIVE', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock
      .onGet('/v1/me/provider/profile')
      .reply(200, { profile: { ...BASE_PROFILE, status: 'ACTIVE' } });

    renderProvider();

    // The Live Jobs tab is the default — its "Pull up to see requests"
    // hint is unique to that screen.
    await waitFor(() => expect(screen.getByText(/Pull up to see requests/i)).toBeInTheDocument());
    expect(screen.queryByTestId(/^provider-status-/)).toBeNull();
  });

  it.each<ProviderProfileStatus>(['DRAFT', 'PENDING_REVIEW', 'SUSPENDED', 'REJECTED'])(
    'renders the status state surface (not the live shell) when status is %s',
    async (status) => {
      mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
      mock.onGet('/v1/me/provider/profile').reply(200, { profile: { ...BASE_PROFILE, status } });

      renderProvider();

      await waitFor(() =>
        expect(screen.getByTestId(`provider-status-${status.toLowerCase()}`)).toBeInTheDocument(),
      );
      // Live-shell hint never appears — the bottom-tab nav is not mounted.
      expect(screen.queryByText(/Pull up to see requests/i)).toBeNull();
    },
  );

  it('shows the pending-review copy for PENDING_REVIEW (no raw enum leak)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock
      .onGet('/v1/me/provider/profile')
      .reply(200, { profile: { ...BASE_PROFILE, status: 'PENDING_REVIEW' } });

    renderProvider();

    await waitFor(() => expect(screen.getByText(/Pending review/i)).toBeInTheDocument());
    // The literal enum value must never reach the user.
    expect(screen.queryByText(/PENDING_REVIEW/)).toBeNull();
  });

  it('shows the suspended copy for SUSPENDED', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock
      .onGet('/v1/me/provider/profile')
      .reply(200, { profile: { ...BASE_PROFILE, status: 'SUSPENDED' } });

    renderProvider();

    await waitFor(() => expect(screen.getByText(/Account suspended/i)).toBeInTheDocument());
    expect(screen.queryByText(/SUSPENDED/)).toBeNull();
  });

  it('falls back to onboarding (not the status state) when no profile exists', async () => {
    // 403 → onboarding, NOT a status surface: there is no ProviderProfile to
    // have a status. The status gate must not engage here.
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(403, { error: { code: 'FORBIDDEN' } });

    renderProvider();

    // Phase 4 change: the shell opens on the ONBOARDING tab rather than the
    // live map.
    //
    // It used to land on Live Jobs, which meant a user who has the provider
    // role but no profile row saw the marketplace — every call it fired came
    // back 403, painting a broken marketplace over what is really an
    // unfinished signup. The upgrade CTA was one tab click away and easy to
    // miss. This assertion tracks the same INTENT the original comment stated
    // ("the Profile tab shows the upgrade CTA"); only the number of clicks to
    // reach it changed.
    expect(
      await screen.findByRole('button', { name: /activate provider account|تفعيل/i }),
    ).toBeInTheDocument();

    // Still no status surface, and the live map is not mounted.
    expect(screen.queryByTestId(/^provider-status-/)).toBeNull();
    expect(screen.queryByText(/Pull up to see requests/i)).toBeNull();
  });
});
