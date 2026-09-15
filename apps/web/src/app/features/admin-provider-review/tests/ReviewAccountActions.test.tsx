import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdminProviderSummary } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { adminProvidersQueryKeys } from '../../../hooks/admin/useAdminProviders';
import { ReviewAccountActions } from '../components/ReviewAccountActions';

const ROOT = '/v1/admin/providers/provider-1';
function profile(overrides: Partial<AdminProviderSummary> = {}): AdminProviderSummary {
  return {
    id: 'provider-1',
    status: 'ACTIVE',
    userId: 'owner-1',
    email: 'owner@example.test',
    displayName: 'Test provider',
    initials: 'TP',
    ratingAvg: 0,
    reviewCount: 0,
    completedJobs: 0,
    verified: false,
    topPro: false,
    serviceAreaCity: null,
    serviceAreaCountry: null,
    reviewNotes: 'Recorded reviewer context',
    availableActions: ['suspend'],
    createdAt: '2026-09-15T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
    ...overrides,
  };
}
let mock: MockAdapter;
let qc: QueryClient;
let stored: AdminProviderSummary;
const changed = vi.fn(async () => undefined);
function setup() {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <ReviewAccountActions providerProfileId="provider-1" lang="en" onChanged={changed} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}
async function openSuspension() {
  fireEvent.click(await screen.findByRole('button', { name: 'Suspend provider' }));
  return within(await screen.findByRole('dialog'));
}
beforeEach(() => {
  localStorage.clear();
  changed.mockReset();
  changed.mockResolvedValue(undefined);
  stored = profile();
  mock = new MockAdapter(api);
  mock.onGet(ROOT).reply(() => [200, stored]);
});
afterEach(() => {
  qc?.clear();
  mock.restore();
});

describe('provider account controls use actual API hooks', () => {
  it('offers only actions returned by the server, with no transition table in the client', async () => {
    stored = profile({ availableActions: [] });
    setup();
    await screen.findByLabelText('Internal notes');
    expect(screen.queryByRole('button', { name: 'Suspend provider' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate provider' })).not.toBeInTheDocument();
    stored = profile({ status: 'ACTIVE', availableActions: ['reactivate'] });
    await act(async () => {
      await qc.invalidateQueries({ queryKey: adminProvidersQueryKeys.detail('provider-1') });
    });
    expect(await screen.findByRole('button', { name: 'Reactivate provider' })).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it('requires a bounded suspension reason and sends its actual trimmed text before refreshing state', async () => {
    mock.onPost(`${ROOT}/suspend`).reply((config) => {
      expect(JSON.parse(config.data)).toEqual({ reason: 'Repeated confirmed conduct violation' });
      stored = profile({ status: 'SUSPENDED', availableActions: ['reactivate'] });
      return [200, { provider: stored }];
    });
    setup();
    const dialog = await openSuspension();
    const confirm = dialog.getByRole('button', { name: 'Confirm decision' });
    const reason = dialog.getByLabelText('Reason for suspension');
    expect(reason).toHaveAttribute('maxlength', '1024');
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: '   ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(reason, { target: { value: '  Repeated confirmed conduct violation  ' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Reactivate provider' })).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Provider status decision saved.');
  });

  it('retains the dialog and reason after a failed mutation and retries the same draft explicitly', async () => {
    mock.onPost(`${ROOT}/suspend`).replyOnce(403, { error: { code: 'FORBIDDEN' } });
    mock.onPost(`${ROOT}/suspend`).reply(() => {
      stored = profile({ status: 'SUSPENDED', availableActions: ['reactivate'] });
      return [200, { provider: stored }];
    });
    setup();
    const dialog = await openSuspension();
    fireEvent.change(dialog.getByLabelText('Reason for suspension'), {
      target: { value: 'Investigated complaint' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm decision' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Could not apply the decision');
    expect(dialog.getByLabelText('Reason for suspension')).toHaveValue('Investigated complaint');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    expect(screen.queryByText('Provider status decision saved.')).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm decision' }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(mock.history.post.map((request) => JSON.parse(request.data))).toEqual([
      { reason: 'Investigated complaint' },
      { reason: 'Investigated complaint' },
    ]);
  });

  it('keeps a submitted command open during its pending request and avoids duplicate submissions', async () => {
    let release!: (response: [number, { provider: AdminProviderSummary }]) => void;
    mock.onPost(`${ROOT}/suspend`).reply(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    setup();
    const dialog = await openSuspension();
    fireEvent.change(dialog.getByLabelText('Reason for suspension'), {
      target: { value: 'Confirmed reason' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm decision' }));
    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Saving…' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Close', exact: true }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(1);
    stored = profile({ status: 'SUSPENDED', availableActions: ['reactivate'] });
    await act(async () => release([200, { provider: stored }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('reactivates through the bodyless API and awaits the server review refresh without inventing work eligibility', async () => {
    stored = profile({ status: 'SUSPENDED', availableActions: ['reactivate'] });
    mock.onPost(`${ROOT}/reactivate`).reply(() => {
      stored = profile({
        status: 'ACTIVE',
        workAccess: { hasLiveGrant: false, canWork: false, denialReason: 'NO_WORK_ACCESS' },
      });
      return [200, { provider: stored }];
    });
    const reviewRead = vi.fn((): [number, { canWork: boolean }] => [200, { canWork: false }]);
    mock.onGet(`${ROOT}/review`).reply(reviewRead);
    changed.mockImplementation(async () => {
      await api.get(`${ROOT}/review`);
    });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate provider' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.queryByLabelText('Reason for suspension')).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm decision' }));
    await waitFor(() => expect(reviewRead).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mock.history.post[0].data)).toEqual({});
    expect(
      qc.getQueryData<AdminProviderSummary>(adminProvidersQueryKeys.detail('provider-1'))
        ?.workAccess?.canWork,
    ).toBe(false);
  });

  it('distinguishes a saved command from a failed refresh and retries reads without replaying the mutation', async () => {
    mock.onPost(`${ROOT}/suspend`).reply(() => {
      mock.onGet(ROOT).reply(503, { error: { code: 'UNAVAILABLE' } });
      return [200, { provider: profile({ status: 'SUSPENDED' }) }];
    });
    setup();
    const dialog = await openSuspension();
    fireEvent.change(dialog.getByLabelText('Reason for suspension'), {
      target: { value: 'Confirmed reason' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Confirm decision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh');
    expect(screen.getByRole('status')).toHaveTextContent('Provider status decision saved.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
    stored = profile({ status: 'SUSPENDED', availableActions: ['reactivate'] });
    mock.onGet(ROOT).reply(() => [200, stored]);
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mock.history.post).toHaveLength(1);
  });

  it('persists private notes through PATCH and keeps unsaved text after server failure', async () => {
    mock.onPatch(`${ROOT}/review-notes`).replyOnce(503, { error: { code: 'UNAVAILABLE' } });
    mock.onPatch(`${ROOT}/review-notes`).reply((config) => {
      stored = profile({ reviewNotes: JSON.parse(config.data).notes });
      return [200, { provider: stored }];
    });
    setup();
    const notes = await screen.findByLabelText('Internal notes');
    expect(notes).toHaveValue('Recorded reviewer context');
    expect(notes).toHaveAttribute('maxlength', '4000');
    fireEvent.change(notes, { target: { value: 'Internal inspection context only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your text remains on this screen');
    expect(notes).toHaveValue('Internal inspection context only');
    expect(screen.queryByText('Internal notes saved.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Internal notes saved.'),
    );
    expect(mock.history.patch.map((request) => JSON.parse(request.data))).toEqual([
      { notes: 'Internal inspection context only' },
      { notes: 'Internal inspection context only' },
    ]);
    expect(
      qc.getQueryData<AdminProviderSummary>(adminProvidersQueryKeys.detail('provider-1'))
        ?.reviewNotes,
    ).toBe('Internal inspection context only');
    expect(mock.history.post).toHaveLength(0);
  });

  it('does not overwrite newer typing when an earlier note save finishes', async () => {
    let release!: (response: [number, { provider: AdminProviderSummary }]) => void;
    mock.onPatch(`${ROOT}/review-notes`).reply(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    setup();
    const notes = await screen.findByLabelText('Internal notes');
    fireEvent.change(notes, { target: { value: 'First revision' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save notes' }));
    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    fireEvent.change(notes, { target: { value: 'Newer revision typed during save' } });
    stored = profile({ reviewNotes: 'First revision' });
    await act(async () => release([200, { provider: stored }]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save notes' })).toBeEnabled());
    expect(notes).toHaveValue('Newer revision typed during save');
    expect(stored.reviewNotes).toBe('First revision');
  });
});
