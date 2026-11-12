import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { AuthProvider, createAuthQueryClient, useAuth } from '../../../lib/auth-provider';
import { api } from '../../../lib/api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';
import { PROVIDER_ONBOARDING_V2_OVERRIDE_KEY } from '../../../lib/feature-flags';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { WORKING_CAPABILITIES } from '../../../test-support/provider-capability-fixtures';
import { ProviderApp } from './ProviderApp';

const statusModule = vi.hoisted(() => ({ loaded: vi.fn() }));
vi.mock('./screens/LiveJobsScreen', () => ({
  LiveJobsScreen: () => <div>Working marketplace</div>,
}));
vi.mock('../../features/provider-onboarding-v2/components/ProviderStatusCentreScreen', () => {
  statusModule.loaded();
  return {
    ProviderStatusCentreScreen: function StatusProbe() {
      const { user } = useAuth();
      const [draft, setDraft] = useState(0);
      return (
        <div>
          <h1>Status for {user?.firstName}</h1>
          <button onClick={() => setDraft((current) => current + 1)}>Status draft {draft}</button>
        </div>
      );
    },
  };
});

let mock: MockAdapter;
let qc: QueryClient;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PROVIDER_ONBOARDING_V2_OVERRIDE_KEY, 'true');
  mock = new MockAdapter(api);
  qc = createAuthQueryClient();
  mock.onGet('/v1/auth/me').reply(200, {
    id: 'provider-user',
    email: 'provider@example.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
    status: 'ACTIVE',
    roles: ['customer', 'provider'],
    emailVerifiedAt: '2026-11-11T00:00:00Z',
    mfaEnabled: false,
  });
  mock.onGet('/v1/me/provider/profile').reply(200, {
    profile: {
      id: 'provider-profile',
      status: 'ACTIVE',
      displayName: 'Ada Lovelace',
      initials: 'AL',
      pendingCategories: [],
      serviceCategories: [],
    },
  });
  mock.onGet('/v1/me/provider/capabilities').reply(200, WORKING_CAPABILITIES);
  mock.onGet(/\/v1\/me\/notifications/).reply(200, { items: [], nextCursor: null, unreadCount: 0 });
});
afterEach(() => {
  cleanup();
  qc.clear();
  mock.restore();
  localStorage.clear();
});

function setup(path = '/provider/jobs') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider client={qc}>
        <LanguageProvider>
          <EcosystemProvider>
            <Link to="/provider/status">Open account status</Link>
            <Routes>
              <Route path="/provider/*" element={<ProviderApp />} />
            </Routes>
          </EcosystemProvider>
        </LanguageProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

it('does not load identity status code merely to open the working marketplace', async () => {
  setup();
  expect(await screen.findByText('Working marketplace')).toBeInTheDocument();
  expect(statusModule.loaded).not.toHaveBeenCalled();
  expect(screen.queryByText('Status for Ada')).not.toBeInTheDocument();
});

it('loads the status route on demand and preserves its local state and shared session during authority refresh', async () => {
  setup();
  await screen.findByText('Working marketplace');
  fireEvent.click(screen.getByRole('link', { name: 'Open account status' }));
  expect(await screen.findByRole('heading', { name: 'Status for Ada' })).toBeInTheDocument();
  expect(statusModule.loaded).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Status draft 0' }));
  await act(async () => {
    await qc.invalidateQueries({ queryKey: providerQueryKeys.capabilities.get() });
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Status draft 1' })).toBeInTheDocument(),
  );
  expect(screen.getByRole('heading', { name: 'Status for Ada' })).toBeInTheDocument();
  expect(mock.history.get.filter((request) => request.url === '/v1/auth/me')).toHaveLength(1);
  expect(mock.history.get.some((request) => request.url === '/v1/me/provider/verification')).toBe(
    false,
  );
});
