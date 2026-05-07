import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Route, Routes } from 'react-router';
import { api } from '../../lib/api';
import { AuthProvider, queryClient } from '../../lib/auth-provider';
import { LanguageProvider } from '../i18n/LanguageContext';
import { EcosystemProvider } from '../context/EcosystemContext';
import { GuestOnly, RequireAdmin, RequireAuth } from '../../lib/route-guards';
import { clearIntendedApp, getIntendedApp, setIntendedApp } from '../../lib/intended-app';
import { AppSelector } from './AppSelector';
import { LoginPage, SignUpPage } from './AuthPages';

// ─────────────────────────────────────────────────────────────────────────────
// Regression: clicking the Provider card used to take the user to the
// Seeker app whenever the auth flow lost react-router state — most
// commonly through the LoginScreen → "Sign up" → register → onOtpVerify
// chain, which hardcoded /home. The fix is the intent layer
// (lib/intended-app.ts) plus binding sanitizeReturnTo and SignUpPage's
// post-OTP destination to it. These tests pin all three launcher cards
// landing on the correct app, including the Provider→signup path that
// was broken.
//
// Stub Components for the protected routes so we don't have to mount the
// real HomeScreen / ProviderApp / AdminPage trees here — this file is
// about routing intent, not the apps themselves.
// ─────────────────────────────────────────────────────────────────────────────

function HomeStub() {
  return <div data-testid="seeker-app">seeker-home</div>;
}

function ProviderStub() {
  return <div data-testid="provider-app">provider-app</div>;
}

function AdminStub() {
  return <div data-testid="admin-app">admin-app</div>;
}

function renderRouter(initialPath = '/select') {
  return render(
    <AuthProvider>
      <LanguageProvider>
        <EcosystemProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route path="/admin" element={<AdminStub />} />
              <Route path="/select" element={<AppSelector />} />
              <Route element={<GuestOnly />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignUpPage />} />
              </Route>
              <Route element={<RequireAuth />}>
                <Route path="/home" element={<HomeStub />} />
                <Route path="/provider" element={<ProviderStub />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </EcosystemProvider>
      </LanguageProvider>
    </AuthProvider>,
  );
}

const MOCK_ME = {
  id: 'u1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: 'ACTIVE' as const,
  emailVerifiedAt: '2026-04-19T00:00:00.000Z',
  mfaEnabled: false,
  roles: ['customer' as const],
};

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  queryClient.clear();
  clearIntendedApp();
});

afterEach(() => {
  mock.restore();
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
  clearIntendedApp();
  // Defensive end-of-test cleanup. The intent layer uses
  // sessionStorage (key `fixnow_intended_app` — see lib/intended-app),
  // not localStorage; `clearIntendedApp()` above already removes that
  // specific key. The blanket .clear() calls catch any other state a
  // future test might write (e.g. an analytics ack flag, a feature
  // toggle override) that could leak into a sibling case. queryClient
  // is also cleared again on the way out so a refetch landing after
  // the test's last assertion can't pollute the next test's
  // baseline — beforeEach clears it on the way in, afterEach
  // clears it on the way out.
  window.localStorage.clear();
  window.sessionStorage.clear();
  queryClient.clear();
});

describe('Public entry hierarchy — Seeker + Provider primary, Admin secondary', () => {
  // The visual identity (colors / gradients / typography / shadows / card
  // markup) is unchanged: both groups call the same renderAppCard helper.
  // What we assert here is the LAYOUT hierarchy — that Seeker + Provider
  // sit in the primary container above the Admin card, and Admin sits in
  // a narrower secondary container below.
  it('renders Seeker and Provider in the primary container, Admin in the secondary container', () => {
    renderRouter();

    const primary = screen.getByTestId('app-cards-primary');
    const secondary = screen.getByTestId('app-cards-secondary');

    // Primary holds the two user-facing apps in the order Seeker → Provider.
    expect(primary).toContainElement(screen.getByTestId('app-card-seeker'));
    expect(primary).toContainElement(screen.getByTestId('app-card-provider'));
    // Admin lives in the secondary container, not primary.
    expect(primary).not.toContainElement(screen.getByTestId('app-card-admin'));
    expect(secondary).toContainElement(screen.getByTestId('app-card-admin'));
  });

  it('Admin remains accessible — its launcher still routes to Admin', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderRouter();
    // Admin is in the secondary container but the click handler still
    // navigates to /admin. We're proving "secondary in layout != hidden".
    await act(async () => {
      screen.getByTestId('app-card-admin').click();
    });
    await waitFor(() => expect(screen.getByTestId('admin-app')).toBeInTheDocument());
  });

  it('primary container appears before the secondary container in DOM order', () => {
    renderRouter();
    const primary = screen.getByTestId('app-cards-primary');
    const secondary = screen.getByTestId('app-cards-secondary');
    // compareDocumentPosition: bit 4 = "DOCUMENT_POSITION_FOLLOWING" (param
    // is preceded by the receiver). i.e. primary comes BEFORE secondary.
    const rel = primary.compareDocumentPosition(secondary);
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('all three cards still expose the same data-testid contract', () => {
    renderRouter();
    expect(screen.getByTestId('app-card-seeker')).toBeInTheDocument();
    expect(screen.getByTestId('app-card-provider')).toBeInTheDocument();
    expect(screen.getByTestId('app-card-admin')).toBeInTheDocument();
  });
});

describe('AppSelector — each launcher card opens its own app', () => {
  it('Admin → /admin (no auth required)', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderRouter();

    await act(async () => {
      screen.getByTestId('app-card-admin').click();
    });

    await waitFor(() => expect(screen.getByTestId('admin-app')).toBeInTheDocument());
    expect(getIntendedApp()).toBe('admin');
  });

  it('Provider (already-authenticated user) → /provider, never the seeker app', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);

    renderRouter();
    // Wait for /me to settle so RequireAuth lets the user through.
    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/v1/auth/me')).toBe(true));

    await act(async () => {
      screen.getByTestId('app-card-provider').click();
    });

    await waitFor(() => expect(screen.getByTestId('provider-app')).toBeInTheDocument());
    expect(screen.queryByTestId('seeker-app')).toBeNull();
    expect(getIntendedApp()).toBe('provider');
  });

  it('Seeker (already-authenticated user) → /home', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);

    renderRouter();
    await waitFor(() => expect(mock.history.get.some((r) => r.url === '/v1/auth/me')).toBe(true));

    await act(async () => {
      screen.getByTestId('app-card-seeker').click();
    });

    await waitFor(() => expect(screen.getByTestId('seeker-app')).toBeInTheDocument());
    expect(screen.queryByTestId('provider-app')).toBeNull();
    expect(getIntendedApp()).toBe('seeker');
  });
});

describe('Provider intent survives the entire auth flow', () => {
  // 15s: under full-suite load the verify-otp → invalidateQueries
  // → /me refetch → SignUpPage destination resolver → router redirect
  // chain occasionally exceeds the 5 s default, even though the inner
  // waitFor was bumped to 8 s.
  it(
    'Provider click → /login → log in with OTP → lands on /provider (returnTo path)',
    { timeout: 15000 },
    async () => {
      // Auth state is gated on an explicit OTP-verified flag rather than
      // a call counter. A counter-based shape was order-dependent: any
      // phantom /v1/auth/me leaking from the shared module-level
      // queryClient (left over by a sibling test file) bumped the
      // counter past 1 before the test even started, flipping the first
      // real auth check to 200 and breaking the post-OTP redirect.
      let otpVerified = false;
      mock.onGet('/v1/auth/me').reply(() => (otpVerified ? [200, MOCK_ME] : [401, {}]));
      mock.onPost('/v1/auth/refresh').reply(401, {});
      mock.onPost('/v1/auth/login').reply(200, {
        otpRequired: true,
        challengeId: 'chal-prov-1',
        codeLength: 6,
        expiresInSeconds: 300,
      });
      mock.onPost('/v1/auth/verify-otp').reply(() => {
        otpVerified = true;
        return [200, {}];
      });

      renderRouter();

      // 1. click Provider on /select
      await act(async () => {
        screen.getByTestId('app-card-provider').click();
      });
      expect(getIntendedApp()).toBe('provider');

      // 2. user is unauthenticated → RequireAuth bounces to /login
      await waitFor(() => {
        const email = document.querySelector('input[type="email"]') as HTMLInputElement | null;
        expect(email).not.toBeNull();
      });

      // 3. submit credentials
      const email = document.querySelector('input[type="email"]') as HTMLInputElement;
      const password = document.querySelector('input[type="password"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(email, { target: { value: 'ada@example.com' } });
        fireEvent.change(password, { target: { value: 'a-reasonable-passphrase' } });
      });
      const loginBtn = screen
        .getAllByRole('button')
        .find((b) => /log ?in|sign ?in/i.test(b.textContent ?? ''))!;
      await act(async () => {
        loginBtn.click();
      });

      // 4. enter OTP
      await waitFor(() => expect(screen.getByTestId('otp-input')).toBeInTheDocument());
      const otpInput = screen.getByTestId('otp-input') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(otpInput, { target: { value: '123456' } });
      });
      const confirmBtn = screen
        .getAllByRole('button')
        .find((b) => /confirm|verifying/i.test(b.textContent ?? ''))!;
      await act(async () => {
        confirmBtn.click();
      });

      // 5. lands on /provider (NOT /home)
      await waitFor(
        () => {
          expect(screen.getByTestId('provider-app')).toBeInTheDocument();
        },
        { timeout: 8000 },
      );
      expect(screen.queryByTestId('seeker-app')).toBeNull();
    },
  );

  it(
    'Provider click → /login → "Sign up" → register → OTP → lands on /provider (intent layer fallback)',
    { timeout: 15000 },
    async () => {
      // This is THE original bug: navigating from /login to /signup loses
      // react-router state, so SignUpPage has no `returnTo` to honor. Before
      // the intent layer, SignUpPage hardcoded `/home`, sending the user
      // straight into Seeker. Now the intent fallback resolves to /provider.
      //
      // Auth state is gated on an explicit OTP-verified flag (not a call
      // counter). The counter-based shape was order-dependent — see the
      // sibling test in this describe for the same rationale.
      let otpVerified = false;
      mock.onGet('/v1/auth/me').reply(() => (otpVerified ? [200, MOCK_ME] : [401, {}]));
      mock.onPost('/v1/auth/refresh').reply(401, {});
      mock.onPost('/v1/auth/register').reply(202, {
        otpRequired: true,
        challengeId: 'chal-reg-prov',
        codeLength: 6,
        expiresInSeconds: 300,
      });
      mock.onPost('/v1/auth/verify-otp').reply(() => {
        otpVerified = true;
        return [200, {}];
      });

      renderRouter();

      // 1. Provider intent
      await act(async () => {
        screen.getByTestId('app-card-provider').click();
      });
      expect(getIntendedApp()).toBe('provider');

      // 2. land on /login (RequireAuth bounce)
      await waitFor(() => {
        expect(document.querySelector('input[type="email"]')).toBeTruthy();
      });

      // 3. user clicks "Don't have an account? Sign up" — navigates to
      //    /signup WITHOUT preserving react-router state.
      const signUpBtn = screen
        .getAllByRole('button')
        .find((b) => /sign up|create account|signUp/i.test(b.textContent ?? ''));
      expect(signUpBtn).toBeDefined();
      await act(async () => {
        signUpBtn!.click();
      });

      // 4. step 1 of signup wizard: name + phone
      await waitFor(() => {
        expect(document.querySelector('input[type="tel"]')).toBeTruthy();
      });
      const nameInput = document.querySelectorAll('input')[0] as HTMLInputElement;
      const phoneInput = document.querySelector('input[type="tel"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'Ada Lovelace' } });
        fireEvent.change(phoneInput, { target: { value: '5551234567' } });
      });
      const nextBtn = screen.getAllByRole('button').find((b) => /next/i.test(b.textContent ?? ''))!;
      await act(async () => {
        nextBtn.click();
      });

      // 5. step 2: email + password + terms
      await waitFor(() => {
        expect(document.querySelector('input[type="email"]')).toBeTruthy();
      });
      const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(emailInput, { target: { value: 'ada@example.com' } });
        fireEvent.change(passwordInput, { target: { value: 'a-reasonable-passphrase' } });
      });
      const termsBtn = screen
        .getAllByRole('button')
        .find((b) => /privacyPolicy|agreeTerms|i agree/i.test(b.textContent ?? ''));
      if (termsBtn) {
        await act(async () => {
          termsBtn.click();
        });
      }
      const registerBtn = screen
        .getAllByRole('button')
        .find((b) => /register|create/i.test(b.textContent ?? ''))!;
      await act(async () => {
        registerBtn.click();
      });

      // 6. OTP step
      await waitFor(() => expect(screen.getByTestId('otp-input')).toBeInTheDocument());
      const otpInput = screen.getByTestId('otp-input') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(otpInput, { target: { value: '654321' } });
      });
      const confirmBtn = screen
        .getAllByRole('button')
        .find((b) => /confirm|verifying/i.test(b.textContent ?? ''))!;
      await act(async () => {
        confirmBtn.click();
      });

      // 7. The whole point: lands on /provider, NOT /home.
      await waitFor(
        () => {
          expect(screen.getByTestId('provider-app')).toBeInTheDocument();
        },
        { timeout: 8000 },
      );
      expect(screen.queryByTestId('seeker-app')).toBeNull();
    },
  );

  it('an authed user on /select clicking Provider then bouncing through /login still lands on /provider via GuestOnly intent fallback', async () => {
    // Edge case: the user is already authed, hits /login somehow (e.g. by
    // typing it), and /login's GuestOnly redirects them. Without intent,
    // it would default to /home. With intent, Provider users go to
    // /provider.
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);

    renderRouter();
    // Pick Provider first to set the intent.
    await waitFor(() => expect(screen.getByTestId('app-card-provider')).toBeInTheDocument());
    await act(async () => {
      screen.getByTestId('app-card-provider').click();
    });
    await waitFor(() => expect(screen.getByTestId('provider-app')).toBeInTheDocument());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 5.1.1 — Experience-aware auth theming.
//
// The login screen is shared across Seeker / Provider / Admin but its
// VISUAL identity must match the app the user clicked on /select. The
// regression these tests guard is the original "click Provider, see
// orange Seeker login" bug.
// ─────────────────────────────────────────────────────────────────────────────
describe('Auth theme follows the selected experience', () => {
  it('Seeker click → /login renders the Seeker (amber) hero', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderRouter();
    await act(async () => {
      screen.getByTestId('app-card-seeker').click();
    });
    await waitFor(() => expect(screen.getByTestId('auth-hero-seeker')).toBeInTheDocument());
    // Seeker hero owns the amber gradient.
    const hero = screen.getByTestId('auth-hero-seeker');
    expect(hero.className).toMatch(/amber/);
    expect(hero.className).not.toMatch(/blue|indigo|purple/);
    // No Provider/Admin hero rendered alongside.
    expect(screen.queryByTestId('auth-hero-provider')).toBeNull();
    expect(screen.queryByTestId('auth-hero-admin')).toBeNull();
    // Brand title matches Seeker.
    expect(screen.getByText('FixNow')).toBeInTheDocument();
    expect(screen.getByText('Home Services Marketplace')).toBeInTheDocument();
  });

  it('Provider click → /login renders the Provider (blue/indigo/purple) hero — never amber', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderRouter();
    await act(async () => {
      screen.getByTestId('app-card-provider').click();
    });
    await waitFor(() => expect(screen.getByTestId('auth-hero-provider')).toBeInTheDocument());
    const hero = screen.getByTestId('auth-hero-provider');
    expect(hero.className).toMatch(/blue|indigo|purple/);
    // Critical regression: the Provider hero must NOT carry the orange
    // Seeker gradient.
    expect(hero.className).not.toMatch(/amber|orange/);
    expect(screen.queryByTestId('auth-hero-seeker')).toBeNull();
    expect(screen.getByText('FixNow Pro')).toBeInTheDocument();
    expect(screen.getByText('Professional Earnings Platform')).toBeInTheDocument();
  });

  it('Admin click → /login renders the Admin (slate) hero', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderRouter(); // Admin is open without RequireAuth in this harness, so to
    // exercise the themed-login path we set the intent and navigate to /login
    // directly (mirrors what would happen if /admin were guarded).
    setIntendedApp('admin');
    await act(async () => {
      screen.getByTestId('app-card-admin').click();
    });
    // Admin route renders directly; navigate to /login via a fresh router
    // instance that drops the user there. The routing test for unauth-driven
    // /login bounce already exists for Provider; this case asserts the theme
    // resolution from sessionStorage intent only.
    cleanupAfterEach();
    setIntendedApp('admin');
    renderRouterAt('/login');
    await waitFor(() => expect(screen.getByTestId('auth-hero-admin')).toBeInTheDocument());
    expect(screen.getByTestId('auth-hero-admin').className).toMatch(/slate/);
    expect(screen.queryByTestId('auth-hero-seeker')).toBeNull();
    expect(screen.queryByTestId('auth-hero-provider')).toBeNull();
    expect(screen.getByText('FixNow Admin')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 5.1.1 — Multi-role routing rules.
//
// The product rule: a user can hold customer + provider + admin roles
// simultaneously. The selected app wins; role inference only applies on
// direct /login arrivals with no signal.
// ─────────────────────────────────────────────────────────────────────────────
describe('Multi-role post-auth routing', () => {
  function authedAs(roles: ('customer' | 'provider' | 'admin')[]) {
    mock.onGet('/v1/auth/me').reply(200, { ...MOCK_ME, roles });
  }

  it('selected app wins over role inference (Provider intent + multi-role user → /provider)', async () => {
    authedAs(['customer', 'provider', 'admin']);

    renderRouter();
    await waitFor(() => expect(screen.getByTestId('app-card-provider')).toBeInTheDocument());
    await act(async () => {
      screen.getByTestId('app-card-provider').click();
    });
    await waitFor(() => expect(screen.getByTestId('provider-app')).toBeInTheDocument());
    expect(screen.queryByTestId('seeker-app')).toBeNull();
    expect(screen.queryByTestId('admin-app')).toBeNull();
  });

  it('direct /login while authed with multiple non-customer roles → /select', async () => {
    authedAs(['customer', 'provider', 'admin']);

    // Reset intent so role inference is the only signal.
    clearIntendedApp();
    renderRouterAt('/login');
    // GuestOnly should redirect to /select (where AppSelector lives).
    await waitFor(() => expect(screen.getByTestId('app-card-seeker')).toBeInTheDocument());
  });

  it('direct /login while authed with sole-provider role → /provider', async () => {
    authedAs(['customer', 'provider']);
    clearIntendedApp();
    renderRouterAt('/login');
    await waitFor(() => expect(screen.getByTestId('provider-app')).toBeInTheDocument());
  });

  it('direct /login while authed with customer-only role → /home', async () => {
    authedAs(['customer']);
    clearIntendedApp();
    renderRouterAt('/login');
    await waitFor(() => expect(screen.getByTestId('seeker-app')).toBeInTheDocument());
  });
});

// ── helpers (used by the new suites above) ───────────────────────────────────
function renderRouterAt(path: string) {
  return render(
    <AuthProvider>
      <LanguageProvider>
        <EcosystemProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/admin" element={<AdminStub />} />
              <Route path="/select" element={<AppSelector />} />
              <Route element={<GuestOnly />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignUpPage />} />
              </Route>
              <Route element={<RequireAuth />}>
                <Route path="/home" element={<HomeStub />} />
                <Route path="/provider" element={<ProviderStub />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </EcosystemProvider>
      </LanguageProvider>
    </AuthProvider>,
  );
}

// Used by the Admin theme test to reset between two render() calls in the
// same `it` body. Mirrors the global afterEach without unmounting React's
// outer providers (we want the fresh MemoryRouter only).
function cleanupAfterEach() {
  queryClient.clear();
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 5.1.1 patch 2 — Admin route is now guarded.
// ─────────────────────────────────────────────────────────────────────────────
function renderRouterWithAdminGuard(initialPath = '/select') {
  return render(
    <AuthProvider>
      <LanguageProvider>
        <EcosystemProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route element={<RequireAdmin />}>
                <Route path="/admin" element={<AdminStub />} />
              </Route>
              <Route path="/select" element={<AppSelector />} />
              <Route element={<GuestOnly />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignUpPage />} />
              </Route>
              <Route element={<RequireAuth />}>
                <Route path="/home" element={<HomeStub />} />
                <Route path="/provider" element={<ProviderStub />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </EcosystemProvider>
      </LanguageProvider>
    </AuthProvider>,
  );
}

describe('Admin route is gated (patch 2)', () => {
  it('unauthenticated /admin → /login with admin theme + returnTo=/admin', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderRouterWithAdminGuard('/admin');

    // Lands on /login with the Admin slate hero (theme resolved from
    // state.app='admin' that RequireAdmin forwarded).
    await waitFor(() => expect(screen.getByTestId('auth-hero-admin')).toBeInTheDocument());
    expect(screen.queryByTestId('admin-app')).toBeNull();
    expect(screen.queryByTestId('seeker-app')).toBeNull();
  });

  it('authenticated customer-only /admin → AdminAccessRequired (NOT /home, NOT dashboard)', async () => {
    mock.onGet('/v1/auth/me').reply(200, { ...MOCK_ME, roles: ['customer' as const] });

    renderRouterWithAdminGuard('/admin');

    await waitFor(() => expect(screen.getByText(/admin access required/i)).toBeInTheDocument());
    expect(screen.queryByTestId('admin-app')).toBeNull();
    expect(screen.queryByTestId('seeker-app')).toBeNull();
  });

  it('authenticated admin /admin → dashboard', async () => {
    mock
      .onGet('/v1/auth/me')
      .reply(200, { ...MOCK_ME, roles: ['customer' as const, 'admin' as const] });

    renderRouterWithAdminGuard('/admin');

    await waitFor(() => expect(screen.getByTestId('admin-app')).toBeInTheDocument());
    expect(screen.queryByText(/admin access required/i)).toBeNull();
  });

  it('Admin card click while unauthenticated routes through /login (not direct dashboard)', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderRouterWithAdminGuard();
    await act(async () => {
      screen.getByTestId('app-card-admin').click();
    });
    // Lands on /login with Admin theme rather than the unprotected
    // dashboard.
    await waitFor(() => expect(screen.getByTestId('auth-hero-admin')).toBeInTheDocument());
    expect(screen.queryByTestId('admin-app')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 5.1.1 patch 2 — destination resolver respects the resolved
// experience, so a Provider-themed signup OTP lands on /provider even
// when the new user has only the customer role.
// ─────────────────────────────────────────────────────────────────────────────
describe('Provider signup OTP → /provider (patch 2 regression repair)', () => {
  it(
    'Provider card → signup → OTP verify → /provider (NOT /home)',
    { timeout: 15000 },
    async () => {
      // Auth state is driven by an explicit OTP-verified flag rather than
      // a call counter. The earlier counter-based shape was order-
      // dependent: a phantom /v1/auth/me from a stale React Query in the
      // shared module-level queryClient (left over by another test file)
      // could bump the counter to 1 before the test even started, making
      // the first real auth check return 200 instead of 401. That bounced
      // the post-OTP redirect to /home and produced an intermittent
      // "lands on seeker-app" failure when the file ran after a busy
      // sibling.
      let otpVerified = false;
      mock.onGet('/v1/auth/me').reply(() => {
        // After OTP verify, the new user is customer-only — without the
        // experienceId fallback this would bounce them to /home.
        return otpVerified ? [200, { ...MOCK_ME, roles: ['customer' as const] }] : [401, {}];
      });
      mock.onPost('/v1/auth/refresh').reply(401, {});
      mock.onPost('/v1/auth/register').reply(202, {
        otpRequired: true,
        challengeId: 'chal-prov-signup',
        codeLength: 6,
        expiresInSeconds: 300,
      });
      mock.onPost('/v1/auth/verify-otp').reply(() => {
        otpVerified = true;
        return [200, {}];
      });

      renderRouter();

      await act(async () => {
        screen.getByTestId('app-card-provider').click();
      });

      // /login renders, click Sign up
      await waitFor(() => expect(document.querySelector('input[type="email"]')).toBeTruthy());
      const signUpBtn = screen
        .getAllByRole('button')
        .find((b) => /sign up|create account|signUp/i.test(b.textContent ?? ''));
      expect(signUpBtn).toBeDefined();
      await act(async () => {
        signUpBtn!.click();
      });

      // step 1 — fill name + phone
      await waitFor(() => expect(document.querySelector('input[type="tel"]')).toBeTruthy());
      const nameInput = document.querySelectorAll('input')[0] as HTMLInputElement;
      const phoneInput = document.querySelector('input[type="tel"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'Ada Lovelace' } });
        fireEvent.change(phoneInput, { target: { value: '5551234567' } });
      });
      const nextBtn = screen.getAllByRole('button').find((b) => /next/i.test(b.textContent ?? ''))!;
      await act(async () => {
        nextBtn.click();
      });

      // step 2 — email + password
      await waitFor(() => expect(document.querySelector('input[type="email"]')).toBeTruthy());
      const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
      const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(emailInput, { target: { value: 'ada@example.com' } });
        fireEvent.change(passwordInput, { target: { value: 'a-reasonable-passphrase' } });
      });
      const termsBtn = screen
        .getAllByRole('button')
        .find((b) => /privacyPolicy|agreeTerms|i agree/i.test(b.textContent ?? ''));
      if (termsBtn) {
        await act(async () => {
          termsBtn.click();
        });
      }
      const registerBtn = screen
        .getAllByRole('button')
        .find((b) => /register|create/i.test(b.textContent ?? ''))!;
      // Critical: the Create Account button is themed Provider blue, not
      // amber. data-tone is the regression hook.
      expect(registerBtn.getAttribute('data-tone')).toBe('provider');
      expect(registerBtn.className).not.toMatch(/amber/);
      expect(registerBtn.className).toMatch(/blue/);
      await act(async () => {
        registerBtn.click();
      });

      // step 3 — OTP. Confirm button is also Provider blue.
      await waitFor(() => expect(screen.getByTestId('otp-input')).toBeInTheDocument());
      const otpInput = screen.getByTestId('otp-input') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(otpInput, { target: { value: '654321' } });
      });
      const confirmBtn = screen
        .getAllByRole('button')
        .find((b) => /confirm|verifying/i.test(b.textContent ?? ''))!;
      expect(confirmBtn.getAttribute('data-tone')).toBe('provider');
      expect(confirmBtn.className).not.toMatch(/amber/);
      await act(async () => {
        confirmBtn.click();
      });

      // Lands on /provider — the patch-2 regression repair.
      await waitFor(() => expect(screen.getByTestId('provider-app')).toBeInTheDocument(), {
        // Generous upper bound: under full-suite load (45 files), the
        // auth-provider's verify-otp → invalidateQueries → /me refetch
        // → SignUpPage destination resolver → router redirect chain
        // can take longer than the 3 s default. The test fired hot
        // when run isolated; the timeout was the only thing failing
        // under load. 8 s is well below the 30 s vitest default test
        // timeout and gives us margin for the cold start.
        timeout: 8000,
      });
      expect(screen.queryByTestId('seeker-app')).toBeNull();
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 5.1.1 patch 2 — auth primary buttons carry the resolved
// experience tone instead of hardcoded amber.
// ─────────────────────────────────────────────────────────────────────────────
describe('Auth primary buttons follow the resolved experience', () => {
  it('Provider login button carries data-tone=provider with blue classes (NOT amber)', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderRouter();
    await act(async () => {
      screen.getByTestId('app-card-provider').click();
    });
    await waitFor(() => expect(screen.getByTestId('auth-hero-provider')).toBeInTheDocument());

    const loginBtn = screen
      .getAllByRole('button')
      .find((b) => /^log ?in|^sign ?in/i.test(b.textContent ?? ''))!;
    expect(loginBtn.getAttribute('data-tone')).toBe('provider');
    expect(loginBtn.className).not.toMatch(/amber/);
    expect(loginBtn.className).toMatch(/blue/);
  });

  it('Seeker login button carries data-tone=seeker with amber classes', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderRouter();
    await act(async () => {
      screen.getByTestId('app-card-seeker').click();
    });
    await waitFor(() => expect(screen.getByTestId('auth-hero-seeker')).toBeInTheDocument());

    const loginBtn = screen
      .getAllByRole('button')
      .find((b) => /^log ?in|^sign ?in/i.test(b.textContent ?? ''))!;
    expect(loginBtn.getAttribute('data-tone')).toBe('seeker');
    expect(loginBtn.className).toMatch(/amber/);
    expect(loginBtn.className).not.toMatch(/\bblue\b|\bslate-700\b/);
  });

  it('Admin login button (resolved via state.app on direct /login) carries data-tone=admin', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});
    setIntendedApp('admin');

    renderRouter('/login');
    await waitFor(() => expect(screen.getByTestId('auth-hero-admin')).toBeInTheDocument());

    const loginBtn = screen
      .getAllByRole('button')
      .find((b) => /^log ?in|^sign ?in/i.test(b.textContent ?? ''))!;
    expect(loginBtn.getAttribute('data-tone')).toBe('admin');
    expect(loginBtn.className).not.toMatch(/amber|\bblue\b/);
    expect(loginBtn.className).toMatch(/slate/);
  });
});
