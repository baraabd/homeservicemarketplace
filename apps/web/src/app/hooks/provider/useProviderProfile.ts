import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type {
  ApplyForCategoryRequest,
  ApplyForCategoryResponse,
  GetProviderProfileResponse,
  UpdateProviderAvailabilityRequest,
  UpdateProviderAvailabilityResponse,
  UpdateProviderProfileRequest,
  UpdateProviderProfileResponse,
  UpgradeToProviderResponse,
} from '@homeservicemarketplace/contracts';

import {
  applyForCategory,
  getProviderProfile,
  updateProviderAvailability,
  updateProviderProfile,
  upgradeToProvider,
} from '../../../lib/provider/provider-profile-api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';

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
export function useUpgradeToProvider() {
  const qc = useQueryClient();
  return useMutation<UpgradeToProviderResponse, AxiosError, void>({
    mutationFn: upgradeToProvider,
    onSuccess: (res) => {
      qc.setQueryData(providerQueryKeys.profile.get(), { profile: res.profile });
      qc.invalidateQueries({ queryKey: providerQueryKeys.profile.root });
      // The user's role set just changed (a refresh of /v1/auth/me will
      // surface "provider"). Drop the cached MeResponse so consumers
      // that role-gate on it pick up the new role.
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
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
