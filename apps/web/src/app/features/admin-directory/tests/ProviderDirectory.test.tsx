import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      query: 'Ada',
      userId: 'account-p1',
      limit: 50,
    });
    expect(screen.getByRole('searchbox')).toHaveValue('Ada');
  });

  it('defaults the application queue to awaiting review', async () => {
    mock.onGet('/v1/admin/providers').reply(200, { items: [], nextCursor: null });
    renderDirectory('/admin/reviews', true);
    await screen.findByText('No profiles match these filters.');
    expect(mock.history.get[0].params.status).toBe('PENDING_REVIEW');
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
      query: 'New name',
      limit: 50,
    });
    expect(screen.getByTestId('directory-location').textContent).not.toContain('Cursor');
    expect(screen.getByTestId('directory-location').textContent).not.toContain('cursor');
  });

  it('shows a forbidden response distinctly from an empty directory without a retry loop', async () => {
    mock.onGet('/v1/admin/providers').reply(403);
    renderDirectory();
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
    expect(screen.queryByText('No profiles match these filters.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
