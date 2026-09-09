import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RoleName } from '@homeservicemarketplace/contracts';

import { getMe, refresh as refreshSession } from '../../../../lib/auth-api';
import { providerQueryKeys } from '../../../../lib/provider/query-keys';
import {
  classifyRecovery,
  shouldAttemptRecovery,
  type RecoveryOutcome,
  type RecoveryState,
} from './stale-role-recovery';

// Sprint 9B.29 — the IO half of stale-role recovery.
//
// The policy lives in `stale-role-recovery.ts` and is tested without React or a
// network. This file does only what needs a browser: hold the attempt counter
// across renders, run the rotation, and refresh the caches afterwards.
//
// WHY A MUTATION AND NOT `useState`
//
// The first version hand-rolled the async state and set it from an effect,
// which `react-hooks/set-state-in-effect` flags — correctly. The effect's own
// dependency list includes the state it was setting, so a synchronous
// transition re-enters the effect before paint.
//
// A mutation removes the problem rather than silencing it: React Query owns
// `idle → pending → success/error`, which is exactly the shape this needed, and
// the effect body ends up calling `mutate()` — a request, not a state write.
// The de-duplication and the unmount safety come with it instead of being
// hand-maintained.
//
// THE COUNTER IS STILL A REF, and that is load-bearing. A 403 arrives from a
// query, which re-renders; if the budget lived in state, two renders in the
// same tick would both read `attempts: 0`, both pass the guard, and both start
// a rotation — the exact storm the cap exists to prevent. A ref is written
// synchronously and read by the very next caller.

export interface StaleRoleRecovery {
  state: RecoveryState;
  /** True while a rotation is in flight — bind to `aria-busy`/`disabled`. */
  isRecovering: boolean;
  /** Manual re-attempt. Restores the budget, so it is offered only where
   *  `isRetryable` says a retry can actually change the answer. */
  retry: () => void;
}

/**
 * Rotate the session, then confirm the role actually arrived.
 *
 * Returns the outcome rather than throwing, because "the refresh call failed"
 * and "the refresh worked and the role still is not there" are different facts
 * that need different copy, and an exception collapses them into one.
 */
async function rotateAndVerify(): Promise<RecoveryOutcome> {
  // No initializer: both branches below assign it.
  let roles: RoleName[] | null;
  try {
    await refreshSession();
    // The authoritative answer, not the rotation's status code. A refresh that
    // returns 200 but yields a session still missing `provider` has recovered
    // nothing.
    roles = (await getMe()).roles;
  } catch {
    // Deliberately no logging: the detail belongs to the refresh cookie, and
    // that is not something to put in a browser console.
    roles = null;
  }
  return classifyRecovery(roles);
}

/**
 * Recover a stale provider role claim, at most once per mount.
 *
 * `forbidden` is the trigger: pass `true` only when the surface is actually
 * being refused with a 403. A broader condition would rotate sessions for
 * ordinary failures.
 *
 * `onRecovered` runs after the caches are invalidated, so the caller can
 * refetch the query that was refused. That is deliberately the caller's job —
 * this hook does not know which query failed, and guessing would either miss it
 * or refetch the world.
 */
export function useStaleRoleRecovery(
  forbidden: boolean,
  onRecovered?: () => void,
): StaleRoleRecovery {
  const qc = useQueryClient();
  const attempts = useRef(0);

  const rotation = useMutation<RecoveryOutcome, Error, void>({
    mutationFn: rotateAndVerify,
    onSuccess: async (outcome) => {
      if (outcome.kind !== 'recovered') return;
      // Deterministic order, matching the upgrade mutation: the session first,
      // because every role gate in the app reads it, then the surfaces that
      // depend on it. Awaited so `onRecovered` cannot refetch into a cache that
      // is still being invalidated.
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      await qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root });
      await qc.invalidateQueries({ queryKey: providerQueryKeys.onboarding.root });
      onRecovered?.();
    },
  });

  // Project the mutation onto the vocabulary the screens speak.
  //
  // `exhausted` is reserved for the case that must never loop: the server gave
  // a genuine refusal. The attempt counter is deliberately NOT consulted here —
  // reading a ref during render is both a lint error and a correctness trap
  // (renders that do not re-run would see a stale value). It is not needed:
  // `rotation.data` exists only after an attempt has completed, and `retry()`
  // clears it via `reset()`, so the presence of a `role-missing` result already
  // means "we spent the budget and the answer was no".
  //
  // A failed *refresh* stays `failed` so the screen can offer a retry that
  // might actually work.
  const state: RecoveryState = rotation.isPending
    ? { kind: 'recovering' }
    : rotation.data
      ? rotation.data.kind === 'recovered'
        ? { kind: 'recovered' }
        : rotation.data.reason === 'role-missing'
          ? { kind: 'exhausted' }
          : rotation.data
      : rotation.isError
        ? { kind: 'failed', reason: 'refresh-failed' }
        : { kind: 'idle' };

  // Fire automatically on the first 403 only. A second 403, a 403 after a
  // failure, and a 403 while recovering are all refused by the policy.
  //
  // The body calls `mutate()` — a request, not a state write — so this effect
  // does not cascade renders.
  useEffect(() => {
    if (!shouldAttemptRecovery({ forbidden, attempts: attempts.current, state: state.kind })) {
      return;
    }
    attempts.current += 1;
    rotation.mutate();
  }, [forbidden, rotation, state.kind]);

  const retry = useCallback(() => {
    // A manual retry is the provider asking again, so it gets a fresh budget.
    // `reset()` returns the mutation to idle, which re-arms the effect above.
    attempts.current = 0;
    rotation.reset();
  }, [rotation]);

  return { state, isRecovering: rotation.isPending, retry };
}
