import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';

// LiveJobsScreen mounts a Leaflet map, which happy-dom cannot size. Same
// stubs the sibling suite uses; the real Leaflet path is exercised in the
// Playwright build.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="leaflet-map">{children}</div>
  ),
  TileLayer: () => <div data-testid="leaflet-tile" />,
  Marker: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  useMap: () => ({
    fitBounds: () => {},
    setView: () => {},
    invalidateSize: () => {},
    getContainer: () => document.createElement('div'),
  }),
}));
vi.mock('leaflet', () => ({
  default: { divIcon: vi.fn((o: unknown) => o ?? {}), latLngBounds: vi.fn(() => ({})) },
}));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { ProviderApp } from './ProviderApp';

// ─────────────────────────────────────────────────────────────────────────────
// Mode B — the workspace routing contract.
//
// The workspace used to choose its screen with `useState('jobs')`. Nothing
// about that was addressable: a reload dropped the provider back on Jobs, no
// screen could be linked to, and the browser back button did not move between
// them. These tests pin the properties that replaced it, because they are the
// whole reason the change was made and they are easy to regress silently — a
// future refactor back to local state would still render every screen
// correctly and fail only here.
//
// The gate is asserted too. Turning it from a pinned tab into a redirect is a
// LAYOUT change to a SECURITY-shaped rule: a non-ACTIVE provider must still
// never mount a marketplace screen. That is enforced server-side as well; this
// only pins that the client does not paint a marketplace it has no right to.
// ─────────────────────────────────────────────────────────────────────────────

function Probe() {
  return <div data-testid="url">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider client={qc}>
        <LanguageProvider>
          <EcosystemProvider>
            <Routes>
              <Route path="/provider/*" element={<ProviderApp />} />
              <Route path="*" element={<Probe />} />
            </Routes>
            <Probe />
          </EcosystemProvider>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

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

const CONVERSATIONS = {
  items: [
    {
      id: 'conv-newest',
      otherParticipant: { displayName: 'Dana Rivera', initials: 'DR' },
      lastMessageBody: 'See you at nine',
      unreadCount: 0,
    },
    {
      id: 'conv-older',
      otherParticipant: { displayName: 'Sam Okafor', initials: 'SO' },
      lastMessageBody: 'Thanks!',
      unreadCount: 0,
    },
  ],
  nextCursor: null,
};

let mock: MockAdapter;
let qc: QueryClient;
const ORIGINAL_FETCH = globalThis.fetch;

/** Everything the workspace reads, so a routing assertion fails on ROUTING. */
function mockWorkspace(status: string) {
  mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
  mock.onGet('/v1/me/provider/profile').reply(200, { profile: { ...BASE_PROFILE, status } });
  mock.onGet(/\/v1\/me\/notifications/).reply(200, { items: [], nextCursor: null, unreadCount: 0 });
  mock.onGet('/v1/provider/conversations').reply(200, CONVERSATIONS);
  mock.onGet(/\/v1\/provider\/conversations\/[^/]+\/messages/).reply(200, { items: [] });
  mock.onGet('/v1/provider/earnings/summary').reply(200, {
    availableCents: 0,
    grossCents: 0,
    feesCents: 0,
    pendingCents: 0,
    completedJobs: 0,
    currency: 'USD',
  });
  mock.onGet('/v1/provider/earnings/transactions').reply(200, { items: [], nextCursor: null });
  mock.onGet('/v1/provider/earnings/chart').reply(200, { points: [], range: '7d' });
  mock.onGet(/\/v1\/(me\/)?provider\/(available-requests|bids|bookings)/).reply(200, { items: [] });
  mock.onGet('/v1/me/provider/onboarding/draft').reply(404);
  mock.onGet('/v1/services').reply(200, { items: [] });
  mock.onGet('/v1/services/equipment').reply(200, { items: [] });
}

beforeEach(() => {
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
  globalThis.fetch = (async () =>
    new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
});
afterEach(() => {
  mock.restore();
  globalThis.fetch = ORIGINAL_FETCH;
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
});

describe('provider workspace — every screen has an address', () => {
  it('opens the wallet directly from its URL, with no navigation', async () => {
    // The property the old shell could not have: arriving at a screen without
    // first landing somewhere else and clicking.
    mockWorkspace('ACTIVE');
    renderAt('/provider/wallet');

    expect(
      await screen.findByText(/Available Balance/i, undefined, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('/provider/wallet');
  });

  it('sends an ACTIVE provider from /provider to their jobs', async () => {
    mockWorkspace('ACTIVE');
    renderAt('/provider');

    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/provider/jobs'));
  });

  it('sends a DRAFT provider from /provider to their status, which has its own URL', async () => {
    // Previously this state had no address at all — it was whatever the shell
    // decided to render instead of the tab you asked for.
    mockWorkspace('DRAFT');
    renderAt('/provider');

    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/provider/status'));
    expect(await screen.findByTestId('provider-status-draft')).toBeInTheDocument();
  });

  it('refuses a marketplace deep link for a non-ACTIVE provider', async () => {
    // The security-shaped half: a SUSPENDED provider typing the jobs URL is
    // redirected, and the marketplace screen never mounts.
    mockWorkspace('SUSPENDED');
    renderAt('/provider/jobs');

    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/provider/status'));
    expect(screen.queryByText(/Pull up to see requests/i)).toBeNull();
    expect(screen.queryByTestId('leaflet-map')).toBeNull();
  });
});

describe('provider workspace — a conversation is linkable', () => {
  it('opens the thread named in the URL', async () => {
    mockWorkspace('ACTIVE');
    renderAt('/provider/messages/conv-older');

    // Matched on the SURNAME: the list renders participants through
    // formatPrivacyDisplayName, which abbreviates the given name, so the seeded
    // "Sam Okafor" appears as "S. Okafor". The two fixtures deliberately have
    // different surnames so the matcher can tell the threads apart.
    //
    // The list is present and the URL's thread is the selected one — not the
    // most recent, which is what the old auto-select would have chosen.
    expect(await screen.findByText(/Okafor/, undefined, { timeout: 10_000 })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('url')).toHaveTextContent('/provider/messages/conv-older'),
    );
  });

  it('puts the chosen conversation in the URL', async () => {
    mockWorkspace('ACTIVE');
    renderAt('/provider/messages/conv-newest');

    fireEvent.click(await screen.findByText(/Okafor/, undefined, { timeout: 10_000 }));

    await waitFor(() =>
      expect(screen.getByTestId('url')).toHaveTextContent('/provider/messages/conv-older'),
    );
  });
});
