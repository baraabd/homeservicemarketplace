// Provider booking lifecycle (Sprint 5 slice 5.4).
//
// Surfaces:
//   GET  /v1/me/provider/bookings                  — list mine
//   GET  /v1/me/provider/bookings/:id              — detail
//   GET  /v1/me/provider/bookings/:id/timeline     — audit timeline
//   POST /v1/me/provider/bookings/:id/start        — SCHEDULED → IN_PROGRESS
//   POST /v1/me/provider/bookings/:id/complete     — IN_PROGRESS → COMPLETED
//   POST /v1/me/provider/bookings/:id/cancel       — SCHEDULED → CANCELLED
//
// All read + write paths are gated on JwtAuthGuard + RolesGuard('provider')
// + ProviderActiveGuard; mutations additionally require CsrfGuard.
//
// Identity exposure: at this point a bid has been ACCEPTED, so the
// provider needs to know who they're working with. The wire surfaces
// the seeker's first name + the full address snapshot (including
// line1) — but never email, phone, or last name. Direct contact flows
// through the Conversation surface (slice 5.5).
export * from './request/list-provider-bookings.query';
export * from './response/list-provider-bookings.response';
export * from './response/provider-booking-detail';
export * from './response/provider-booking-mutation.response';
export * from './response/provider-booking-summary';
export * from './response/provider-booking-timeline.response';
