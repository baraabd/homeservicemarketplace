// Admin provider-category-application queue (Sprint 7.x).
//
//   GET  /v1/admin/category-applications?status&limit&cursor
//   POST /v1/admin/category-applications/:applicationId/review
//
// Approve flips PENDING → APPROVED and mirrors the row into
// ProviderProfileServiceCategory so the provider's public profile picks the
// skill up. Reject flips PENDING → REJECTED. Both happen in ONE transaction
// together with the audit record, so a decision and its evidence cannot come
// apart. RolesGuard('admin') + CsrfGuard apply on the mutation.
//
// (This barrel previously also claimed each review "dispatches a notification
// to the provider's userId". It does not, and never did. The claim is removed
// rather than left standing: provider-facing notification of a skill decision
// is worth building, but a comment is not the place to pretend it exists.)
export * from './enums/provider-category-application-status';
export * from './request/list-pending-categories.query';
export * from './request/review-category-application.request';
export * from './response/pending-category-summary';
export * from './response/list-pending-categories.response';
