import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../lib/api';
import { AdminFinancialOperations } from './AdminFinancialOperations';
vi.mock('../../../lib/auth-provider', () => ({ useAuth: () => ({ user: { id: 'admin-one' } }) }));

describe('Admin financial route wrapper', () => {
  let mock: MockAdapter;
  let client: QueryClient;
  beforeEach(() => {
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
          <AdminFinancialOperations />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }
  it('shows a guarded denial rather than fabricated finance totals', async () => {
    mount();
    expect(
      await screen.findByText('You do not have permission to read these financial records.'),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Financial operations', level: 1 })).toBeVisible();
    expect(screen.queryByText('Confirmed collections')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export this page' })).toBeNull();
    await waitFor(() => expect(mock.history.get).toHaveLength(3));
    expect(
      mock.history.get.every((request) => request.url?.startsWith('/v1/money/operations/')),
    ).toBe(true);
  });
  it('uses persisted Arabic on the first render with a semantic RTL root', async () => {
    localStorage.setItem('hsm.lang', 'ar');
    mount();
    expect(
      await screen.findByText('لا تملك صلاحية الاطلاع على هذه السجلات المالية.'),
    ).toBeVisible();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('link', { name: 'العودة إلى تقارير الحجوزات' })).toHaveAttribute(
      'href',
      '/admin/financials',
    );
  });
});
