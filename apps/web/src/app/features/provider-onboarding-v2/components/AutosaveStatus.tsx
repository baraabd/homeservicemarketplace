import { AlertTriangle, Check, CloudOff, Loader2 } from 'lucide-react';

import { AUTOSAVE_COPY, type Lang } from '../copy/autosave-copy';
import type { AutosaveStatusKind } from '../autosave-status';

// Sprint 9B.25 — one save-status renderer for every V2 task.
//
// docs/sprint-09b25/HARDENING.md
//
// Previously three screens had a private copy of this component and two had
// none. The two with none — ServiceArea and Services — autosaved silently: a
// conflict or a failed write produced no visible change at all, so a provider
// went on believing their work was saved. That is the defect this file closes,
// and consolidating the other three is what stops it recurring.
//
// STATUS IS THE HOOK'S, NEVER THIS COMPONENT'S.
//
// It renders `useOnboardingStepAutosave`'s state and derives nothing. In
// particular it cannot show "Saved" optimistically: `saved` is set only after
// the server acknowledges the write and returns the new draft version.

interface AutosaveStatusProps {
  status: AutosaveStatusKind;
  lang: Lang;
  /** Keeps each screen's existing test ids stable — `basics`, `availability`,
   *  `public-profile`, and so on. */
  testIdPrefix: string;
}

export function AutosaveStatus({ status, lang, testIdPrefix }: AutosaveStatusProps) {
  const copy = AUTOSAVE_COPY[lang];

  // Idle renders nothing: a permanent "nothing has happened" line is noise
  // that trains people to stop reading the one place status appears.
  if (status.kind === 'idle') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`${testIdPrefix}-save-status`}
      data-status={status.kind}
      className="flex flex-wrap items-center gap-2"
      style={{ fontSize: '12px' }}
    >
      {/* Every state carries an ICON as well as a colour. Colour alone fails
          both a colour-blind reader and a monochrome screenshot, and "saved"
          versus "failed" is exactly the distinction that must not depend on
          hue. The icons are aria-hidden because the adjacent text already
          says it. */}
      {status.kind === 'saving' ? (
        <span className="flex items-center gap-1 text-slate-500">
          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          {copy.saving}
        </span>
      ) : null}

      {status.kind === 'saved' ? (
        <span className="flex items-center gap-1 text-emerald-700">
          <Check size={12} aria-hidden="true" />
          {copy.saved}
        </span>
      ) : null}

      {status.kind === 'offline' ? (
        <span className="flex items-center gap-1 break-words text-amber-700">
          <CloudOff size={12} className="flex-shrink-0" aria-hidden="true" />
          {copy.offline}
        </span>
      ) : null}

      {status.kind === 'conflict' ? (
        <span className="flex items-center gap-1 break-words text-rose-600">
          <AlertTriangle size={12} className="flex-shrink-0" aria-hidden="true" />
          {copy.conflict}
        </span>
      ) : null}

      {status.kind === 'error' ? (
        <>
          <span className="flex items-center gap-1 text-rose-600">
            <AlertTriangle size={12} className="flex-shrink-0" aria-hidden="true" />
            {copy.failed}
          </span>
          <button
            type="button"
            onClick={status.retry}
            data-testid={`${testIdPrefix}-save-retry`}
            className="rounded-lg px-2 text-blue-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            style={{ fontWeight: 600, minHeight: '44px' }}
          >
            {copy.retry}
          </button>
        </>
      ) : null}
    </div>
  );
}
