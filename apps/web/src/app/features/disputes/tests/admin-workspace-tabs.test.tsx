import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import type { DisputeWorkspaceView } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { AdminRouteContent } from '../../../components/admin/AdminRouteContent';
import { resolveAdminRoute } from '../../../components/admin/admin-routes';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { WorkspacePanel } from '../workspace/WorkspacePanel';
import { WORKSPACE_COPY } from '../workspace/copy';
import {
  DISPUTE_WORKSPACE_TASK_IDS,
  disputeTaskSearch,
  selectedDisputeTask,
} from '../workspace/dispute-task-navigation';

// Sprint 12D — the Admin dispute workspace is six real tabs, not a long page
// with anchor links.
//
// These are presentation tests against deterministic HTTP fixtures. They prove
// the layout, the URL contract and that browsing sends no command; they are NOT
// evidence that a real backend accepted anything.

const CASE_ID = 'synthetic-case-1';
const adminPath = `/v1/admin/dispute-workspaces/${CASE_ID}`;

const view: DisputeWorkspaceView = {
  disputeId: CASE_ID,
  reference: 'DSP-TABS-001',
  state: 'DECIDED',
  revision: 4,
  role: 'REVIEWER',
  assignedToYou: true,
  assignedReviewer: { id: 'synthetic-reviewer', label: 'Reviewer One' },
  reviewers: [{ id: 'synthetic-reviewer', label: 'Reviewer One' }],
  participants: [
    { role: 'SEEKER', label: 'Synthetic Customer' },
    { role: 'PROVIDER', label: 'Synthetic Provider' },
  ],
  // Deliberately empty: a reviewer who only browses must be offered nothing.
  availableActions: [],
  canUploadEvidence: false,
  policy: { version: 'test-v1', appealWindowHours: 24, resolutionDueAt: '2026-09-21T00:00:00Z' },
  facts: [
    {
      id: 'bk-1',
      source: 'BOOKING',
      label: 'BOOKING_STATUS',
      value: 'COMPLETED',
      recordedAt: '2026-09-19T09:00:00Z',
    },
  ],
  events: [
    {
      id: 'ev-1',
      kind: 'OPENED',
      reasonCode: 'PARTICIPANT_INTAKE',
      actorRole: 'SEEKER',
      revision: 1,
      occurredAt: '2026-09-19T09:05:00Z',
    },
  ],
  eventsTruncated: false,
  requests: [
    {
      id: 'rq-1',
      question: 'Please confirm the visit date.',
      status: 'OPEN',
      dueAt: '2026-09-22T00:00:00Z',
      yours: false,
    },
  ],
  statements: [],
  evidence: [],
  proposals: [],
  decisions: [
    {
      id: 'dec-1',
      rationale: 'Recorded decision rationale.',
      reasonCode: 'EVIDENCE_SUFFICIENT',
      policyVersion: 'test-v1',
      supersedesId: null,
      appealUntil: '2026-09-25T00:00:00Z',
      basisEventIds: ['ev-1'],
      evidenceIds: [],
      createdAt: '2026-09-20T09:00:00Z',
    },
  ],
  appeals: [
    {
      id: 'ap-1',
      status: 'OPEN',
      grounds: 'The recorded visit date is wrong.',
      createdAt: '2026-09-20T10:00:00Z',
    },
  ],
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

/** Renders the REAL admin route, not the component in isolation. */
function setupAdmin(entry = `/admin/disputes/${CASE_ID}`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <AdminRouteContent route={resolveAdminRoute(`/admin/disputes/${CASE_ID}`)} />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function ready() {
  await screen.findByTestId('case-task-tabs');
}

/**
 * Radix selects a tab on focus/mousedown, not on a bare synthetic click — the
 * same helper the provider review tab suite uses.
 */
async function selectTab(task: string) {
  fireEvent.mouseDown(screen.getByTestId(`case-tab-${task}`), { button: 0, ctrlKey: false });
  await waitFor(() =>
    expect(screen.getByTestId(`case-tab-${task}`)).toHaveAttribute('aria-selected', 'true'),
  );
}

describe('Sprint 12D — Admin dispute workspace tabs', () => {
  it('renders six real tabs with exactly one visible panel and the versioned layout marker', async () => {
    mock.onGet(adminPath).reply(200, view);
    setupAdmin();
    await ready();

    const tabs = screen.getByTestId('case-task-tabs');
    expect(tabs).toHaveAttribute('data-dispute-workspace-layout', 'tabbed-v1');
    expect(within(tabs).getAllByRole('tab')).toHaveLength(6);
    // The defining property of a tab set: one panel, not six stacked sections.
    expect(within(tabs).getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByTestId('case-panel-overview')).toBeVisible();
    expect(screen.getByTestId('case-panel-history')).not.toBeVisible();
    // The replaced anchor row must be gone from the Admin surface.
    expect(tabs.querySelector('a[href^="#case-"]')).toBeNull();
  });

  it('keeps inactive panels mounted so unsent state and open disclosures survive a tab change', async () => {
    mock.onGet(adminPath).reply(200, view);
    setupAdmin();
    await ready();

    // The overview panel's content exists in the DOM while the history tab is
    // selected — mounted but hidden, which is what preserves unsent edits.
    await selectTab('history');
    const overview = screen.getByTestId('case-panel-overview');
    expect(overview).toBeInTheDocument();
    expect(overview).not.toBeVisible();
    expect(within(overview).getByText('COMPLETED')).toBeInTheDocument();
    // Hidden panels leave sequential focus order.
    expect(overview).toHaveAttribute('tabindex', '-1');
  });

  it('selects a tab from the URL and preserves unrelated queue parameters when switching', async () => {
    mock.onGet(adminPath).reply(200, view);
    setupAdmin(`/admin/disputes/${CASE_ID}?state=APPEALED&cursor=page2&caseTab=evidence`);
    await ready();

    expect(screen.getByTestId('case-tab-evidence')).toHaveAttribute('aria-selected', 'true');

    await selectTab('appeals');
    // The reviewer must still be able to return to the exact queue page.
    const search = disputeTaskSearch('?state=APPEALED&cursor=page2&caseTab=evidence', 'appeals');
    expect(new URLSearchParams(search).get('state')).toBe('APPEALED');
    expect(new URLSearchParams(search).get('cursor')).toBe('page2');
    expect(new URLSearchParams(search).get('caseTab')).toBe('appeals');
  });

  it('honours a legacy #case- anchor so old links and notifications still land correctly', async () => {
    mock.onGet(adminPath).reply(200, view);
    setupAdmin(`/admin/disputes/${CASE_ID}#case-solutions`);
    await ready();
    expect(screen.getByTestId('case-tab-solutions')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('case-panel-solutions')).toBeVisible();
  });

  it('moves between tabs with the keyboard alone', async () => {
    mock.onGet(adminPath).reply(200, view);
    setupAdmin();
    await ready();

    const first = screen.getByTestId('case-tab-overview');
    first.focus();
    expect(first).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(screen.getByTestId('case-tab-information')).toHaveAttribute('aria-selected', 'true'),
    );
    fireEvent.keyDown(screen.getByTestId('case-tab-information'), { key: 'End' });
    await waitFor(() =>
      expect(screen.getByTestId('case-tab-history')).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('walks sections with the previous/next controls', async () => {
    mock.onGet(adminPath).reply(200, view);
    setupAdmin();
    await ready();

    const next = screen.getByRole('button', { name: WORKSPACE_COPY.en.tabsNext });
    expect(screen.getByRole('button', { name: WORKSPACE_COPY.en.tabsPrevious })).toBeDisabled();
    fireEvent.click(next);
    await waitFor(() =>
      expect(screen.getByTestId('case-tab-information')).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('browsing every tab issues no mutation and offers no action the server did not allow', async () => {
    mock.onGet(adminPath).reply(200, view);
    setupAdmin();
    await ready();

    for (const task of DISPUTE_WORKSPACE_TASK_IDS) {
      await selectTab(task);
    }
    // `availableActions` is empty, so the decide-appeal control must not exist
    // even though an OPEN appeal is present.
    expect(screen.queryByRole('button', { name: /appeal/i })).not.toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
    expect(mock.history.patch).toHaveLength(0);
    expect(mock.history.put).toHaveLength(0);
    expect(mock.history.delete).toHaveLength(0);
  });

  it('renders Arabic labels and RTL tab direction at the real route', async () => {
    localStorage.setItem('hsm.lang', 'ar');
    mock.onGet(adminPath).reply(200, view);
    setupAdmin();
    await ready();

    expect(screen.getByTestId('case-task-tabs')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('case-tab-appeals')).toHaveAccessibleName(WORKSPACE_COPY.ar.appeals);
    expect(screen.getByTestId('case-tab-history')).toHaveAccessibleName(WORKSPACE_COPY.ar.history);
  });

  it('leaves the participant workspace as a stacked page, not tabs', async () => {
    mock.onGet(`/v1/me/disputes/${CASE_ID}/workspace`).reply(200, { ...view, role: 'SEEKER' });
    render(
      <MemoryRouter initialEntries={[`/disputes/${CASE_ID}`]}>
        <QueryClientProvider client={client}>
          <LanguageProvider>
            <WorkspacePanel caseId={CASE_ID} />
          </LanguageProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    // Wait for the loaded case, not merely the shell that renders while pending.
    await screen.findByText('DSP-TABS-001');
    expect(screen.queryByTestId('case-task-tabs')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    // Every section stays reachable on one page for the participant.
    expect(document.querySelector('#case-appeals')).not.toBeNull();
    expect(document.querySelector('#case-history')).not.toBeNull();
  });
});

describe('dispute tab URL parsing', () => {
  it('falls back to the first tab for missing or untrusted values', () => {
    expect(selectedDisputeTask('', '')).toBe('overview');
    expect(selectedDisputeTask('?caseTab=../../etc/passwd', '')).toBe('overview');
    expect(selectedDisputeTask('?caseTab=APPEALED', '')).toBe('overview');
  });

  it('prefers a legacy anchor over the query parameter', () => {
    expect(selectedDisputeTask('?caseTab=evidence', '#case-history')).toBe('history');
  });

  it('never drops an unrelated parameter', () => {
    const search = disputeTaskSearch('?state=OPEN&cursor=abc', 'evidence');
    const params = new URLSearchParams(search);
    expect(params.get('state')).toBe('OPEN');
    expect(params.get('cursor')).toBe('abc');
    expect(params.get('caseTab')).toBe('evidence');
  });
});
