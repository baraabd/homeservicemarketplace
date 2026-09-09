import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type {
  PatchOnboardingStepRequest,
  ProviderOnboardingDraftView,
  ProviderOnboardingStep,
} from '@homeservicemarketplace/contracts';

import {
  getOnboardingDraft,
  patchOnboardingStep,
  submitOnboarding,
  withdrawOnboarding,
} from '../../../lib/provider/provider-onboarding-api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';

// Sprint 8 — the onboarding wizard, client side.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// Every server call returns the COMPLETE application view, so every hook here
// seeds the cache from the response rather than invalidating and refetching.
// That is not an optimisation: a refetch means the screen briefly shows the
// pre-save state, and on a slow connection a provider watches their own typing
// disappear and reappear.

/** How long the field rests before an autosave fires.
 *
 *  Long enough that typing a sentence is one save rather than forty; short
 *  enough that tabbing away feels saved. */
export const AUTOSAVE_DEBOUNCE_MS = 900;

export type AutosaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  /** The browser reports no connection. Distinct from `error`: nothing is
   *  wrong with the data and retrying now would fail for a reason the provider
   *  can see out the window. The pending edit is held, not discarded. */
  | { kind: 'offline' }
  /** A save failed for a reason retrying might fix. */
  | { kind: 'error'; message: string; retry: () => void }
  /** Another tab (or another device) advanced the draft. The local form is
   *  behind, and overwriting would silently discard their work. */
  | { kind: 'conflict'; serverVersion: number };

export function useOnboardingDraft(options: { enabled?: boolean } = {}) {
  return useQuery<ProviderOnboardingDraftView, AxiosError>({
    queryKey: providerQueryKeys.onboarding.draft(),
    queryFn: getOnboardingDraft,
    enabled: options.enabled ?? true,
    // The wizard is the only writer of this resource in a given tab, and every
    // mutation seeds the cache. Refetching on focus would replace a form the
    // provider is mid-edit in with the server's copy.
    refetchOnWindowFocus: false,
    // Sprint 09B.29 Phase 4 — THE CACHE SLOT MUST NOT GO BACKWARDS.
    //
    // This slot has two writers: this query, and the autosave coordinator's
    // `setQueryData` after a successful PATCH. React Query has no idea the
    // second one exists, so a fetch result always overwrites whatever is
    // there — including a NEWER view written while the request was open.
    //
    // A GET issued when the task mounted, resolving after a PATCH that
    // advanced the draft, therefore put the pre-PATCH version back. The next
    // edit then presented a token the server had already moved past, the
    // server answered 409, and the coordinator DROPS a conflicted payload by
    // design (re-sending it would overwrite whoever else wrote). The
    // provider's typing was discarded and the chip told them to reload.
    //
    // `structuralSharing` is the documented hook for deciding what actually
    // lands in the cache. Keeping the higher version makes the slot
    // monotonic, which is the invariant the optimistic lock assumes and was
    // silently relying on.
    //
    // A stale read is not a reason to forget a write the server committed.
    //
    // SCOPED TO `draftId`, AND THAT SCOPE IS THE SAFETY PROPERTY.
    //
    // Comparing bare versions would be worse than the bug it fixes. This slot
    // is keyed by RESOURCE, not by provider, so two values in it can belong to
    // two different people or to two generations of one draft:
    //
    //   cross-provider   provider A at version 50, then a sign-out that left
    //                    anything behind, then provider B at version 3. A
    //                    version-only rule keeps A — and B is shown, and could
    //                    submit, another provider's application.
    //   reset draft      a draft row deleted and recreated restarts at 0. A
    //                    version-only rule pins the client to the dead
    //                    generation until the cache is dropped.
    //
    // So versions are only compared when they are versions of the SAME draft.
    // A different id is not a stale read, it is a different document, and it
    // wins outright. A null id on either side means the server has no draft
    // row to compare and the newer response is taken as-is.
    //
    // The sign-out path (`purgeNonAuthQueries`) already removes this key, so
    // in a correct session the cross-provider case never arises. This does not
    // rely on that: a guard whose safety depends on a distant module staying
    // correct is a guard that fails the first time that module changes.
    structuralSharing: (prev, next) => {
      const previous = prev as ProviderOnboardingDraftView | undefined;
      const incoming = next as ProviderOnboardingDraftView;
      const sameDraft =
        previous != null &&
        previous.draftId != null &&
        incoming.draftId != null &&
        previous.draftId === incoming.draftId;
      if (sameDraft && incoming.version < previous.version) return previous;
      return incoming;
    },
    // 401, 403 and 404 are ANSWERS, not transient failures.
    //
    //   401 — the session is gone. The api client already fired
    //         `auth:session-expired`, and a second and third identical attempt
    //         cannot succeed; all they do is hold the screen on a spinner for
    //         several seconds of backoff before showing the same thing.
    //   403 — no provider role.
    //   404 — provider role but no profile row.
    //
    // Retrying any of them delays the screen that would explain the state.
    retry: (failureCount, err) => {
      const status = err.response?.status;
      if (status === 401 || status === 403 || status === 404) return false;
      return failureCount < 2;
    },
  });
}

export function useSubmitOnboarding() {
  const qc = useQueryClient();
  return useMutation<ProviderOnboardingDraftView, AxiosError, { version: number }>({
    mutationFn: (input) => submitOnboarding(input),
    onSuccess: (view) => {
      qc.setQueryData(providerQueryKeys.onboarding.draft(), view);
      // The provider's lifecycle state changed, so anything gated on it — the
      // profile screen, the capability set — is now stale.
      qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root });
    },
  });
}

export function useWithdrawOnboarding() {
  const qc = useQueryClient();
  return useMutation<ProviderOnboardingDraftView, AxiosError, void>({
    mutationFn: withdrawOnboarding,
    onSuccess: (view) => {
      qc.setQueryData(providerQueryKeys.onboarding.draft(), view);
      qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root });
    },
  });
}

/**
 * Autosave for one step of the SPRINT 8 (V1) WIZARD. Legacy.
 *
 * Sprint 9B.28 — V2 no longer uses this. Its writes go through
 * `ProviderOnboardingAutosaveProvider`, which owns ONE queue and ONE version
 * handshake for the whole draft; see that file for why per-component instances
 * could not be made safe.
 *
 * This copy stays because V1 is still the DEFAULT onboarding surface — the V2
 * flag ships off — and rewriting the live fallback's save semantics is not
 * this sprint's scope or risk budget. V1 is much less exposed than V2 was: it
 * mounts ONE step at a time, so the two-instances-one-version race that
 * produced 409s on the V2 Basics and Services screens cannot occur here.
 *
 * What it still carries, and what is tracked as residual risk:
 *   - `status` has no `dirty` state, so a `saved` chip outlives a newer edit;
 *   - `flush()` returns early while a write is open, so `saveNow()` is not a
 *     true drain.
 *
 * Do not add callers. New work belongs on the coordinator.
 *
 * Owns four things the wizard would otherwise get wrong in four places:
 *
 *   DEBOUNCE     one save per pause, not one per keystroke.
 *   COALESCING   a save fired while another is in flight replaces the queued
 *                payload rather than queueing a second write. Two writes with
 *                the same version means the second one 409s on work the
 *                provider has not seen fail.
 *   VERSION      always taken from the LATEST server response, never from a
 *                value captured when the component rendered.
 *   OFFLINE      a save attempted with no connection is HELD, not failed. The
 *                edit is still in memory and fires when the connection
 *                returns, so a provider in a basement does not lose a screen.
 */
export function useLegacyWizardStepAutosave(step: ProviderOnboardingStep) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AutosaveStatus>({ kind: 'idle' });
  const [isDirty, setDirty] = useState(false);

  // The edit waiting to be written. A ref rather than state because changing
  // it must not re-render — the whole point is that typing is cheap.
  const pending = useRef<Omit<PatchOnboardingStepRequest, 'version'> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const currentVersion = useCallback((): number | null => {
    const view = qc.getQueryData<ProviderOnboardingDraftView>(providerQueryKeys.onboarding.draft());
    return view?.version ?? null;
  }, [qc]);

  const flush = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    const payload = pending.current;
    if (!payload) return;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Held, not dropped. `pending` still carries the edit, and the online
      // listener below re-fires this.
      setStatus({ kind: 'offline' });
      return;
    }

    const version = currentVersion();
    if (version === null) {
      setStatus({
        kind: 'error',
        message: 'not-loaded',
        retry: () => {
          void flush();
        },
      });
      return;
    }

    inFlight.current = true;
    pending.current = null;
    setStatus({ kind: 'saving' });

    let succeeded = false;
    try {
      const view = await patchOnboardingStep(step, { ...payload, version });
      if (!mounted.current) return;
      // Seeded, not invalidated: a refetch would briefly repaint the
      // pre-save state, and the provider would watch their own typing
      // flicker.
      qc.setQueryData(providerQueryKeys.onboarding.draft(), view);
      setStatus({ kind: 'saved', at: Date.now() });
      setDirty(false);
      succeeded = true;
    } catch (error) {
      if (!mounted.current) return;
      const axiosError = error as AxiosError<{ details?: { expectedVersion?: number } }>;
      const httpStatus = axiosError.response?.status;

      if (httpStatus === 409) {
        // Another tab won. The edit is dropped rather than queued: retrying it
        // would overwrite work the provider has not seen, and the UI's answer
        // is to reload, not to try harder.
        setStatus({
          kind: 'conflict',
          serverVersion: axiosError.response?.data?.details?.expectedVersion ?? -1,
        });
        return;
      }

      // Put the edit back so the retry button has something to send. Any
      // newer edit that landed while the request was in flight wins — it is
      // more recent than what just failed.
      pending.current = { ...payload, ...(pending.current ?? {}) };
      setStatus({
        kind: 'error',
        message: String(httpStatus ?? 'network'),
        retry: () => {
          void flush();
        },
      });
    } finally {
      inFlight.current = false;
      // Chase a follow-up edit ONLY after a success.
      //
      // Re-firing after a failure would hot-loop the network: the failed
      // payload is deliberately put back for the retry button, so an
      // automatic re-flush would immediately fail it again, and again. Retry
      // is the provider's decision, and the failure is on screen for them to
      // make it.
      if (succeeded && mounted.current && pending.current) void flush();
    }
  }, [currentVersion, qc, step]);

  /** Queue an edit. Replaces any queued edit for the same step — the newest
   *  values are the complete answer for this screen, not a delta on top of an
   *  older one. */
  const save = useCallback(
    (patch: Omit<PatchOnboardingStepRequest, 'version'>) => {
      pending.current = { ...(pending.current ?? {}), ...patch };
      setDirty(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  /** Write immediately — used by Next/Back, which must not advance while an
   *  edit is still resting in the debounce. */
  const saveNow = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await flush();
  }, [flush]);

  // Retry when the connection returns. Without this an offline edit sits
  // there until the provider touches the field again, and "Saved" never
  // appears even though they are back online.
  useEffect(() => {
    const onOnline = () => {
      if (pending.current) void flush();
      else if (status.kind === 'offline') setStatus({ kind: 'idle' });
    };
    const onOffline = () => {
      if (pending.current) setStatus({ kind: 'offline' });
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flush, status.kind]);

  // Unsaved-change protection. Fires only while something is genuinely
  // unwritten — a confirm dialog on every navigation trains people to dismiss
  // it, which is worse than not having one.
  useEffect(() => {
    if (!isDirty && !pending.current) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Assigning returnValue is what actually triggers the browser prompt;
      // the text itself is ignored by every current browser.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  return { status, isDirty, save, saveNow };
}
