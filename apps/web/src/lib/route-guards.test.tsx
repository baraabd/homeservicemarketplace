import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter, Outlet, Route, Routes, useOutletContext } from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import { api } from './api';
import { AuthProvider, createAuthQueryClient } from './auth-provider';
import { RequireAuth, GuestOnly } from './route-guards';

// ─────────────────────────────────────────────────────────────────────────────
// Regression: route guards must forward outlet context.
//
// Root renders <Outlet context={ctx}/> to pass RootContext down. An
// intermediate layout route (RequireAuth / GuestOnly) that renders a bare
// <Outlet/> silently drops that context, so grandchildren calling
// useOutletContext() receive undefined.
//
// Symptom before the fix:
//   "Cannot destructure property 'isOffline' of 'useRootContext(...)' as it
//    is undefined." — thrown by HomePage on first render after OTP verify.
//
// These tests render a mini Root-like layout + guard + consumer and assert
// the consumer can actually read the parent's context. If someone later
// removes the ForwardingOutlet and goes back to a bare <Outlet/>, this test
// fails loudly instead of shipping the crash.
// ─────────────────────────────────────────────────────────────────────────────

interface TestCtx {
  isOffline: boolean;
  marker: string;
}

function RootLayout({ ctx }: { ctx: TestCtx }) {
  return <Outlet context={ctx} />;
}

function ContextConsumer() {
  // Using destructuring here is intentional — this is the exact pattern that
  // crashes if context is undefined (mirrors HomePage.tsx:11).
  const { isOffline, marker } = useOutletContext<TestCtx>();
  return (
    <div>
      <div data-testid="consumer">consumer</div>
      <div data-testid="isOffline">{String(isOffline)}</div>
      <div data-testid="marker">{marker}</div>
    </div>
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

describe('RequireAuth forwards outlet context', () => {
  it('authenticated child route receives the Root layout context intact', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);

    const ctx: TestCtx = { isOffline: true, marker: 'from-root' };

    render(
      <AuthProvider client={qc}>
        <MemoryRouter initialEntries={['/home']}>
          <Routes>
            <Route element={<RootLayout ctx={ctx} />}>
              <Route element={<RequireAuth />}>
                <Route path="/home" element={<ContextConsumer />} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('consumer')).toBeInTheDocument());
    // These two assertions are the teeth of the regression test: before the
    // fix, useOutletContext() returned undefined and destructuring crashed
    // — the test would never reach these lines.
    expect(screen.getByTestId('isOffline').textContent).toBe('true');
    expect(screen.getByTestId('marker').textContent).toBe('from-root');
  });

  it('propagates through multiple levels (Root → RequireAuth → nested layout → page)', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);

    const ctx: TestCtx = { isOffline: false, marker: 'deep' };

    // A second intermediate layout that also forwards context — simulates
    // what a future feature-area layout (e.g. /home's tab shell) would look
    // like. Anyone who forgets to forward context inside their own layout
    // will see this test fail the moment they add it below RequireAuth.
    function IntermediateLayout() {
      const parent = useOutletContext<TestCtx>();
      return <Outlet context={parent} />;
    }

    render(
      <AuthProvider client={qc}>
        <MemoryRouter initialEntries={['/home/bookings']}>
          <Routes>
            <Route element={<RootLayout ctx={ctx} />}>
              <Route element={<RequireAuth />}>
                <Route element={<IntermediateLayout />}>
                  <Route path="/home/bookings" element={<ContextConsumer />} />
                </Route>
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('consumer')).toBeInTheDocument());
    expect(screen.getByTestId('marker').textContent).toBe('deep');
  });
});

describe('GuestOnly forwards outlet context', () => {
  it('unauthenticated child route (e.g. /login) receives the Root layout context', async () => {
    mock.onGet('/v1/auth/me').reply(401, {});
    mock.onPost('/v1/auth/refresh').reply(401, {});

    const ctx: TestCtx = { isOffline: false, marker: 'guest-branch' };

    render(
      <AuthProvider client={qc}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route element={<RootLayout ctx={ctx} />}>
              <Route element={<GuestOnly />}>
                <Route path="/login" element={<ContextConsumer />} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('consumer')).toBeInTheDocument());
    expect(screen.getByTestId('marker').textContent).toBe('guest-branch');
  });
});

describe('Login → OTP → /home does not crash on context', () => {
  it('after successful auth, the landing protected route can destructure useOutletContext', async () => {
    // The scenario the user reported verbatim: signup/login succeeds, OTP
    // verify succeeds, redirect fires, HomePage renders for the first time.
    // Before the fix this render throws. We simulate the redirect by
    // starting at /home with /me already authenticated — the same code path
    // HomePage hits on mount.
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);

    const ctx: TestCtx = { isOffline: false, marker: 'post-otp-landing' };

    const renderResult = render(
      <AuthProvider client={qc}>
        <MemoryRouter initialEntries={['/home']}>
          <Routes>
            <Route element={<RootLayout ctx={ctx} />}>
              <Route element={<RequireAuth />}>
                <Route path="/home" element={<ContextConsumer />} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    // Just reaching this line without a thrown render is already the core
    // regression coverage — but we assert the consumer's visible state too
    // to catch silent fallbacks (e.g. someone "fixing" by defaulting to {}).
    await waitFor(() => expect(screen.getByTestId('consumer')).toBeInTheDocument());
    expect(screen.getByTestId('marker').textContent).toBe('post-otp-landing');
    renderResult.unmount();
  });
});

describe('Refresh on /home (cold mount under the full layout chain)', () => {
  it('direct navigation to /home (no prior history) still receives context', async () => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);

    const ctx: TestCtx = { isOffline: false, marker: 'cold-mount' };

    render(
      <AuthProvider client={qc}>
        <MemoryRouter initialEntries={['/home']}>
          <Routes>
            <Route element={<RootLayout ctx={ctx} />}>
              <Route element={<RequireAuth />}>
                <Route path="/home" element={<ContextConsumer />} />
                <Route path="/home/bookings" element={<ContextConsumer />} />
                <Route path="/home/messages" element={<ContextConsumer />} />
                <Route path="/home/profile" element={<ContextConsumer />} />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('consumer')).toBeInTheDocument());
    expect(screen.getByTestId('marker').textContent).toBe('cold-mount');
  });

  it.each(['/home/bookings', '/home/messages', '/home/profile', '/provider'])(
    '%s also receives context (all tab/sibling protected routes)',
    async (path) => {
      mock.onGet('/v1/auth/me').reply(200, MOCK_ME);

      const ctx: TestCtx = { isOffline: false, marker: `cold-${path}` };

      render(
        <AuthProvider client={qc}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route element={<RootLayout ctx={ctx} />}>
                <Route element={<RequireAuth />}>
                  <Route path="/home" element={<ContextConsumer />} />
                  <Route path="/home/bookings" element={<ContextConsumer />} />
                  <Route path="/home/messages" element={<ContextConsumer />} />
                  <Route path="/home/profile" element={<ContextConsumer />} />
                  <Route path="/provider" element={<ContextConsumer />} />
                </Route>
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>,
      );

      await waitFor(() => expect(screen.getByTestId('consumer')).toBeInTheDocument());
      expect(screen.getByTestId('marker').textContent).toBe(`cold-${path}`);

      // Give React Query's bootstrap a tick to settle before the next case
      // clears the QueryClient — prevents open handles across cases.
      await act(async () => {
        await Promise.resolve();
      });
    },
  );
});
