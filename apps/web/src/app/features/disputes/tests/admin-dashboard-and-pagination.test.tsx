import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import type { DisputeAdminQueue } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { AdminRouteContent } from '../../../components/admin/AdminRouteContent';
import { resolveAdminRoute } from '../../../components/admin/admin-routes';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { WORKSPACE_COPY } from '../workspace/copy';

// Sprint 12 closure — the dashboard's dispute half, and cursor pagination.
//
// PAGE SIZE IS 40, NOT 50.
//
// `workspace.service.ts` takes 41 rows and slices 40, ordering by
// `[resolutionDueAt asc, disputeId asc]`. These tests use the repository's real
// page size rather than a round number, and deliberately give every row on the
// first page the SAME `resolutionDueAt` so that an unstable sort — one without
// the `disputeId` tie-break — would show up as a duplicated or dropped row.

const path = '/v1/admin/dispute-workspaces';
const PAGE = 40;

function row(n: number, dueAt: string) {
  return {
    disputeId: `case-${String(n).padStart(3, '0')}`,
    reference: `DSP-${String(n).padStart(3, '0')}`,
    state: 'GATHERING' as const,
    revision: 1,
    priority: 'MEDIUM' as const,
    assignedToYou: false,
    unassigned: true,
    dueAt,
    overdue: false,
    createdAt: '2026-09-20T10:00:00Z',
  };
}

const counts = { all: 41, unassigned: 12, overdue: 4, appeals: 3 };
// Every first-page row shares one timestamp: the tie-break is what orders them.
const TIED = '2026-09-21T10:00:00Z';
const firstPage: DisputeAdminQueue = {
  counts,
  items: Array.from({ length: PAGE }, (_, i) => row(i + 1, TIED)),
  nextCursor: 'case-040',
};
const secondPage: DisputeAdminQueue = {
  counts,
  items: [row(41, '2026-09-22T10:00:00Z')],
  nextCursor: null,
};

let mock: MockAdapter;
let client: QueryClient;

beforeEach(() => {
  localStorage.clear();
  mock = new MockAdapter(api);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  mock.restore();
  localStorage.clear();
});

function setup(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <AdminRouteContent route={resolveAdminRoute(pathname)} />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Admin dashboard — dispute summary', () => {
  it('shows the four server counts and routes into the inbox', async () => {
    mock.onGet(path).reply(200, firstPage);
    mock.onGet(/.*/).reply(500);
    setup('/admin');

    const summary = await screen.findByTestId('admin-dispute-summary');
    // Wait for the server counts to arrive; the tile renders before they do.
    await waitFor(() =>
      expect(within(summary).getByTestId('dispute-count-all')).toHaveTextContent('41'),
    );
    expect(within(summary).getByTestId('dispute-count-unassigned')).toHaveTextContent('12');
    expect(within(summary).getByTestId('dispute-count-overdue')).toHaveTextContent('4');
    expect(within(summary).getByTestId('dispute-count-appeals')).toHaveTextContent('3');
    expect(
      within(summary).getByRole('link', { name: WORKSPACE_COPY.en.summaryOpenInbox }),
    ).toHaveAttribute('href', '/admin/disputes');
  });

  it('never shows a fabricated zero when the count request fails', async () => {
    mock.onGet(path).reply(500, { message: 'PrismaClient internal detail' });
    mock.onGet(/.*/).reply(500);
    setup('/admin');

    const summary = await screen.findByTestId('admin-dispute-summary');
    await waitFor(() =>
      expect(within(summary).getByTestId('dispute-count-all')).toHaveTextContent(
        WORKSPACE_COPY.en.countUnavailable,
      ),
    );
    // "unavailable" and "zero" must never look the same.
    expect(within(summary).getByTestId('dispute-count-overdue')).not.toHaveTextContent('0');
    expect(document.body.textContent).not.toContain('PrismaClient');
  });

  it('renders Arabic summary copy on the dashboard', async () => {
    localStorage.setItem('hsm.lang', 'ar');
    mock.onGet(path).reply(200, firstPage);
    mock.onGet(/.*/).reply(500);
    setup('/admin');

    const summary = await screen.findByTestId('admin-dispute-summary');
    expect(within(summary).getByText(WORKSPACE_COPY.ar.summaryOpenInbox)).toBeInTheDocument();
    expect(within(summary).getByText(WORKSPACE_COPY.ar.overdue)).toBeInTheDocument();
  });
});

describe('Admin dispute inbox — cursor pagination beyond the first page', () => {
  it('loads a second page with tied timestamps without duplicating or dropping a case', async () => {
    mock.onGet(path).reply((config) => [200, config.params?.cursor ? secondPage : firstPage]);
    setup('/admin/disputes');

    await screen.findByText('DSP-001');
    expect(screen.getAllByText(/^DSP-\d{3}$/)).toHaveLength(PAGE);
    expect(screen.queryByText('DSP-041')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: WORKSPACE_COPY.en.more }));
    await screen.findByText('DSP-041');

    const shown = screen.getAllByText(/^DSP-\d{3}$/).map((n) => n.textContent);
    // 41 distinct rows: nothing duplicated across the cursor boundary, nothing lost.
    expect(shown).toHaveLength(41);
    expect(new Set(shown).size).toBe(41);
    // The cursor the client sent is the last row of page one, not an offset.
    expect(mock.history.get.at(-1)?.params).toMatchObject({ cursor: 'case-040' });
  });

  it('changing the state filter restarts pagination instead of appending to a stale cursor', async () => {
    mock.onGet(path).reply((config) => [200, config.params?.cursor ? secondPage : firstPage]);
    setup('/admin/disputes');

    await screen.findByText('DSP-001');
    fireEvent.click(screen.getByRole('button', { name: WORKSPACE_COPY.en.more }));
    await screen.findByText('DSP-041');

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'APPEALED' } });
    await waitFor(() =>
      expect(mock.history.get.at(-1)?.params).toMatchObject({ state: 'APPEALED' }),
    );
    // A filter change must not carry the previous page's cursor.
    expect(mock.history.get.at(-1)?.params?.cursor).toBeUndefined();
  });
});
