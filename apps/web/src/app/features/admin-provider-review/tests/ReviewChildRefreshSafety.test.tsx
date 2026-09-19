import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { AdminProviderReviewWorkspace } from '../components/AdminProviderReviewWorkspace';
import { reviewQueryKey } from '../api';
import { actionableReview, portfolioItem, PORTFOLIO_PATH } from './review-safety-fixtures';

vi.mock('../evidence/IdentityPdfCanvas', () => ({ IdentityPdfCanvas: () => null }));
const PATH = '/v1/admin/providers/provider-1/review';
let mock: MockAdapter;
let qc: QueryClient;
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('hsm.lang', 'en');
  mock = new MockAdapter(api);
  mock.onGet(PATH).reply(200, actionableReview());
  mock.onGet(`${PATH}/history`).reply(200, { items: [], nextCursor: null });
  mock.onGet('/v1/services/equipment').reply(200, { items: [] });
  mock.onGet(PORTFOLIO_PATH).reply(200, { items: [portfolioItem] });
  mock.onGet(`${PORTFOLIO_PATH}/image-1/media`).reply(200, new Blob(['image'], { type: 'image/png' }));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:child-refresh');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); qc.clear(); mock.restore(); vi.unstubAllGlobals(); });

it.each(['identity', 'category', 'portfolio'] as const)(
  'propagates pending and failed dossier refresh to an open %s confirmation', async (kind) => {
    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <LanguageProvider>
            <AdminProviderReviewWorkspace providerProfileId="provider-1" />
          </LanguageProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await screen.findByTestId('review-approve');
    const task = kind === 'identity' ? 'BASICS_IDENTITY' :
      kind === 'category' ? 'SERVICES_EXPERIENCE' : 'PORTFOLIO';
    fireEvent.click(screen.getByTestId(`review-tab-${task}`));
    const confirmId = kind === 'identity' ? 'review-case-confirm' :
      kind === 'category' ? 'review-category-confirm' : 'review-portfolio-confirm';
    if (kind === 'identity') {
      const open = screen.getByTestId('review-case-assign');
      open.closest('details')!.open = true;
      fireEvent.click(open);
    } else if (kind === 'category') {
      fireEvent.click(screen.getByTestId('review-category-approve-category-1'));
    } else {
      fireEvent.click(await screen.findByTestId('review-portfolio-open-image-1'));
      await screen.findByRole('img');
      fireEvent.click(screen.getByRole('button', { name: 'Reject image' }));
    }
    if (kind !== 'category') {
      fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox'), {
        target: { value: 'Preserved draft' },
      });
    }
    let resolve!: (response: [number, object]) => void;
    mock.onGet(PATH).reply(() => new Promise((done) => { resolve = done; }));
    let pending!: Promise<void>;
    act(() => {
      pending = qc.refetchQueries({ queryKey: reviewQueryKey('provider-1'), exact: true });
    });
    await waitFor(() => expect(screen.getByTestId(confirmId)).toBeDisabled());
    fireEvent.click(screen.getByTestId(confirmId));
    await act(async () => { resolve([500, {}]); await pending; });
    await waitFor(() => expect(qc.getQueryState(reviewQueryKey('provider-1'))?.status).toBe('error'));
    expect(screen.getByTestId(confirmId)).toBeDisabled();
    expect(mock.history.post).toHaveLength(0);
    expect(mock.history.patch).toHaveLength(0);
    if (kind !== 'category') {
      expect(within(screen.getByRole('dialog')).getByRole('textbox')).toHaveValue('Preserved draft');
    }
    mock.onGet(PATH).reply(200, actionableReview());
    await act(async () => {
      await qc.refetchQueries({ queryKey: reviewQueryKey('provider-1'), exact: true });
    });
    await waitFor(() => expect(screen.getByTestId(confirmId)).toBeEnabled());
  },
);
