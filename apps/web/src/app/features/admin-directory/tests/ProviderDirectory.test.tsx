import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../../../../lib/api';
import { LanguageProvider } from '../../../i18n/LanguageContext';
import { ProviderDirectory } from '../components/ProviderDirectory';

const provider = (id: string, name: string) => ({
  id,
  userId: `account-${id}`,
  displayName: name,
  initials: 'AP',
  email: `${id}@example.com`,
  serviceAreaCity: 'Damascus',
  serviceAreaCountry: 'Syria',
  status: 'PENDING_REVIEW',
  submittedForReviewAt: '2026-09-01T10:00:00.000Z',
  account: { status: 'ACTIVE', isActive: true, deletedAt: null },
  onboardingState: 'SUBMITTED',
  verificationState: 'PENDING',
  portfolio: { total: 3, pending: 2, approved: 1, rejected: 0 },
  verificationCase: {
    id: 'case-1',
    state: 'IN_REVIEW',
    submittedAt: '2026-09-01T10:00:00.000Z',
    assignedTo: { id: 'reviewer-1', name: 'Maya Reviewer' },
  },
  workAccess: { canWork: false, hasLiveGrant: false, denialReason: 'AWAITING_REVIEW' },
  attentionReasons: ['IDENTITY_IN_REVIEW', 'PORTFOLIO_REVIEW_REQUIRED'],
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="directory-location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderDirectory(initialEntry = '/admin/providers', reviewQueue = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <LanguageProvider>
          <ProviderDirectory reviewQueue={reviewQueue} />
          <LocationProbe />
        </LanguageProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

let mock: MockAdapter;
beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('hsm.lang', 'en');
  mock = new MockAdapter(api);
});
afterEach(() => mock.restore());

describe('ProviderDirectory', () => {
  it('requests every status by default and restores account/search filters from a deep link', async () => {
    mock
      .onGet('/v1/admin/providers')
      .reply(200, { items: [provider('p1', 'Ada Provider')], nextCursor: null });
    renderDirectory('/admin/providers?query=Ada&userId=account-p1');
    await screen.findByRole('link', { name: 'Open profile Ada Provider' });
    expect(mock.history.get[0].params).toEqual({
      status: 'ALL',
      sort: 'UPDATED_NEWEST',
      query: 'Ada',
      userId: 'account-p1',
      limit: 50,
    });
    expect(screen.getByRole('searchbox')).toHaveValue('Ada');
  });

  it('defaults the application queue to awaiting review', async () => {
    mock.onGet('/v1/admin/providers').reply(200, { items: [], nextCursor: null });
    renderDirectory('/admin/reviews', true);
    await screen.findByText('No requests match these filters.');
    expect(mock.history.get[0].params.status).toBe('PENDING_REVIEW');
    expect(mock.history.get[0].params.sort).toBe('SUBMITTED_OLDEST');
  });

  it('reaches the next page and preserves the cursor and filters in the profile return link', async () => {
    mock
      .onGet('/v1/admin/providers')
      .reply(({ params }) => [
        200,
        params.cursor
          ? { items: [provider('p51', 'Page Two')], nextCursor: null }
          : { items: [provider('p1', 'Page One')], nextCursor: 'p50' },
      ]);
    renderDirectory('/admin/providers?status=ACTIVE&query=Page');
    await screen.findByText('Page One');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const profileLink = await screen.findByRole('link', { name: 'Open profile Page Two' });
    expect(mock.history.get.at(-1)?.params).toEqual({
      status: 'ACTIVE',
      sort: 'UPDATED_NEWEST',
      query: 'Page',
      cursor: 'p50',
      limit: 50,
    });
    const target = new URL(profileLink.getAttribute('href')!, 'https://example.com');
    const returnTo = target.searchParams.get('returnTo')!;
    expect(new URL(returnTo, 'https://example.com').searchParams.get('cursor')).toBe('p50');
    expect(new URL(returnTo, 'https://example.com').searchParams.get('query')).toBe('Page');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('Page One');
    expect(screen.getByTestId('directory-location').textContent).not.toContain('cursor=');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('resets the cursor trail when search changes without discarding the status', async () => {
    mock.onGet('/v1/admin/providers').reply(200, { items: [], nextCursor: null });
    renderDirectory('/admin/providers?status=ACTIVE&cursor=p50&previousCursor=&query=old');
    await screen.findByText('No profiles match these filters.');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  New name  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(mock.history.get.at(-1)?.params.query).toBe('New name'));
    expect(mock.history.get.at(-1)?.params).toEqual({
      status: 'ACTIVE',
      sort: 'UPDATED_NEWEST',
      query: 'New name',
      limit: 50,
    });
    expect(screen.getByTestId('directory-location').textContent).not.toContain('Cursor');
    expect(screen.getByTestId('directory-location').textContent).not.toContain('cursor');
  });

  it('renders server totals across pages and preserves independent work access', async () => {
    mock.onGet('/v1/admin/providers').reply(200, {
      items: [
        {
          ...provider('p1', 'Ada Provider'),
          status: 'ACTIVE',
          workAccess: { canWork: false, hasLiveGrant: true, denialReason: 'ACCOUNT_INELIGIBLE' },
        },
      ],
      total: 120,
      counts: { all: 120, pendingReview: 48, active: 62, returned: 5, suspended: 4, draft: 1 },
      nextCursor: 'p2',
    });
    renderDirectory();
    await screen.findByText('Ada Provider');
    expect(screen.getByTestId('directory-total')).toHaveTextContent('120');
    expect(screen.getByTestId('directory-count-PENDING_REVIEW')).toHaveTextContent('48');
    const row = within(screen.getByTestId('provider-row-p1'));
    expect(row.getByText('Accepted')).toBeInTheDocument();
    expect(row.getByText('Not enabled')).toBeInTheDocument();
    expect(row.getByText('Live work grant')).toBeInTheDocument();
    expect(row.getByText('Account unavailable')).toBeInTheDocument();
    expect(row.queryByText('Can take work')).not.toBeInTheDocument();
    expect(row.getByText('2 awaiting review')).toBeInTheDocument();
  });

  it('does not fabricate submission or totals for an older response with missing fields', async () => {
    const item = {
      ...provider('p1', 'Legacy Provider'),
      submittedForReviewAt: null,
      attentionReasons: ['APPLICATION_NOT_SUBMITTED'],
    };
    mock.onGet('/v1/admin/providers').reply(200, { items: [item], nextCursor: null });
    renderDirectory();
    await screen.findByText('Legacy Provider');
    expect(screen.getByText('Submission date unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Not submitted yet')).not.toBeInTheDocument();
    expect(screen.getByTestId('directory-total')).toHaveTextContent('—');
    expect(screen.getByTestId('directory-count-ALL')).toHaveTextContent('—');
  });

  it('shows the identity assignee, semantic submission date and server attention in the queue', async () => {
    mock
      .onGet('/v1/admin/providers')
      .reply(200, { items: [provider('p1', 'Ada Provider')], nextCursor: null });
    renderDirectory(
      '/admin/reviews?assignment=MINE&identityState=PENDING&portfolioState=PENDING',
      true,
    );
    await screen.findByText('Ada Provider');
    expect(screen.getByText('Maya Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Inspect identity evidence')).toBeInTheDocument();
    expect(screen.getByText('Review portfolio images')).toBeInTheDocument();
    expect(screen.getByTestId('provider-row-p1').querySelector('time')).toHaveAttribute(
      'datetime',
      '2026-09-01T10:00:00.000Z',
    );
    expect(mock.history.get[0].params).toMatchObject({
      assignment: 'MINE',
      identityState: 'PENDING',
      portfolioState: 'PENDING',
      sort: 'SUBMITTED_OLDEST',
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Identity reviewer' }), {
      target: { value: 'UNASSIGNED' },
    });
    await waitFor(() => expect(mock.history.get.at(-1)?.params.assignment).toBe('UNASSIGNED'));
  });

  it('keeps Arabic status labels and direction across independent axes', async () => {
    window.localStorage.setItem('hsm.lang', 'ar');
    mock
      .onGet('/v1/admin/providers')
      .reply(200, { items: [provider('p1', 'ليلى منصور')], nextCursor: null });
    renderDirectory('/admin/reviews', true);
    await screen.findByText('ليلى منصور');
    expect(screen.getByTestId('admin-review-directory')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('فحص مستندات الهوية')).toBeInTheDocument();
    expect(screen.getByText('غير مفعّل للعمل')).toBeInTheDocument();
    expect(screen.queryByText('PENDING_REVIEW')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'فتح الملف ليلى منصور' })).toHaveTextContent(
      'مراجعة الطلب',
    );
  });

  it.each([
    ['en', 'Not verified', 'Not available'],
    ['ar', 'غير موثّق', 'غير متاح'],
  ])(
    'distinguishes a null identity axis from missing or unknown data in %s',
    async (lang, unverified, unavailable) => {
      window.localStorage.setItem('hsm.lang', lang);
      mock.onGet('/v1/admin/providers').reply(200, {
        items: [
          { ...provider('null-axis', 'Not Yet Verified'), verificationState: null },
          { ...provider('missing-axis', 'Older Response'), verificationState: undefined },
          { ...provider('unknown-axis', 'Future Response'), verificationState: 'FUTURE_STATE' },
        ],
        nextCursor: null,
      });
      renderDirectory('/admin/reviews', true);

      const unverifiedRow = within(await screen.findByTestId('provider-row-null-axis'));
      expect(unverifiedRow.getByText(unverified)).toBeInTheDocument();
      expect(unverifiedRow.queryByText(unavailable)).not.toBeInTheDocument();
      for (const id of ['missing-axis', 'unknown-axis']) {
        const row = within(screen.getByTestId(`provider-row-${id}`));
        expect(row.getByText(unavailable)).toBeInTheDocument();
        expect(row.queryByText(unverified)).not.toBeInTheDocument();
        expect(row.queryByText('FUTURE_STATE')).not.toBeInTheDocument();
      }
    },
  );

  it('shows a forbidden response distinctly from an empty directory without a retry loop', async () => {
    mock.onGet('/v1/admin/providers').reply(403);
    renderDirectory();
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
    expect(screen.queryByText('No profiles match these filters.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
