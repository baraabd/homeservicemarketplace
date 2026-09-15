import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AdminPortfolioItem } from '@homeservicemarketplace/contracts';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ReviewPortfolio } from '../components/ReviewPortfolio';
import { reviewFixture, STAMP } from './fixtures';

const ROOT = '/v1/admin/providers/provider-1/portfolio';
const item: AdminPortfolioItem = {
  id: 'image-1',
  title: 'Kitchen lighting',
  description: 'Completed installation',
  serviceCategoryId: null,
  position: 0,
  moderationState: 'PENDING',
  moderationReason: null,
  revision: 3,
  media: { url: `${ROOT}/image-1/media`, contentType: 'image/png' },
  createdAt: STAMP,
  updatedAt: STAMP,
  moderatedAt: null,
  reviewBlockedReason: null,
  availableActions: ['APPROVE', 'REJECT'],
  history: [],
};
let mock: MockAdapter;
let qc: QueryClient;
const refresh = vi.fn(async () => undefined);
function setup() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <ReviewPortfolio review={reviewFixture()} lang="en" onChanged={refresh} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  localStorage.clear();
  refresh.mockClear();
  mock = new MockAdapter(api);
  mock.onGet(ROOT).reply(200, { items: [item] });
  mock.onGet(`${ROOT}/image-1/media`).reply(200, new Blob(['fixture'], { type: 'image/png' }));
  const NativeURL = URL;
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:private-preview');
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  mock.restore();
  vi.unstubAllGlobals();
});

describe('private portfolio inspection', () => {
  it('loads bytes only after an explicit open, never caches them, and revokes the preview on close', async () => {
    setup();
    const open = await screen.findByTestId('review-portfolio-open-image-1');
    expect(mock.history.get.map((request) => request.url)).toEqual([ROOT]);
    fireEvent.click(open);
    expect(await screen.findByRole('img', { name: 'Completed installation' })).toHaveAttribute(
      'src',
      'blob:private-preview',
    );
    expect(mock.history.get[1].url).toBe(`${ROOT}/image-1/media`);
    expect(
      JSON.stringify(
        qc
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ),
    ).not.toContain('blob:private-preview');
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close', exact: true }),
    );
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-preview'));
  });
  it('does not reuse a revoked preview or enable moderation when opening the same item is denied', async () => {
    setup();
    const open = await screen.findByTestId('review-portfolio-open-image-1');
    fireEvent.click(open);
    await screen.findByRole('img');
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close', exact: true }),
    );
    mock.onGet(`${ROOT}/image-1/media`).reply(403, { error: { code: 'FORBIDDEN' } });
    fireEvent.click(open);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve image' })).toBeDisabled();
    await screen.findByText('The image could not be opened.');
    expect(screen.getByRole('button', { name: 'Reject image' })).toBeDisabled();
  });
  it('requires a provider-facing reason and sends the inspected revision for rejection', async () => {
    let payload: Record<string, unknown> | undefined;
    mock.onPatch(`${ROOT}/image-1/review`).reply((config) => {
      payload = JSON.parse(config.data);
      return [200, { ...item, moderationState: 'REJECTED', revision: 4 }];
    });
    setup();
    fireEvent.click(await screen.findByTestId('review-portfolio-open-image-1'));
    await screen.findByRole('img');
    fireEvent.click(screen.getByRole('button', { name: 'Reject image' }));
    fireEvent.click(screen.getByTestId('review-portfolio-confirm'));
    expect(payload).toBeUndefined();
    const reason = screen.getByRole('textbox');
    expect(reason).toHaveAttribute('maxlength', '1000');
    fireEvent.change(reason, { target: { value: 'Please remove the visible customer address.' } });
    fireEvent.click(screen.getByTestId('review-portfolio-confirm'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(payload).toEqual({
      action: 'REJECT',
      expectedRevision: 3,
      reason: 'Please remove the visible customer address.',
    });
  });
});
