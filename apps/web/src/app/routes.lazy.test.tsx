import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  useLocation,
  useOutletContext,
  useParams,
} from 'react-router';

const state = vi.hoisted(() => ({
  auth: {
    isAuthenticated: false,
    isLoading: false,
    user: null as { id: string; roles: string[]; email: string } | null,
  },
  imports: { admin: 0, home: 0, provider: 0, onboarding: 0, auth: 0, disputes: 0 },
  coordinatorMounts: 0,
  coordinatorUnmounts: 0,
}));

vi.mock('../lib/auth-provider', () => ({ useAuth: () => state.auth }));
vi.mock('./Root', () => ({
  Root: () => (
    <main data-testid="root-shell">
      <Outlet context={{ marker: 'root-context' }} />
    </main>
  ),
}));
vi.mock('./pages/AppSelector', () => ({ AppSelector: () => <h1>App selector</h1> }));
vi.mock('./pages/AuthPages', () => {
  state.imports.auth++;
  function AuthPage() {
    const location = useLocation();
    return <h1>Login {(location.state as { returnTo?: string } | null)?.returnTo}</h1>;
  }
  return {
    LoginPage: AuthPage,
    SignUpPage: AuthPage,
    ForgotPasswordPage: AuthPage,
    CheckEmailPage: AuthPage,
    VerifyEmailPage: AuthPage,
    ResetPasswordPage: AuthPage,
  };
});
vi.mock('./pages/AdminPage', () => {
  state.imports.admin++;
  return { AdminPage: () => <h1>Admin workspace</h1> };
});
vi.mock('./pages/HomePage', () => {
  state.imports.home++;
  return {
    HomePage: function HomeProbe() {
      const [draft, setDraft] = useState('');
      const { marker } = useOutletContext<{ marker: string }>();
      const location = useLocation();
      return (
        <>
          <h1>Seeker workspace {location.pathname}</h1>
          <p>{marker}</p>
          <input
            aria-label="Seeker draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </>
      );
    },
  };
});
vi.mock('./pages/ProviderPage', () => {
  state.imports.provider++;
  return { ProviderPage: () => <h1>Provider workspace</h1> };
});
vi.mock('./pages/DisputesPage', () => {
  state.imports.disputes++;
  return { DisputesPage: () => <h1>Disputes workspace</h1> };
});
vi.mock('./pages/ProviderOnboardingPage', () => {
  state.imports.onboarding++;
  function LayoutProbe() {
    const [queued, setQueued] = useState('');
    useEffect(() => {
      state.coordinatorMounts++;
      return () => {
        state.coordinatorUnmounts++;
      };
    }, []);
    return (
      <>
        <input
          aria-label="Queued onboarding edit"
          value={queued}
          onChange={(event) => setQueued(event.target.value)}
        />
        <Outlet context={{ queued }} />
      </>
    );
  }
  function TaskProbe() {
    const { taskId } = useParams();
    const { queued } = useOutletContext<{ queued: string }>();
    return (
      <>
        <h1>Onboarding {taskId ?? 'hub'}</h1>
        <p data-testid="pending-edit">{queued}</p>
      </>
    );
  }
  return {
    ProviderOnboardingLayout: LayoutProbe,
    ProviderOnboardingHubPage: TaskProbe,
    ProviderOnboardingTaskPage: TaskProbe,
    ProviderVerificationPage: () => <h1>Identity verification</h1>,
  };
});

import { router as applicationRouter } from './routes';

// Exercise the real route table while page probes isolate route lifecycle from
// API/domain behavior. The autosave coordinator has its own real queue tests.
// Use one router entry in Vitest so CJS hooks and native-ESM /dom contexts are
// not mixed. App.router.test separately covers the application's /dom wiring.
applicationRouter.dispose();
const routers: ReturnType<typeof createMemoryRouter>[] = [];
function renderRoute(path: string) {
  const router = createMemoryRouter(applicationRouter.routes, { initialEntries: [path] });
  routers.push(router);
  render(<RouterProvider router={router} />);
  return router;
}
function signIn(id: string, roles: string[]) {
  state.auth = {
    isAuthenticated: true,
    isLoading: false,
    user: { id, roles, email: `${id}@example.test` },
  };
}
beforeEach(() => {
  state.auth = { isAuthenticated: false, isLoading: false, user: null };
  state.coordinatorMounts = 0;
  state.coordinatorUnmounts = 0;
});
afterEach(() => {
  cleanup();
  for (const router of routers.splice(0)) router.dispose();
});

describe('actual route table with deferred pages', () => {
  it('loads no private experience for the selector, an anonymous visit, or an unauthorized admin visit', async () => {
    const router = renderRoute('/select');
    expect(screen.getByRole('heading', { name: 'App selector' })).toBeVisible();
    expect(state.imports).toEqual({
      admin: 0,
      home: 0,
      provider: 0,
      onboarding: 0,
      auth: 0,
      disputes: 0,
    });

    await act(async () => {
      await router.navigate('/admin/reviews?status=PENDING#queue');
    });
    expect(
      await screen.findByRole('heading', { name: 'Login /admin/reviews?status=PENDING#queue' }),
    ).toBeVisible();
    expect(state.imports.admin).toBe(0);

    await act(async () => {
      await router.navigate('/home');
    });
    expect(await screen.findByRole('heading', { name: 'Login /home' })).toBeVisible();
    expect(state.imports.home).toBe(0);

    signIn('customer-a', ['customer']);
    await act(async () => {
      await router.navigate('/admin');
    });
    expect(await screen.findByRole('heading', { name: 'Admin access required' })).toBeVisible();
    expect(state.imports.admin).toBe(0);

    signIn('admin-a', ['admin']);
    await act(async () => {
      await router.navigate('/select');
      await router.navigate('/admin');
    });
    expect(await screen.findByRole('heading', { name: 'Admin workspace' })).toBeVisible();
    expect(state.imports.admin).toBe(1);
    expect(state.imports.provider).toBe(0);
    expect(state.imports.onboarding).toBe(0);
  });

  it('preserves the seeker instance and forwarded root context across all four tabs', async () => {
    signIn('customer-a', ['customer']);
    const router = renderRoute('/home');
    const draft = await screen.findByRole('textbox', { name: 'Seeker draft' });
    fireEvent.change(draft, { target: { value: 'unfinished request' } });
    const shell = screen.getByTestId('root-shell');
    for (const path of ['/home/bookings', '/home/messages', '/home/profile', '/home']) {
      await act(async () => {
        await router.navigate(path);
      });
      expect(
        await screen.findByRole('heading', { name: `Seeker workspace ${path}` }),
      ).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Seeker draft' })).toBe(draft);
      expect(draft).toHaveValue('unfinished request');
      expect(screen.getByText('root-context')).toBeVisible();
      expect(screen.getByTestId('root-shell')).toBe(shell);
    }
    expect(state.imports.home).toBe(1);
  });

  it('keeps the onboarding coordinator and pending edit above hub/task navigation, then resets on identity change', async () => {
    signIn('provider-a', ['provider']);
    const router = renderRoute('/provider/onboarding');
    expect(await screen.findByRole('heading', { name: 'Onboarding hub' })).toBeVisible();
    const draft = screen.getByRole('textbox', { name: 'Queued onboarding edit' });
    fireEvent.change(draft, { target: { value: 'waiting for server acknowledgement' } });
    for (const task of ['identity', 'services', 'hub']) {
      const path = task === 'hub' ? '/provider/onboarding' : `/provider/onboarding/${task}`;
      await act(async () => {
        await router.navigate(path);
      });
      expect(await screen.findByRole('heading', { name: `Onboarding ${task}` })).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Queued onboarding edit' })).toBe(draft);
      expect(screen.getByTestId('pending-edit')).toHaveTextContent(
        'waiting for server acknowledgement',
      );
      expect(state.coordinatorMounts).toBe(1);
      expect(state.coordinatorUnmounts).toBe(0);
    }

    signIn('provider-b', ['provider']);
    await act(async () => {
      await router.navigate('/provider/onboarding/identity');
    });
    expect(await screen.findByRole('heading', { name: 'Onboarding identity' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Queued onboarding edit' })).toHaveValue('');
    expect(screen.getByTestId('pending-edit')).toBeEmptyDOMElement();
    expect(state.coordinatorMounts).toBe(2);
    expect(state.coordinatorUnmounts).toBe(1);

    await act(async () => {
      await router.navigate('/provider/jobs');
    });
    expect(await screen.findByRole('heading', { name: 'Provider workspace' })).toBeVisible();
    expect(state.imports.provider).toBe(1);
    expect(state.coordinatorUnmounts).toBe(2);
  });
});
