import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
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

/** Sprint 8 — the wizard's own read, for a provider who has not started. */
const EMPTY_DRAFT = {
  state: 'DRAFT' as const,
  currentStep: 'PROVIDER_TYPE' as const,
  steps: [
    { step: 'PROVIDER_TYPE' as const, complete: false, issues: [] },
    { step: 'IDENTITY' as const, complete: false, issues: [] },
    { step: 'LOCATION' as const, complete: false, issues: [] },
    { step: 'SPECIALTIES' as const, complete: false, issues: [] },
    { step: 'EXPERIENCE' as const, complete: false, issues: [] },
    { step: 'AVAILABILITY' as const, complete: false, issues: [] },
    { step: 'PROFILE' as const, complete: false, issues: [] },
    { step: 'CONSENT' as const, complete: false, issues: [] },
    { step: 'REVIEW' as const, complete: false, issues: [] },
  ],
  completedSteps: [],
  percentComplete: 0,
  nextAction: { kind: 'COMPLETE_STEP' as const, step: 'PROVIDER_TYPE' as const },
  complete: false,
  missing: [],
  version: 0,
  policyVersion: 'sprint-08',
  lastSavedAt: null,
  editable: true,
  data: {
    providerType: null,
    legalBusinessName: null,
    displayName: 'Grace Hopper',
    profileImageUrl: null,
    phoneNumber: null,
    phoneVerified: false,
    serviceAreaCity: null,
    serviceAreaCountry: null,
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: null,
    serviceAreaIds: [],
    workshopAddressLine: null,
    workshopLat: null,
    workshopLng: null,
    primaryGroupIds: [],
    specialtyLeafIds: [],
    pendingSpecialtyIds: [],
    yearsOfExperience: null,
    professionSince: null,
    equipmentCodes: [],
    transportMode: null,
    availability: [],
    timezone: null,
    headline: null,
    bio: null,
    additionalInformation: null,
    acceptedConsentVersion: null,
    consentAcceptedAt: null,
  },
};

let mock: MockAdapter;
let qc: QueryClient;

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

  // Sprint 8 — the onboarding surface these tests reach is now the wizard,
  // which reads its own draft plus the public catalogue. Answered here so the
  // routing assertions below fail on ROUTING when they fail, not on an
  // unmocked request.
  mock.onGet('/v1/me/provider/onboarding/draft').reply(200, EMPTY_DRAFT);
  mock.onGet('/v1/services').reply(200, { items: [] });
  mock.onGet('/v1/services/equipment').reply(200, { items: [] });
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

    // Sprint 8 — the onboarding surface is now the WIZARD, not the profile
    // editor. "Set up your provider account" is its heading and belongs to no
    // other screen, so it is the anchor that proves the right surface mounted.
    await waitFor(() =>
      expect(screen.getByText(/set up your provider account/i)).toBeInTheDocument(),
    );
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
    await waitFor(() =>
      expect(screen.getByText(/set up your provider account/i)).toBeInTheDocument(),
    );

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

      // The Arabic heading of the same surface — the wizard, since Sprint 8.
      await waitFor(() =>
        expect(
          screen.getByText(/إعداد حساب مزوّد الخدمة|set up your provider account/i),
        ).toBeInTheDocument(),
      );
      const rtlHost = document.querySelector('[dir="rtl"]');
      expect(rtlHost).not.toBeNull();
    } finally {
      window.localStorage.removeItem('hsm.lang');
    }
  });
});
