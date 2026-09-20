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
import { WORKSPACE_COPY, WORKSPACE_STATES } from '../workspace/copy';

const path = '/v1/admin/dispute-workspaces';
const key = 'hsm.dispute-queue-view.v1';
const fixture: DisputeAdminQueue = {
  counts: { all: 37, unassigned: 12, overdue: 4, appeals: 3 },
  items: [
    {
      disputeId: 'case/one',
      reference: 'DSP-CASE-001',
      state: 'GATHERING',
      revision: 1,
      priority: 'MEDIUM',
      assignedToYou: false,
      unassigned: true,
      dueAt: '2026-09-21T10:00:00Z',
      overdue: false,
      createdAt: '2026-09-20T10:00:00Z',
    },
  ],
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
function setup() {
  return render(
    <MemoryRouter initialEntries={['/admin/disputes']}>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <AdminRouteContent route={resolveAdminRoute('/admin/disputes')} />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
describe('Sprint 12 Admin dispute route', () => {
  it('renders server aggregates, links a safe dossier route and keeps legacy queries opt-in', async () => {
    mock.onGet(path).reply(200, fixture);
    setup();
    await screen.findByText('DSP-CASE-001');
    const inbox = within(screen.getByTestId('admin-dispute-inbox'));
    expect(inbox.getByText('37')).toBeInTheDocument();
    expect(inbox.getByText('12')).toBeInTheDocument();
    expect(inbox.getByRole('link', { name: WORKSPACE_COPY.en.open })).toHaveAttribute(
      'href',
      '/admin/disputes/case%2Fone',
    );
    expect(inbox.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
    expect(mock.history.get.every((r) => r.url === path)).toBe(true);
  });
  it('submits the selected server state and assignment filter and saves only nonprivate view settings', async () => {
    mock.onGet(path).reply(200, fixture);
    setup();
    await screen.findByText('DSP-CASE-001');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'APPEALED' } });
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() =>
      expect(mock.history.get.at(-1)?.params).toMatchObject({ state: 'APPEALED', mine: 'true' }),
    );
    fireEvent.click(screen.getByRole('button', { name: WORKSPACE_COPY.en.saveView }));
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ state: 'APPEALED', mine: true });
    expect(localStorage.getItem(key)).not.toContain('DSP-CASE-001');
  });
  it('renders the verified empty result without issuing a legacy API call', async () => {
    mock
      .onGet(path)
      .reply(200, {
        ...fixture,
        items: [],
        counts: { all: 0, unassigned: 0, overdue: 0, appeals: 0 },
      });
    setup();
    await screen.findByText(WORKSPACE_COPY.en.empty);
    expect(screen.getAllByText('0')).toHaveLength(4);
    expect(mock.history.get).toHaveLength(1);
  });
  it.each([403, 500])(
    'removes stale rows and totals after a %i response instead of presenting an empty successful queue',
    async (status) => {
      mock.onGet(path).reply(200, fixture);
      setup();
      await screen.findByText('DSP-CASE-001');
      mock.onGet(path).reply(status, { message: 'Internal PrismaClient secret must not render' });
      fireEvent.click(screen.getByRole('button', { name: WORKSPACE_COPY.en.refreshQueue }));
      await screen.findByRole('alert');
      expect(screen.queryByText('DSP-CASE-001')).not.toBeInTheDocument();
      expect(screen.queryByText('37')).not.toBeInTheDocument();
      expect(screen.queryByText(WORKSPACE_COPY.en.empty)).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain('PrismaClient');
      mock.onGet(path).reply(200, fixture);
      fireEvent.click(screen.getByRole('button', { name: WORKSPACE_COPY.en.retry }));
      await screen.findByText('DSP-CASE-001');
    },
  );
  it('uses Arabic labels and RTL at the real route', async () => {
    localStorage.setItem('hsm.lang', 'ar');
    mock.onGet(path).reply(200, fixture);
    setup();
    await screen.findByText('DSP-CASE-001');
    expect(screen.getByTestId('admin-dispute-inbox')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(WORKSPACE_COPY.ar.queue);
    expect(screen.getByText(WORKSPACE_STATES.ar.GATHERING, { selector: 'span' })).toBeInTheDocument();
  });
  it('does not adopt an invalid persisted server filter', async () => {
    localStorage.setItem(key, JSON.stringify({ state: 'untrusted-state', mine: 'true' }));
    mock.onGet(path).reply(200, fixture);
    setup();
    await screen.findByText('DSP-CASE-001');
    expect(mock.history.get[0].params).toMatchObject({ state: undefined, mine: undefined });
    expect(screen.getByRole('combobox')).toHaveValue('');
  });
});
