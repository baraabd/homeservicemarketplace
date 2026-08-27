import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { AdminVerificationCaseWorkspace } from './AdminVerificationCaseWorkspace';
import { UI } from '../copy/verification-copy';

// Sprint 9B.12 — the workspace, which is where the separately-tested panels
// have to actually add up.
//
// The panels are proved on their own elsewhere. What only this level can prove
// is the WIRING: that opening a queue row fetches that case, that the view
// button on a document reaches the audited evidence route (it was inert until
// this sprint — the panel exposed `onView` and nothing passed it), and that a
// decision is followed by a refetch rather than a hopeful local patch.

const QUEUE_URL = '/v1/admin/verification/cases';

let mock: MockAdapter;

const queueItem = {
  id: 'c1',
  providerProfileId: 'pp-1',
  providerDisplayName: 'Pat Provider',
  state: 'SUBMITTED',
  policyVersion: '2026.08-v1',
  country: 'SY',
  submittedAt: '2026-06-15T00:00:00.000Z',
  assignedToUserId: null,
  documentCount: 1,
  availableActions: ['approve'],
  blockedReason: null,
};

const kase = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  providerProfileId: 'pp-1',
  state: 'SUBMITTED',
  policyVersion: '2026.08-v1',
  country: 'SY',
  providerType: 'INDIVIDUAL',
  submittedAt: '2026-06-15T00:00:00.000Z',
  assignedToUserId: null,
  assignedAt: null,
  decidedAt: null,
  requirements: [
    {
      kind: 'INDIVIDUAL_IDENTITY',
      serviceCategoryId: null,
      serviceCategoryLabelEn: null,
      serviceCategoryLabelAr: null,
      satisfied: true,
    },
  ],
  documents: [
    {
      id: 'doc-1',
      kind: 'INDIVIDUAL_IDENTITY',
      serviceCategoryId: null,
      serviceCategoryLabelEn: null,
      serviceCategoryLabelAr: null,
      sizeBytes: 1024,
      displayFilename: 'passport.jpg',
      scanState: 'CLEAN',
      viewable: true,
      uploadedAt: '2026-06-15T00:00:00.000Z',
      evidenceDeletedAt: null,
      supersededAt: null,
    },
  ],
  decisions: [],
  availableActions: ['approve'],
  blockedReason: null,
  workAccess: null,
  ...over,
});

function renderWorkspace() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <AdminVerificationCaseWorkspace />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/** Open the one queue row, and wait until the case behind it has rendered. */
async function openCase() {
  fireEvent.click(await screen.findByRole('button', { name: 'Pat Provider' }));
  await screen.findByTestId('case-policy-version');
}

beforeEach(() => {
  mock = new MockAdapter(api);
  window.localStorage.clear();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  mock.restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('opening a case from the queue', () => {
  it('fetches the case that was clicked and shows its policy version', async () => {
    // The policy version is on screen because a reviewer judges under the rules
    // in force at SUBMISSION, not today's.
    mock.onGet(QUEUE_URL).reply(200, { items: [queueItem], nextCursor: null });
    mock.onGet(`${QUEUE_URL}/c1`).reply(200, kase());
    mock.onGet(`${QUEUE_URL}/c1/audit`).reply(200, { items: [], nextCursor: null });
    renderWorkspace();

    await openCase();
    expect(screen.getByTestId('case-policy-version')).toHaveTextContent('2026.08-v1');
    expect(screen.getByTestId('case-actions')).toBeInTheDocument();
  });

  it('shows nothing but the queue until a case is opened', async () => {
    mock.onGet(QUEUE_URL).reply(200, { items: [queueItem], nextCursor: null });
    renderWorkspace();

    await screen.findByTestId('queue-row-c1');
    expect(screen.queryByTestId('admin-case-detail')).not.toBeInTheDocument();
  });

  it('distinguishes a permission failure on the case from a load failure', async () => {
    mock.onGet(QUEUE_URL).reply(200, { items: [queueItem], nextCursor: null });
    mock.onGet(`${QUEUE_URL}/c1`).reply(403, { success: false, error: { code: 'FORBIDDEN' } });
    renderWorkspace();

    fireEvent.click(await screen.findByRole('button', { name: 'Pat Provider' }));
    expect(await screen.findByTestId('case-error')).toHaveTextContent(UI.en.forbiddenBody);
  });
});

describe('opening a restricted document', () => {
  beforeEach(() => {
    mock.onGet(QUEUE_URL).reply(200, { items: [queueItem], nextCursor: null });
    mock.onGet(`${QUEUE_URL}/c1`).reply(200, kase());
    mock.onGet(`${QUEUE_URL}/c1/audit`).reply(200, { items: [], nextCursor: null });
  });

  it('reaches the audited evidence route', async () => {
    // The button was inert before this sprint: the panel exposed `onView` and
    // no caller passed it, so a reviewer clicked and nothing happened.
    let asked: string | undefined;
    mock.onGet(/verification\/documents/).reply((config) => {
      asked = config.url;
      return [200, 'bytes'];
    });
    renderWorkspace();
    await openCase();

    fireEvent.click(screen.getByRole('button', { name: `${UI.en.view}: Identity document` }));
    await waitFor(() => expect(asked).toBe('/v1/verification/documents/doc-1/content'));
  });

  it('says the failed attempt was recorded, without claiming to know why', async () => {
    // The server answers a denial and a missing document identically. Telling
    // the reviewer which one happened would be inventing information.
    mock.onGet(/verification\/documents/).reply(404);
    renderWorkspace();
    await openCase();

    fireEvent.click(screen.getByRole('button', { name: `${UI.en.view}: Identity document` }));
    expect(await screen.findByTestId('evidence-open-error')).toHaveTextContent(
      UI.en.evidenceOpenFailed,
    );
  });
});

describe('deciding a case', () => {
  it('posts the decision and re-reads the case rather than patching it locally', async () => {
    // A command can land somewhere the client did not predict — an approve
    // also opens a work-access grant. Refetching is how the reviewer sees
    // where the case actually went.
    let posted: Record<string, unknown> | null = null;
    let caseReads = 0;
    mock.onGet(QUEUE_URL).reply(200, { items: [queueItem], nextCursor: null });
    mock.onGet(`${QUEUE_URL}/c1`).reply(() => {
      caseReads += 1;
      return [200, caseReads === 1 ? kase() : kase({ state: 'VERIFIED', availableActions: [] })];
    });
    mock.onGet(`${QUEUE_URL}/c1/audit`).reply(200, { items: [], nextCursor: null });
    mock.onPost(`${QUEUE_URL}/c1/approve`).reply((config) => {
      posted = JSON.parse(config.data);
      return [200, { caseId: 'c1', state: 'VERIFIED', changed: true, availableActions: [] }];
    });
    renderWorkspace();
    await openCase();

    fireEvent.click(screen.getByTestId('case-action-approve'));
    fireEvent.change(screen.getByTestId('case-action-reason'), {
      target: { value: 'DOCUMENTS_COMPLETE_AND_LEGIBLE' },
    });
    fireEvent.click(screen.getByTestId('case-action-confirm'));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toEqual({
      reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE',
      expectedState: 'SUBMITTED',
    });
    await waitFor(() => expect(caseReads).toBeGreaterThan(1));
    expect(await screen.findByTestId('case-actions-none')).toBeInTheDocument();
  });

  it('surfaces a stale-state conflict with the actions still available', async () => {
    mock.onGet(QUEUE_URL).reply(200, { items: [queueItem], nextCursor: null });
    mock.onGet(`${QUEUE_URL}/c1`).reply(200, kase());
    mock.onGet(`${QUEUE_URL}/c1/audit`).reply(200, { items: [], nextCursor: null });
    mock.onPost(`${QUEUE_URL}/c1/approve`).reply(409, {
      success: false,
      error: { code: 'CONFLICT', message: 'stale' },
    });
    renderWorkspace();
    await openCase();

    fireEvent.click(screen.getByTestId('case-action-approve'));
    fireEvent.change(screen.getByTestId('case-action-reason'), {
      target: { value: 'DOCUMENTS_COMPLETE_AND_LEGIBLE' },
    });
    fireEvent.click(screen.getByTestId('case-action-confirm'));

    expect(await screen.findByTestId('case-actions-conflict')).toHaveTextContent(
      UI.en.conflictTitle,
    );
    expect(screen.getByTestId('case-action-approve')).toBeInTheDocument();
    expect(screen.queryByTestId('case-actions-forbidden')).not.toBeInTheDocument();
  });
});
