// Admin provider-category-application queue (Sprint 7.x).
//
//   GET  /v1/admin/category-applications?status&limit&cursor
//   POST /v1/admin/category-applications/:applicationId/review
//
// Approve flips PENDING → APPROVED and mirrors the row into
// ProviderProfileServiceCategory so the provider's public profile
// picks the skill up. Reject flips PENDING → REJECTED. Each writes
// an admin audit event and dispatches a notification to the provider's
// userId. RolesGuard('admin') + CsrfGuard apply on the mutation.
export * from './enums/provider-category-application-status';
export * from './request/list-pending-categories.query';
export * from './request/review-category-application.request';
export * from './response/pending-category-summary';
export * from './response/list-pending-categories.response';
