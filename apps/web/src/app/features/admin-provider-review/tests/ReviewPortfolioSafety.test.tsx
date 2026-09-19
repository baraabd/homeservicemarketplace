import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { AdminProviderReview } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ReviewPortfolio } from '../components/ReviewPortfolio';
import { reviewQueryKey } from '../api';
import { reviewFixture } from './fixtures';
import { portfolioItem as item, PORTFOLIO_PATH as PATH } from './review-safety-fixtures';

const KEY = [...reviewQueryKey('provider-1'), 'portfolio'];
let mock: MockAdapter;
let qc: QueryClient;
const onChanged = vi.fn(async () => undefined);
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('hsm.lang', 'en');
  onChanged.mockClear();
  mock = new MockAdapter(api);
  mock.onGet(PATH).reply(200, { items: [item] });
  mock.onGet(`${PATH}/image-1/media`).reply(200, new Blob(['fixture'], { type: 'image/png' }));
  mock.onPost('/v1/auth/refresh').reply(401, {});
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:private-safety-preview');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); qc.clear(); mock.restore(); vi.unstubAllGlobals(); });

function setup() {
  const tree = (review: AdminProviderReview, readOnly: boolean) => (
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <ReviewPortfolio review={review} lang="en" onChanged={onChanged} readOnly={readOnly} />
      </LanguageProvider>
    </QueryClientProvider>
  );
  const result = render(tree(reviewFixture(), false));
  return (review = reviewFixture(), readOnly = false) => result.rerender(tree(review, readOnly));
}
async function open() {
  fireEvent.click(await screen.findByTestId('review-portfolio-open-image-1'));
  await screen.findByRole('img');
}
async function refreshList() {
  await act(async () => { await qc.refetchQueries({ queryKey: KEY, exact: true }); });
}
function reject() {
  fireEvent.click(screen.getByRole('button', { name: 'Reject image' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Preserve my correction reason' } });
}

describe('private portfolio denial cleanup', () => {
  it.each([401, 403, 404])('removes the open viewer and revokes resident bytes on list denial %s', async (status) => {
    setup(); await open();
    mock.onGet(PATH).reply(status, {});
    await refreshList();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Private installation detail')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-safety-preview');
    expect(mock.history.patch).toHaveLength(0);
    // Regaining list access never silently reopens previously resident media.
    mock.onGet(PATH).reply(200, { items: [item] });
    await refreshList();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
  it('aborts an in-flight image on a list denial and ignores a late response', async () => {
    let resolve!: (response: [number, Blob]) => void;
    mock.onGet(`${PATH}/image-1/media`).reply(() => new Promise((done) => { resolve = done; }));
    setup();
    fireEvent.click(await screen.findByTestId('review-portfolio-open-image-1'));
    await waitFor(() => expect(mock.history.get.some((request) => request.url?.endsWith('/media'))).toBe(true));
    const request = mock.history.get.find((entry) => entry.url?.endsWith('/media'))!;
    mock.onGet(PATH).reply(403, {});
    await refreshList();
    await waitFor(() => expect(request.signal?.aborted).toBe(true));
    await act(async () => { resolve([200, new Blob(['late'], { type: 'image/png' })]); });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('portfolio decision freshness', () => {
  it.each([500, 'network'] as const)('retains a reason but cannot moderate through a %s list failure', async (failure) => {
    setup(); await open(); reject();
    if (failure === 'network') mock.onGet(PATH).networkError();
    else mock.onGet(PATH).reply(failure, {});
    await refreshList();
    await waitFor(() => expect(screen.getByTestId('review-portfolio-confirm')).toBeDisabled());
    expect(screen.getByRole('textbox')).toHaveValue('Preserve my correction reason');
    fireEvent.click(screen.getByTestId('review-portfolio-confirm'));
    expect(mock.history.patch).toHaveLength(0);
    mock.onGet(PATH).reply(200, { items: [item] });
    await refreshList();
    await waitFor(() => expect(screen.getByTestId('review-portfolio-confirm')).toBeEnabled());
    expect(screen.getByRole('textbox')).toHaveValue('Preserve my correction reason');
  });
  it('pauses confirmations while the list request is still pending', async () => {
    setup(); await open(); reject();
    let resolve!: (response: [number, { items: typeof item[] }]) => void;
    mock.onGet(PATH).reply(() => new Promise((done) => { resolve = done; }));
    let pending!: Promise<void>;
    act(() => { pending = qc.refetchQueries({ queryKey: KEY, exact: true }); });
    await waitFor(() => expect(screen.getByTestId('review-portfolio-confirm')).toBeDisabled());
    fireEvent.click(screen.getByTestId('review-portfolio-confirm'));
    expect(mock.history.patch).toHaveLength(0);
    await act(async () => { resolve([200, { items: [item] }]); await pending; });
    await waitFor(() => expect(screen.getByTestId('review-portfolio-confirm')).toBeEnabled());
  });
  it('pauses an existing confirmation when the parent dossier cannot refresh', async () => {
    const update = setup(); await open(); reject();
    update(reviewFixture(), true);
    expect(screen.getByTestId('review-portfolio-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('review-portfolio-confirm'));
    expect(mock.history.patch).toHaveLength(0);
    expect(screen.getByRole('textbox')).toHaveValue('Preserve my correction reason');
    update();
    expect(screen.getByTestId('review-portfolio-confirm')).toBeEnabled();
  });
  it('rechecks moderation permission for a confirmation that is already open', async () => {
    const update = setup(); await open(); reject();
    const next = reviewFixture(); next.permissions.canModeratePortfolio = false;
    update(next);
    expect(screen.getByTestId('review-portfolio-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('review-portfolio-confirm'));
    expect(mock.history.patch).toHaveLength(0);
    // Read and moderation permissions are separate: do not invent a read denial.
    expect(screen.getByRole('img')).toBeInTheDocument();
  });
  it.each(['revision', 'actions'] as const)('does not silently retarget a selection after %s change', async (change) => {
    setup(); await open(); reject();
    const next = change === 'revision' ? { ...item, revision: 4 } : { ...item, availableActions: [] };
    mock.onGet(PATH).reply(200, { items: [next] });
    await refreshList();
    await waitFor(() => expect(screen.getByTestId('review-portfolio-confirm')).toBeDisabled());
    fireEvent.click(screen.getByTestId('review-portfolio-confirm'));
    expect(mock.history.patch).toHaveLength(0);
    expect(screen.getByRole('textbox')).toHaveValue('Preserve my correction reason');
  });
  it('keeps a conflicted revision and reason when portfolio refresh fails but dossier refresh succeeds', async () => {
    mock.onPatch(`${PATH}/image-1/review`).reply(409, {});
    setup(); await open(); reject();
    fireEvent.click(screen.getByTestId('review-portfolio-confirm'));
    const reload = await screen.findByTestId('review-portfolio-reload');
    mock.onGet(PATH).reply(500, {});
    fireEvent.click(reload);
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    await waitFor(() => expect(qc.getQueryState(KEY)?.status).toBe('error'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Preserve my correction reason');
    expect(mock.history.patch).toHaveLength(1);
    expect(JSON.parse(mock.history.patch[0].data).expectedRevision).toBe(3);
  });
});
