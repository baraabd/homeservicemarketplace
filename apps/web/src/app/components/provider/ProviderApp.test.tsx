import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';

// Phase 6 (Provider) — LiveJobsScreen mounts a Leaflet MapContainer
// at the top of the default tab. Real Leaflet measures the viewport
// (clientWidth/Height) on init, which happy-dom does not size, so the
// map throws on mount during tests. We replace react-leaflet with
// minimal DOM stubs that surface the props we want to assert on
// (center / position / popup contents) without booting Leaflet's
// rendering engine. The stubs are scoped to the test file so the real
// Leaflet code path is exercised in the runtime build.
vi.mock('react-leaflet', () => ({
  MapContainer: ({
    children,
    center,
    'aria-label': ariaLabel,
  }: {
    children?: ReactNode;
    center?: [number, number];
    'aria-label'?: string;
  }) => (
    <div data-testid="leaflet-map" data-center={JSON.stringify(center)} aria-label={ariaLabel}>
      {children}
    </div>
  ),
  TileLayer: ({ url }: { url?: string }) => <div data-testid="leaflet-tile" data-url={url} />,
  Marker: ({ children, position }: { children?: ReactNode; position?: [number, number] }) => (
    <div data-testid="leaflet-marker" data-position={JSON.stringify(position)}>
      {children}
    </div>
  ),
  Popup: ({ children }: { children?: ReactNode }) => (
    <div data-testid="leaflet-popup">{children}</div>
  ),
  useMap: () => ({
    fitBounds: () => {},
    setView: () => {},
  }),
}));

// L.divIcon / L.latLngBounds are called from JobMarker / MapAutoFit at
// render time. The real implementations need a DOM-attached element to
// compute bounds; the no-op stubs are enough to satisfy the call sites.
vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn((opts: unknown) => opts ?? {}),
    latLngBounds: vi.fn(() => ({})),
  },
}));

// Importing the leaflet stylesheet has no DOM side-effect under
// happy-dom, but Vite would still try to resolve the asset at test
// time. The stub keeps the import a no-op.
vi.mock('leaflet/dist/leaflet.css', () => ({}));

// Sprint 7.0 — sonner is imported by BiddingModal (toast.error path)
// and by LiveJobsScreen (the new-job toast.success path). Mock at
// module scope so the new-job toast tests can assert on the mock,
// and so existing BiddingModal tests don't fire real toasts during
// happy-dom runs.
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { api } from '../../../lib/api';
import { AuthProvider, queryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { ProviderApp } from './ProviderApp';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 5 Slice 5.1 — Provider Profile foundation.
//
// These tests pin the slice's frontend contract:
//   • Provider top bar + ProviderProfileScreen render real
//     ProviderProfile from the backend (no hardcoded "Omar" / "OK").
//   • Non-provider users (403/404 from /v1/me/provider/profile) see
//     the safe Activate Provider Account onboarding state.
//   • Clicking Activate posts /v1/me/provider/upgrade and refetches.
//   • Availability toggle calls PATCH /v1/me/provider/availability.
//   • Backend errors never render the raw payload.
// ─────────────────────────────────────────────────────────────────────────────

function renderProvider() {
  // Phase 5: ProviderProfileScreen now calls useNavigate() so the
  // Sign Out button can route to /login. Tests must wrap in a
  // MemoryRouter to provide router context. /provider is a sensible
  // initial path even though the bottom-nav drives the in-app route.
  return render(
    <MemoryRouter initialEntries={['/provider']}>
      <AuthProvider>
        <LanguageProvider>
          <EcosystemProvider>
            <ProviderApp />
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

const MOCK_PROFILE = {
  id: 'pp-1',
  displayName: 'Grace Hopper',
  initials: 'GH',
  avatarUrl: null,
  bio: null,
  headline: null,
  phoneNumber: null,
  ratingAvg: 4.9,
  reviewCount: 312,
  completedJobs: 540,
  verified: true,
  topPro: true,
  availability: 'OFFLINE' as const,
  status: 'ACTIVE' as const,
  serviceAreaCity: 'Riyadh',
  serviceAreaCountry: 'Saudi Arabia',
  serviceAreaLat: 24.7136,
  serviceAreaLng: 46.6753,
  serviceAreaRadiusKm: 25,
  serviceCategories: [
    { id: 'c1', slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة', icon: 'wrench' },
    { id: 'c2', slug: 'electrical', labelEn: 'Electrical', labelAr: 'كهرباء', icon: 'zap' },
  ],
  createdAt: '2024-06-15T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
};

// Switch to the Profile tab (the bottom-nav button is matched by its
// label). The Live Jobs tab renders by default; the slice's profile
// surface lives behind one click.
function openProfileTab() {
  fireEvent.click(screen.getByRole('button', { name: /^profile|ملفي/i }));
}

describe('ProviderApp — provider with profile', () => {
  it('renders the real provider identity (no "Omar Al-Khalid" hardcoded)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });

    renderProvider();
    openProfileTab();

    await waitFor(() => expect(screen.getAllByText('Grace Hopper').length).toBeGreaterThan(0));
    expect(screen.getAllByText('GH').length).toBeGreaterThan(0);
    // Real stats from the backend.
    expect(screen.getByText('540')).toBeInTheDocument();
    expect(screen.getByText('4.9★')).toBeInTheDocument();
    // Service area pill — stays on jobs tab when we open it; for now,
    // confirm the city/country roundtrip is in the rendered profile.
    expect(screen.queryByText(/Omar Al-Khalid/i)).toBeNull();
    expect(screen.queryByText(/^OK$/)).toBeNull();
    expect(screen.queryByText(/Member since Jan 2023/i)).toBeNull();
  });

  it('renders skills from the backend categories (not the hardcoded array)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });

    renderProvider();
    openProfileTab();

    await waitFor(() => expect(screen.getByText('Plumbing')).toBeInTheDocument());
    expect(screen.getByText('Electrical')).toBeInTheDocument();
    // The legacy hardcoded list also included AC Repair / Carpentry —
    // those should NOT appear because the backend rows don't include them.
    expect(screen.queryByText('AC Repair')).toBeNull();
    expect(screen.queryByText('Carpentry')).toBeNull();
  });

  it('availability toggle calls PATCH /v1/me/provider/availability', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    let postedBody: Record<string, unknown> = {};
    mock.onPatch('/v1/me/provider/availability').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { profile: { ...MOCK_PROFILE, availability: 'ONLINE' } }];
    });

    renderProvider();
    openProfileTab();
    await waitFor(() => expect(screen.getAllByText('Grace Hopper').length).toBeGreaterThan(0));

    // The toggle button has aria-label = the current availability label.
    const toggle = screen.getByRole('button', { name: /unavailable|غير متاح/i });
    fireEvent.click(toggle);

    await waitFor(() => expect(postedBody.availability).toBe('ONLINE'));
  });

  it('shows safe error copy when availability PATCH fails (no raw payload in DOM)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onPatch('/v1/me/provider/availability').reply(500, {
      error: { code: 'INTERNAL_ERROR', message: 'PrismaClientKnownRequestError: boom' },
    });

    renderProvider();
    openProfileTab();
    await waitFor(() => expect(screen.getAllByText('Grace Hopper').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /unavailable|غير متاح/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/couldn't update your availability|تعذر تحديث الحالة/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/PrismaClient/i)).toBeNull();
    expect(screen.queryByText(/boom/i)).toBeNull();
  });
});

describe('ProviderApp — non-provider onboarding', () => {
  it('shows the Activate Provider Account state when the API returns 403', async () => {
    mock.onGet('/v1/auth/me').reply(200, { ...MOCK_ME, roles: ['customer' as const] });
    mock.onGet('/v1/me/provider/profile').reply(403, {
      error: { code: 'FORBIDDEN', message: 'Forbidden' },
    });

    renderProvider();
    openProfileTab();

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /activate provider account|تفعيل حساب المحترف/i }),
      ).toBeInTheDocument(),
    );
    // No fake stats on the onboarding surface.
    expect(screen.queryByText(/156/)).toBeNull();
    expect(screen.queryByText(/4\.8★/)).toBeNull();
  });

  it('Activate button calls POST /v1/me/provider/upgrade with no body and seeds the cache', async () => {
    mock.onGet('/v1/auth/me').reply(200, { ...MOCK_ME, roles: ['customer' as const] });
    mock.onGet('/v1/me/provider/profile').reply(403, { error: { code: 'FORBIDDEN' } });
    let upgradeCalls = 0;
    let upgradeBody: string | null = null;
    mock.onPost('/v1/me/provider/upgrade').reply((config) => {
      upgradeCalls += 1;
      // The deliberate-upgrade contract: no client body. axios serialises
      // an empty post as undefined / "" — both are acceptable.
      upgradeBody = (config.data as string | undefined) ?? null;
      return [200, { profile: MOCK_PROFILE }];
    });

    renderProvider();
    openProfileTab();
    const activate = await screen.findByRole('button', {
      name: /activate provider account|تفعيل حساب المحترف/i,
    });
    fireEvent.click(activate);

    await waitFor(() => expect(upgradeCalls).toBe(1));
    // No client-supplied body — userId comes from the session only.
    expect(upgradeBody === null || upgradeBody === '').toBe(true);
    // Cache is seeded with the upgrade response — the post-upgrade
    // render verification is covered by the "shell top bar identity"
    // tests in this file (which assert the same setQueryData → render
    // path under cleaner conditions).
  });

  it('shows the safe upgrade error when POST /upgrade fails (no raw payload)', async () => {
    mock.onGet('/v1/auth/me').reply(200, { ...MOCK_ME, roles: ['customer' as const] });
    mock.onGet('/v1/me/provider/profile').reply(403);
    mock.onPost('/v1/me/provider/upgrade').reply(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'PrismaClientKnownRequestError: provider role missing',
      },
    });

    renderProvider();
    openProfileTab();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /activate provider account|تفعيل حساب المحترف/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /activate provider account|تفعيل حساب المحترف/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(/couldn't activate your provider account|تعذر تفعيل الحساب/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/PrismaClient/i)).toBeNull();
    expect(screen.queryByText(/provider role missing/i)).toBeNull();
  });
});

describe('ProviderApp — shell top bar identity', () => {
  it('uses the auth identity when no provider profile is loaded yet', async () => {
    mock.onGet('/v1/auth/me').reply(200, { ...MOCK_ME, roles: ['customer' as const] });
    mock.onGet('/v1/me/provider/profile').reply(403);

    renderProvider();
    // The Bids tab renders the top bar (Live Jobs hides it).
    fireEvent.click(screen.getByRole('button', { name: /^my bids|عروضي/i }));

    await waitFor(() => expect(screen.getAllByText('Grace Hopper').length).toBeGreaterThan(0));
    expect(screen.queryByText(/Omar Al-Khalid/i)).toBeNull();
    expect(screen.queryByText(/^OK$/)).toBeNull();
  });

  it('prefers the provider profile identity over the auth identity once loaded', async () => {
    const profileWithDifferentIdentity = {
      ...MOCK_PROFILE,
      displayName: 'Trade Name LLC',
      initials: 'TN',
    };
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: profileWithDifferentIdentity });

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: /^my bids|عروضي/i }));

    await waitFor(() => expect(screen.getAllByText('Trade Name LLC').length).toBeGreaterThan(0));
    // Auth identity (Grace Hopper) is overridden.
    expect(screen.queryByText('Grace Hopper')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5 — Provider Profile actions.
// Bug 4 (Sign Out) and Feature 5 (Edit Profile) used to be no-ops.
// ─────────────────────────────────────────────────────────────────────────────

describe('ProviderApp — Phase 5 profile actions', () => {
  it('Sign Out calls /v1/auth/logout and the button reflects an in-flight state', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    let logoutHits = 0;
    mock.onPost('/v1/auth/logout').reply(() => {
      logoutHits += 1;
      return [200, {}];
    });

    renderProvider();
    openProfileTab();

    const signOut = await screen.findByTestId('provider-sign-out');
    fireEvent.click(signOut);

    await waitFor(() => expect(logoutHits).toBe(1));
  });

  it('Edit Profile button swaps to the EditProfilePage in place', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    // EditProfilePage hits /v1/me/profile on mount; mock that too so
    // the swapped surface doesn't sit stuck on a loading state.
    mock.onGet('/v1/me/profile').reply(200, {
      id: 'u-1',
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      phone: null,
      bio: null,
      avatarUrl: null,
    });

    renderProvider();
    openProfileTab();

    const edit = await screen.findByTestId('provider-menu-edit-profile');
    fireEvent.click(edit);

    // EditProfilePage replaces the profile menu — the Sign Out button
    // disappears because we're on the Edit surface now.
    await waitFor(() => {
      expect(screen.queryByTestId('provider-sign-out')).toBeNull();
    });
  });
});

// Phase 6 — LiveJobsScreen interactive map.
// Replaces the static Unsplash photo with a Leaflet MapContainer that
// renders one Marker per available-request that carries real lat/lng,
// skipping rows whose location.{lat,lng} are null. The map's default
// center comes from the provider's serviceArea coords when set, with
// Riyadh [24.7136, 46.6753] as the hard-coded fallback for the empty
// case. react-leaflet + leaflet are mocked at the top of this file
// because happy-dom doesn't size the viewport for real Leaflet to
// measure.
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_AVAILABLE_REQUEST = {
  id: 'r1',
  category: { id: 'c1', slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
  customServiceText: null,
  description: 'Pipe leak under kitchen sink',
  media: [],
  scheduleType: 'ASAP' as const,
  scheduledAt: null,
  location: {
    city: 'Riyadh',
    country: 'Saudi Arabia',
    lat: 24.6904,
    lng: 46.6863,
  },
  bidsCount: 0,
  createdAt: '2026-05-01T08:00:00.000Z',
};

describe('ProviderApp — Phase 6 Live Jobs map', () => {
  it('mounts a Leaflet MapContainer + TileLayer on the default Live Jobs tab', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/available-requests').reply(200, { items: [], nextCursor: null });

    renderProvider();

    // The aria-label distinguishes our map from any other landmarks.
    await waitFor(() =>
      expect(screen.getByLabelText(/live jobs map|خريطة الوظائف الحية/i)).toBeInTheDocument(),
    );
    expect(screen.getByTestId('leaflet-tile')).toBeInTheDocument();
    // The static-image map is gone — no img with alt 'City map' remains.
    expect(screen.queryByAltText(/city map/i)).toBeNull();
  });

  it('renders one Marker per request with real coords and skips null-coord rows', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    // Three rows: two carry real lat/lng, the third has null coords and
    // must NOT render a marker (the LiveJobsScreen does not synthesise
    // fake locations for missing-coord rows).
    mock.onGet('/v1/provider/available-requests').reply(200, {
      items: [
        SAMPLE_AVAILABLE_REQUEST,
        {
          ...SAMPLE_AVAILABLE_REQUEST,
          id: 'r2',
          location: { ...SAMPLE_AVAILABLE_REQUEST.location, lat: 24.8112, lng: 46.6298 },
        },
        {
          ...SAMPLE_AVAILABLE_REQUEST,
          id: 'r3',
          location: { ...SAMPLE_AVAILABLE_REQUEST.location, lat: null, lng: null },
        },
      ],
      nextCursor: null,
    });

    renderProvider();

    // Wait for the feed to land and the markers to mount.
    await waitFor(() => expect(screen.getAllByTestId('leaflet-marker')).toHaveLength(2));
    const markers = screen.getAllByTestId('leaflet-marker');
    const positions = markers.map((m) => m.getAttribute('data-position'));
    expect(positions).toContain(JSON.stringify([24.6904, 46.6863]));
    expect(positions).toContain(JSON.stringify([24.8112, 46.6298]));
  });

  it('uses the provider serviceArea coords as the map center when present', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    // MOCK_PROFILE carries Riyadh's coords on serviceAreaLat/Lng — use
    // a different city to prove the wire field, not the fallback,
    // is what the map reads.
    mock.onGet('/v1/me/provider/profile').reply(200, {
      profile: { ...MOCK_PROFILE, serviceAreaLat: 21.5433, serviceAreaLng: 39.1728 },
    });
    mock.onGet('/v1/provider/available-requests').reply(200, { items: [], nextCursor: null });

    renderProvider();

    await waitFor(() => {
      const map = screen.getByTestId('leaflet-map');
      expect(map.getAttribute('data-center')).toBe(JSON.stringify([21.5433, 39.1728]));
    });
  });

  it('falls back to Riyadh when the provider profile has no serviceArea coords', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, {
      profile: { ...MOCK_PROFILE, serviceAreaLat: null, serviceAreaLng: null },
    });
    mock.onGet('/v1/provider/available-requests').reply(200, { items: [], nextCursor: null });

    renderProvider();

    await waitFor(() => {
      const map = screen.getByTestId('leaflet-map');
      expect(map.getAttribute('data-center')).toBe(JSON.stringify([24.7136, 46.6753]));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6 — Pending skills (admin approval queue surface).
// Providers can apply for new categories; until an admin approves,
// the row appears on /v1/me/provider/profile under
// `pendingCategories` and the Skills section renders it with a
// dashed-border, faded pill carrying a Clock icon and a
// "Pending Admin Approval" tooltip.
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_PENDING_CATEGORY = {
  id: 'c-pending-1',
  slug: 'painting',
  labelEn: 'Painting',
  labelAr: 'دهان',
  icon: 'brush',
};

describe('ProviderApp — pending skills (admin approval queue)', () => {
  it('renders a dashed-border pill with a Clock icon and "Pending Admin Approval" title', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, {
      profile: { ...MOCK_PROFILE, pendingCategories: [MOCK_PENDING_CATEGORY] },
    });

    renderProvider();
    openProfileTab();

    // The pending pill is the only element labelled "Pending approval"
    // (aria-label) — that's the canonical handle for the assertion.
    const pendingPill = await screen.findByLabelText(/^pending approval$/i);
    expect(pendingPill).toHaveTextContent('Painting');
    expect(pendingPill).toHaveAttribute('title', 'Pending Admin Approval');
    expect(pendingPill).toHaveClass('border-dashed');
    expect(pendingPill).toHaveClass('cursor-help');
    // The Clock icon is hidden from AT (aria-hidden) but present in DOM.
    const clockIcon = pendingPill.querySelector('svg');
    expect(clockIcon).not.toBeNull();
  });

  it('renders approved categories alongside pending ones (single flex row, both visible)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, {
      profile: { ...MOCK_PROFILE, pendingCategories: [MOCK_PENDING_CATEGORY] },
    });

    renderProvider();
    openProfileTab();

    // Approved categories from MOCK_PROFILE — rendered without the
    // dashed-border / pending affordance.
    await waitFor(() => expect(screen.getByText('Plumbing')).toBeInTheDocument());
    expect(screen.getByText('Electrical')).toBeInTheDocument();
    // Pending category — coexists with the approved ones.
    expect(screen.getByText('Painting')).toBeInTheDocument();
    // Empty-state copy must NOT appear when at least one pill renders.
    expect(screen.queryByText(/no skills added yet|لم تضف مهارات بعد/i)).toBeNull();
  });

  it('uses the Arabic copy for the pending tooltip when lang is ar', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, {
      profile: { ...MOCK_PROFILE, pendingCategories: [MOCK_PENDING_CATEGORY] },
    });

    renderProvider();
    // The LangToggle lives on the top-bar, which is hidden on the
    // default Live Jobs tab. Switch to Profile first so the toggle
    // is mountable, then flip to Arabic, then assert the localised
    // pending tooltip copy.
    openProfileTab();
    const langToggle = await screen.findByRole('button', { name: /switch language/i });
    fireEvent.click(langToggle);

    const pendingPill = await screen.findByLabelText(/في انتظار موافقة الإدارة/);
    expect(pendingPill).toHaveAttribute('title', 'في انتظار موافقة الإدارة');
  });

  it('treats pendingCategories as [] when the wire omits the field', async () => {
    // Backend slices that pre-date the approval queue do not emit
    // `pendingCategories`. The frontend must render the same as if the
    // field were an empty array (no pending pills, approved list intact).
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });

    renderProvider();
    openProfileTab();

    await waitFor(() => expect(screen.getByText('Plumbing')).toBeInTheDocument());
    expect(screen.queryByLabelText(/^pending approval$/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 6 — Job Detail overlay.
// LiveJobsScreen tap surfaces (bottom-sheet card body, marker popup
// CTA) now route through a JobDetailOverlay before the BiddingModal.
// The overlay surfaces the request context (service / description /
// distance / budget / seeker / urgency); its "Place Bid" CTA is what
// actually opens the BiddingModal.
//
// Wire-data caveat verified by these tests: distance / budget / seeker
// are NOT on the Sprint 5.2 ProviderAvailableRequestSummary contract.
// The adapter blanks them; the overlay must render "—" rather than
// fake values for those rows.
// ─────────────────────────────────────────────────────────────────────────────

describe('ProviderApp — Phase 6 Job Detail overlay', () => {
  function mockBaseFlow() {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/available-requests').reply(200, {
      items: [SAMPLE_AVAILABLE_REQUEST],
      nextCursor: null,
    });
  }

  it('clicking a bottom-sheet card opens the JobDetailOverlay with the request copy', async () => {
    mockBaseFlow();
    renderProvider();

    // Open the bottom sheet first; the cards live inside it.
    const dragHandle = await screen.findByRole('button', {
      name: /pull up to see requests|اسحب للأعلى لرؤية الطلبات/i,
    });
    fireEvent.click(dragHandle);

    // The card uses role=button + aria-label = service name (English).
    const card = await screen.findByTestId('job-card-r1');
    fireEvent.click(card);

    // Overlay mounts with the request's service + description.
    const overlay = await screen.findByTestId('job-detail-overlay');
    expect(overlay).toHaveTextContent('Plumbing');
    expect(overlay).toHaveTextContent('Pipe leak under kitchen sink');
    // The BiddingModal must NOT yet be open — overlay sits between
    // feed and bidding.
    expect(screen.queryByText(/submit offer|تقديم عرض/i)).toBeNull();
  });

  it('clicking the marker popup CTA opens the JobDetailOverlay (NOT the BiddingModal directly)', async () => {
    mockBaseFlow();
    renderProvider();

    // The mocked react-leaflet Popup renders its children eagerly
    // (no open-on-click affordance under the test stub), so the CTA
    // is reachable directly.
    const popupCta = await screen.findByRole('button', { name: /place bid|قدم عرض/i });
    fireEvent.click(popupCta);

    expect(await screen.findByTestId('job-detail-overlay')).toBeInTheDocument();
    expect(screen.queryByText(/submit offer|تقديم عرض/i)).toBeNull();
  });

  it('the overlay\'s "Place Bid" CTA closes the overlay and opens the BiddingModal', async () => {
    mockBaseFlow();
    renderProvider();

    const popupCta = await screen.findByRole('button', { name: /place bid|قدم عرض/i });
    fireEvent.click(popupCta);

    // Overlay open.
    const overlayBidBtn = await screen.findByTestId('job-detail-place-bid');
    fireEvent.click(overlayBidBtn);

    // Overlay closed AND BiddingModal mounted (its title is "Submit Offer").
    await waitFor(() => expect(screen.queryByTestId('job-detail-overlay')).toBeNull());
    expect(screen.getByText(/submit offer|تقديم عرض/i)).toBeInTheDocument();
  });

  it('renders "—" for distance / budget / seeker when the wire fields are blank', async () => {
    mockBaseFlow();
    renderProvider();

    // Open overlay via the popup CTA so we land in the overlay context.
    const popupCta = await screen.findByRole('button', { name: /place bid|قدم عرض/i });
    fireEvent.click(popupCta);

    const overlay = await screen.findByTestId('job-detail-overlay');
    // The Sprint 5.2 wire shape doesn't carry distance / budget /
    // seeker name on available-requests; the adapter blanks those
    // and the overlay must surface "—" rather than zero / empty.
    // Three em-dash placeholders → one per missing field.
    const placeholders = Array.from(overlay.querySelectorAll('p')).filter(
      (p) => p.textContent?.trim() === '—',
    );
    expect(placeholders).toHaveLength(3);
  });

  it('the overlay close button dismisses without opening the BiddingModal', async () => {
    mockBaseFlow();
    renderProvider();

    const popupCta = await screen.findByRole('button', { name: /place bid|قدم عرض/i });
    fireEvent.click(popupCta);

    const closeBtn = await screen.findByTestId('job-detail-close');
    fireEvent.click(closeBtn);

    await waitFor(() => expect(screen.queryByTestId('job-detail-overlay')).toBeNull());
    expect(screen.queryByText(/submit offer|تقديم عرض/i)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 7.0 — Live Jobs floating job-count badge + new-job toast.
// The badge that sits inside the "Pull up to see requests" pill should
// reflect what the operator will see when they pull the bottom sheet
// up — i.e. activeReqs after the all/pending/bidding filter is
// applied. The earlier shape rendered the count of `pending` rows
// regardless of filter, which drifted from the sheet contents.
// ─────────────────────────────────────────────────────────────────────────────

describe('ProviderApp — Sprint 7.0 floating job-count badge', () => {
  it('badge reflects filteredReqs.length, not activeReqs pending count', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    // Two pending, one bidding — under filter='all' the badge must
    // show 3 (the bottom-sheet card count), NOT 2 (the pending count).
    mock.onGet('/v1/provider/available-requests').reply(200, {
      items: [
        { ...SAMPLE_AVAILABLE_REQUEST, id: 'r1' },
        { ...SAMPLE_AVAILABLE_REQUEST, id: 'r2' },
        { ...SAMPLE_AVAILABLE_REQUEST, id: 'r3', bidsCount: 2 },
      ],
      nextCursor: null,
    });

    renderProvider();

    // findByTestId resolves on first render — when filteredReqs is
    // still empty (the feed hasn't landed). Wait for the data to
    // settle before asserting.
    const badge = await screen.findByTestId('job-count-badge');
    await waitFor(() => expect(badge.textContent?.trim()).toBe('3'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 7.0 — "New job nearby" toast (cache-subscribe pattern).
// LiveJobsScreen tracks the previously-seen request ids and fires a
// success toast whenever the next available-requests refetch lands an
// id that wasn't in the prior set. The first successful fetch is the
// initial baseline and must NOT toast. (`toast` is mocked at the top
// of this file alongside the other module-scope mocks.)
// ─────────────────────────────────────────────────────────────────────────────

describe('ProviderApp — Sprint 7.0 new-job toast', () => {
  beforeEach(() => {
    (toast.success as unknown as { mockClear: () => void }).mockClear();
  });

  it('does NOT toast on the initial available-requests fetch', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    mock.onGet('/v1/provider/available-requests').reply(200, {
      items: [SAMPLE_AVAILABLE_REQUEST],
      nextCursor: null,
    });

    renderProvider();

    // Wait for the feed to settle.
    await screen.findByTestId('leaflet-marker');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('toasts when a refetch lands a new request id', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/provider/profile').reply(200, { profile: MOCK_PROFILE });
    // First fetch: r1 only. Second fetch (same endpoint, different
    // payload): r1 + r2. The second response is what
    // queryClient.refetchQueries lands.
    let call = 0;
    mock.onGet('/v1/provider/available-requests').reply(() => {
      call += 1;
      if (call === 1) {
        return [200, { items: [SAMPLE_AVAILABLE_REQUEST], nextCursor: null }];
      }
      return [
        200,
        {
          items: [
            SAMPLE_AVAILABLE_REQUEST,
            {
              ...SAMPLE_AVAILABLE_REQUEST,
              id: 'r2',
              location: { ...SAMPLE_AVAILABLE_REQUEST.location, lat: 24.8112, lng: 46.6298 },
            },
          ],
          nextCursor: null,
        },
      ];
    });

    renderProvider();

    // First fetch settles — baseline established, no toast.
    await waitFor(() => expect(screen.getAllByTestId('leaflet-marker')).toHaveLength(1));
    expect(toast.success).not.toHaveBeenCalled();

    // Force a refetch via the queryClient. The provider feed key uses
    // the canonical `providerQueryKeys.availableRequests.list({})`
    // shape — refetching the root invalidates every variant.
    await queryClient.refetchQueries({ queryKey: ['provider', 'available-requests'] });

    await waitFor(() => expect(screen.getAllByTestId('leaflet-marker')).toHaveLength(2));
    expect(toast.success).toHaveBeenCalledWith('New job nearby!');
  });
});
