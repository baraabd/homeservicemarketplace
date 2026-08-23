import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { ProviderApp } from './ProviderApp';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 7 — REGRESSION: the DRAFT "Continue onboarding" loop.
//
// A DRAFT provider is shown ProviderStatusState with a "Continue onboarding"
// CTA. The CTA calls setActiveTab('profile'). But the shell gates on
//
//     if (profile && profile.status !== 'ACTIVE') return <ProviderStatusState/>
//
// BEFORE it ever consults activeTab, so the next render returns the very same
// screen. The button appears to do nothing and the onboarding surface is
// unreachable — for the one status whose entire purpose is to finish
// onboarding. A provider in DRAFT can never leave DRAFT through the UI.
//
// These tests pin BOTH halves of the fix, because the naive repair (drop the
// gate) would hand DRAFT providers the marketplace:
//
//   1. DRAFT can REACH the onboarding surface.
//   2. DRAFT still cannot reach any MARKETPLACE surface.
//
// The second is the security-relevant half and is enforced server-side as
// well; this only asserts the client does not paint a marketplace it has no
// right to show.
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

const DRAFT_PROFILE = {
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
  status: 'DRAFT' as const,
  serviceAreaCity: null,
  serviceAreaCountry: null,
  serviceAreaLat: null,
  serviceAreaLng: null,
  serviceAreaRadiusKm: null,
  serviceCategories: [],
  pendingCategories: [],
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
};

let mock: MockAdapter;
let qc: QueryClient;

function renderProvider() {
  return render(
    <MemoryRouter>
      <AuthProvider client={qc}>
        <LanguageProvider>
          <EcosystemProvider>
            <ProviderApp />
          </EcosystemProvider>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** Answer the calls the shell makes, with a DRAFT profile. */
function mockDraftProvider() {
  mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
  mock.onGet('/v1/me/provider/profile').reply(200, { profile: DRAFT_PROFILE });
  // Marketplace endpoints answer 403 exactly as the server does for a
  // non-approved provider, so a client that wrongly mounts them is visible
  // here rather than silently passing against a permissive mock.
  mock.onGet(/\/v1\/(me\/)?provider\/(available-requests|jobs|bids|bookings|earnings)/).reply(403, {
    code: 'FORBIDDEN',
  });
  mock.onGet(/\/v1\/me\/notifications/).reply(200, { items: [], nextCursor: null, unreadCount: 0 });
}

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

describe('ProviderApp — DRAFT onboarding routing (Sprint 7 regression)', () => {
  it('shows the DRAFT status surface with a Continue onboarding CTA', async () => {
    mockDraftProvider();
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('provider-status-draft')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /continue onboarding/i })).toBeEnabled();
  });

  it('REGRESSION: Continue onboarding reaches the onboarding surface', async () => {
    // The bug: this click is swallowed. setActiveTab('profile') runs, the
    // component re-renders, the status gate matches again, and the user is
    // returned to the identical screen with no indication anything happened.
    mockDraftProvider();
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('provider-status-draft')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /continue onboarding/i }));

    // "My Skills" is a section heading unique to the profile/onboarding
    // surface. ("My Profile" is defined as a label but never painted, so it
    // is not a usable anchor.)
    await waitFor(() => expect(screen.getByText(/my skills/i)).toBeInTheDocument());
    // And the status screen is genuinely gone, not merely overlaid.
    expect(screen.queryByTestId('provider-status-draft')).toBeNull();
  });

  it('keeps every MARKETPLACE surface blocked for DRAFT after entering onboarding', async () => {
    // The half that must NOT regress while fixing the half above. Reaching
    // onboarding must not hand a DRAFT provider the live job feed.
    mockDraftProvider();
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('provider-status-draft')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /continue onboarding/i }));
    await waitFor(() => expect(screen.getByText(/my skills/i)).toBeInTheDocument());

    // The live jobs screen's unique hint must never appear for DRAFT.
    expect(screen.queryByText(/pull up to see requests/i)).toBeNull();
  });

  it('renders the onboarding surface in Arabic with RTL direction', async () => {
    // Sprint 1-6 shipped EN/AR/RTL; the routing fix must not bypass it.
    mockDraftProvider();
    window.localStorage.setItem('hsm.lang', 'ar');
    try {
      renderProvider();

      await waitFor(() => expect(screen.getByTestId('provider-status-draft')).toBeInTheDocument());
      const cta = screen.getByRole('button', { name: /إكمال الملف|continue onboarding/i });
      fireEvent.click(cta);

      // The Arabic heading of the same surface.
      await waitFor(() => expect(screen.getByText(/مهاراتي|my skills/i)).toBeInTheDocument());
      const rtlHost = document.querySelector('[dir="rtl"]');
      expect(rtlHost).not.toBeNull();
    } finally {
      window.localStorage.removeItem('hsm.lang');
    }
  });
});
