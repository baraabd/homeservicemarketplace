// PATCH /v1/admin/providers/:providerProfileId/review-notes
//
// Sprint 6.2 — sets / clears the admin-facing review notes pinned to
// the provider profile. `notes` is required on the wire; pass an empty
// string to clear. The mutation writes an ADMIN_PROVIDER_NOTES_UPDATED
// audit event and does NOT fan out a user-facing notification (notes
// are an admin private surface).
export interface UpdateProviderReviewNotesRequest {
  notes: string;
}
