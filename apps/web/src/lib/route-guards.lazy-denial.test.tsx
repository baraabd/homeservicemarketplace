import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazyPage } from '../app/lazy-page';

const state = vi.hoisted(() => ({ adminImports: 0 }));

vi.mock('./auth-provider', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: { id: 'provider-only', roles: ['provider'], email: 'provider@example.test' },
  }),
}));
vi.mock('../app/pages/AdminPage', () => {
  state.adminImports++;
  return { AdminPage: () => <h1>Protected Admin workspace</h1> };
});
vi.mock('../app/components/admin/AdminAccessRequired', () => {
  throw new Error('private denial chunk /internal/admin-denial.js is unavailable');
});

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Admin denial chunk recovery', () => {
  it.each([
    ['en', 'ltr', 'The page could not load. Reload it to try again.', 'Reload page'],
    ['ar', 'rtl', 'تعذّر تحميل الصفحة. أعد تحميلها للمحاولة مجددًا.', 'إعادة تحميل الصفحة'],
  ] as const)(
    'keeps an unauthorized user outside Admin when the denial display fails in %s',
    async (lang, dir, message, action) => {
      localStorage.setItem('hsm.lang', lang);
      const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => {});
      const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
      // Importing the guard must not fetch the optional denial display. Its
      // failure belongs inside the existing standalone recovery boundary.
      const { RequireAdmin } = await import('./route-guards');
      const AdminPage = lazyPage(() =>
        import('../app/pages/AdminPage').then((module) => ({ default: module.AdminPage })),
      );
      render(
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route element={<RequireAdmin />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(alert.closest('section')).toHaveAttribute('lang', lang);
      expect(alert.closest('section')).toHaveAttribute('dir', dir);
      expect(screen.queryByText(/internal\/admin-denial/)).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Protected Admin workspace' })).toBeNull();
      expect(state.adminImports).toBe(0);
      fireEvent.click(screen.getByRole('button', { name: action, exact: true }));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(diagnostics).toHaveBeenCalled();
    },
  );
});
