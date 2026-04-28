import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { EcosystemProvider } from '../../context/EcosystemContext';
import { JobDetailView, type JobDetailSource } from './JobDetailView';

// ─────────────────────────────────────────────────────────────────────────────
// Slice 2.4 contract: JobDetailView fetches request OR booking detail + the
// matching timeline via React Query hooks. It never receives a synthesized
// JobData blob with fake provider rating / review counts / tags. Provider
// info is only rendered when the BookingDetail surface actually returns it.
// ─────────────────────────────────────────────────────────────────────────────

function renderDetail(source: JobDetailSource) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <EcosystemProvider>
          <JobDetailView source={source} isVisible onBack={() => {}} onOpenChat={() => {}} />
        </EcosystemProvider>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

const REQUEST_DETAIL = {
  id: 'req-1',
  status: 'OPEN_FOR_BIDS' as const,
  category: { id: 'cat-1', slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
  customServiceText: null,
  description: 'Leaky tap under the kitchen sink',
  scheduleType: 'ASAP' as const,
  scheduledAt: null,
  addressSnapshot: {
    label: 'Home',
    line1: '123 Main',
    city: 'Riyadh',
    country: 'SA',
    lat: null,
    lng: null,
  },
  bidsCount: 0,
  createdAt: '2026-04-28T08:00:00.000Z',
  updatedAt: '2026-04-28T08:00:00.000Z',
};

const BOOKING_DETAIL = {
  id: 'bk-1',
  requestId: 'req-1',
  bidId: 'bid-1',
  status: 'SCHEDULED' as const,
  scheduledAt: '2026-04-29T15:00:00.000Z',
  priceAmount: 35,
  currency: 'USD',
  pricingType: 'HOURLY' as const,
  createdAt: '2026-04-28T09:00:00.000Z',
  updatedAt: '2026-04-28T09:00:00.000Z',
  description: 'Leaky tap under the kitchen sink',
  bidNote: 'I can be there in 30 minutes.',
  service: {
    categorySlug: 'plumbing',
    categoryLabelEn: 'Plumbing',
    categoryLabelAr: 'سباكة',
    customServiceText: null,
  },
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
  addressSnapshot: {
    label: 'Home',
    line1: '123 Main',
    city: 'Riyadh',
    country: 'SA',
    lat: null,
    lng: null,
  },
};

const REQUEST_TIMELINE = {
  items: [
    {
      id: 'evt-1',
      type: 'REQUEST_CREATED',
      metadata: null,
      createdAt: '2026-04-28T08:00:00.000Z',
    },
  ],
};

const BOOKING_TIMELINE = {
  items: [
    {
      id: 'bevt-1',
      type: 'BOOKING_CREATED',
      metadata: { requestId: 'req-1', bidId: 'bid-1', providerId: 'pp-omar' },
      createdAt: '2026-04-28T09:00:00.000Z',
    },
  ],
};

describe('JobDetailView — request source', () => {
  it('fetches /v1/me/requests/:id + timeline and renders real fields', async () => {
    mock.onGet('/v1/me/requests/req-1').reply(200, REQUEST_DETAIL);
    mock.onGet('/v1/me/requests/req-1/timeline').reply(200, REQUEST_TIMELINE);

    renderDetail({ kind: 'request', id: 'req-1' });

    await waitFor(() => {
      // The service label appears in the header AND the Job Details row.
      expect(screen.getAllByText('Plumbing').length).toBeGreaterThan(0);
    });

    // Status pill reflects the OPEN_FOR_BIDS → 'pending' mapping.
    expect(screen.getByText(/Awaiting Bids/i)).toBeInTheDocument();

    // Address renders from the addressSnapshot, not a placeholder.
    expect(screen.getByText(/123 Main, Riyadh/)).toBeInTheDocument();

    // Description renders from API.
    expect(screen.getByText(/Leaky tap under the kitchen sink/)).toBeInTheDocument();

    // No Pro card — there's no provider on a pending request.
    expect(screen.queryByText(/Assigned Professional/i)).toBeNull();
    expect(screen.queryByText(/Verified & Licensed/i)).toBeNull();

    // No fake rating / review fallback ("4.8 · 156 reviews" was the
    // slice-2 placeholder).
    expect(screen.queryByText(/4\.8 · 156/)).toBeNull();
    expect(screen.queryByText(/156 reviews/)).toBeNull();
  });

  it('shows Cancel Request button on a pending request and calls the API on click', async () => {
    mock.onGet('/v1/me/requests/req-1').reply(200, REQUEST_DETAIL);
    mock.onGet('/v1/me/requests/req-1/timeline').reply(200, REQUEST_TIMELINE);
    let cancelCalled = false;
    mock.onPost('/v1/me/requests/req-1/cancel').reply(() => {
      cancelCalled = true;
      return [200, { ...REQUEST_DETAIL, status: 'CANCELLED' }];
    });

    renderDetail({ kind: 'request', id: 'req-1' });

    const cancelBtn = await screen.findByRole('button', { name: /cancel request/i });
    fireEvent.click(cancelBtn);
    await waitFor(() => expect(cancelCalled).toBe(true));
  });

  it('does NOT show Cancel Request on a CANCELLED request', async () => {
    mock
      .onGet('/v1/me/requests/req-2')
      .reply(200, { ...REQUEST_DETAIL, id: 'req-2', status: 'CANCELLED' });
    mock.onGet('/v1/me/requests/req-2/timeline').reply(200, REQUEST_TIMELINE);

    renderDetail({ kind: 'request', id: 'req-2' });

    await waitFor(() => expect(screen.getByText(/Cancelled/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /cancel request/i })).toBeNull();
  });
});

describe('JobDetailView — booking source', () => {
  it('fetches /v1/me/bookings/:id + timeline and renders real provider data', async () => {
    mock.onGet('/v1/me/bookings/bk-1').reply(200, BOOKING_DETAIL);
    mock.onGet('/v1/me/bookings/bk-1/timeline').reply(200, BOOKING_TIMELINE);

    renderDetail({ kind: 'booking', id: 'bk-1' });

    await waitFor(() => {
      expect(screen.getAllByText('Plumbing').length).toBeGreaterThan(0);
    });

    // Pro card renders with API provider name + initials + real rating.
    expect(screen.getByText(/Assigned Professional/i)).toBeInTheDocument();
    expect(screen.getByText('Omar Al-Khalid')).toBeInTheDocument();
    expect(screen.getByText(/4\.9 · 312/)).toBeInTheDocument();

    // Verified badge renders because provider.verified === true.
    expect(screen.getByText(/Verified & Licensed/i)).toBeInTheDocument();

    // Status reflects SCHEDULED → 'active' mapping. The label appears in
    // the status pill AND in the timeline step list ("In Progress" step).
    expect(screen.getAllByText(/In Progress/i).length).toBeGreaterThan(0);
  });

  it('renders only Verified / Top Pro pills — no fake Licensed/Insured fallback', async () => {
    mock.onGet('/v1/me/bookings/bk-1').reply(200, BOOKING_DETAIL);
    mock.onGet('/v1/me/bookings/bk-1/timeline').reply(200, BOOKING_TIMELINE);

    renderDetail({ kind: 'booking', id: 'bk-1' });

    await waitFor(() => expect(screen.getByText('Omar Al-Khalid')).toBeInTheDocument());

    // Both flags are true on the mock, so both pills render.
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Top Pro')).toBeInTheDocument();

    // The slice-2 fake fallback was ['Licensed', 'Insured', 'Top Rated'].
    // None of those should appear.
    expect(screen.queryByText('Licensed')).toBeNull();
    expect(screen.queryByText('Insured')).toBeNull();
    expect(screen.queryByText('Top Rated')).toBeNull();
  });

  it('Chat / Call / Track buttons render but are disabled (no fake actions)', async () => {
    mock.onGet('/v1/me/bookings/bk-1').reply(200, BOOKING_DETAIL);
    mock.onGet('/v1/me/bookings/bk-1/timeline').reply(200, BOOKING_TIMELINE);

    renderDetail({ kind: 'booking', id: 'bk-1' });

    await waitFor(() => expect(screen.getByText('Omar Al-Khalid')).toBeInTheDocument());

    const message = screen.getByRole('button', { name: /Message/ });
    const call = screen.getByRole('button', { name: /Call/ });
    const track = screen.getByRole('button', { name: /Track/ });
    expect(message).toBeDisabled();
    expect(call).toBeDisabled();
    expect(track).toBeDisabled();
    // The "coming soon" hint is rendered.
    expect(screen.getByText(/Messaging, calls, and tracking are coming soon/i)).toBeInTheDocument();
  });

  it('renders timeline timestamps from real events (no hardcoded 9:00 AM placeholder)', async () => {
    mock.onGet('/v1/me/bookings/bk-1').reply(200, BOOKING_DETAIL);
    mock.onGet('/v1/me/bookings/bk-1/timeline').reply(200, BOOKING_TIMELINE);

    renderDetail({ kind: 'booking', id: 'bk-1' });

    await waitFor(() => expect(screen.getByText('Omar Al-Khalid')).toBeInTheDocument());
    // Slice-2 had hardcoded '9:00 AM' / '9:15 AM' / '9:32 AM' / '3:00 PM' /
    // '5:10 PM' timestamps inside the timeline. Those exact strings should
    // not appear because we now derive timestamps from real events. The
    // BOOKING_CREATED event time formats to a non-9:00 string locally.
    // (We don't pin the formatted string because Intl is locale-dependent;
    // we just assert the exact slice-2 placeholders are gone.)
    expect(screen.queryByText('9:00 AM')).toBeNull();
    expect(screen.queryByText('9:15 AM')).toBeNull();
    expect(screen.queryByText('9:32 AM')).toBeNull();
    expect(screen.queryByText('3:00 PM')).toBeNull();
    expect(screen.queryByText('5:10 PM')).toBeNull();
  });
});

describe('JobDetailView — loading + error states', () => {
  it('renders the loading state while the detail is in flight', async () => {
    let resolve: (v: [number, unknown]) => void = () => {};
    const pending = new Promise<[number, unknown]>((r) => {
      resolve = r;
    });
    mock.onGet('/v1/me/requests/req-1').reply(() => pending);
    mock.onGet('/v1/me/requests/req-1/timeline').reply(() => pending);

    renderDetail({ kind: 'request', id: 'req-1' });

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Loading details/i)).toBeInTheDocument();
    resolve([200, REQUEST_DETAIL]);
  });

  it('renders a safe error message on 500 (no Prisma leak in DOM)', async () => {
    mock.onGet('/v1/me/requests/req-1').reply(500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'PrismaClientKnownRequestError: column requests.foo does not exist',
      },
    });
    mock.onGet('/v1/me/requests/req-1/timeline').reply(500, {});

    renderDetail({ kind: 'request', id: 'req-1' });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/couldn't load the details/i)).toBeInTheDocument();
    // Raw backend message must never reach the DOM.
    expect(screen.queryByText(/PrismaClient/i)).toBeNull();
    expect(screen.queryByText(/column requests/i)).toBeNull();
  });
});
