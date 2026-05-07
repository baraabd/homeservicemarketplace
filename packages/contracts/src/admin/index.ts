// Admin bounded-context contracts. Sprint 6 ships:
//   health/               ✓ slice 6.0 — module bootstrap + ping
//   users/                  slice 6.1 — list/search/suspend/restore
//   verification/           slice 6.2 — provider approve/reject
//   disputes/               slice 6.3 — open/resolve disputes
//   analytics/              slice 6.4 — overview / revenue (date-range)
//   financials/             slice 6.4 — summary / bookings / provider-earnings
//   settings/               slice 6.5 — platform settings
//   audit/                  slice 6.6 — audit log read
//   category-applications/  Sprint 7.x — provider skill-application queue
//
// Every admin endpoint is gated on RolesGuard('admin'); mutations
// additionally require CsrfGuard. Identity comes from the session.
export * from './health';
export * from './users';
export * from './verification';
export * from './disputes';
export * from './analytics';
export * from './financials';
export * from './settings';
export * from './audit';
export * from './category-applications';
