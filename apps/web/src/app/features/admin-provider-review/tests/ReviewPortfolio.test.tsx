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
  it('does not let a listed replacement reason override fresh media authorization denial', async () => {
    mock.onGet(ROOT).reply(200, {
      items: [{ ...item, reviewBlockedReason: 'MEDIA_UNAVAILABLE', availableActions: ['REJECT'] }],
    });
    mock.onGet(`${ROOT}/image-1/media`).reply(403);
    setup();
    fireEvent.click(await screen.findByTestId('review-portfolio-open-image-1'));
    await screen.findByText('The image could not be opened.');
    expect(screen.getByRole('button', { name: 'Reject image' })).toBeDisabled();
    expect(mock.history.patch).toHaveLength(0);
  });
  it('enables approval only after the inspected image is displayed and submits that revision', async () => {
    mock
      .onPatch(`${ROOT}/image-1/review`)
      .reply(200, { ...item, moderationState: 'APPROVED', revision: 4 });
    setup();
    fireEvent.click(await screen.findByTestId('review-portfolio-open-image-1'));
    const image = await screen.findByRole('img');
    expect(screen.getByRole('button', { name: 'Approve image' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve image' }));
    expect(screen.queryByTestId('review-portfolio-confirm')).not.toBeInTheDocument();
    fireEvent.load(image);
    expect(screen.getByRole('button', { name: 'Approve image' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve image' }));
    fireEvent.click(screen.getByTestId('review-portfolio-confirm'));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(JSON.parse(mock.history.patch[0].data)).toEqual({
      action: 'APPROVE',
      expectedRevision: 3,
    });
  });
  it('blocks approval for undecodable bytes and requires a fresh displayed preview after retry', async () => {
    setup();
    fireEvent.click(await screen.findByTestId('review-portfolio-open-image-1'));
    fireEvent.error(await screen.findByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve image' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject image' })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('The image could not be opened.');
    fireEvent.click(screen.getByTestId('review-portfolio-media-retry'));
    const image = await screen.findByRole('img');
    expect(screen.getByRole('button', { name: 'Approve image' })).toBeDisabled();
    fireEvent.load(image);
    expect(screen.getByRole('button', { name: 'Approve image' })).toBeEnabled();
    expect(mock.history.get.filter((request) => request.url?.endsWith('/media'))).toHaveLength(2);
    expect(mock.history.patch).toHaveLength(0);
  });
  it.each(['MEDIA_UNAVAILABLE', null] as const)(
    'lets reviewers reject missing media with replacement instructions (listed reason: %s)',
    async (listedReason) => {
      mock.onGet(ROOT).reply(200, {
        items: [{ ...item, reviewBlockedReason: listedReason, availableActions: ['REJECT'] }],
      });
      mock.onGet(`${ROOT}/image-1/media`).reply(404);
      mock
        .onPatch(`${ROOT}/image-1/review`)
        .reply(200, { ...item, moderationState: 'REJECTED', revision: 4 });
      setup();
      fireEvent.click(await screen.findByTestId('review-portfolio-open-image-1'));
      await screen.findByText('The image could not be opened.');
      expect(screen.queryByRole('button', { name: 'Approve image' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Reject image' }));
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'Please upload a readable replacement image.' },
      });
      fireEvent.click(screen.getByTestId('review-portfolio-confirm'));
      await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
      expect(JSON.parse(mock.history.patch[0].data)).toEqual({
        action: 'REJECT',
        expectedRevision: 3,
        reason: 'Please upload a readable replacement image.',
      });
    },
  );
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
