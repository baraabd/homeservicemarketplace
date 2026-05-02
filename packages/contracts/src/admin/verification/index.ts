// Admin provider verification (Sprint 6.2).
//
//   GET  /v1/admin/providers?status&limit&cursor — list (default PENDING_REVIEW)
//   GET  /v1/admin/providers/:providerProfileId
//   POST /v1/admin/providers/:providerProfileId/approve   { note? }
//   POST /v1/admin/providers/:providerProfileId/reject    { reason }
//   POST /v1/admin/providers/:providerProfileId/suspend   { reason }
//
// Approve flips status DRAFT|PENDING_REVIEW -> ACTIVE; reject flips
// any non-terminal status -> REJECTED; suspend flips ACTIVE ->
// SUSPENDED. Each writes ADMIN_PROVIDER_{APPROVED,REJECTED,SUSPENDED}
// audit + sends a notification to the provider's userId when set.
export * from './request/list-admin-providers.query';
export * from './request/admin-provider-decision.request';
export * from './response/admin-provider-summary';
export * from './response/list-admin-providers.response';
export * from './response/admin-provider-mutation.response';
