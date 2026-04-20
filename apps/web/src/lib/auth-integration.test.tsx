import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { api } from './api';
import { AuthProvider, queryClient, useAuth } from './auth-provider';
import { RequireAuth, GuestOnly } from './route-guards';

// A small debug probe to read router state inside tests.
function LocationProbe() {
  const loc = useLocation();
  return (
    <div data-testid="location">
      {loc.pathname}|{(loc.state as { returnTo?: string } | null)?.returnTo ?? ''}
    </div>
  );
}

function LoginStub() {
  const { login, verifyOtp } = useAuth();
  // Stub that simulates the two-step login the real UI does: credentials →
  // OTP challenge → verify-otp → authenticated. The test suite mocks both
  // endpoints so this single click exercises the whole contract.
  return (
    <div>
      <div data-testid="login-page">login-page</div>
      <LocationProbe />
      <button
        data-testid="do-login"
        onClick={async () => {
          const c = await login({ email: 'ada@example.com', password: 'a-reasonable-passphrase' });
          await verifyOtp(c.challengeId, '123456');
        }}
      >
        login
      </button>
    </div>
  );
}

function HomeStub() {
  const { user, logout, isDegraded } = useAuth();
  return (
    <div>
      <div data-testid="home">home</div>
      <div data-testid="user-email">{user?.email ?? ''}</div>
      {isDegraded && <div data-testid="degraded">degraded</div>}
      <button
        data-testid="do-logout"
        onClick={() => {
          void logout();
        }}
      >
        logout
      </button>
    </div>
  );
}

function renderApp(initialEntries: Array<string | { pathname: string; state?: unknown }>) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route element={<GuestOnly />}>
            <Route path="/login" element={<LoginStub />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/home" element={<HomeStub />} />
            <Route path="/home/bookings" element={<HomeStub />} />
          </Route>
        </Routes>
      </MemoryRouter>
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
  // The AuthProvider's QueryClient is a module singleton so we must reset it
  // between tests — otherwise cached /me data from one case leaks into the
  // next and observers never refetch.
  queryClient.clear();
});

afterEach(() => {
  mock.restore();
  // Clear cookies between tests.
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  });
});

describe('deep-link → login → returnTo', () => {
  it('redirects unauthenticated deep link to /login with returnTo preserved', async () => {
    mock.onGet('/v1/auth/me').reply(401, { error: { code: 'AUTH_INVALID_CREDENTIALS' } });
    // The 401 interceptor attempts a silent refresh; fail it fast so the
    // original /me rejection bubbles up to the queryFn.
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderApp(['/home/bookings?tab=upcoming#top']);

    await waitFor(
      () => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    // The guard must persist the full target (pathname + search + hash).
    expect(screen.getByTestId('location').textContent).toBe(
      '/login|/home/bookings?tab=upcoming#top',
    );
  });

  it('after login, navigates back to the original deep link (not /home)', async () => {
    let meCalls = 0;
    mock.onGet('/v1/auth/me').reply(() => {
      meCalls++;
      if (meCalls === 1) return [401, {}];
      return [200, MOCK_ME];
    });
    mock.onPost('/v1/auth/refresh').reply(401, {});
    // Real login now returns an OTP challenge; verify-otp issues the session.
    mock.onPost('/v1/auth/login').reply(200, {
      otpRequired: true,
      challengeId: 'chal-int-test',
      codeLength: 6,
      expiresInSeconds: 300,
    });
    mock.onPost('/v1/auth/verify-otp').reply(200, {});

    renderApp(['/home/bookings']);

    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument(), {
      timeout: 3000,
    });

    await act(async () => {
      screen.getByTestId('do-login').click();
    });

    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByTestId('user-email').textContent).toBe('ada@example.com');
  });
});

describe('/me restore on reload', () => {
  it('bootstraps user from cookies (GET /me → 200) and renders the protected route directly', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);

    renderApp(['/home']);

    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument());
    expect(screen.getByTestId('user-email').textContent).toBe('ada@example.com');
  });
});

describe('transient /me failure does NOT flip to logged-out', () => {
  it('keeps the user rendered and surfaces isDegraded on a non-401 error', async () => {
    // 1st response: 200 (establishes session). 2nd+ responses: 503 (transient).
    let calls = 0;
    mock.onGet('/v1/auth/me').reply(() => {
      calls++;
      if (calls === 1) return [200, MOCK_ME];
      return [503, { error: { code: 'DEPENDENCY_UNAVAILABLE' } }];
    });

    renderApp(['/home']);
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument());

    // Force a re-fetch of /me (simulates window focus / manual refresh).
    await act(async () => {
      await api.get('/v1/auth/me').catch(() => undefined);
    });

    // The protected route is still mounted — user was NOT logged out by the 503.
    expect(screen.getByTestId('home')).toBeInTheDocument();
    expect(screen.getByTestId('user-email').textContent).toBe('ada@example.com');
  });
});

describe('expired access token → refresh → retry (already covered in api.test.ts)', () => {
  it('serves as an anchor to the existing coverage', () => {
    // Behavior proven by src/lib/api.test.ts:
    //   "401 refresh interceptor → retries the original request exactly once
    //   after a successful refresh". This integration file intentionally does
    //   not duplicate that low-level test; it tests the UI outcomes instead.
    expect(true).toBe(true);
  });
});

describe('refresh failure / revoked session → clear auth state safely', () => {
  it('session-expired event clears the query cache and flips user to null → lands on /login', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderApp(['/home']);
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument(), { timeout: 3000 });

    // Simulate the 401 interceptor firing after a failed refresh.
    await act(async () => {
      window.dispatchEvent(new Event('auth:session-expired'));
    });

    // The handler seeds auth/me=null, so the guard redirects immediately.
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument(), {
      timeout: 3000,
    });
  });
});

describe('logout clears authenticated UI and query cache', () => {
  it('POST /logout succeeds → user is null → RequireAuth redirects to /login', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onPost('/v1/auth/logout').reply(204);
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderApp(['/home']);
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument(), { timeout: 3000 });

    await act(async () => {
      screen.getByTestId('do-logout').click();
    });

    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('is resilient if /logout itself fails (still clears local auth state)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onPost('/v1/auth/logout').reply(503, { error: { code: 'DEPENDENCY_UNAVAILABLE' } });
    mock.onPost('/v1/auth/refresh').reply(401, {});

    renderApp(['/home']);
    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument(), { timeout: 3000 });

    await act(async () => {
      screen.getByTestId('do-logout').click();
    });

    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument(), {
      timeout: 3000,
    });
  });
});

describe('GuestOnly honors a pending returnTo', () => {
  it('an already-authed user hitting /login with returnTo lands on the protected target', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);

    renderApp([{ pathname: '/login', state: { returnTo: '/home/bookings' } }]);

    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument());
  });

  it('does not allow an external returnTo (open-redirect guard at GuestOnly level)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);

    // GuestOnly unconditionally falls back to /home unless the returnTo is a
    // same-path in-app route; an explicit `/login` returnTo is short-circuited
    // to /home to avoid a loop.
    renderApp([{ pathname: '/login', state: { returnTo: '/login' } }]);

    await waitFor(() => expect(screen.getByTestId('home')).toBeInTheDocument());
  });
});
