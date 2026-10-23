import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import { ProviderFinancialHistory } from './ProviderFinancialHistory';
const auth = vi.hoisted(() => ({ user: { id: 'provider-one' } as { id: string } | null }));
vi.mock('../../../lib/auth-provider', () => ({ useAuth: () => auth }));

describe('Provider financial history route wrapper', () => {
  let mock: MockAdapter;
  let client: QueryClient;
  beforeEach(() => {
    auth.user = { id: 'provider-one' };
    mock = new MockAdapter(api);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mock.onGet().reply(403, {});
  });
  afterEach(() => {
    cleanup();
    client.clear();
    mock.restore();
  });
  function mount() {
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProviderFinancialHistory />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }
  it('uses only self-scoped reads and never requests admin reconciliation or export', async () => {
    mount();
    expect(
      await screen.findByText('You do not have permission to read these financial records.'),
    ).toBeVisible();
    await waitFor(() => expect(mock.history.get).toHaveLength(1));
    expect(mock.history.get.map((request) => request.url).sort()).toEqual([
      '/v1/money/history/records',
    ]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Subscription payment history',
    );
    expect(screen.queryByRole('button', { name: 'Export this page' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to provider workspace' })).toHaveAttribute(
      'href',
      '/provider',
    );
  });
  it('does not issue finance reads without an authenticated identity', () => {
    auth.user = null;
    mount();
    expect(screen.getByText('Sign in to view financial records.')).toBeVisible();
    expect(mock.history.get).toHaveLength(0);
  });
  it('renders a successful history read without requesting an absent provider summary', async () => {
    mock.resetHandlers();
    mock.onGet('/v1/money/history/records').reply(200, {
      contractVersion: 'hsm.money.v1',
      reportVersion: 'hsm.finance-operations.v1',
      kind: 'PAYMENT',
      items: [],
      nextCursor: null,
      provenance: {
        readAt: '2026-10-23T04:11:34.000Z',
        source: 'AUTHORITATIVE_PERSISTENCE',
        cache: 'NO_STORE',
      },
      availability: { state: 'AVAILABLE', reason: null },
    });
    mount();
    expect(await screen.findByText('No records match this view.')).toBeVisible();
    expect(screen.getByText('My Plan is not configured on this surface.')).toBeVisible();
    for (const timestamp of screen.getAllByText(/Read at:/))
      expect(timestamp).toHaveTextContent('UTC');
    expect(screen.queryByText('Loading financial records…')).toBeNull();
    expect(screen.queryByText('Financial records could not be loaded.')).toBeNull();
    expect(mock.history.get.map((request) => request.url)).toEqual(['/v1/money/history/records']);
  });
});
