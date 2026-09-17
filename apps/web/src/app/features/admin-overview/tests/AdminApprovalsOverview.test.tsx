import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ListAdminProvidersResponse } from '@homeservicemarketplace/contracts';
import { useAdminProviders } from '../../../hooks/admin/useAdminProviders';
import { AdminApprovalsOverview } from '../AdminApprovalsOverview';
import { APPROVAL_OVERVIEW_QUERY } from '../queries';
import { ADMIN_OVERVIEW_COPY } from '../copy';

vi.mock('../../../hooks/admin/useAdminProviders', () => ({ useAdminProviders: vi.fn() }));
const refetch = vi.fn();
const response: ListAdminProvidersResponse = {
  items: [{
    id: 'review-1', userId: 'owner-1', status: 'PENDING_REVIEW', displayName: 'Test applicant', initials: 'TA',
    email: 'applicant@example.test', ratingAvg: 0, reviewCount: 0, completedJobs: 0,
    verified: false, topPro: false, serviceAreaCity: 'Damascus', serviceAreaCountry: 'Syria', reviewNotes: null,
    createdAt: '2026-09-01T09:00:00Z', updatedAt: '2026-09-01T09:00:00Z', submittedForReviewAt: '2026-09-01T09:00:00Z',
    verificationState: 'UNVERIFIED', workAccess: { canWork: false, hasLiveGrant: false, denialReason: 'AWAITING_REVIEW' },
  }],
  total: 127, nextCursor: 'more',
  counts: { all: 250, pendingReview: 127, active: 90, returned: 12, draft: 20, suspended: 1 },
};
function state(overrides: object = {}) {
  vi.mocked(useAdminProviders).mockReturnValue({
    data: response, isPending: false, isError: false, isFetching: false,
    dataUpdatedAt: Date.parse('2026-09-17T09:00:00Z'), error: null, refetch,
    ...overrides,
  } as ReturnType<typeof useAdminProviders>);
}
function mount(lang: 'en' | 'ar' = 'en') {
  return render(<MemoryRouter><AdminApprovalsOverview lang={lang} /></MemoryRouter>);
}
beforeEach(() => { vi.clearAllMocks(); state(); });
afterEach(cleanup);

describe('Admin approvals entry', () => {
  it.each(['en', 'ar'] as const)('shows server totals rather than preview length in %s', (lang) => {
    mount(lang);
    expect(useAdminProviders).toHaveBeenCalledWith(APPROVAL_OVERVIEW_QUERY);
    expect(screen.getByTestId('overview-count-pendingReview')).toHaveTextContent((127).toLocaleString(lang));
    expect(screen.getByTestId('overview-count-draft')).toHaveTextContent((20).toLocaleString(lang));
    expect(screen.getAllByTestId(/^approval-preview-/)).toHaveLength(1);
    expect(screen.getByTestId('admin-approvals-overview')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  });
  it('opens the existing dossier instead of offering a shortcut approval', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Review application: Test applicant' })).toHaveAttribute('href', '/admin/providers/review-1?returnTo=%2Fadmin%2Freviews');
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('overview-open-queue')).toHaveAttribute('href', '/admin/reviews');
  });
  it('keeps unknown aggregates unknown for a compatible older API', () => {
    state({ data: { items: response.items, nextCursor: null } }); mount();
    expect(screen.getByTestId('overview-count-pendingReview')).toHaveTextContent('—');
  });
  it('does not confuse a loading request with an empty queue', () => {
    state({ data: undefined, isPending: true, isFetching: true }); mount();
    expect(screen.getByRole('status')).toHaveTextContent(ADMIN_OVERVIEW_COPY.en.loading);
    expect(screen.queryByText(ADMIN_OVERVIEW_COPY.en.empty)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: ADMIN_OVERVIEW_COPY.en.refresh })).toBeDisabled();
  });
  it('explains the difference between drafts and a genuinely empty queue', () => {
    state({ data: { ...response, items: [], total: 0, counts: { ...response.counts, pendingReview: 0 } } }); mount();
    expect(screen.getByRole('status')).toHaveTextContent(ADMIN_OVERVIEW_COPY.en.emptyHint);
    expect(screen.getByTestId('overview-count-draft')).toHaveTextContent('20');
  });
  it('hides cached identities and totals when a refresh is forbidden', () => {
    state({ isError: true, error: { response: { status: 403 } } }); mount();
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission');
    expect(screen.queryByText('Test applicant')).not.toBeInTheDocument();
    expect(screen.getByTestId('overview-count-pendingReview')).toHaveTextContent('—');
    expect(screen.queryByText(ADMIN_OVERVIEW_COPY.en.empty)).not.toBeInTheDocument();
  });
  it('offers an actual retry on a failed read', () => {
    state({ isError: true, error: { response: { status: 503 } } }); mount();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
  it('refreshes the same query rather than another state store', () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: ADMIN_OVERVIEW_COPY.en.refresh }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
