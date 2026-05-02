// Admin user control (Sprint 6.1).
//
// Surfaces:
//   GET   /v1/admin/users?query|q&status&role&limit&cursor — list/search
//   GET   /v1/admin/users/:userId                          — detail
//   PATCH /v1/admin/users/:userId/status                   — Sprint 6.1 canonical
//   POST  /v1/admin/users/:userId/suspend                  — legacy (kept for back-compat)
//   POST  /v1/admin/users/:userId/restore                  — legacy (kept for back-compat)
//   GET   /v1/admin/roles                                  — Sprint 6.1; for filter chips
//
// Mutations write an AuditEvent (ADMIN_USER_SUSPENDED /
// ADMIN_USER_RESTORED) attributed to the calling admin's userId.
// Role mutation is intentionally deferred — see docs/sprints/sprint-6-admin-plan.md.
export * from './request/list-admin-users.query';
export * from './request/update-user-status.request';
export * from './response/admin-user-summary';
export * from './response/list-admin-users.response';
export * from './response/admin-user-mutation.response';
export * from './response/admin-roles.response';
