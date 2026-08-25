// Admin provider verification (Sprint 6.2 refined — full workflow).
//
//   GET   /v1/admin/providers?status&limit&cursor             — list (default PENDING_REVIEW)
//   GET   /v1/admin/providers/:providerProfileId              — detail (now carries reviewNotes)
//   GET   /v1/admin/providers/:providerProfileId/audit        — Sprint 6.2 verification history
//   PATCH /v1/admin/providers/:providerProfileId/review-notes — Sprint 6.2 reviewer notes upsert
//   POST  /v1/admin/providers/:providerProfileId/approve      { note? }
//   POST  /v1/admin/providers/:providerProfileId/reject       { reason? }
//   POST  /v1/admin/providers/:providerProfileId/suspend      { reason? }
//   POST  /v1/admin/providers/:providerProfileId/reactivate
//
// The legal transitions are NOT restated here. This comment used to say
// "Approve flips status DRAFT|PENDING_REVIEW -> ACTIVE", which stopped being
// true in Phase 4 and stayed on the page — a third copy of the rule, drifted,
// in the file whose job is to define it. The table now lives in exactly one
// place and is imported:
//
//     ADMIN_PROVIDER_TRANSITIONS  (./admin-provider-transitions)
//
// review-notes upserts the persisted reviewer notes. Each action writes an
// ADMIN_PROVIDER_{APPROVED,REJECTED,SUSPENDED,NOTES_UPDATED} audit row and,
// for status changes only, notifies the provider's userId.
export * from './admin-provider-transitions';
export * from './request/list-admin-providers.query';
export * from './request/admin-provider-decision.request';
export * from './request/update-review-notes.request';
export * from './request/list-provider-audit.query';
export * from './response/admin-provider-summary';
export * from './response/admin-verification-case';
export * from './response/list-admin-providers.response';
export * from './response/admin-provider-mutation.response';
export * from './response/provider-audit-event';
