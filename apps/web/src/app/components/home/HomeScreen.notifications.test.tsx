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

// ─────────────────────────────────────────────────────────────────────────────
// Notification tap → deep-link routing
//
// The dispatcher routes off the backend-truth `resourceType` field, not the
// UI icon palette. These tests pin that a click on each kind of notification
// drives the matching detail fetch — which is the load-bearing signal that
// the correct overlay actually opened (JobDetailView issues the request /
// booking detail GET on mount, ChatScreen issues the messages GET).
// ─────────────────────────────────────────────────────────────────────────────
describe('HomeScreen — notification tap deep-links by resourceType', () => {
  beforeEach(() => {
    mock.onGet('/v1/auth/me').reply(200, MOCK_ME);
    mock.onGet('/v1/me/requests').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/me/bookings').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/me/conversations').reply(200, { items: [], nextCursor: null });
    mock.onGet('/v1/me/notifications/unread-count').reply(200, { count: 1 });
    // Mark-read returns 200 silently for every test in this suite — the
    // dispatcher does not wait on the mutation.
    mock.onPost(/\/v1\/me\/notifications\/.+\/read$/).reply(200, { notification: null });
  });

  it('REQUEST notification → fetches request detail (JobDetailView opens for the right request)', async () => {
    const notif = {
      id: 'n-req',
      type: 'BOOKING_CANCELLED' as const,
      title: 'Booking cancelled',
      body: 'Your booking was cancelled — see the request for details.',
      resourceType: 'REQUEST' as const,
      resourceId: 'req-42',
      deepLink: null,
      metadata: null,
      readAt: null,
      createdAt: '2026-04-29T10:00:00.000Z',
    };
    mock.onGet('/v1/me/notifications').reply(200, { items: [notif], nextCursor: null });
    // 500 keeps JobDetailView in its safe error state without crashing
    // the render (the dispatcher's job is to MOUNT the view; we only
    // need to observe that the detail GET fired).
    mock.onGet('/v1/me/requests/req-42').reply(500, { error: { code: 'X', message: 'X' } });

    renderHome();

    await waitFor(() => expect(screen.getByText(notif.body)).toBeInTheDocument());
    fireEvent.click(screen.getByText(notif.body));

    await waitFor(
      () => {
        expect(mock.history.get.some((r) => r.url === '/v1/me/requests/req-42')).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it('BOOKING notification → fetches booking detail', async () => {
    const notif = {
      id: 'n-bk',
      type: 'BOOKING_CREATED' as const,
      title: 'Booking confirmed',
      body: 'Your job is booked.',
      resourceType: 'BOOKING' as const,
      resourceId: 'bk-7',
      deepLink: null,
      metadata: null,
      readAt: null,
      createdAt: '2026-04-29T10:00:00.000Z',
    };
    mock.onGet('/v1/me/notifications').reply(200, { items: [notif], nextCursor: null });
    mock.onGet('/v1/me/bookings/bk-7').reply(500, { error: { code: 'X', message: 'X' } });
    mock.onGet('/v1/me/bookings/bk-7/timeline').reply(200, { items: [] });

    renderHome();

    await waitFor(() => expect(screen.getByText('Your job is booked.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Your job is booked.'));

    await waitFor(
      () => {
        expect(mock.history.get.some((r) => r.url === '/v1/me/bookings/bk-7')).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it('CONVERSATION notification → opens chat for the conversation (regression: previously matched on bookingId)', async () => {
    const conv = {
      id: 'conv-9',
      bookingId: 'bk-other',
      requestId: null,
      otherParticipant: { displayName: 'Sara', initials: 'S', avatarUrl: null },
      lastMessageBody: null,
      lastMessageAt: null,
      unreadCount: 0,
      createdAt: '2026-04-29T09:00:00.000Z',
      updatedAt: '2026-04-29T09:00:00.000Z',
    };
    const notif = {
      id: 'n-conv',
      type: 'MESSAGE_RECEIVED' as const,
      title: 'New message',
      body: 'Sara sent you a message.',
      resourceType: 'CONVERSATION' as const,
      resourceId: 'conv-9',
      deepLink: null,
      metadata: null,
      readAt: null,
      createdAt: '2026-04-29T10:00:00.000Z',
    };
    mock.onGet('/v1/me/conversations').reply(200, { items: [conv], nextCursor: null });
    mock.onGet('/v1/me/notifications').reply(200, { items: [notif], nextCursor: null });
    mock.onGet('/v1/me/conversations/conv-9/messages').reply(200, { items: [], nextCursor: null });

    renderHome();

    await waitFor(() => expect(screen.getByText('Sara sent you a message.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Sara sent you a message.'));

    // ChatScreen mounts and immediately fetches messages for the
    // notification's resourceId — the regression was that the dispatcher
    // looked up conversation by `bookingId`, never matched (bookingId is
    // 'bk-other'), and silently no-op'd.
    await waitFor(
      () => {
        expect(mock.history.get.some((r) => r.url === '/v1/me/conversations/conv-9/messages')).toBe(
          true,
        );
      },
      { timeout: 2000 },
    );
  });

  it('BID notification with metadata.requestId → fetches that request detail (not an arbitrary pending lead)', async () => {
    // Backend emits BID_RECEIVED with resourceId = bidId. The parent
    // request id is carried in metadata so the dispatcher can open
    // the correct surface without a separate /bids fetch. The
    // pre-fix dispatcher fell back to "first pending lead" which
    // could route to a different request entirely.
    const notif = {
      id: 'n-bid-2',
      type: 'BID_RECEIVED' as const,
      title: 'New bid',
      body: 'You have a new bid.',
      resourceType: 'BID' as const,
      resourceId: 'bid-abc',
      deepLink: null,
      metadata: { requestId: 'req-99' },
      readAt: null,
      createdAt: '2026-04-29T10:00:00.000Z',
    };
    // No matching lead row in the cache — dispatcher should still
    // open the request detail by id so the tap never silently does
    // nothing.
    mock.onGet('/v1/me/notifications').reply(200, { items: [notif], nextCursor: null });
    mock.onGet('/v1/me/requests/req-99').reply(500, { error: { code: 'X', message: 'X' } });

    renderHome();

    await waitFor(() => expect(screen.getByText('You have a new bid.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('You have a new bid.'));

    await waitFor(
      () => {
        expect(mock.history.get.some((r) => r.url === '/v1/me/requests/req-99')).toBe(true);
      },
      { timeout: 2000 },
    );
  });
});
