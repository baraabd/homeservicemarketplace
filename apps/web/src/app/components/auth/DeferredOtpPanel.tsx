import { lazy, useState, type ComponentType } from 'react';
import { AsyncBoundary } from '../../AsyncBoundary';
import { useLang } from '../../i18n/LanguageContext';
import { Button } from '../ds/Button';
import type { EmailOtpPanelProps } from './otp-types';

type PanelLoader = () => Promise<{ default: ComponentType<EmailOtpPanelProps> }>;
const loadOtpPanel: PanelLoader = () =>
  import('./EmailOtpPanel').then((module) => ({ default: module.EmailOtpPanel }));

/** Mount only for the challenge step; retries keep the parent's challenge intact. */
export function DeferredOtpPanel({
  loadPanel = loadOtpPanel,
  ...props
}: EmailOtpPanelProps & { loadPanel?: PanelLoader }) {
  const { lang, dir } = useLang();
  const busy = props.isVerifying || props.isResending;
  // A failed React.lazy promise is cached. Only an explicit retry creates a
  // fresh loader and boundary; normal language/parent rerenders keep OTP input.
  const [{ Panel, attempt }, setAttempt] = useState(() => ({
    Panel: lazy(loadPanel),
    attempt: 0,
  }));
  return (
    <AsyncBoundary
      key={attempt}
      error={
        <section className="flex flex-col gap-4" dir={dir}>
          <p role="alert" className="text-sm text-slate-700">
            {lang === 'ar'
              ? 'تعذّر تحميل نموذج التحقق. أعد المحاولة للمتابعة.'
              : 'The verification form could not load. Try again to continue.'}
          </p>
          <Button
            contrast="strong"
            variant="primary"
            tone={props.experience?.id ?? 'seeker'}
            state={busy ? 'disabled' : 'default'}
            onClick={() =>
              setAttempt((current) => ({ Panel: lazy(loadPanel), attempt: current.attempt + 1 }))
            }
          >
            {lang === 'ar' ? 'إعادة المحاولة' : 'Try again'}
          </Button>
          {props.onRestart && (
            <button
              type="button"
              className="min-h-11 text-sm underline disabled:opacity-50"
              disabled={busy}
              onClick={props.onRestart}
            >
              {props.restartLabel ??
                (lang === 'ar' ? 'بدء تسجيل الدخول مجدداً' : 'Start sign-in again')}
            </button>
          )}
        </section>
      }
    >
      <Panel {...props} />
    </AsyncBoundary>
  );
}
