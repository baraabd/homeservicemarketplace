// POST /v1/admin/category-applications/:applicationId/review body.
//
// `action: 'APPROVE'` flips the row to APPROVED and mirrors it into
// ProviderProfileServiceCategory so the provider's public profile
// picks the skill up immediately.
// `action: 'REJECT'` flips the row to REJECTED. The provider keeps
// the prior approved skills; the rejected row stays as audit trail.
//
// `notes` are admin-facing. They land on the audit row but do NOT
// reach the provider — provider-facing copy comes through the
// notification template tied to the action. (Distinct from the
// provider-profile reviewNotes which is a free-form pin.)
export interface ReviewCategoryApplicationRequest {
  action: 'APPROVE' | 'REJECT';
  notes?: string | null;
}
