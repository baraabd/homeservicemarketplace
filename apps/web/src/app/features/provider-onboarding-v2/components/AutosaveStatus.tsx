import {
  AlertTriangle,
  Check,
  CloudOff,
  Loader2,
  PencilLine,
  RefreshCw,
  UploadCloud,
} from 'lucide-react';

import { AUTOSAVE_COPY, type Lang } from '../copy/autosave-copy';
import type { AutosaveStatusKind } from '../autosave-status';

// Sprint 9B.25 — one save-status renderer for every V2 task.
// Sprint 09B.29 Phase 5A — moved into the approved sticky bar, and tokenised.
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
//
// WHY IDLE IS NO LONGER NOTHING
//
// The approved screens print "Changes saved • 12:42" under the sticky action
// from the moment the screen opens. That is not an optimistic "Saved" — it is
// `lastSavedAt` off the draft, a timestamp the SERVER wrote, and it answers the
// question the provider actually has on arrival: is what I typed last time
// still there. An empty bar until the first keystroke answered it only once it
// had stopped being urgent.
//
// The distinction the persistence contract cares about is preserved exactly:
// `persisted` reports a write the server has already acknowledged, `saved`
// reports one this session just made, and neither is ever shown ahead of the
// acknowledgement.

interface AutosaveStatusProps {
  status: AutosaveStatusKind;
  lang: Lang;
  /** Keeps each screen's existing test ids stable — `basics`, `availability`,
   *  `public-profile`, and so on. */
  testIdPrefix: string;
  /** The server's own `lastSavedAt`, ISO. Shown only while nothing is in
   *  flight; a live status always wins, because it is the newer fact. */
  lastSavedAt?: string | null;
}

/**
 * The time, and only the time.
 *
 * `en-GB` in both languages, deliberately: the approved screens print Latin
 * digits and a 24-hour clock in the Arabic rendering as well as the English
 * one, and a saved-at stamp is a machine fact the provider matches against
 * their own clock rather than prose. Returns null rather than "Invalid Date"
 * for a value the server sent in a shape we did not expect.
 */
function timeOf(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function AutosaveStatus({
  status,
  lang,
  testIdPrefix,
  lastSavedAt = null,
}: AutosaveStatusProps) {
  const copy = AUTOSAVE_COPY[lang];

  if (status.kind === 'idle') {
    // Nothing in flight and nothing ever written: there is genuinely nothing
    // to report, and a permanent "nothing has happened" line is noise that
    // trains people to stop reading the one place status appears.
    const at = lastSavedAt ? timeOf(lastSavedAt) : null;
    if (!at) return null;

    return (
      <p
        data-testid={`${testIdPrefix}-save-status`}
        data-status="persisted"
        className="flex items-center justify-center gap-[5px] text-pv-caption text-pv-muted"
      >
        <UploadCloud size={14} aria-hidden="true" />
        {copy.persisted} • {at}
      </p>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`${testIdPrefix}-save-status`}
      data-status={status.kind}
      className="flex flex-wrap items-center justify-center gap-2 text-pv-caption"
    >
      {/* Every state carries an ICON as well as a colour. Colour alone fails
          both a colour-blind reader and a monochrome screenshot, and "saved"
          versus "failed" is exactly the distinction that must not depend on
          hue. The icons are aria-hidden because the adjacent text already
          says it. */}
      {/* Sprint 9B.28 — 'dirty' is a REAL state now. It renders because a
          screen that shows nothing between the keystroke and the save is the
          screen that used to show a stale 'Saved' instead. */}
      {status.kind === 'dirty' ? (
        <span className="flex items-center gap-1 text-pv-muted">
          <PencilLine size={12} aria-hidden="true" />
          {copy.dirty}
        </span>
      ) : null}

      {status.kind === 'saving' ? (
        <span className="flex items-center gap-1 text-pv-muted">
          <Loader2
            size={12}
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {copy.saving}
        </span>
      ) : null}

      {status.kind === 'saved' ? (
        <span className="flex items-center gap-1 text-pv-done">
          {/* The write is acknowledged either way — only the DERIVED task
              statuses are behind — so this stays green and stays 'Saved'.
              Downgrading it to a warning would tell the provider their data
              is at risk when it is not. */}
          {status.projectionStale ? (
            <RefreshCw size={12} aria-hidden="true" />
          ) : (
            <Check size={12} aria-hidden="true" />
          )}
          {status.projectionStale ? copy.savedProjectionStale : copy.saved}
        </span>
      ) : null}

      {status.kind === 'offline' ? (
        <span className="flex items-center gap-1 break-words text-pv-blocked">
          <CloudOff size={12} className="flex-shrink-0" aria-hidden="true" />
          {copy.offline}
        </span>
      ) : null}

      {status.kind === 'conflict' ? (
        <span className="flex items-center gap-1 break-words text-pv-danger">
          <AlertTriangle size={12} className="flex-shrink-0" aria-hidden="true" />
          {copy.conflict}
        </span>
      ) : null}

      {status.kind === 'error' ? (
        <>
          <span className="flex items-center gap-1 text-pv-danger">
            <AlertTriangle size={12} className="flex-shrink-0" aria-hidden="true" />
            {copy.failed}
          </span>
          <button
            type="button"
            onClick={status.retry}
            data-testid={`${testIdPrefix}-save-retry`}
            className="min-h-[44px] rounded-lg px-2 font-semibold text-pv-accent underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pv-accent"
          >
            {copy.retry}
          </button>
        </>
      ) : null}
    </div>
  );
}
