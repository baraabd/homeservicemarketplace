import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { VerificationQueuePanel } from './VerificationQueuePanel';
import { WorkAccessPanel } from './WorkAccessPanel';
import { UI } from '../copy/verification-copy';

// Sprint 9B.12 — the queue and the work-access panel.
//
// The queue's job is to be TRUSTWORTHY: what comes back has to match what was
// asked for, or a reviewer working a backlog draws the wrong conclusion from an
// empty list. So the assertions are mostly about the request, not the render.

const QUEUE_URL = '/v1/admin/verification/cases';

let mock: MockAdapter;

const item = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  providerProfileId: 'pp-1',
  providerDisplayName: 'Pat Provider',
  state: 'SUBMITTED',
  policyVersion: 'v1',
  country: 'SY',
  submittedAt: '2026-06-15T00:00:00.000Z',
  assignedToUserId: null,
  documentCount: 2,
  availableActions: ['approve'],
  blockedReason: null,
  ...over,
});

function renderQueue(lang: 'en' | 'ar' = 'en', onOpenCase = vi.fn()) {
  window.localStorage.setItem('hsm.lang', lang);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <VerificationQueuePanel onOpenCase={onOpenCase} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  return { onOpenCase };
}

beforeEach(() => {
  mock = new MockAdapter(api);
  window.localStorage.clear();
});

afterEach(() => {
  mock.restore();
  vi.restoreAllMocks();
});

describe('the queue renders what the server returned', () => {
  it('lists the cases', async () => {
    mock.onGet(QUEUE_URL).reply(200, { items: [item()], nextCursor: null });
    renderQueue();

    expect(await screen.findByTestId('queue-row-c1')).toHaveTextContent('Pat Provider');
  });

  it('says plainly when there is nothing to review', async () => {
    mock.onGet(QUEUE_URL).reply(200, { items: [], nextCursor: null });
    renderQueue();

    expect(await screen.findByTestId('queue-empty')).toHaveTextContent(UI.en.queueEmpty);
  });

  it('opens the case that was clicked', async () => {
    mock.onGet(QUEUE_URL).reply(200, { items: [item()], nextCursor: null });
    const { onOpenCase } = renderQueue();

    fireEvent.click(await screen.findByRole('button', { name: 'Pat Provider' }));
    expect(onOpenCase).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });
});

describe('filters go to the SERVER', () => {
  it('sends the state filter rather than filtering the page in the client', async () => {
    // A client-side filter over one page of a cursor-paged list shows "3
    // results" when the answer is thirty, and a reviewer would believe the
    // smaller number.
    let params: Record<string, unknown> = {};
    mock.onGet(QUEUE_URL).reply((config) => {
      params = config.params ?? {};
      return [200, { items: [], nextCursor: null }];
    });
    renderQueue();
    await screen.findByTestId('queue-empty');

    fireEvent.change(screen.getByTestId('queue-state'), { target: { value: 'IN_REVIEW' } });
    await waitFor(() => expect(params.state).toBe('IN_REVIEW'));
  });

  it('sends the date window', async () => {
    let params: Record<string, unknown> = {};
    mock.onGet(QUEUE_URL).reply((config) => {
      params = config.params ?? {};
      return [200, { items: [], nextCursor: null }];
    });
    renderQueue();
    await screen.findByTestId('queue-empty');

    fireEvent.change(screen.getByTestId('queue-from'), { target: { value: '2026-06-01' } });
    await waitFor(() => expect(params.submittedFrom).toBe('2026-06-01'));

    fireEvent.change(screen.getByTestId('queue-to'), { target: { value: '2026-06-30' } });
    await waitFor(() => expect(params.submittedTo).toBe('2026-06-30'));
  });

  it('searches on Enter, not on every keystroke', async () => {
    // A request per character turns a reviewer typing a name into a dozen
    // queries whose answers arrive out of order.
    let calls = 0;
    let params: Record<string, unknown> = {};
    mock.onGet(QUEUE_URL).reply((config) => {
      calls += 1;
      params = config.params ?? {};
      return [200, { items: [], nextCursor: null }];
    });
    renderQueue();
    await screen.findByTestId('queue-empty');
    const before = calls;

    const search = screen.getByTestId('queue-search');
    fireEvent.change(search, { target: { value: 'Pat' } });
    expect(calls).toBe(before);

    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(params.search).toBe('Pat'));
  });

  it('an emptied filter is removed, not sent as an empty string', async () => {
    let params: Record<string, unknown> = {};
    mock.onGet(QUEUE_URL).reply((config) => {
      params = config.params ?? {};
      return [200, { items: [], nextCursor: null }];
    });
    renderQueue();
    await screen.findByTestId('queue-empty');

    fireEvent.change(screen.getByTestId('queue-policy'), { target: { value: 'v1' } });
    await waitFor(() => expect(params.policyVersion).toBe('v1'));

    fireEvent.change(screen.getByTestId('queue-policy'), { target: { value: '' } });
    await waitFor(() => expect(params.policyVersion).toBeUndefined());
  });

  it('clears every filter at once', async () => {
    let params: Record<string, unknown> = {};
    mock.onGet(QUEUE_URL).reply((config) => {
      params = config.params ?? {};
      return [200, { items: [], nextCursor: null }];
    });
    renderQueue();
    await screen.findByTestId('queue-empty');

    fireEvent.change(screen.getByTestId('queue-state'), { target: { value: 'VERIFIED' } });
    await waitFor(() => expect(params.state).toBe('VERIFIED'));

    fireEvent.click(screen.getByTestId('queue-clear'));
    await waitFor(() => expect(params).toEqual({}));
  });
});

describe('failures a reviewer must tell apart', () => {
  it('shows a permission message with no retry', async () => {
    // Retrying a 403 forever is not a recovery.
    mock.onGet(QUEUE_URL).reply(403, { success: false, error: { code: 'FORBIDDEN' } });
    renderQueue();

    const err = await screen.findByTestId('queue-error');
    expect(err).toHaveTextContent(UI.en.forbiddenTitle);
    expect(screen.queryByRole('button', { name: UI.en.reload })).not.toBeInTheDocument();
  });

  it('offers a retry on a server error', async () => {
    mock.onGet(QUEUE_URL).reply(500);
    renderQueue();

    const err = await screen.findByTestId('queue-error');
    expect(err).toHaveTextContent(UI.en.failed);
    expect(screen.getByRole('button', { name: UI.en.reload })).toBeInTheDocument();
  });

  it('an error is not an empty queue', async () => {
    // "Nothing to review" and "we could not ask" are different facts, and a
    // reviewer who confuses them goes home.
    mock.onGet(QUEUE_URL).reply(500);
    renderQueue();
    await screen.findByTestId('queue-error');
    expect(screen.queryByTestId('queue-empty')).not.toBeInTheDocument();
  });
});

describe('Arabic', () => {
  it('renders the Arabic heading and direction', async () => {
    mock.onGet(QUEUE_URL).reply(200, { items: [], nextCursor: null });
    renderQueue('ar');

    const panel = await screen.findByTestId('verification-queue');
    expect(panel).toHaveAttribute('dir', 'rtl');
    expect(panel).toHaveTextContent(UI.ar.queueTitle);
  });
});

describe('work access is its own fact', () => {
  const renderAccess = (workAccess: Parameters<typeof WorkAccessPanel>[0]['workAccess']) =>
    render(
      <LanguageProvider>
        <WorkAccessPanel workAccess={workAccess} />
      </LanguageProvider>,
    );

  it('says so when a grant was never issued', () => {
    renderAccess(null);
    expect(screen.getByTestId('work-access-none')).toHaveTextContent(UI.en.workAccessNone);
  });

  it('reports the server’s computed answer, not the status column', () => {
    // A grant row can say ACTIVE while the access has already lapsed. Showing
    // the column would have a reviewer revoke something already gone — or
    // decline to, believing it live.
    renderAccess({
      active: false,
      status: 'ACTIVE',
      source: 'VERIFIED_DOCUMENTS',
      grantedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-02-01T00:00:00.000Z',
      revokedAt: null,
    });

    const state = screen.getByTestId('work-access-state');
    expect(state).toHaveAttribute('data-active', 'false');
    expect(state).toHaveTextContent(UI.en.workAccessInactive);
  });

  it('keeps the SOURCE visible, so earned access is distinguishable from granted', () => {
    renderAccess({
      active: true,
      status: 'ACTIVE',
      source: 'MANUAL_OVERRIDE',
      grantedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
      revokedAt: null,
    });
    expect(screen.getByTestId('work-access-source')).toHaveTextContent('MANUAL_OVERRIDE');
  });
});
