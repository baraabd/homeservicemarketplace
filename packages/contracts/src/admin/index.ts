// Admin bounded-context contracts. Sprint 6 ships:
//   health/  ✓ slice 6.0 — module bootstrap + ping
//   users/        slice 6.1 — list/search/suspend/restore
//   verification/ slice 6.2 — provider approve/reject
//   disputes/     slice 6.3 — open/resolve disputes
//   analytics/    slice 6.4 — read-only KPIs
//   settings/     slice 6.5 — platform settings
//   audit/        slice 6.6 — audit log read
//
// Every admin endpoint is gated on RolesGuard('admin'); mutations
// additionally require CsrfGuard. Identity comes from the session.
export * from './health';
export * from './users';
