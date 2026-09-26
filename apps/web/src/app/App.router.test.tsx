import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Isolate root RouterProvider wiring, not the authentication/backend contract.
vi.mock('../lib/auth-provider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./routes', async () => {
  const { createMemoryRouter } = await import('react-router');
  return {
    router: createMemoryRouter([
      { path: '/', element: <h1>Before navigation</h1> },
      { path: '/next', element: <h1 data-testid="committed-route">After navigation</h1> },
    ]),
  };
});

import App from './App';
import { router } from './routes';

afterEach(cleanup);

describe('S09 browser root router contract', () => {
  it('commits a flushSync navigation before the next DOM-dependent keyboard operation', () => {
    render(<App />);
    expect(screen.getByText('Before navigation')).toBeVisible();
    act(() => {
      void router.navigate('/next', { flushSync: true });
      // Deliberately assert IN the event, before act flushes batched updates.
      // Importing RouterProvider from react-router (without /dom) fails here:
      // its missing flushSync implementation leaves the previous panel active.
      expect(screen.getByTestId('committed-route')).toBeVisible();
      expect(screen.queryByText('Before navigation')).toBeNull();
    });
  });
});
