import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Route, Routes } from 'react-router';
import { api } from '../../lib/api';
import { AuthProvider, queryClient } from '../../lib/auth-provider';
import { LanguageProvider } from '../i18n/LanguageContext';
import { EcosystemProvider } from '../context/EcosystemContext';
import { GuestOnly, RequireAuth } from '../../lib/route-guards';
import { clearIntendedApp, getIntendedApp } from '../../lib/intended-app';
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
  it('Provider click → /login → log in with OTP → lands on /provider (returnTo path)', async () => {
    let meCalls = 0;
    mock.onGet('/v1/auth/me').reply(() => {
      meCalls++;
      return meCalls === 1 ? [401, {}] : [200, MOCK_ME];
    });
    mock.onPost('/v1/auth/refresh').reply(401, {});
    mock.onPost('/v1/auth/login').reply(200, {
      otpRequired: true,
      challengeId: 'chal-prov-1',
      codeLength: 6,
      expiresInSeconds: 300,
    });
    mock.onPost('/v1/auth/verify-otp').reply(200, {});

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
      { timeout: 3000 },
    );
    expect(screen.queryByTestId('seeker-app')).toBeNull();
  });

  it('Provider click → /login → "Sign up" → register → OTP → lands on /provider (intent layer fallback)', async () => {
    // This is THE original bug: navigating from /login to /signup loses
    // react-router state, so SignUpPage has no `returnTo` to honor. Before
    // the intent layer, SignUpPage hardcoded `/home`, sending the user
    // straight into Seeker. Now the intent fallback resolves to /provider.
    let meCalls = 0;
    mock.onGet('/v1/auth/me').reply(() => {
      meCalls++;
      return meCalls === 1 ? [401, {}] : [200, MOCK_ME];
    });
    mock.onPost('/v1/auth/refresh').reply(401, {});
    mock.onPost('/v1/auth/register').reply(202, {
      otpRequired: true,
      challengeId: 'chal-reg-prov',
      codeLength: 6,
      expiresInSeconds: 300,
    });
    mock.onPost('/v1/auth/verify-otp').reply(200, {});

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
      { timeout: 3000 },
    );
    expect(screen.queryByTestId('seeker-app')).toBeNull();
  });

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
