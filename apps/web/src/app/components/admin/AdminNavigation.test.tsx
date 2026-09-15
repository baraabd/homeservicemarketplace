import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, useLocation } from 'react-router';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { AdminDashboard } from './AdminDashboard';

vi.mock('../../../lib/auth-provider', () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock('../../../lib/use-auth-identity', () => ({ useAuthIdentity: () => ({}) }));
vi.mock('./AdminNotificationsBell', () => ({ AdminNotificationsBell: () => null }));
vi.mock('./AdminRouteContent', () => ({
  AdminRouteContent: () => {
    const location = useLocation();
    return (
      <>
        <output data-testid="location">
          {location.pathname + location.search + location.hash}
        </output>
        <Link to="?query=Ada">Filter results</Link>
        <Link to="/admin/providers/p1#portfolio">Open portfolio</Link>
        <Link to="#portfolio">Jump to portfolio</Link>
      </>
    );
  },
}));

function open(path = '/admin/reviews') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <AdminDashboard />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.setItem('hsm.lang', 'en');
});
afterEach(() => vi.restoreAllMocks());

describe('Admin navigation scroll and focus', () => {
  it('starts a new destination at the top without native main focus scrolling over its heading', () => {
    const scroll = vi.spyOn(window, 'scrollTo');
    open();
    const main = screen.getByRole('main');
    const focus = vi.spyOn(main, 'focus');

    fireEvent.click(screen.getByTestId('nav-providers'));

    expect(screen.getByTestId('location')).toHaveTextContent('/admin/providers');
    expect(main).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  it('preserves scroll position and control focus for query-only filtering', () => {
    const scroll = vi.spyOn(window, 'scrollTo');
    open();
    const filter = screen.getByRole('link', { name: 'Filter results' });
    filter.focus();

    fireEvent.click(filter);

    expect(screen.getByTestId('location')).toHaveTextContent('/admin/reviews?query=Ada');
    expect(filter).toHaveFocus();
    expect(scroll).not.toHaveBeenCalled();
  });

  it.each(['Open portfolio', 'Jump to portfolio'])(
    'does not replace the anchor destination with a top reset for %s',
    (name) => {
      const scroll = vi.spyOn(window, 'scrollTo');
      open();

      fireEvent.click(screen.getByRole('link', { name }));

      expect(screen.getByTestId('location')).toHaveTextContent('#portfolio');
      expect(scroll).not.toHaveBeenCalled();
    },
  );

  it('returns focus to mobile navigation without scrolling the page on dismissal', async () => {
    const scroll = vi.spyOn(window, 'scrollTo');
    open();
    const menu = screen.getByRole('button', { name: 'Open navigation' });
    const focus = vi.spyOn(menu, 'focus');

    fireEvent.click(menu);
    fireEvent.click(await screen.findByRole('button', { name: 'Close navigation' }));

    await waitFor(() => expect(menu).toHaveFocus());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroll).not.toHaveBeenCalled();
  });

  it('focuses the new content after selecting a destination from mobile navigation', async () => {
    const scroll = vi.spyOn(window, 'scrollTo');
    open();
    const main = screen.getByRole('main');
    const focus = vi.spyOn(main, 'focus');

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    fireEvent.click(await screen.findByTestId('mobile-nav-providers'));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(main).toHaveFocus();
    expect(focus.mock.calls.every(([options]) => options?.preventScroll === true)).toBe(true);
    expect(scroll).toHaveBeenCalledOnce();
  });
});
