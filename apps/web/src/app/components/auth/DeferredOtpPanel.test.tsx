import { useState, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLang } from '../../i18n/LanguageContext';
import { DeferredOtpPanel } from './DeferredOtpPanel';
import { EmailOtpPanel } from './EmailOtpPanel';

type Loader = NonNullable<ComponentProps<typeof DeferredOtpPanel>['loadPanel']>;

function LanguageControl() {
  const { toggleLang } = useLang();
  return <button onClick={toggleLang}>Change language</button>;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('deferred verification panel', () => {
  it.each([
    ['en', 'Try again', 'Confirm', 'isVerifying'],
    ['ar', 'إعادة المحاولة', 'تأكيد', 'isResending'],
  ] as const)(
    'retries a failed %s chunk without replacing the challenge or sending another code',
    async (lang, retry, confirm, busyProp) => {
      localStorage.setItem('hsm.lang', lang);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
      const loadPanel = vi
        .fn<Loader>()
        .mockRejectedValueOnce(new Error('private build chunk /internal/verification.js'))
        .mockResolvedValue({ default: EmailOtpPanel });
      const verify = vi.fn().mockResolvedValue(undefined);
      const resend = vi.fn().mockResolvedValue(undefined);
      const restart = vi.fn();
      function Challenge({ busy = false }: { busy?: boolean }) {
        const [challengeId] = useState('original-challenge');
        return (
          <DeferredOtpPanel
            loadPanel={loadPanel}
            email="+966 •••• 4567"
            channel="whatsapp"
            codeLength={6}
            onVerify={(code) => verify(challengeId, code)}
            onResend={resend}
            onRestart={restart}
            restartLabel="Restart verification"
            {...{ [busyProp]: busy }}
          />
        );
      }
      const view = render(
        <LanguageProvider>
          <Challenge busy />
        </LanguageProvider>,
      );
      expect(await screen.findByRole('alert')).not.toHaveTextContent('/internal/');
      expect(verify).not.toHaveBeenCalled();
      expect(resend).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: retry, exact: true })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Restart verification' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: retry, exact: true }));
      fireEvent.click(screen.getByRole('button', { name: 'Restart verification' }));
      expect(loadPanel).toHaveBeenCalledTimes(1);
      expect(restart).not.toHaveBeenCalled();
      view.rerender(
        <LanguageProvider>
          <Challenge />
        </LanguageProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: retry, exact: true }));
      const input = await screen.findByTestId('otp-input');
      expect(screen.getByText('+966 •••• 4567')).toBeVisible();
      fireEvent.change(input, { target: { value: '١٢٣٤٥٦' } });
      fireEvent.click(screen.getByRole('button', { name: confirm, exact: true }));
      expect(verify).toHaveBeenCalledExactlyOnceWith('original-challenge', '123456');
      expect(resend).not.toHaveBeenCalled();
      expect(restart).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      expect(loadPanel).toHaveBeenCalledTimes(2);
    },
  );

  it('uses the existing accessible loader and keeps partial OTP input through language changes', async () => {
    let resolve!: (panel: Awaited<ReturnType<Loader>>) => void;
    const loadPanel = vi.fn<Loader>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(
      <LanguageProvider>
        <LanguageControl />
        <DeferredOtpPanel
          loadPanel={loadPanel}
          email="v•••@example.test"
          codeLength={6}
          onVerify={vi.fn().mockResolvedValue(undefined)}
          onResend={vi.fn().mockResolvedValue(undefined)}
        />
      </LanguageProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading the page…');
    fireEvent.click(screen.getByRole('button', { name: 'Change language' }));
    expect(screen.getByRole('status')).toHaveAttribute('dir', 'rtl');
    expect(loadPanel).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ default: EmailOtpPanel }));
    const input = screen.getByTestId('otp-input');
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change language' }));
    expect(screen.getByTestId('otp-input')).toBe(input);
    expect(input).toHaveValue('123');
    expect(loadPanel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
