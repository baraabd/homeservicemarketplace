import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GetProfileResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
} from '@homeservicemarketplace/contracts';

import { getProfile, updateProfile } from '../../../lib/seeker/profile-api';
import { seekerQueryKeys } from '../../../lib/seeker/query-keys';

// React Query hook for the editable-profile feed. 30s stale matches
// the other Seeker queries — short enough that a re-open after a save
// is fresh, long enough that opening the edit page twice in a row
// doesn't refetch needlessly.
export function useProfile() {
  return useQuery<GetProfileResponse>({
    queryKey: seekerQueryKeys.profile.get(),
    queryFn: () => getProfile(),
    staleTime: 30 * 1000,
  });
}

// PATCH /v1/me/profile mutation.
//
// On success, invalidate:
//   - profile root → form re-reads the canonical post-trim values
//   - auth/me → header / useAuthIdentity reflect updated firstName /
//     lastName / initials in the same render cycle
//
// We deliberately do NOT optimistic-update: the server normalises
// empty strings to null and trims whitespace, so the client should
// reconcile against the response, not its own pre-trim guess.
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation<UpdateProfileResponse, Error, UpdateProfileRequest>({
    mutationFn: (input) => updateProfile(input),
    onSuccess: (res) => {
      // The acknowledgement IS the canonical profile, so the cache takes it
      // before the refetch is even asked for. Without this the cache still
      // held the pre-save profile until the refetch returned, and a form
      // re-reading it in that window put the old values back on screen. This
      // is the server's own response, not a client guess, and it mirrors what
      // the provider profile mutation already does.
      qc.setQueryData<GetProfileResponse>(seekerQueryKeys.profile.get(), {
        profile: res.profile,
      });
      qc.invalidateQueries({ queryKey: seekerQueryKeys.profile.root });
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });
}
