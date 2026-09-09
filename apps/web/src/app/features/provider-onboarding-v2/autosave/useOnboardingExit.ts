import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, type Location } from 'react-router';

import { useOnboardingAutosave, type FlushResult } from './ProviderOnboardingAutosaveProvider';

// Sprint 9B.28 — the only way out of a V2 task.
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
//
// WHAT WAS WRONG
//
// `OnboardingTaskScreen` exited through
//
//     const backToHub = () => navigate('/provider/onboarding');
//
// wired to BOTH the header Close and the "Back to tasks" footer button. It is
// synchronous. An edit resting in the 900ms debounce — which is every edit
// made in the second before someone taps Close — was still sitting in a timer
// owned by a component that React was about to unmount. Nothing flushed it and
// nothing warned. The screen said "Saved" from the PREVIOUS write on the way
// out, which is why this was reported as data loss rather than as a missing
// save: the UI actively told the provider the opposite of what happened.
//
// `saveNow()` existed on the old hook the whole time and had NO callers.
//
// WHAT THIS IS
//
// One exit path. Every control that leaves a task goes through `exit()`, and
// `exit()` does not navigate until the coordinator says the whole draft is
// drained. Browser Back is covered by the router's own blocker rather than a
// second mechanism, because Back does not run a click handler.
//
// `beforeunload` is NOT part of this. It does not fire for a React Router
// navigation, so treating it as protection for Close was the category error
// underneath the original bug; it lives on the coordinator and covers only the
// hard reload and the tab close.

export type ExitState =
  /** Nothing in progress. */
  | { kind: 'idle' }
  /** Flushing before leaving. Repeated navigation is refused while in this
   *  state — a second tap must not start a second drain or, worse, navigate
   *  past the first one. */
  | { kind: 'leaving' }
  /** The flush reached a terminal failure. The provider stays on the task,
   *  with their data still in memory and a message that says what to do. */
  | { kind: 'blocked'; result: FlushResult };

export interface OnboardingExit {
  state: ExitState;
  /** Leave for `to`, but only after the whole draft has drained. */
  exit: (to: string) => void;
  /** Re-attempt the flush and the navigation that failed. Offered for
   *  everything except a conflict, which retrying cannot fix. */
  retry: () => void;
  /** Abandon the exit and stay, keeping the pending edit. */
  dismiss: () => void;
  /**
   * Leave WITHOUT the failed upload.
   *
   * Sprint 09B.29 Phase 4 — only offered for `upload-failed`, and it is the
   * only thing that clears that state. Retrying an upload belongs to the
   * uploader, which owns the file; the exit can only offer to go on without
   * it, and that has to be a decision the provider actually makes rather than
   * a second click on the control they already pressed.
   */
  discard: () => void;
  /** True while an exit is in flight — bind to `disabled`/`aria-busy`. */
  isLeaving: boolean;
}

/** Retrying a 409 would present the same stale version and fail the same way.
 *  The answer there is to reload, not to try harder. */
export function isRetryable(result: FlushResult | undefined): boolean {
  return result?.reason === 'error' || result?.reason === 'offline';
}

/** A failed binary upload. Retrying is the UPLOADER's control, not the exit's,
 *  so the exit offers to leave without it instead. */
export function isUploadFailure(result: FlushResult | undefined): boolean {
  return result?.reason === 'upload-failed';
}

export function useOnboardingExit(): OnboardingExit {
  const navigate = useNavigate();
  const { flushAll, hasPendingWork, discardFailedUploads } = useOnboardingAutosave();

  const [state, setState] = useState<ExitState>({ kind: 'idle' });
  /** Where the interrupted exit was headed, so Retry resumes it rather than
   *  guessing the hub. */
  const target = useRef<string | null>(null);
  const leaving = useRef(false);

  const run = useCallback(
    async (to: string) => {
      // Guard on the REF, not on `state`: two taps in the same tick both read
      // the pre-render state and both would pass a state-based check.
      if (leaving.current) return;

      leaving.current = true;
      target.current = to;
      setState({ kind: 'leaving' });

      const result = await flushAll();

      leaving.current = false;
      if (result.ok) {
        setState({ kind: 'idle' });
        navigate(to);
        return;
      }
      // Stay put. The edit is still in the coordinator's queue, so the
      // provider loses nothing by reading the message and deciding.
      setState({ kind: 'blocked', result });
    },
    [flushAll, navigate],
  );

  const exit = useCallback(
    (to: string) => {
      void run(to);
    },
    [run],
  );

  const retry = useCallback(() => {
    const to = target.current;
    if (!to) return;
    setState({ kind: 'idle' });
    void run(to);
  }, [run]);

  const dismiss = useCallback(() => {
    setState({ kind: 'idle' });
  }, []);

  const discard = useCallback(() => {
    const to = target.current;
    // Clears the failure FIRST, so the flush this starts can succeed. Nothing
    // else clears it: a second press of Close cannot become the discard by
    // accident, which is what makes leaving without the photo a decision
    // rather than a side effect of impatience.
    discardFailedUploads();
    setState({ kind: 'idle' });
    if (to) void run(to);
  }, [discardFailedUploads, run]);

  // ── Browser Back / Forward ────────────────────────────────────────────────
  //
  // A history POP runs no click handler, so `exit()` never sees it. The
  // router's blocker is the only hook that does. It is armed ONLY while there
  // is unwritten work: blocking a clean navigation would make Back feel broken
  // for the majority of exits that have nothing to save.
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: Location; nextLocation: Location }) =>
        hasPendingWork && currentLocation.pathname !== nextLocation.pathname,
      [hasPendingWork],
    ),
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let cancelled = false;
    setState({ kind: 'leaving' });
    void flushAll().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setState({ kind: 'idle' });
        // Let the navigation the provider actually asked for continue.
        blocker.proceed?.();
        return;
      }
      // Cancel the POP so the task screen — and the message explaining why
      // they are still on it — stays addressable.
      setState({ kind: 'blocked', result });
      blocker.reset?.();
    });
    return () => {
      cancelled = true;
    };
  }, [blocker, flushAll]);

  return { state, exit, retry, dismiss, discard, isLeaving: state.kind === 'leaving' };
}
