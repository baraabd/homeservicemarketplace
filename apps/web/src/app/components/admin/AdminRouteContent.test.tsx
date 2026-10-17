import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { AdminRouteContent } from './AdminRouteContent';

// Component contract doubles only: the real-route browser gate separately
// checks the emitted chunk and the real authenticated API.
const charts = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release, requested: false, failed: false };
});
vi.mock('./DashboardOverview', async () => {
  charts.requested = true;
  await charts.ready;
  return {
    DashboardOverview: () => {
      if (charts.failed) throw new Error('synthetic chart failure');
      return <p>Loaded charts</p>;
    },
  };
});
vi.mock('../../features/admin-approvals/ApprovalCenter', () => ({
  ApprovalCenter: () => <button type="button">Approval queue remains usable</button>,
}));
vi.mock('../../features/admin-directory/components/UsersSection', () => ({
  UsersSection: () => <p>User directory</p>,
}));

function view(section: 'users' | 'dashboard') {
  return (
    <MemoryRouter>
      <LanguageProvider>
        <AdminRouteContent route={{ kind: 'section', section }} />
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('admin chart isolation', () => {
  it('does not request charts for users and keeps approvals visible while charts load', async () => {
    const page = render(view('users'));
    expect(screen.getByText('User directory')).toBeInTheDocument();
    expect(charts.requested).toBe(false);
    page.rerender(view('dashboard'));
    expect(screen.getByRole('button', { name: 'Approval queue remains usable' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the page');
    await act(async () => {
      charts.release();
      await charts.ready;
    });
    expect(await screen.findByText('Loaded charts')).toBeInTheDocument();
  });

  it.each(['en', 'ar'])(
    'keeps approvals and localized recovery after chart failure (%s)',
    async (lang) => {
      localStorage.setItem('hsm.lang', lang);
      charts.failed = true;
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        render(view('dashboard'));
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        const retry = screen.getByRole('button', {
          name: lang === 'ar' ? 'إعادة تحميل الصفحة' : 'Reload page',
        });
        expect(retry).toBeEnabled();
        retry.focus();
        expect(retry).toHaveFocus();
        expect(screen.getByRole('button', { name: 'Approval queue remains usable' })).toBeEnabled();
        expect(document.documentElement.dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
      } finally {
        charts.failed = false;
        error.mockRestore();
      }
    },
  );
});
