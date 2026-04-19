// Public-facing shape of a user's profile. Purely optional cosmetic fields
// today; provider-only data (portfolio, skills) will be carried by a
// separate contract when the provider domain lands.
export interface ProfileDto {
  id: string;
  userId: string;
  avatarUrl: string | null;
  phoneNumber: string | null;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
}
