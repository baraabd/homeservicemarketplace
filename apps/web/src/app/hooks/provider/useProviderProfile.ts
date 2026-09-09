import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type {
  ApplyForCategoryRequest,
  ApplyForCategoryResponse,
  GetProviderProfileResponse,
  RoleName,
  UpdateProviderAvailabilityRequest,
  UpdateProviderAvailabilityResponse,
  UpdateProviderProfileRequest,
  UpdateProviderProfileResponse,
  UpgradeToProviderResponse,
} from '@homeservicemarketplace/contracts';

import {
  classifyRecovery,
  type RecoveryState,
} from '../../features/provider-onboarding-v2/session/stale-role-recovery';

import {
  applyForCategory,
  getProviderProfile,
  updateProviderAvailability,
  updateProviderProfile,
  upgradeToProvider,
} from '../../../lib/provider/provider-profile-api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';
import { getMe, refresh as refreshSession } from '../../../lib/auth-api';

// React Query hook for the authenticated user's Provider profile. A
// 403 (no provider role) and a 404 (provider role but no profile row
// — corner case after a manual data edit) are BOTH handled by the
// caller as "needs upgrade", so we don't retry either; the upgrade
// mutation is the deliberate next step.
function isUpgradeNeeded(err: unknown): boolean {
  const status = (err as AxiosError | undefined)?.response?.status;
  return status === 403 || status === 404;
}

export function useProviderProfile() {
  return useQuery<GetProviderProfileResponse, AxiosError>({
    queryKey: providerQueryKeys.profile.get(),
    queryFn: getProviderProfile,
    staleTime: 60 * 1000,
    retry: (failureCount, err) => !isUpgradeNeeded(err) && failureCount < 2,
  });
}

// All three mutations seed the profile cache from the response and
// invalidate the root so any future reader picks up the canonical
// state. The caller doesn't need to refetch manually.

/**
 * Become a provider — and end up with a SESSION that says so.
 *
 * Sprint 9B.28 — the second half of that sentence is the fix.
 *
 * THE BUG
 *
 * `POST /me/provider/upgrade` assigns the provider role in the database and
 * returns the new profile. It does not touch the caller's session. But
 * `JwtStrategy.validate` takes `roles` FROM THE ACCESS TOKEN — deliberately,
 * and it says so in a comment — so the token minted at login still carried the
 * pre-upgrade role set. `RolesGuard` read that token and answered 403 to every
 * `/v1/me/provider/**` call the freshly-upgraded provider made, including the
 * onboarding draft, hub and review this sprint exists to repair.
 *
 * Invalidating the cached `/v1/auth/me` — which is all this used to do — could
 * not fix it. That refetch goes out on the SAME token and comes back with the
 * same roles.
 *
 * And it presented as 403, not 401, so the api client's refresh interceptor
 * never engaged: that interceptor is scoped to 401 on purpose, because a 403
 * normally means "correctly identified, genuinely not allowed" and retrying it
 * after a refresh would be a privilege-escalation retry loop. Nothing was
 * wrong with the interceptor. The upgrade simply left the session behind.
 *
 * THE FIX
 *
 * Rotate the session immediately after the upgrade commits.
 * `AuthenticationService.refresh` re-reads the role rows from the database
 * before minting — `peekByRefreshRaw` then `users.listRoles` — so the new
 * access token carries `provider` because the SERVER looked it up, not because
 * the client asked for it. No new endpoint, no client-side claim, no
 * capability the user was not already granted by the upgrade itself.
 *
 * Awaited, and inside `onSuccess`, so `mutateAsync` does not resolve until the
 * new cookie is set. A caller that navigates into a provider surface on
 * resolution therefore arrives with a usable token rather than into a 403.
 *
 * A failed rotation is deliberately NOT fatal to the upgrade: the role is
 * committed server-side either way, and the ordinary 401 → refresh → retry
 * path recovers the session on the next call. Throwing here would report a
 * successful upgrade as a failure and invite the provider to run it again.
 *
 * Sprint 9B.29 — the rotation is no longer SILENT, and it is VERIFIED.
 *
 * 9B.28 wrapped the rotation in `try { … } catch {}`. The reasoning given was
 * sound as far as it went — the role is committed server-side either way, so
 * failing the upgrade would be untrue — but swallowing the error left the
 * provider with a session that cannot open the thing the button just created,
 * and nothing on screen said so. They were navigated into a 403 and told their
 * session had expired.
 *
 * So the failure is now REPORTED rather than either thrown or discarded:
 * `mutateAsync` still resolves (the upgrade did succeed), and the hook
 * additionally exposes `sync`, which the activation surface renders as a
 * recoverable synchronization error with a retry.
 *
 * And the rotation is checked rather than assumed. A refresh that returns 200
 * but produces a session still missing `provider` has not synchronized
 * anything; `classifyRecovery` reads the authoritative role set and says so.
 *
 * Invalidation order is deterministic and AWAITED — `auth/me` first because
 * every role gate in the app reads it, then the provider profile, then the
 * onboarding read-models. Previously the onboarding keys were not invalidated
 * at all, so the hub could serve a projection built under the old token, and
 * the calls were not awaited, so `mutateAsync` resolved before any of them had
 * refetched.
 */
export function useUpgradeToProvider() {
  const qc = useQueryClient();
  const [sync, setSync] = useState<RecoveryState>({ kind: 'idle' });

  /**
   * Rotate, verify, then refresh every cache the new role changes the answer
   * for. Returns the outcome instead of throwing: the caller needs to know the
   * upgrade succeeded AND that the session lagged, which an exception collapses
   * into one fact.
   */
  const synchronize = useCallback(async (): Promise<RecoveryState> => {
    setSync({ kind: 'recovering' });

    // No initializer: both branches below assign it.
    let roles: RoleName[] | null;
    try {
      await refreshSession();
      // Read the AUTHORITATIVE session rather than trusting the rotation's
      // status code. This is the check that distinguishes "the token now says
      // provider" from "the request that should have made it say so returned
      // 200".
      roles = (await getMe()).roles;
    } catch {
      // Deliberately no logging: the failure detail belongs to the refresh
      // cookie, and that is not something to put in a browser console.
      roles = null;
    }

    const outcome = classifyRecovery(roles);
    setSync(outcome);

    // Only worth refreshing caches when the session actually changed. Doing it
    // after a failed rotation would fire every provider query on the old token
    // and collect a fan of 403s.
    if (outcome.kind === 'recovered') {
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      await qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root });
      await qc.invalidateQueries({ queryKey: providerQueryKeys.onboarding.root });
    }

    return outcome;
  }, [qc]);

  const mutation = useMutation<UpgradeToProviderResponse, AxiosError, void>({
    mutationFn: upgradeToProvider,
    onSuccess: async (res) => {
      qc.setQueryData(providerQueryKeys.profile.get(), { profile: res.profile });
      await synchronize();
    },
  });

  return {
    ...mutation,
    /** The session-synchronization axis, separate from the upgrade's own
     *  success. `retry` re-runs only the rotation — the upgrade is idempotent
     *  but re-running it would be a second write for a problem that is not
     *  there. */
    sync: { state: sync, retry: synchronize },
  };
}

export function useUpdateProviderProfile() {
  const qc = useQueryClient();
  return useMutation<UpdateProviderProfileResponse, AxiosError, UpdateProviderProfileRequest>({
    mutationFn: updateProviderProfile,
    onSuccess: (res) => {
      qc.setQueryData(providerQueryKeys.profile.get(), { profile: res.profile });
      qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root });
    },
  });
}

export function useUpdateProviderAvailability() {
  const qc = useQueryClient();
  return useMutation<
    UpdateProviderAvailabilityResponse,
    AxiosError,
    UpdateProviderAvailabilityRequest
  >({
    mutationFn: updateProviderAvailability,
    onSuccess: (res) => {
      qc.setQueryData(providerQueryKeys.profile.get(), { profile: res.profile });
      qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root });
    },
  });
}

// Sprint 2 — apply for a service category.
//
// Kept separate from useUpdateProviderProfile because the two do genuinely
// different things: the PATCH edits a profile, this one opens a request that
// an admin has to decide. Sharing a mutation would invite the UI to treat a
// submitted application as a saved field.
//
// On success the profile cache is invalidated rather than seeded: the response
// carries the application, not the profile, and `pendingCategories` lives on
// the profile — so a refetch is what makes the new pending chip appear.
export function useApplyForCategory() {
  const qc = useQueryClient();
  return useMutation<ApplyForCategoryResponse, AxiosError, ApplyForCategoryRequest>({
    mutationFn: applyForCategory,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root });
    },
  });
}
