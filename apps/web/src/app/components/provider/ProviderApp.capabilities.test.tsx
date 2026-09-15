import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient, useAuth } from '../../../lib/auth-provider';
import { RequireAuth } from '../../../lib/route-guards';
import { providerQueryKeys } from '../../../lib/provider/query-keys';
import { PROVIDER_ONBOARDING_V2_OVERRIDE_KEY } from '../../../lib/feature-flags';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import {
  APPLYING_CAPABILITIES,
  WORKING_CAPABILITIES,
} from '../../../test-support/provider-capability-fixtures';
import { ProviderApp } from './ProviderApp';

vi.mock('./screens/LiveJobsScreen', () => ({
  LiveJobsScreen: () => <div>Working marketplace</div>,
}));
vi.mock('./screens/MyBidsScreen', () => ({ MyBidsScreen: () => <div>Working bids</div> }));
vi.mock('./screens/ProviderChatScreen', () => ({
  ProviderChatScreen: () => <div>Existing conversations</div>,
}));
vi.mock('./screens/WalletScreen', () => ({ WalletScreen: () => <div>Existing earnings</div> }));
vi.mock('./screens/ProviderProfileScreen', () => ({
  ProviderProfileScreen: () => <div>Profile editor</div>,
}));
vi.mock('../../features/provider-onboarding-v2/components/ProviderStatusCentreScreen', () => ({
  ProviderStatusCentreScreen: () => <div>Application status centre</div>,
}));

const CAPS = '/v1/me/provider/capabilities';
const PROFILE = '/v1/me/provider/profile';
const ME = {
  id: 'provider-user',
  email: 'provider@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  status: 'ACTIVE',
  roles: ['customer', 'provider'],
  emailVerifiedAt: '2026-09-15T00:00:00Z',
  mfaEnabled: false,
};
const ACTIVE_PROFILE = {
  id: 'provider-profile',
  status: 'ACTIVE',
  displayName: 'Ada Lovelace',
  initials: 'AL',
  pendingCategories: [],
  serviceCategories: [],
};
let mock: MockAdapter;
let qc: QueryClient;

function LocationProbe() {
  return (
    <>
      <div data-testid="location">{useLocation().pathname}</div>
      <Link to="/provider/activate/">Visit activation</Link>
    </>
  );
}
function LoginProbe() {
  const { verifyOtp, isAuthenticated } = useAuth();
  return isAuthenticated ? (
    <Navigate to="/provider/jobs" replace />
  ) : (
    <button onClick={() => void verifyOtp('fixture-challenge', '123456')}>Finish sign in</button>
  );
}
function renderProvider(path = '/provider/jobs') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider client={qc}>
        <LanguageProvider>
          <EcosystemProvider>
            <Routes>
              <Route path="/login" element={<LoginProbe />} />
              <Route element={<RequireAuth />}>
                <Route path="/provider/onboarding" element={<div>Complete your application</div>} />
                <Route path="/provider/*" element={<ProviderApp />} />
              </Route>
            </Routes>
            <LocationProbe />
          </EcosystemProvider>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
  window.localStorage.setItem(PROVIDER_ONBOARDING_V2_OVERRIDE_KEY, 'true');
  mock.onGet('/v1/auth/me').reply(200, ME);
  mock.onGet(PROFILE).reply(200, { profile: ACTIVE_PROFILE });
  mock.onGet(/\/v1\/me\/notifications/).reply(200, { items: [], nextCursor: null, unreadCount: 0 });
});
afterEach(() => {
  mock.restore();
  qc.clear();
  window.localStorage.clear();
});

function expectNoWorkspace() {
  expect(screen.queryByText('Working marketplace')).toBeNull();
  expect(screen.queryByText('Working bids')).toBeNull();
  expect(screen.queryByText('Existing conversations')).toBeNull();
  expect(screen.queryByText('Existing earnings')).toBeNull();
  expect(screen.queryByTestId('provider-bottom-nav')).toBeNull();
}

describe('ProviderApp — canonical access survives navigation and authentication', () => {
  it.each([
    '/provider',
    '/provider/jobs',
    '/provider/bids',
    '/provider/messages/thread-1',
    '/provider/wallet',
    '/provider/profile',
    '/provider/status',
  ])(
    'returns ACTIVE legacy status with incomplete onboarding to its tasks from %s',
    async (path) => {
      mock.onGet(CAPS).reply(200, APPLYING_CAPABILITIES);
      renderProvider(path);
      expect(await screen.findByText('Complete your application')).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent('/provider/onboarding');
      expectNoWorkspace();
    },
  );

  it('denies the same incomplete application with V2 off', async () => {
    window.localStorage.setItem(PROVIDER_ONBOARDING_V2_OVERRIDE_KEY, 'false');
    mock.onGet(CAPS).reply(200, APPLYING_CAPABILITIES);
    renderProvider();
    expect(await screen.findByRole('button', { name: /continue onboarding/i })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/provider/status');
    expectNoWorkspace();
  });

  it.each([200, 403, 404])(
    'never reuses cached work capabilities when the profile is absent (HTTP %s)',
    async (status) => {
      qc.setQueryData(providerQueryKeys.capabilities.get(), WORKING_CAPABILITIES);
      mock.onGet(PROFILE).reply(status, status === 200 ? { profile: null } : { code: 'NOT_FOUND' });
      renderProvider();
      expect(
        await screen.findByRole('button', { name: 'Activate provider account' }),
      ).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent('/provider/activate');
      expect(mock.history.get.filter((request) => request.url === CAPS)).toHaveLength(0);
      expectNoWorkspace();
    },
  );

  it.each(['/provider/activate', '/provider/activate/'])(
    'keeps %s mounted while the committed upgrade waits for verified session rotation',
    async (path) => {
      mock.onGet(PROFILE).reply(403);
      mock.onGet('/v1/auth/me').reply(200, { ...ME, roles: ['customer'] });
      mock.onPost('/v1/me/provider/upgrade').reply(() => {
        mock.onGet(PROFILE).reply(200, { profile: { ...ACTIVE_PROFILE, status: 'DRAFT' } });
        return [200, { profile: { ...ACTIVE_PROFILE, status: 'DRAFT' } }];
      });
      let finishRotation!: () => void;
      mock.onPost('/v1/auth/refresh').reply(
        () =>
          new Promise((resolve) => {
            finishRotation = () => {
              mock.onGet('/v1/auth/me').reply(200, ME);
              resolve([200, {}]);
            };
          }),
      );
      mock.onGet(CAPS).reply(403);
      renderProvider(path);
      fireEvent.click(await screen.findByRole('button', { name: 'Activate provider account' }));
      expect(await screen.findByText('Preparing your provider account')).toBeInTheDocument();
      await waitFor(() => expect(finishRotation).toBeTypeOf('function'));
      expect(screen.getByTestId('location')).toHaveTextContent('/provider/activate');
      expect(mock.history.get.filter((request) => request.url === CAPS)).toHaveLength(0);
      expectNoWorkspace();
      await act(async () => {
        finishRotation();
      });
      expect(await screen.findByText('Complete your application')).toBeInTheDocument();
      expectNoWorkspace();
    },
  );

  it('rechecks access after an activation visit instead of reusing the previous workspace decision', async () => {
    mock.onGet(CAPS).reply(200, WORKING_CAPABILITIES);
    renderProvider();
    expect(await screen.findByText('Working marketplace')).toBeInTheDocument();
    let answer!: () => void;
    mock.onGet(CAPS).reply(
      () =>
        new Promise((resolve) => {
          answer = () => resolve([200, APPLYING_CAPABILITIES]);
        }),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Visit activation' }));
    await waitFor(() => expect(answer).toBeTypeOf('function'));
    expect(screen.getByTestId('provider-shell-loading')).toBeInTheDocument();
    expect(screen.queryByText('Application status centre')).toBeNull();
    expectNoWorkspace();
    await act(async () => answer());
    expect(await screen.findByText('Complete your application')).toBeInTheDocument();
    expectNoWorkspace();
  });

  it('requires a fresh capability answer before rendering a cached ACTIVE workspace', async () => {
    qc.setQueryData(providerQueryKeys.capabilities.get(), WORKING_CAPABILITIES);
    let answer!: () => void;
    mock.onGet(CAPS).reply(
      () =>
        new Promise((resolve) => {
          answer = () => resolve([200, APPLYING_CAPABILITIES]);
        }),
    );
    renderProvider();
    await waitFor(() =>
      expect(mock.history.get.some((request) => request.url === CAPS)).toBe(true),
    );
    expectNoWorkspace();
    await act(async () => {
      answer();
    });
    expect(await screen.findByText('Complete your application')).toBeInTheDocument();
    expectNoWorkspace();
  });

  it.each([403, 500])(
    'fails closed on capability HTTP %s and exposes a real retry',
    async (status) => {
      qc.setQueryData(providerQueryKeys.capabilities.get(), WORKING_CAPABILITIES);
      mock.onGet(CAPS).reply(status, { message: 'internal details must stay private' });
      renderProvider();
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to check access');
      expect(screen.queryByText('internal details must stay private')).toBeNull();
      expectNoWorkspace();
      mock.onGet(CAPS).reply(200, APPLYING_CAPABILITIES);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Complete your application')).toBeInTheDocument();
    },
  );

  it('removes an already mounted workspace when refreshed capabilities deny access', async () => {
    mock.onGet(CAPS).reply(200, WORKING_CAPABILITIES);
    renderProvider();
    expect(await screen.findByText('Working marketplace')).toBeInTheDocument();
    mock.onGet(CAPS).reply(200, APPLYING_CAPABILITIES);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: providerQueryKeys.capabilities.get() });
    });
    expect(await screen.findByText('Complete your application')).toBeInTheDocument();
    expectNoWorkspace();
  });

  it.each([403, 404])(
    'does not keep working from cached data when the profile becomes unavailable (HTTP %s)',
    async (status) => {
      mock.onGet(CAPS).reply(200, WORKING_CAPABILITIES);
      renderProvider();
      expect(await screen.findByText('Working marketplace')).toBeInTheDocument();
      mock.onGet(PROFILE).reply(status, { code: 'NOT_FOUND' });
      await act(async () => {
        await qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root });
      });
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to check access');
      expectNoWorkspace();
    },
  );

  it('does not retain cached work access after session expiry and another sign in', async () => {
    mock.onGet(CAPS).reply(200, WORKING_CAPABILITIES);
    renderProvider();
    expect(await screen.findByText('Working marketplace')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('auth:session-expired'));
    });
    expect(await screen.findByRole('button', { name: 'Finish sign in' })).toBeInTheDocument();
    expect(qc.getQueryData(providerQueryKeys.capabilities.get())).toBeUndefined();
    mock.onGet(CAPS).reply(200, APPLYING_CAPABILITIES);
    mock.onPost('/v1/auth/verify-otp').reply(200, {});
    fireEvent.click(screen.getByRole('button', { name: 'Finish sign in' }));
    expect(await screen.findByText('Complete your application')).toBeInTheDocument();
    expectNoWorkspace();
  });

  it('keeps a submitted application on status despite legacy ACTIVE and preview permission', async () => {
    mock.onGet(CAPS).reply(200, {
      ...APPLYING_CAPABILITIES,
      allowed: [
        'VIEW_OWN_PROFILE',
        'EDIT_OWN_PROFILE',
        'COMPLETE_ONBOARDING',
        'MANAGE_VERIFICATION',
        'PREVIEW_MARKETPLACE',
      ],
      primaryReason: 'AWAITING_REVIEW',
      nextActions: ['WAIT_FOR_REVIEW'],
    });
    renderProvider();
    expect(await screen.findByText('Application status centre')).toBeInTheDocument();
    expectNoWorkspace();
  });

  it('does not tell a legacy ACTIVE provider that work is enabled when V2 is off', async () => {
    window.localStorage.setItem(PROVIDER_ONBOARDING_V2_OVERRIDE_KEY, 'false');
    mock.onGet(CAPS).reply(200, {
      allowed: ['VIEW_OWN_PROFILE', 'EDIT_OWN_PROFILE', 'PREVIEW_MARKETPLACE'],
      capabilities: [],
      primaryReason: 'NO_WORK_ACCESS',
      nextActions: ['WAIT_FOR_REVIEW'],
    });
    renderProvider();
    expect(await screen.findByText('Work access is not active')).toBeInTheDocument();
    expect(screen.queryByText('You can now use the Provider app.')).toBeNull();
    expectNoWorkspace();
  });

  it.each(['/provider/wallet', '/provider/messages'])(
    'preserves a restricted provider’s existing obligations at %s without offering new work',
    async (path) => {
      mock.onGet(CAPS).reply(200, {
        allowed: ['VIEW_OWN_PROFILE', 'EDIT_OWN_PROFILE', 'MANAGE_BOOKINGS', 'VIEW_EARNINGS'],
        capabilities: [],
        primaryReason: 'PROVIDER_RESTRICTED',
        nextActions: ['APPEAL_DECISION'],
      });
      renderProvider(path);
      expect(
        await screen.findByText(
          path.endsWith('wallet') ? 'Existing earnings' : 'Existing conversations',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByTestId('provider-nav-jobs')).toBeNull();
      expect(screen.queryByTestId('provider-nav-bids')).toBeNull();
      expect(screen.getByTestId('provider-nav-wallet')).toBeInTheDocument();
      expect(screen.getByTestId('provider-nav-messages')).toBeInTheDocument();
    },
  );
});
