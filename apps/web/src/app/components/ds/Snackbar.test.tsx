import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LangToggle, LanguageProvider } from '../../i18n/LanguageContext';
import { Snackbar } from './Snackbar';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Snackbar dismissal', () => {
  it.each([
    ['en', 'Dismiss notification'],
    ['ar', 'إغلاق الإشعار'],
  ] as const)(
    'names the focusable close button in %s and keeps the dismissal callback',
    (lang, name) => {
      localStorage.setItem('hsm.lang', lang);
      const onDismiss = vi.fn();
      render(
        <LanguageProvider>
          <Snackbar visible message="Connection notice" duration={0} onDismiss={onDismiss} />
        </LanguageProvider>,
      );
      const dismiss = screen.getByRole('button', { name });
      expect(dismiss).toHaveAttribute('type', 'button');
      expect(dismiss).toHaveClass('h-11', 'w-11', 'focus-visible:outline-2');
      expect(dismiss.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      act(() => dismiss.focus());
      expect(dismiss).toHaveFocus();
      fireEvent.click(dismiss);
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(320));
      expect(onDismiss).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name })).toBeNull();
    },
  );

  it('updates the accessible name without dismissing the active notification on language change', () => {
    const onDismiss = vi.fn();
    render(
      <LanguageProvider>
        <LangToggle />
        <Snackbar visible message="Connection notice" duration={0} onDismiss={onDismiss} />
      </LanguageProvider>,
    );
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    fireEvent.click(screen.getByTestId('lang-toggle'));
    expect(screen.getByRole('button', { name: 'إغلاق الإشعار' })).toBe(dismiss);
    expect(screen.getByText('Connection notice')).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
