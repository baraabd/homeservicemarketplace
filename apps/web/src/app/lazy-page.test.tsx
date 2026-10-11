import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { LanguageProvider } from './i18n/LanguageContext';
import { lazyPage } from './lazy-page';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('deferred page recovery', () => {
  it.each([
    ['en', 'ltr', 'Loading the page…'],
    ['ar', 'rtl', 'جارٍ تحميل الصفحة…'],
  ] as const)(
    'keeps the shell visible and uses the active %s language while loading',
    async (lang, dir, copy) => {
      localStorage.setItem('hsm.lang', lang);
      let resolve!: (value: { default: ComponentType }) => void;
      const load = vi.fn(
        () =>
          new Promise<{ default: ComponentType }>((done) => {
            resolve = done;
          }),
      );
      const Page = lazyPage(load);
      expect(load).not.toHaveBeenCalled();

      render(
        <LanguageProvider>
          <header>Existing shell</header>
          <Page />
        </LanguageProvider>,
      );
      const shell = screen.getByText('Existing shell');
      expect(shell).toBeVisible();
      expect(screen.getByRole('status')).toHaveTextContent(copy);
      expect(screen.getByRole('status')).toHaveAttribute('lang', lang);
      expect(screen.getByRole('status')).toHaveAttribute('dir', dir);
      expect(screen.getByRole('status').querySelector('[aria-hidden="true"]')).not.toBeNull();

      await act(async () => {
        resolve({ default: () => <h1>Loaded page</h1> });
      });
      expect(await screen.findByRole('heading', { name: 'Loaded page' })).toBeVisible();
      expect(screen.getByText('Existing shell')).toBe(shell);
      expect(screen.queryByRole('status')).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['en', 'The page could not load. Reload it to try again.', 'Reload page'],
    ['ar', 'تعذّر تحميل الصفحة. أعد تحميلها للمحاولة مجددًا.', 'إعادة تحميل الصفحة'],
  ] as const)(
    'gives a safe %s recovery action for a failed top-level chunk',
    async (lang, copy, action) => {
      localStorage.setItem('hsm.lang', lang);
      const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => {});
      const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
      const Page = lazyPage(
        () => Promise.reject(new Error('internal chunk path /private-build.js')),
        { standalone: true },
      );

      render(<Page />);
      expect(await screen.findByRole('alert')).toHaveTextContent(copy);
      expect(screen.queryByText(/private-build/)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: action, exact: true }));
      expect(reload).toHaveBeenCalledTimes(1);
      // Keep the developer diagnostic; only the user-facing text is sanitized.
      expect(diagnostics).toHaveBeenCalled();
    },
  );
});
