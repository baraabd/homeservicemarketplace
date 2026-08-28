import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import type { QueryClient } from '@tanstack/react-query';

import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { PROVIDER_ONBOARDING_V2_OVERRIDE_KEY } from '../../../lib/feature-flags';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { ProviderApp } from './ProviderApp';

// Sprint 9B.16 — the flag, at the seam where it actually matters.
//
// The unit tests prove the flag reads correctly. This proves the SHELL obeys
// it: one CTA, two destinations, and the Sprint 8 wizard still reachable
// byte-for-byte when the flag is off. That second half is the rollback, and a
// rollback nobody tests is a hope.

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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderProvider() {
  return render(
    <MemoryRouter initialEntries={['/provider']}>
      <AuthProvider client={qc}>
        <LanguageProvider>
          <EcosystemProvider>
            <Routes>
              <Route path="/provider" element={<ProviderApp />} />
              <Route path="*" element={<LocationProbe />} />
            </Routes>
          </EcosystemProvider>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function mockDraftProvider() {
  mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
  mock.onGet('/v1/me/provider/profile').reply(200, { profile: DRAFT_PROFILE });
  mock.onGet(/\/v1\/(me\/)?provider\/(available-requests|jobs|bids|bookings|earnings)/).reply(403, {
    code: 'FORBIDDEN',
  });
  mock.onGet(/\/v1\/me\/notifications/).reply(200, { items: [], nextCursor: null, unreadCount: 0 });
  mock.onGet('/v1/services').reply(200, { items: [] });
  mock.onGet('/v1/services/equipment').reply(200, { items: [] });
  mock.onGet('/v1/me/provider/onboarding/draft').reply(200, {
    state: 'DRAFT',
    currentStep: 'PROVIDER_TYPE',
    steps: [],
    completedSteps: [],
    percentComplete: 0,
    nextAction: { kind: 'COMPLETE_STEP', step: 'PROVIDER_TYPE' },
    complete: false,
    missing: [],
    version: 0,
    policyVersion: 'sprint-08',
    lastSavedAt: null,
    editable: true,
    data: {},
  });
}

beforeEach(() => {
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
});

afterEach(() => {
  mock.restore();
  window.localStorage.clear();
});

const continueCta = () => screen.getByRole('button', { name: /continue onboarding/i });

describe('ProviderApp — the V2 onboarding entry point', () => {
  it('with the flag OFF, keeps the Sprint 8 wizard and never navigates', async () => {
    mockDraftProvider();
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('provider-status-draft')).toBeInTheDocument());
    fireEvent.click(continueCta());

    await waitFor(() =>
      expect(screen.getByText(/set up your provider account/i)).toBeInTheDocument(),
    );
    // Still on /provider: the legacy surface is a TAB, and the route must not
    // have moved underneath it.
    expect(screen.queryByTestId('location')).toBeNull();
  });

  it('with the flag ON, sends the provider to the full-screen route instead', async () => {
    window.localStorage.setItem(PROVIDER_ONBOARDING_V2_OVERRIDE_KEY, 'true');
    mockDraftProvider();
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('provider-status-draft')).toBeInTheDocument());
    fireEvent.click(continueCta());

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/provider/onboarding'),
    );
    // And the legacy wizard is not mounted behind it.
    expect(screen.queryByText(/set up your provider account/i)).toBeNull();
  });

  it('with the flag ON, does not mount the marketplace for a DRAFT provider', async () => {
    // The half that must never regress: changing where onboarding lives must
    // not hand a DRAFT provider the live job feed on the way.
    window.localStorage.setItem(PROVIDER_ONBOARDING_V2_OVERRIDE_KEY, 'true');
    mockDraftProvider();
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('provider-status-draft')).toBeInTheDocument());
    expect(screen.queryByText(/pull up to see requests/i)).toBeNull();
  });
});
