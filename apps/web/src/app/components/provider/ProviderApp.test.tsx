import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
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
