import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type {
  PatchOnboardingStepRequest,
  ProviderOnboardingDraftView,
  ProviderOnboardingStep,
} from '@homeservicemarketplace/contracts';

import { patchOnboardingStep } from '../../../../lib/provider/provider-onboarding-api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import type { AutosaveStatusKind } from '../autosave-status';

// Sprint 9B.28 — ONE writer for the provider onboarding draft.
//
// docs/sprint-09b28/PROVIDER_ONBOARDING_PERSISTENCE_MOBILE_FIRST.md
//
// WHAT WAS WRONG
//
// `useOnboardingStepAutosave` was called once per STEP, and two of the six
// task screens call it twice. Each instance owned a private `inFlight` flag, a
// private timer and a private pending payload — but all seven read the draft
// VERSION out of one shared cache slot and wrote to one server-side row
// guarded by one optimistic lock. Two instances flushing together both
// presented version N; the server accepted the first and 409'd the second on
// work the provider had never seen fail. The regression suite reproduces this
// exactly: `[3, 3]` before, `[3, 4]` after.
//
// It got worse on the way out. `flush()` opened with `if (inFlight) return;`,
// so the promise a caller awaited resolved IMMEDIATELY whenever a write was
// already open — a "drain" that drained nothing. And the instances lived
// INSIDE the task components, so unmounting the screen (which is what Close
// does) tore down the timer holding the only copy of the edit, and the
// `if (!mounted.current) return;` guard after the await threw away the
// server's response for writes that had actually succeeded.
//
// WHAT THIS IS
//
// One coordinator, mounted ABOVE the task routes so it outlives every task
// component. It owns:
//
//   ONE serial queue      keyed by step, so edits to different steps are kept
//                         rather than overwriting each other, while repeated
//                         edits to the SAME step coalesce.
//   ONE version handshake taken from the latest server response. Because the
//                         queue is serial, two writes can never present the
//                         same version.
//   ONE real drain        `flushAll()` resolves only when the queue is empty
//                         and nothing is in flight, or a terminal state
//                         (offline / error / conflict) has been reached.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not promise durability across a reload or a crashed tab. Pending
// edits live in memory. `beforeunload` covers the hard-reload case with the
// browser's own prompt; nothing here silently retries into a closed tab, and
// the offline copy tells the provider to keep the page open rather than
// claiming their work is safe.

/** How long the field rests before an autosave fires.
 *
 *  Long enough that typing a sentence is one save rather than forty; short
 *  enough that tabbing away feels saved. Navigation never waits on it — every
 *  exit flushes — so this is a network-economy number, not a safety one. */
export const AUTOSAVE_DEBOUNCE_MS = 900;

export type StepPatch = Omit<PatchOnboardingStepRequest, 'version'>;

/** What a caller that gated navigation on the flush needs in order to decide
 *  whether it may leave. A bare `void` gave navigation nothing to branch on,
 *  which is why every exit left regardless of what happened. */
export interface FlushResult {
  ok: boolean;
  /** `upload-failed` — a tracked binary upload rejected. Distinct from
   *  `error`, because retrying it is the uploader's job, not the flush's: the
   *  exit offers an explicit discard instead of a retry it cannot perform. */
  reason?: 'offline' | 'error' | 'conflict' | 'not-loaded' | 'upload-failed';
  /** HTTP status or `network`, for the message the screen shows. */
  message?: string;
  /** Present on `conflict` — the version the server says it holds. */
  serverVersion?: number;
}

const OK: FlushResult = { ok: true };

/**
 * Steps whose fields also feed the provider profile / capability read models.
 *
 * CONSENT and REVIEW collect nothing that changes what a provider IS, so a
 * write to either leaves those caches alone. Everything else can change the
 * display name, the specialties a provider is matched on, or where and when
 * they work.
 */
const PROFILE_AFFECTING_STEPS = new Set<ProviderOnboardingStep>([
  'PROVIDER_TYPE',
  'IDENTITY',
  'LOCATION',
  'SPECIALTIES',
  'EXPERIENCE',
  'AVAILABILITY',
  'PROFILE',
]);

interface CoordinatorValue {
  statusOf: (step: ProviderOnboardingStep) => AutosaveStatusKind;
  isDirtyStep: (step: ProviderOnboardingStep) => boolean;
  save: (step: ProviderOnboardingStep, patch: StepPatch) => void;
  /** Drain everything, for every step. Resolves only when the queue is empty
   *  and nothing is in flight, or a terminal state has been reached. */
  flushAll: () => Promise<FlushResult>;
  /** Anything queued, in flight, or resting in the debounce. */
  isBusy: boolean;
  /** Anything unwritten — what `beforeunload` and the exit guards ask. */
  hasPendingWork: boolean;
  /**
   * Register long-running work that is NOT part of the debounced queue.
   *
   * Sprint 09B.29 Phase 4 — binary uploads stay OUT of the queue and IN the
   * exit contract, which are separate decisions that were previously made as
   * one. A multi-second photo upload must not sit behind a keystroke's
   * debounce, but it is still unwritten work: the avatar aborts on unmount, so
   * navigating away from it, reloading, closing the tab or signing out all
   * destroyed an upload the provider was watching.
   *
   * Pass the promise; the coordinator counts it as pending until it settles,
   * so `flushAll()` waits for it and `beforeunload` warns about it. The
   * promise's REJECTION is not the coordinator's business — the uploader owns
   * its own error surface — so this never turns an upload failure into a flush
   * failure.
   */
  trackExternalWork: (work: Promise<unknown>) => void;
  /**
   * The provider has decided to leave WITHOUT the failed upload.
   *
   * Explicit by construction: nothing clears this state except this call, so
   * repeating the gesture the product just refused — clicking Close again —
   * cannot become the discard by accident.
   */
  discardFailedUploads: () => void;
}

const CoordinatorContext = createContext<CoordinatorValue | null>(null);

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function versionFrom(qc: QueryClient): number | null {
  const view = qc.getQueryData<ProviderOnboardingDraftView>(providerQueryKeys.onboarding.draft());
  return view?.version ?? null;
}

// Sprint 09B.29 Phase 4 — WHY THERE IS NO SECOND VERSION SOURCE HERE.
//
// The first repair for the hydration race carried a `lastAcknowledgedVersion`
// ref beside this, and presented `max(cache, acknowledged)` — belt and braces
// against the shared cache slot regressing.
//
// It was removed after mutation testing, which is the only reason we know it
// was not doing anything. With `useOnboardingDraft`'s `structuralSharing`
// guard disabled, the ref alone kept the version correct; with the ref
// disabled and the guard in place, every test in
// `onboarding-hydration-race.test.tsx` still passed — including one written
// specifically to catch the `setQueryData` path, because React Query v5 runs
// `structuralSharing` on `setQueryData` too. No reachable case was left for it.
//
// It was not merely redundant, it was a hazard: a version ref living on a
// coordinator that outlives the task routes would survive a sign-out and
// present provider A's token for provider B, which is the cross-provider
// leakage the hydration contract forbids.
//
// One source of truth, one guard, and the guard is tested.

export function ProviderOnboardingAutosaveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const [statuses, setStatuses] = useState<Record<string, AutosaveStatusKind>>({});
  // Mirrors `statuses` for the paths that must read it without waiting for a
  // render — the drain loop decides `saved` vs `dirty` from live queue state,
  // not from a snapshot React has not committed yet.
  const [busy, setBusy] = useState(false);

  /** step → the edit waiting to be written. A Map because ITERATION ORDER is
   *  the queue order, and a ref because queueing must not re-render: the whole
   *  point of a debounce is that typing is cheap. */
  const pending = useRef<Map<ProviderOnboardingStep, StepPatch>>(new Map());
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draining = useRef<Promise<FlushResult> | null>(null);
  /** The last terminal outcome, so a `flushAll` that finds nothing to do still
   *  reports the failure that stopped the previous one. */
  const lastResult = useRef<FlushResult>(OK);
  /** Long-running work outside the queue — binary uploads. See
   *  `trackExternalWork`. */
  const externalWork = useRef<Set<Promise<unknown>>>(new Set());
  /** Uploads that REJECTED and have not yet been answered by an explicit
   *  discard. Non-zero blocks the exit. */
  const failedUploads = useRef(0);

  const setStatus = useCallback((step: ProviderOnboardingStep, next: AutosaveStatusKind) => {
    setStatuses((prev) => (prev[step] === next ? prev : { ...prev, [step]: next }));
  }, []);

  const syncBusy = useCallback(() => {
    setBusy(
      pending.current.size > 0 ||
        inFlight.current ||
        timer.current !== null ||
        // An upload in flight is unwritten work, so it arms `beforeunload` and
        // the exit blocker exactly as a queued keystroke does.
        externalWork.current.size > 0,
    );
  }, []);

  /**
   * Mark every read model derived from the draft as stale.
   *
   * Seeded, not invalidated, for the DRAFT itself: the response IS the new
   * draft, and refetching it would briefly repaint the pre-save state while
   * the provider watches their own typing flicker.
   *
   * Invalidated, not seeded, for hub and review: they are server-DERIVED
   * verdicts, and the client cannot compute them from a draft without becoming
   * a second copy of the completeness policy.
   *
   * Scoped keys throughout. A broad `qc.clear()` here would take unrelated
   * user state with it.
   */
  const refreshProjections = useCallback(
    (step: ProviderOnboardingStep): Promise<unknown> => {
      const work = [
        // Hub inherits the global five-minute staleTime, so without this an
        // edit followed by Close showed a projection built before it.
        qc.invalidateQueries({ queryKey: providerQueryKeys.onboarding.hub() }),
        // Both locales: a provider who switches language after editing must
        // not read a verdict about the draft as it was.
        qc.invalidateQueries({ queryKey: providerQueryKeys.onboarding.review('en') }),
        qc.invalidateQueries({ queryKey: providerQueryKeys.onboarding.review('ar') }),
      ];
      if (PROFILE_AFFECTING_STEPS.has(step)) {
        work.push(qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root }));
      }
      return Promise.all(work);
    },
    [qc],
  );

  const drain = useCallback(async (): Promise<FlushResult> => {
    while (pending.current.size > 0) {
      if (isOffline()) {
        // HELD, not dropped. Every queued step says so, and the payloads stay
        // in the map for the `online` listener to re-fire.
        for (const step of pending.current.keys()) setStatus(step, { kind: 'offline' });
        return { ok: false, reason: 'offline' };
      }

      const version = versionFrom(qc);
      if (version === null) {
        for (const step of pending.current.keys()) {
          setStatus(step, { kind: 'error', message: 'not-loaded', retry: () => {} });
        }
        return { ok: false, reason: 'not-loaded', message: 'not-loaded' };
      }

      // Oldest queued step first. Taking it OUT of the map before the await is
      // what lets a fresh edit for the same step queue independently while
      // this one is open.
      const [step, patch] = pending.current.entries().next().value as [
        ProviderOnboardingStep,
        StepPatch,
      ];
      pending.current.delete(step);

      inFlight.current = true;
      setStatus(step, { kind: 'saving' });
      syncBusy();

      try {
        const view = await patchOnboardingStep(step, { ...patch, version });
        // Unconditional. The coordinator outlives the task component, so a
        // response that arrives after the screen closed still updates the
        // shared cache — which is the whole reason this moved up here.
        qc.setQueryData(providerQueryKeys.onboarding.draft(), view);

        // If a NEWER edit for this step landed while the request was open, the
        // step is dirty again, not saved. Saying "Saved" here is precisely the
        // false-saved-state this sprint exists to remove.
        setStatus(
          step,
          pending.current.has(step) ? { kind: 'dirty' } : { kind: 'saved', at: Date.now() },
        );

        // Fire and observe, but do not BLOCK the drain on it: the write is
        // already durable, and holding navigation for a projection refetch
        // would make a successful save feel like a failed one. A refresh that
        // fails downgrades the chip to "Saved — refreshing status"; it never
        // claims the write failed, because it did not.
        void refreshProjections(step).catch(() => {
          setStatuses((prev) => {
            const current = prev[step];
            if (current?.kind !== 'saved') return prev;
            return { ...prev, [step]: { ...current, projectionStale: true } };
          });
        });
      } catch (error) {
        const axiosError = error as AxiosError<{ details?: { expectedVersion?: number } }>;
        const httpStatus = axiosError.response?.status;

        if (httpStatus === 409) {
          // Another tab (or another device) advanced the draft. The edit is
          // DROPPED rather than re-queued: retrying it would overwrite work
          // the provider has not seen, and the answer is to reload, not to try
          // harder. Everything still queued stays queued — but the version in
          // hand is stale, so draining further would only 409 again.
          const serverVersion = axiosError.response?.data?.details?.expectedVersion ?? -1;
          setStatus(step, { kind: 'conflict', serverVersion });
          inFlight.current = false;
          syncBusy();
          return { ok: false, reason: 'conflict', serverVersion };
        }

        // Put it back so a retry has something to send. Any NEWER edit that
        // landed while this was in flight wins the merge — it is more recent
        // than what just failed.
        pending.current.set(step, { ...patch, ...(pending.current.get(step) ?? {}) });
        const message = String(httpStatus ?? 'network');
        setStatus(step, {
          kind: 'error',
          message,
          retry: () => {
            void flushAllRef.current();
          },
        });
        inFlight.current = false;
        syncBusy();
        // STOP. Looping here would hot-loop the network: the payload was
        // deliberately put back, so an immediate re-drain fails it again, and
        // again. Retry is the provider's decision and it is on screen.
        return { ok: false, reason: 'error', message };
      } finally {
        inFlight.current = false;
      }
    }

    syncBusy();
    return OK;
  }, [qc, refreshProjections, setStatus, syncBusy]);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  /**
   * A REAL drain.
   *
   * Resolves only when the queue is empty and nothing is in flight, or a
   * terminal state has been reached. The loop re-checks `pending` after each
   * drain because an edit queued mid-drain must be carried by the same call —
   * that is the case the old `if (inFlight) return;` silently dropped.
   */
  const flushAll = useCallback(async (): Promise<FlushResult> => {
    clearTimer();

    // Sprint 09B.29 Phase 4 — wait for the photo before deciding the draft is
    // drained.
    //
    // `allSettled` rather than `all` because a rejected upload must not throw
    // out of the drain — but settling is NOT the same as succeeding, and the
    // first version of this conflated them. It treated a failed upload as done
    // and returned ok, so the provider walked out of the screen and the photo
    // was silently gone. Nothing said "Saved", so no false claim was made; it
    // was worse than that, because nothing said anything at all.
    //
    // A failure is therefore RECORDED and reported below as a terminal result,
    // exactly like a failed text write. The difference is what resolves it:
    // retrying belongs to the uploader, which owns the file and its own retry
    // control, so the exit offers an explicit discard instead of a retry it
    // could not perform.
    //
    // Looped because finalize is itself a draft write: settling an upload can
    // leave the queue non-empty, and the drain below has to see that.
    while (externalWork.current.size > 0) {
      const inFlightUploads = [...externalWork.current];
      // `allSettled` so a rejection does not throw out of the drain. It is not
      // how a failure is COUNTED — `trackExternalWork` does that at the moment
      // of rejection, because an upload can fail long before anyone asks to
      // leave.
      await Promise.allSettled(inFlightUploads);
      for (const settledWork of inFlightUploads) externalWork.current.delete(settledWork);
    }
    syncBusy();

    // Reported BEFORE the queue drain, so a failed photo is not masked by text
    // that saved perfectly well. The provider is told the photo failed and is
    // asked what to do about it.
    if (failedUploads.current > 0) {
      return { ok: false, reason: 'upload-failed' };
    }

    for (;;) {
      if (!draining.current) {
        if (pending.current.size === 0 && !inFlight.current) {
          syncBusy();
          // Nothing queued and nothing open, so navigating loses nothing —
          // whatever happened LAST time is not a reason to hold the provider
          // on this screen now.
          //
          // This returned `lastResult` and trapped them. A 409 DROPS its patch
          // (re-sending it would overwrite the other writer), so the queue
          // empties — and every later flush then replayed the stale conflict
          // and refused the exit again. The provider could not leave the task
          // at all except by reloading. The conflict is reported once, by the
          // drain that produced it, and stays visible in the status chip;
          // it is not a permanent veto on navigation.
          return OK;
        }
        const run = drain().finally(() => {
          if (draining.current === run) draining.current = null;
        });
        draining.current = run;
      }
      const result = await draining.current;
      lastResult.current = result;
      if (!result.ok) {
        syncBusy();
        return result;
      }
      if (pending.current.size === 0 && !inFlight.current) {
        syncBusy();
        return result;
      }
    }
  }, [clearTimer, drain, syncBusy]);

  // `retry` closures created inside `drain` need the CURRENT flushAll without
  // making `drain` depend on it (which would be a cycle).
  const flushAllRef = useRef(flushAll);
  flushAllRef.current = flushAll;

  /** Queue an edit for one step. Replaces any queued edit for the SAME step —
   *  the newest values are the complete answer for that step, not a delta on
   *  an older one — and leaves every other step's queued edit alone. */
  const save = useCallback(
    (step: ProviderOnboardingStep, patch: StepPatch) => {
      pending.current.set(step, { ...(pending.current.get(step) ?? {}), ...patch });
      // Immediately, and before anything is sent. A `saved` chip from the
      // previous write must not outlive the keystroke that invalidated it.
      setStatus(step, { kind: 'dirty' });
      lastResult.current = OK;
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        void flushAllRef.current();
      }, AUTOSAVE_DEBOUNCE_MS);
      syncBusy();
    },
    [clearTimer, setStatus, syncBusy],
  );

  // Retry when the connection returns. Without this an offline edit sits there
  // until the provider touches the field again, and the status never resolves
  // even though they are back online.
  useEffect(() => {
    const onOnline = () => {
      if (pending.current.size > 0) void flushAllRef.current();
      else {
        setStatuses((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [step, status] of Object.entries(prev)) {
            if (status.kind === 'offline') {
              next[step] = { kind: 'idle' };
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    };
    const onOffline = () => {
      for (const step of pending.current.keys()) setStatus(step, { kind: 'offline' });
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [setStatus]);

  const hasPendingWork = busy;

  // Hard-reload protection ONLY.
  //
  // `beforeunload` does not fire for a React Router navigation, so it is not
  // and never was protection for Close or Back — those are gated on a real
  // flush. This covers the tab close, the reload, and the typed-in URL, where
  // the browser's own prompt is the only thing that can intervene.
  useEffect(() => {
    if (!hasPendingWork) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Assigning returnValue is what actually triggers the prompt; the text
      // is ignored by every current browser.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasPendingWork]);

  // The coordinator lives above the task routes, so it is not unmounted by
  // navigating between them. This only runs when onboarding itself is left.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const trackExternalWork = useCallback(
    (work: Promise<unknown>) => {
      externalWork.current.add(work);
      syncBusy();

      const done = () => {
        externalWork.current.delete(work);
        syncBusy();
      };
      // The failure is recorded HERE, at the moment of rejection — not inside
      // `flushAll`.
      //
      // Recording it in the drain only worked if a flush happened to be
      // waiting when the upload failed. An upload that failed while the
      // provider was still typing had already settled and been removed by the
      // time they pressed Close, so the drain saw an empty set, found nothing
      // wrong, and let them leave. Which is the whole defect, reintroduced one
      // layer down.
      work.then(done, () => {
        failedUploads.current += 1;
        done();
      });
    },
    [syncBusy],
  );

  const discardFailedUploads = useCallback(() => {
    failedUploads.current = 0;
    syncBusy();
  }, [syncBusy]);

  const value = useMemo<CoordinatorValue>(
    () => ({
      statusOf: (step) => statuses[step] ?? { kind: 'idle' },
      isDirtyStep: (step) => pending.current.has(step) || statuses[step]?.kind === 'dirty',
      save,
      flushAll,
      isBusy: busy,
      hasPendingWork: busy,
      trackExternalWork,
      discardFailedUploads,
    }),
    [statuses, save, flushAll, busy, trackExternalWork, discardFailedUploads],
  );

  return <CoordinatorContext.Provider value={value}>{children}</CoordinatorContext.Provider>;
}

/**
 * The coordinator itself — for the things that act on the WHOLE draft.
 *
 * Navigation uses this: an exit control cannot ask "is my step clean?", it has
 * to ask "is anything unwritten?". A Close that flushed only the step whose
 * field was last touched is how the two-autosave screens lost half a form.
 */
export function useOnboardingAutosave(): CoordinatorValue {
  const ctx = useContext(CoordinatorContext);
  if (!ctx) {
    throw new Error(
      'useOnboardingAutosave must be used inside <ProviderOnboardingAutosaveProvider>. ' +
        'Mount it above the onboarding task routes, not inside a task component.',
    );
  }
  return ctx;
}

/**
 * One step's view of the coordinator.
 *
 * Keeps the shape the task screens already consume — `{ status, isDirty, save }`
 * — so the six screens did not have to be rewritten to be made safe. What
 * changed underneath is that `save` now feeds ONE queue with ONE version
 * handshake, and `flushAll` drains the whole draft rather than this step.
 */
export function useOnboardingStepAutosave(step: ProviderOnboardingStep) {
  const ctx = useOnboardingAutosave();
  const { statusOf, isDirtyStep, save, flushAll } = ctx;

  const boundSave = useCallback((patch: StepPatch) => save(step, patch), [save, step]);

  return {
    status: statusOf(step),
    isDirty: isDirtyStep(step),
    save: boundSave,
    /** Drains the ENTIRE draft, not just this step. Named for what it does. */
    flushAll,
  };
}
