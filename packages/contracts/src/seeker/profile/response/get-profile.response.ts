import type { ProfileSummary } from './profile-summary';

// GET /v1/me/profile envelope. Wraps the ProfileSummary in a `profile`
// key so the response shape can grow (verification status, completion
// score, etc.) without breaking existing consumers.
export interface GetProfileResponse {
  profile: ProfileSummary;
}
