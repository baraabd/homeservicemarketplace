import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { AdminVerificationCase } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { createAuthQueryClient } from '../../../../lib/auth-provider';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { AdminVerificationCaseWorkspace } from './AdminVerificationCaseWorkspace';
import { UI } from '../copy/verification-copy';

const PATH = '/v1/admin/verification/cases';
const key = (id: string) => ['admin', 'verification', 'case', id] as const;
function kase(id: string): AdminVerificationCase {
  return {
    id,
    providerProfileId: `provider-${id}`,
    state: 'SUBMITTED',
    policyVersion: `policy-${id}`,
    country: 'SY',
    providerType: 'INDIVIDUAL',
    submittedAt: '2026-11-11T12:00:00.000Z',
    assignedToUserId: null,
    assignedAt: null,
    decidedAt: null,
    requirements: [],
    documents: [],
    decisions: [],
    availableActions: ['approve'],
    blockedReason: null,
    workAccess: null,
  };
}
let mock: MockAdapter;
let qc: QueryClient;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('hsm.lang', 'en');
  mock = new MockAdapter(api);
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  for (const id of ['a', 'b']) {
    qc.setQueryData(key(id), kase(id));
    mock.onGet(`${PATH}/${id}`).reply(200, kase(id));
    mock.onGet(`${PATH}/${id}/audit`).reply(200, { items: [], nextCursor: null });
  }
});
afterEach(() => {
  cleanup();
  qc.clear();
  mock.restore();
});

async function setup() {
  const tree = (id: string) => (
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <AdminVerificationCaseWorkspace selectedCaseId={id} onSelectCase={vi.fn()} />
      </LanguageProvider>
    </QueryClientProvider>
  );
  const view = render(tree('a'));
  await waitFor(() => expect(qc.getQueryState(key('a'))?.fetchStatus).toBe('idle'));
  fireEvent.click(await screen.findByTestId('case-action-approve'));
  fireEvent.change(screen.getByTestId('case-action-reason'), {
    target: { value: 'DOCUMENTS_COMPLETE_AND_LEGIBLE' },
  });
  fireEvent.change(screen.getByTestId('case-action-note'), {
    target: { value: 'Private note about case A' },
  });
  return { ...view, select: (id: string) => view.rerender(tree(id)) };
}

it('does not carry a confirmation or private note to another cached case', async () => {
  const view = await setup();
  view.select('b');
  await waitFor(() =>
    expect(screen.getByTestId('case-policy-version')).toHaveTextContent('policy-b'),
  );
  expect(screen.queryByTestId('case-action-dialog')).not.toBeInTheDocument();
  expect(mock.history.post).toHaveLength(0);
  await waitFor(() => expect(qc.getQueryState(key('b'))?.fetchStatus).toBe('idle'));
  fireEvent.click(screen.getByTestId('case-action-approve'));
  expect(screen.getByTestId('case-action-note')).toHaveValue('');
  expect(screen.getByTestId('case-action-reason')).toHaveValue('');
});

it('locks a pending or failed refresh without discarding the current private note', async () => {
  await setup();
  let finish!: (response: [number, unknown]) => void;
  mock.onGet(`${PATH}/a`).reply(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let refreshing!: Promise<void>;
  await act(async () => {
    refreshing = qc.refetchQueries({ queryKey: key('a'), exact: true });
  });
  await waitFor(() => expect(screen.getByTestId('case-action-confirm')).toBeDisabled());
  fireEvent.click(screen.getByTestId('case-action-confirm'));
  expect(mock.history.post).toHaveLength(0);
  await act(async () => {
    finish([500, { error: { code: 'UNAVAILABLE' } }]);
    await refreshing;
  });
  await waitFor(() => expect(screen.getByTestId('case-error')).toBeInTheDocument());
  expect(screen.getByTestId('case-action-note')).toHaveValue('Private note about case A');
  expect(screen.getByTestId('case-action-confirm')).toBeDisabled();
});

it('keeps a conflict blocked and retains the note if reloading fails', async () => {
  mock.onPost(`${PATH}/a/approve`).reply(409, { error: { code: 'CONFLICT' } });
  await setup();
  fireEvent.click(screen.getByTestId('case-action-confirm'));
  const conflict = await screen.findByTestId('case-actions-conflict');
  expect(mock.history.post).toHaveLength(1);
  mock.onGet(`${PATH}/a`).reply(500);
  fireEvent.click(within(conflict).getByRole('button', { name: UI.en.reload }));
  await screen.findByTestId('case-error');
  expect(screen.getByTestId('case-actions-conflict')).toBeInTheDocument();
  expect(screen.getByTestId('case-action-note')).toHaveValue('Private note about case A');
  expect(screen.getByTestId('case-action-confirm')).toBeDisabled();
  expect(mock.history.post).toHaveLength(1);
});

it('revalidates a cached case before using its actions with the application cache defaults', async () => {
  qc.clear();
  qc = createAuthQueryClient();
  qc.setQueryData(key('a'), kase('a'));
  let finish!: (response: [number, unknown]) => void;
  mock.onGet(`${PATH}/a`).reply(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <AdminVerificationCaseWorkspace selectedCaseId="a" onSelectCase={vi.fn()} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByTestId('case-action-approve')).toBeDisabled();
  fireEvent.click(screen.getByTestId('case-action-approve'));
  expect(screen.queryByTestId('case-action-dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(finish).toEqual(expect.any(Function)));
  await act(async () => {
    finish([200, { ...kase('a'), availableActions: [] }]);
  });
  await waitFor(() => expect(screen.queryByTestId('case-action-approve')).not.toBeInTheDocument());
  expect(mock.history.post).toHaveLength(0);
});

it('does not revive the old confirmation after a top-level conflict refresh with the same case state', async () => {
  mock.onPost(`${PATH}/a/approve`).reply(409, { error: { code: 'CONFLICT' } });
  await setup();
  fireEvent.click(screen.getByTestId('case-action-confirm'));
  await screen.findByTestId('case-actions-conflict');
  mock.onGet(`${PATH}/a`).reply(200, { ...kase('a'), policyVersion: 'refreshed-case-details' });
  fireEvent.click(screen.getByTestId('case-refresh'));
  await waitFor(() =>
    expect(screen.getByTestId('case-policy-version')).toHaveTextContent('refreshed-case-details'),
  );
  expect(screen.queryByTestId('case-actions-conflict')).not.toBeInTheDocument();
  expect(screen.getByTestId('case-action-confirm')).toBeDisabled();
  expect(screen.getByTestId('case-action-note')).toHaveValue('Private note about case A');
  fireEvent.click(screen.getByTestId('case-action-confirm'));
  expect(mock.history.post).toHaveLength(1);
  fireEvent.click(screen.getByTestId('case-action-cancel'));
  fireEvent.click(screen.getByTestId('case-action-approve'));
  expect(screen.getByTestId('case-action-confirm')).toBeEnabled();
  expect(screen.getByTestId('case-action-reason')).toHaveValue('');
});
