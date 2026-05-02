// Admin user control (Sprint 6.1).
//
// Surfaces:
//   GET  /v1/admin/users?q&status&role&limit&cursor — list/search
//   GET  /v1/admin/users/:userId                    — detail
//   POST /v1/admin/users/:userId/suspend            — set isActive=false
//   POST /v1/admin/users/:userId/restore            — set isActive=true
//
// Mutations write an AuditEvent (ADMIN_USER_SUSPENDED /
// ADMIN_USER_RESTORED) attributed to the calling admin's userId.
export * from './request/list-admin-users.query';
export * from './response/admin-user-summary';
export * from './response/list-admin-users.response';
export * from './response/admin-user-mutation.response';
