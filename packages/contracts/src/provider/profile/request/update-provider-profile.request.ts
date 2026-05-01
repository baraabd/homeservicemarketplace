// PATCH /v1/me/provider/profile body. Every field is optional; only
// the fields the caller sends are written. `userId`, `email`, `role`,
// `status`, and reputation columns (`ratingAvg`, `reviewCount`,
// `completedJobs`, `verified`, `topPro`) are intentionally absent —
// the global ValidationPipe is configured with
// `forbidNonWhitelisted: true` and rejects any payload trying to
// inject them.
//
// `categoryIds` replaces the provider's full skill set when present
// (set semantics, not append). Sending an empty array clears the
// skills.
//
// Trim/empty-string normalisation is handled in the DTO layer so the
// caller can safely send "" to clear an optional field.
export interface UpdateProviderProfileRequest {
  displayName?: string;
  bio?: string | null;
  headline?: string | null;
  phoneNumber?: string | null;
  serviceAreaCity?: string | null;
  serviceAreaCountry?: string | null;
  serviceAreaLat?: number | null;
  serviceAreaLng?: number | null;
  serviceAreaRadiusKm?: number | null;
  categoryIds?: string[];
}
