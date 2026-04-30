// Editable profile shape returned by GET / PATCH /v1/me/profile.
//
// `firstName` / `lastName` / `email` come from the User row (auth
// columns); `phoneNumber` / `city` / `bio` / `avatarUrl` come from
// the UserProfile row that's lazily upserted on first access.
//
// `displayName` and `initials` are computed server-side so every
// surface (header, drawer, edit page) shows the same string without
// duplicating the deriveDisplayName / deriveInitials logic on the
// client.
//
// `email` is read-only in slice; the PATCH DTO does not declare it.
// `avatarUrl` is exposed for completeness — avatar upload is out of
// scope for this slice.
export interface ProfileSummary {
  firstName: string;
  lastName: string;
  displayName: string;
  initials: string;
  email: string;
  phoneNumber: string | null;
  city: string | null;
  bio: string | null;
  avatarUrl: string | null;
  updatedAt: string;
}
