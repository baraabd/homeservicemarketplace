import type { ProfileSummary } from './profile-summary';

// PATCH /v1/me/profile envelope. Returns the post-update profile so
// the frontend can reconcile the form against the canonical server
// state (trims, null normalisation, etc.) without a follow-up GET.
export interface UpdateProfileResponse {
  profile: ProfileSummary;
}
