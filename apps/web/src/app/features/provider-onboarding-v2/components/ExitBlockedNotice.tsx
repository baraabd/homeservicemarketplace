import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react';

import { EXIT_COPY, type Lang } from '../copy/exit-copy';
import { isRetryable, type ExitState } from '../autosave/useOnboardingExit';

// Sprint 9B.28 — why the provider is still on this screen.
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
//
// A blocked exit is the ONE moment where the app refuses something the
// provider explicitly asked for. Refusing silently — which is the failure mode
// a naive `await flush(); navigate()` produces when the flush rejects — reads
// as a broken button. So this states the reason, says the work is still held,
// and offers the action that actually resolves the case in hand.
//
// `assertive`, not `polite`. Every other status on these screens is polite
// because it narrates background work; this one interrupts a navigation the
// provider is waiting on, and a screen-reader user who has already moved on
// would otherwise never learn the exit did not happen.

interface ExitBlockedNoticeProps {
  state: ExitState;
  lang: Lang;
  onRetry: () => void;
  onDismiss: () => void;
}

export function ExitBlockedNotice({ state, lang, onRetry, onDismiss }: ExitBlockedNoticeProps) {
  const copy = EXIT_COPY[lang];
  if (state.kind !== 'blocked') return null;

  const { result } = state;
  const conflict = result.reason === 'conflict';
  const offline = result.reason === 'offline';

  const body = conflict
    ? copy.blockedConflict
    : offline
      ? copy.blockedOffline
      : result.reason === 'not-loaded'
        ? copy.blockedNotLoaded
        : copy.blockedError;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="onboarding-exit-blocked"
      data-reason={result.reason ?? 'error'}
      className="flex flex-col gap-2 rounded-2xl border p-3 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
    >
      <div className="flex items-start gap-2">
        {/* Icon AND text carry the state — colour alone fails a monochrome
            screenshot and a colour-blind reader, and this is the message that
            must not be missed. */}
        {offline ? (
          <CloudOff size={16} className="mt-0.5 flex-shrink-0 text-amber-700" aria-hidden="true" />
        ) : (
          <AlertTriangle
            size={16}
            className="mt-0.5 flex-shrink-0 text-amber-700"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0">
          <p
            className="break-words text-amber-900 dark:text-amber-100"
            style={{ fontSize: '13px', fontWeight: 700 }}
          >
            {copy.blockedTitle}
          </p>
          <p
            className="break-words text-amber-800 dark:text-amber-200"
            style={{ fontSize: '13px' }}
          >
            {body}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {conflict ? (
          // Reload, never "save anyway". Forcing the write past a 409 would
          // overwrite whatever the other tab wrote, unseen.
          <button
            type="button"
            onClick={() => window.location.reload()}
            data-testid="onboarding-exit-reload"
            className="flex items-center gap-1 rounded-xl bg-amber-700 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {copy.reload}
          </button>
        ) : null}

        {isRetryable(result) ? (
          <button
            type="button"
            onClick={onRetry}
            data-testid="onboarding-exit-retry"
            className="rounded-xl bg-amber-700 px-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
          >
            {copy.retry}
          </button>
        ) : null}

        <button
          type="button"
          onClick={onDismiss}
          data-testid="onboarding-exit-stay"
          className="rounded-xl px-3 text-amber-900 underline dark:text-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          style={{ fontSize: '13px', fontWeight: 600, minHeight: '44px' }}
        >
          {copy.stay}
        </button>
      </div>
    </div>
  );
}
