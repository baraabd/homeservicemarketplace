import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { MemoryRouter } from 'react-router';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { AuthProvider, createAuthQueryClient } from '../../../lib/auth-provider';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { HomeScreen } from './HomeScreen';

// ─────────────────────────────────────────────────────────────────────────────
// Stabilization fix (defect #3): the notification drawer reads from
// /v1/me/notifications and persists read state via mark-read mutations.
// The slice-2 INITIAL_NOTIFS seed is gone, so the unread badge no
// longer snaps back to 3 after refresh.
// ─────────────────────────────────────────────────────────────────────────────

function renderHome() {
  return render(
    <AuthProvider client={qc}>
      <LanguageProvider>
        <EcosystemProvider>
          <MemoryRouter initialEntries={['/home']}>
            <HomeScreen isOffline={false} onServiceSelect={() => {}} onToggleOffline={() => {}} />
          </MemoryRouter>
        </EcosystemProvider>
      </LanguageProvider>
    </AuthProvider>,
  );
}

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

const NOTIF_BID = {
  id: 'n-bid',
  type: 'BID_ACCEPTED' as const,
  title: 'Bid accepted',
  body: 'You accepted a bid.',
  resourceType: 'BID' as const,
  resourceId: 'bid-1',
  deepLink: null,
  metadata: null,
  readAt: null,
  createdAt: '2026-04-29T10:00:00.000Z',
};

describe('HomeScreen — notification drawer (defect #3)', () => {
  beforeEach(() => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/requests').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/me/bookings').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/me/conversations').reply(200, { items: [], nextCursor: null });
  });

  it('reads notifications from /v1/me/notifications (no INITIAL_NOTIFS in DOM)', async () => {
    mock.onGet('/v1/me/notifications').reply(200, {
      items: [NOTIF_BID],
      nextCursor: null,
    });
    mock.onGet('/v1/me/notifications/unread-count').reply(200, { count: 1 });

    renderHome();

    await waitFor(() => {
      // Real notification body from API
      expect(screen.getByText('You accepted a bid.')).toBeInTheDocument();
    });

    // Slice-2 INITIAL_NOTIFS seed strings (Omar Al-Khalid bid $35/hr, etc.)
    // must NOT be in the DOM unless the API returned them.
    expect(screen.queryByText(/Omar Al-Khalid bid \$35/i)).toBeNull();
    expect(screen.queryByText(/6 bids on Electrical/i)).toBeNull();
    expect(screen.queryByText(/Pro is on the way/i)).toBeNull();
  });

  it('renders the unread count from the dedicated count endpoint, not from local state', async () => {
    mock.onGet('/v1/me/notifications').reply(200, { items: [], nextCursor: null });
    // The list returns 0 items but the count endpoint returns 1 — the
    // bell badge must reflect the count endpoint, not derive from the
    // (empty) list.
    mock.onGet('/v1/me/notifications/unread-count').reply(200, { count: 1 });

    renderHome();

    await waitFor(() => {
      // The bell badge displays the API count, not 0 (which a local-derived
      // count from the empty list would yield).
      const badges = screen.getAllByText('1');
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  it('mark-read tap calls POST /v1/me/notifications/:id/read', async () => {
    mock.onGet('/v1/me/notifications').reply(200, { items: [NOTIF_BID], nextCursor: null });
    mock.onGet('/v1/me/notifications/unread-count').reply(200, { count: 1 });
    let markedId: string | null = null;
    mock.onPost(/\/v1\/me\/notifications\/.+\/read$/).reply((config) => {
      markedId = (config.url ?? '').match(/notifications\/([^/]+)\/read/)?.[1] ?? null;
      return [200, { notification: { ...NOTIF_BID, readAt: '2026-04-29T11:00:00.000Z' } }];
    });

    renderHome();

    await waitFor(() => expect(screen.getByText('You accepted a bid.')).toBeInTheDocument());

    // Open the drawer by clicking the bell button. The bell is the first
    // button rendered in the top header; identifying it by aria/title
    // would require markup changes, so we click the row directly via
    // its body text.
    fireEvent.click(screen.getByText('You accepted a bid.'));

    await waitFor(() => expect(markedId).toBe('n-bid'));
  });
});
