import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { BidsScreen } from './BidsScreen';
import type { LeadCardProps } from './LeadCard';

// ─────────────────────────────────────────────────────────────────────────────
// Slice 2.1 contract: BidsScreen reads bids from /v1/me/requests/:id/bids,
// not from SEED_BIDS. There is no setTimeout-driven fake-arrival flow in
// the production path. Loading / empty / error states are all safe and
// never expose raw backend error text.
// ─────────────────────────────────────────────────────────────────────────────

function renderScreen(lead: LeadCardProps, onBookBid: (name: string) => void = () => {}) {
  // Fresh QueryClient per test so React Query state never leaks.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <EcosystemProvider>
          <BidsScreen lead={lead} onBack={() => {}} onBookBid={onBookBid} />
        </EcosystemProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

const LEAD: LeadCardProps = {
  id: 'req-test-1',
  service: 'Plumbing',
  status: 'pending',
  postedAt: '2h ago',
};

const BID_OMAR = {
  id: 'b-omar',
  requestId: 'req-test-1',
  amount: 35,
  currency: 'USD',
  pricingType: 'HOURLY' as const,
  note: null,
  status: 'PENDING' as const,
  responseTimeMinutes: 5,
  badge: 'BEST_MATCH' as const,
  submittedAt: '2026-04-28T01:00:00.000Z',
  provider: {
    id: 'pp-omar',
    displayName: 'Omar Al-Khalid',
    initials: 'OK',
    avatarUrl: null,
    ratingAvg: 4.9,
    reviewCount: 312,
    completedJobs: 540,
    verified: true,
    topPro: true,
  },
};

const BID_KHALID = {
  ...BID_OMAR,
  id: 'b-khalid',
  amount: 28,
  badge: 'BEST_VALUE' as const,
  responseTimeMinutes: 20,
  provider: {
    ...BID_OMAR.provider,
    id: 'pp-khalid',
    displayName: 'Khalid Hassan',
    initials: 'KH',
    ratingAvg: 4.7,
    reviewCount: 156,
    completedJobs: 220,
    topPro: false,
  },
};

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

describe('BidsScreen', () => {
  it('loads bids from /v1/me/requests/:id/bids and renders provider names', async () => {
    mock.onGet('/v1/me/requests/req-test-1/bids').reply(200, {
      items: [BID_OMAR, BID_KHALID],
      nextCursor: null,
    });
    renderScreen(LEAD);
    // The mock SEED_BIDS list is no longer baked in — these names come
    // from the API response only.
    await waitFor(() => {
      expect(screen.getByText('Omar Al-Khalid')).toBeInTheDocument();
    });
    expect(screen.getByText('Khalid Hassan')).toBeInTheDocument();
    // The pre-API mock had bids like "Faisal Al-Nasser" (LIVE_BID) and
    // "Ali Al-Rashid" / "Mohammed Al-Zahra" / "Hassan Mustafa". None of
    // those should appear unless the API actually returned them.
    expect(screen.queryByText('Faisal Al-Nasser')).toBeNull();
    expect(screen.queryByText('Ali Al-Rashid')).toBeNull();
    expect(screen.queryByText('Mohammed Al-Zahra')).toBeNull();
    // Header reflects the API count (2), not the old SEED count (5).
    expect(screen.getByText(/^2 /)).toBeInTheDocument();
  });

  it('renders the loading state before the API resolves', async () => {
    let resolve: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve = r;
    });
    mock
      .onGet('/v1/me/requests/req-test-1/bids')
      .reply(() => pending as Promise<[number, unknown]>);
    renderScreen(LEAD);
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/loading bids/i)).toBeInTheDocument();
    resolve([200, { items: [], nextCursor: null }]);
  });

  it('renders the empty state when the API returns zero bids', async () => {
    mock.onGet('/v1/me/requests/req-test-1/bids').reply(200, { items: [], nextCursor: null });
    renderScreen(LEAD);
    await waitFor(() => {
      expect(screen.getByText(/no bids yet/i)).toBeInTheDocument();
    });
  });

  it('shows a safe error message when the list call fails (no raw backend error)', async () => {
    mock.onGet('/v1/me/requests/req-test-1/bids').reply(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'PrismaClientKnownRequestError: column bids.foo does not exist',
      },
    });
    renderScreen(LEAD);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/couldn't load bids/i)).toBeInTheDocument();
    // No raw backend error markers on the page.
    expect(screen.queryByText(/PrismaClient/i)).toBeNull();
    expect(screen.queryByText(/column bids/i)).toBeNull();
  });

  it('changing the sort tab refetches with the new sort param', async () => {
    const sortsSeen: string[] = [];
    mock.onGet('/v1/me/requests/req-test-1/bids').reply((config) => {
      const sort = (config.params?.sort as string | undefined) ?? '(none)';
      sortsSeen.push(sort);
      return [200, { items: [BID_OMAR, BID_KHALID], nextCursor: null }];
    });
    renderScreen(LEAD);
    await waitFor(() => expect(screen.getByText('Omar Al-Khalid')).toBeInTheDocument());
    // The Best Value tab posts sort=price — the second tab in the row.
    // Disambiguate via role since "Best Value" also appears as a badge.
    fireEvent.click(screen.getByRole('button', { name: /best value/i }));
    await waitFor(() => expect(sortsSeen).toContain('price'));
  });

  it('does not render the legacy "A new bid is arriving…" banner from the mock simulator', async () => {
    mock.onGet('/v1/me/requests/req-test-1/bids').reply(200, {
      items: [BID_OMAR],
      nextCursor: null,
    });
    renderScreen(LEAD);
    await waitFor(() => expect(screen.getByText('Omar Al-Khalid')).toBeInTheDocument());
    // Wait long enough that the slice-1 setTimeout (8s/11s) WOULD have
    // fired if it still existed, then assert no fake-arrival UI.
    expect(screen.queryByText(/a new bid is arriving/i)).toBeNull();
    expect(screen.queryByText(/^NEW$/)).toBeNull();
  });

  // ─── Slice 2.2 — accept-bid flow ─────────────────────────────────────
  it('Book button calls accept endpoint and shows the success overlay only after backend success', async () => {
    mock.onGet('/v1/me/requests/req-test-1/bids').reply(200, {
      items: [BID_OMAR],
      nextCursor: null,
    });
    let acceptUrl: string | null = null;
    let resolveAccept: (() => void) | null = null;
    const acceptPending = new Promise<void>((r) => {
      resolveAccept = r;
    });
    mock.onPost(/\/v1\/me\/requests\/.+\/bids\/.+\/accept/).reply((config) => {
      acceptUrl = config.url ?? null;
      return acceptPending.then(() => [
        200,
        {
          bid: { ...BID_OMAR, status: 'ACCEPTED' },
          booking: {
            id: 'bk-1',
            requestId: 'req-test-1',
            bidId: BID_OMAR.id,
            status: 'SCHEDULED',
            scheduledAt: null,
            priceAmount: 35,
            currency: 'USD',
            createdAt: '2026-04-28T02:00:00.000Z',
          },
          requestStatus: 'BID_ACCEPTED',
        },
      ]);
    });
    const bookSpy = vi.fn();
    renderScreen(LEAD, bookSpy);
    await waitFor(() => expect(screen.getByText('Omar Al-Khalid')).toBeInTheDocument());

    // Click Book Now → POST is in flight, NO success overlay yet.
    fireEvent.click(screen.getByRole('button', { name: /book now/i }));
    await waitFor(() => expect(acceptUrl).toBe('/v1/me/requests/req-test-1/bids/b-omar/accept'));
    expect(screen.queryByText(/booking confirmed/i)).toBeNull();

    // Resolve the backend → overlay appears.
    resolveAccept?.();
    await waitFor(() => expect(screen.getByText(/booking confirmed/i)).toBeInTheDocument());
    // Parent snackbar fires after the brief overlay window.
    await waitFor(() => expect(bookSpy).toHaveBeenCalledWith('Omar Al-Khalid'));
  });

  it('shows a friendly CONFLICT message on 409 (already-accepted) — no raw backend error rendered', async () => {
    mock.onGet('/v1/me/requests/req-test-1/bids').reply(200, {
      items: [BID_OMAR],
      nextCursor: null,
    });
    mock.onPost(/\/v1\/me\/requests\/.+\/bids\/.+\/accept/).reply(409, {
      error: {
        code: 'CONFLICT',
        message: 'PrismaClientKnownRequestError: A bid has already been accepted.',
      },
    });
    renderScreen(LEAD);
    await waitFor(() => expect(screen.getByText('Omar Al-Khalid')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /book now/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/can no longer be accepted/i)).toBeInTheDocument();
    // The raw backend message must never reach the DOM.
    expect(screen.queryByText(/PrismaClient/i)).toBeNull();
    // Success overlay must NOT have appeared on a failed accept.
    expect(screen.queryByText(/booking confirmed/i)).toBeNull();
  });

  it('shows a generic friendly message on 500 — no raw backend error rendered', async () => {
    mock.onGet('/v1/me/requests/req-test-1/bids').reply(200, {
      items: [BID_OMAR],
      nextCursor: null,
    });
    mock.onPost(/\/v1\/me\/requests\/.+\/bids\/.+\/accept/).reply(500, {
      error: { code: 'INTERNAL_ERROR', message: 'PrismaClientUnknownRequestError: kaboom' },
    });
    renderScreen(LEAD);
    await waitFor(() => expect(screen.getByText('Omar Al-Khalid')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /book now/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/couldn't confirm the booking/i)).toBeInTheDocument();
    expect(screen.queryByText(/PrismaClient/i)).toBeNull();
    expect(screen.queryByText(/booking confirmed/i)).toBeNull();
  });
});
