import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { AdminProviderReview } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ReviewIdentity } from '../components/ReviewIdentity';
import { ReviewCategories } from '../components/ReviewCategories';
import { actionableReview } from './review-safety-fixtures';

vi.mock('../evidence/IdentityPdfCanvas', () => ({ IdentityPdfCanvas: () => null }));
let mock: MockAdapter;
let qc: QueryClient;
const refresh = vi.fn(async () => undefined);
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('hsm.lang', 'en');
  refresh.mockClear();
  mock = new MockAdapter(api);
  mock.onPost().reply(200, {});
  mock.onPatch().reply(200, {});
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); qc.clear(); mock.restore(); });

function setup(kind: 'identity' | 'categories', lang: 'en' | 'ar' = 'en') {
  localStorage.setItem('hsm.lang', lang);
  const Component = kind === 'identity' ? ReviewIdentity : ReviewCategories;
  const tree = (review: AdminProviderReview, readOnly: boolean) => (
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <Component review={review} lang={lang} onChanged={refresh} readOnly={readOnly} />
      </LanguageProvider>
    </QueryClientProvider>
  );
  const result = render(tree(actionableReview(), false));
  return (review = actionableReview(), readOnly = false) => result.rerender(tree(review, readOnly));
}

function openIdentity() {
  const button = screen.getByTestId('review-case-assign');
  button.closest('details')!.open = true;
  fireEvent.click(button);
}

describe('identity confirmation pins the inspected case', () => {
  it('sends the original case and expected state with the private note', async () => {
    setup('identity'); openIdentity();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Inspected case one' } });
    fireEvent.click(screen.getByTestId('review-case-confirm'));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mock.history.post).toHaveLength(1);
    expect(mock.history.post[0].url).toBe('/v1/admin/verification/cases/case-1/assign');
    expect(JSON.parse(mock.history.post[0].data)).toEqual({
      expectedState: 'SUBMITTED', note: 'Inspected case one',
    });
  });
  it.each(['replacement', 'state', 'action', 'permission', 'missing'] as const)(
    'cannot confirm after the current case changes: %s', (change) => {
      const update = setup('identity'); openIdentity();
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Keep my note' } });
      const next = actionableReview();
      if (change === 'replacement') next.verification!.id = 'case-2';
      if (change === 'state') next.verification!.state = 'IN_REVIEW';
      if (change === 'action') next.verification!.availableActions = [];
      if (change === 'permission') next.permissions.canDecide = false;
      if (change === 'missing') next.verification = null;
      update(next);
      expect(screen.getByTestId('review-case-confirm')).toBeDisabled();
      expect(screen.getByRole('textbox')).toHaveValue('Keep my note');
      expect(screen.getByRole('status')).toHaveTextContent('selected item or available action changed');
      fireEvent.click(screen.getByTestId('review-case-confirm'));
      expect(mock.history.post).toHaveLength(0);
    },
  );
  it.each(['en', 'ar'] as const)('pauses open confirmations and preserves notes in %s', (lang) => {
    const update = setup('identity', lang); openIdentity();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsent note' } });
    update(actionableReview(), true);
    expect(screen.getByTestId('review-case-confirm')).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue('Unsent note');
    expect(screen.getByRole('status')).toHaveTextContent(lang === 'ar' ? 'القرارات متوقفة' : 'Decisions are paused');
    fireEvent.click(screen.getByTestId('review-case-confirm'));
    expect(mock.history.post).toHaveLength(0);
    update();
    expect(screen.getByTestId('review-case-confirm')).toBeEnabled();
  });
});

describe('specialty confirmation freshness', () => {
  it('locks both openers and an existing confirmation during a dossier refresh', () => {
    const update = setup('categories');
    const open = screen.getByTestId('review-category-approve-category-1');
    fireEvent.click(open);
    update(actionableReview(), true);
    expect(open).toBeDisabled();
    expect(screen.getByTestId('review-category-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('review-category-confirm'));
    expect(mock.history.patch).toHaveLength(0);
    update();
    expect(screen.getByTestId('review-category-confirm')).toBeEnabled();
  });
  it.each(['replacement', 'state', 'action'] as const)('refuses stale %s selections', (change) => {
    const update = setup('categories');
    fireEvent.click(screen.getByTestId('review-category-approve-category-1'));
    const next = actionableReview();
    if (change === 'replacement') next.categoryApplications[0].id = 'category-2';
    if (change === 'state') next.categoryApplications[0].status = 'APPROVED';
    if (change === 'action') next.categoryApplications[0].availableActions = [];
    update(next);
    expect(screen.getByTestId('review-category-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('review-category-confirm'));
    expect(mock.history.patch).toHaveLength(0);
  });
  it('retains the server-authorized specialty command for a fresh selection', async () => {
    setup('categories');
    fireEvent.click(screen.getByTestId('review-category-approve-category-1'));
    fireEvent.click(screen.getByTestId('review-category-confirm'));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(mock.history.patch[0].url).toBe('/v1/admin/category-applications/category-1/review');
    expect(JSON.parse(mock.history.patch[0].data)).toEqual({ action: 'APPROVE' });
  });
});
