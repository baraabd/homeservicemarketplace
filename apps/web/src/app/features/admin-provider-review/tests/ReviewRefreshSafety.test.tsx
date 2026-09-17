import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { AdminProviderReviewWorkspace } from '../components/AdminProviderReviewWorkspace';
import { reviewFixture } from './fixtures';
import { reviewQueryKey } from '../api';

const PATH = '/v1/admin/providers/provider-1/review';
let mock: MockAdapter;
let qc: QueryClient;
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('hsm.lang', 'en');
  mock = new MockAdapter(api);
  mock.onGet(PATH).reply(200, reviewFixture());
  mock.onGet(`${PATH}/history`).reply(200, { items: [], nextCursor: null });
  mock.onGet('/v1/services/equipment').reply(200, { items: [] });
  mock.onGet('/v1/admin/providers/provider-1/portfolio').reply(200, { items: [] });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); qc.clear(); mock.restore(); });

function setup() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <LanguageProvider><AdminProviderReviewWorkspace providerProfileId="provider-1" /></LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

it.each([403, 404, 500, 'network'] as const)('blocks decisions after a %s refresh failure without losing permitted unsent notes', async (failure) => {
  setup();
  await screen.findByTestId('review-approve');
  fireEvent.change(screen.getByTestId('review-private-note'), { target: { value: 'Unsent private note' } });
  if (failure === 'network') mock.onGet(PATH).networkError();
  else mock.onGet(PATH).reply(failure, { error: { code: 'UNAVAILABLE' } });
  fireEvent.click(screen.getByTestId('review-refresh'));
  await waitFor(() => expect(qc.getQueryState(reviewQueryKey('provider-1'))?.status).toBe('error'));
  if (failure === 403 || failure === 404) {
    await waitFor(() => expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument());
    expect(screen.queryByTestId('review-task-index')).not.toBeInTheDocument();
  } else {
    await waitFor(() => expect(screen.getByTestId('review-approve')).toBeDisabled());
    expect(screen.getByTestId('review-request-changes')).toBeDisabled();
    expect(screen.getByTestId('review-private-note')).toHaveValue('Unsent private note');
    fireEvent.click(screen.getByTestId('review-approve'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
  expect(mock.history.post).toHaveLength(0);
  mock.onGet(PATH).reply(200, reviewFixture());
  fireEvent.click(screen.getByTestId('review-refresh'));
  await waitFor(() => expect(screen.getByTestId('review-approve')).not.toBeDisabled());
  if (failure !== 403 && failure !== 404)
    expect(screen.getByTestId('review-private-note')).toHaveValue('Unsent private note');
});

it('also locks a confirmation already open in the dialog portal and retains the note', async () => {
  setup();
  await screen.findByTestId('review-approve');
  fireEvent.change(screen.getByTestId('review-private-note'), { target: { value: 'Keep this note' } });
  fireEvent.click(screen.getByTestId('review-approve'));
  fireEvent.click(screen.getByTestId('review-approval-ack'));
  mock.onGet(PATH).reply(500, { error: { code: 'UNAVAILABLE' } });
  await act(async () => { await qc.refetchQueries({ queryKey: reviewQueryKey('provider-1') }); });
  await waitFor(() => expect(qc.getQueryState(reviewQueryKey('provider-1'))?.status).toBe('error'));
  expect(screen.getByTestId('review-confirm')).toBeDisabled();
  fireEvent.click(screen.getByTestId('review-confirm'));
  expect(mock.history.post).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  expect(screen.getByTestId('review-private-note')).toHaveValue('Keep this note');
});
