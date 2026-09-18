import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ApprovalCenter } from '../ApprovalCenter';
import { ApprovalRequestPreview } from '../ApprovalRequestPreview';
import type { AdminProviderSummary } from '@homeservicemarketplace/contracts';

const PATH = '/v1/admin/providers';
const COUNTS = { all: 127, pendingReview: 24, draft: 18, active: 73, returned: 9, suspended: 3 };
const provider: AdminProviderSummary = {
  id: 'provider-1', status: 'PENDING_REVIEW', userId: 'owner', email: 'review@example.test',
  displayName: 'Application owner', initials: 'AO', ratingAvg: 0, reviewCount: 0,
  completedJobs: 0, verified: false, topPro: false, serviceAreaCity: 'Damascus',
  serviceAreaCountry: 'Syria', reviewNotes: null, submittedForReviewAt: '2026-09-17T08:00:00Z',
  reviewedAt: null, rejectionReason: null, createdAt: '2026-09-16T08:00:00Z',
  updatedAt: '2026-09-17T08:00:00Z',
};
let mock: MockAdapter;
let qc: QueryClient;
function setup() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <LanguageProvider><ApprovalCenter /></LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => { localStorage.clear(); mock = new MockAdapter(api); });
afterEach(() => { cleanup(); qc?.clear(); mock.restore(); vi.restoreAllMocks(); });

describe('Approval center entry and truthful counts', () => {
  it('uses server totals rather than the preview length and links all four lifecycle views', async () => {
    mock.onGet(PATH).reply(200, { items: [provider], counts: COUNTS, total: 24, nextCursor: 'next' });
    setup();
    await screen.findByText('Application owner');
    expect(screen.getByTestId('approval-count-pendingReview')).toHaveTextContent('24');
    expect(screen.getByTestId('approval-count-draft').closest('a')).toHaveAttribute('href', '/admin/providers?status=DRAFT');
    expect(screen.getByTestId('approval-count-active').closest('a')).toHaveAttribute('href', '/admin/providers?status=ACTIVE');
    expect(screen.getByTestId('approval-count-returned').closest('a')).toHaveAttribute('href', '/admin/reviews?status=REJECTED');
    expect(mock.history.get[0].params).toEqual(expect.objectContaining({ status: 'PENDING_REVIEW', sort: 'SUBMITTED_OLDEST', limit: 3 }));
    expect(screen.queryByTestId('review-approve')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review file: Application owner' })).toHaveAttribute('href', '/admin/providers/provider-1?returnTo=%2Fadmin');
  });
  it('shows a real zero only when the API supplies it', async () => {
    mock.onGet(PATH).reply(200, { items: [], counts: { ...COUNTS, pendingReview: 0 }, total: 0, nextCursor: null });
    setup();
    await screen.findByText('No applications awaiting review');
    expect(screen.getByTestId('approval-count-pendingReview')).toHaveTextContent('0');
  });
  it('keeps missing legacy totals unknown', async () => {
    mock.onGet(PATH).reply(200, { items: [], nextCursor: null });
    setup();
    await screen.findByText('No applications awaiting review');
    expect(screen.getByTestId('approval-count-pendingReview')).toHaveTextContent('—');
  });
  it.each([403, 500])('does not retain stale profile links or totals after HTTP %s', async (status) => {
    mock.onGet(PATH).reply(200, { items: [provider], counts: COUNTS, nextCursor: null });
    setup();
    await screen.findByText('Application owner');
    mock.onGet(PATH).reply(status, { error: { code: status === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR' } });
    fireEvent.click(screen.getByTestId('approval-refresh'));
    await waitFor(() => expect(screen.queryByText('Application owner')).not.toBeInTheDocument());
    expect(screen.getByTestId('approval-count-pendingReview')).toHaveTextContent('—');
    expect(screen.queryByText('No applications awaiting review')).not.toBeInTheDocument();
  });
  it('renders Arabic and RTL from the existing language preference', async () => {
    localStorage.setItem('hsm.lang', 'ar');
    mock.onGet(PATH).reply(200, { items: [], counts: COUNTS, nextCursor: null });
    setup();
    await screen.findByText('لا توجد طلبات بانتظار المراجعة');
    expect(screen.getByTestId('admin-approval-center')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'مركز موافقات المهنيين' })).toBeInTheDocument();
  });
  it('escapes the route segment and does not infer work access from legacy profile status', () => {
    render(<MemoryRouter><ApprovalRequestPreview provider={{ ...provider, id: 'id/unsafe', status: 'ACTIVE' }} lang="en" /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Review file: Application owner' })).toHaveAttribute('href', '/admin/providers/id%2Funsafe?returnTo=%2Fadmin');
    expect(screen.getByText('Work access not reported')).toBeInTheDocument();
  });
});
