// Every field is optional — the client PATCHes only what it wants to change.
// `null` explicitly clears a field; `undefined` leaves it untouched.
export interface UpdateProfileRequest {
  avatarUrl?: string | null;
  phoneNumber?: string | null;
  bio?: string | null;
}
