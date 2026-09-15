import { afterEach, beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../../../../lib/api';
import { UsersSection } from '../components/UsersSection';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => mock.restore());

it('localizes Arabic roles and account states while preserving canonical API filters', async () => {
  mock.onGet('/v1/admin/roles').reply(200, { items: [{ id: 'role-provider', name: 'provider' }] });
  mock.onGet('/v1/admin/users').reply(200, {
    items: [
      {
        id: 'u1',
        firstName: 'ليلى',
        lastName: 'منصور',
        email: 'layla@example.com',
        roles: ['provider'],
        status: 'ACTIVE',
        createdAt: '2026-09-01T12:00:00.000Z',
      },
    ],
    nextCursor: null,
  });
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <UsersSection lang="ar" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const providerOption = await screen.findByRole('option', { name: 'مهني' });
  expect(providerOption).toHaveAttribute('value', 'provider');
  expect(await screen.findByTestId('badge-account-status')).toHaveTextContent('نشط');
  fireEvent.change(screen.getByRole('combobox', { name: 'الدور' }), {
    target: { value: 'provider' },
  });
  await waitFor(() =>
    expect(
      mock.history.get.filter((request) => request.url === '/v1/admin/users').at(-1)?.params.role,
    ).toBe('provider'),
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'الحالة' }), {
    target: { value: 'SUSPENDED' },
  });
  await waitFor(() =>
    expect(
      mock.history.get.filter((request) => request.url === '/v1/admin/users').at(-1)?.params,
    ).toMatchObject({ role: 'provider', status: 'SUSPENDED' }),
  );
});
