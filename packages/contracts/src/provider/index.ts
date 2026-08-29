// Provider bounded-context contracts. Sprint 5 ships:
//   profile/   ✓ slice 5.1   — identity, skills, availability, service area
//   feed/      ✓ slice 5.2   — provider jobs feed (legacy /me/provider/jobs path)
//   requests/  ✓ slice 5.2   — canonical /v1/provider/available-requests + detail
//   bids/      ✓ slice 5.3   — submit, list mine, withdraw
//   bookings/  ✓ slice 5.4   — provider bookings + lifecycle transitions
//   wallet/    ✓ slice 5.6   — legacy /me/provider/earnings (kept for back-compat)
//   earnings/  ✓ slice 5.6   — canonical /v1/provider/earnings/{summary,transactions,chart}
//
// Subdomains mirror the planned backend modules and follow the same
// request/, response/, enums/ shape used under seeker/.
export * from './profile';
// Phase 4 — onboarding lifecycle (DRAFT → submit-for-review → PENDING_REVIEW).
export * from './onboarding';
export * from './feed';
export * from './requests';
export * from './bids';
export * from './bookings';
export * from './wallet';
export * from './earnings';
// Sprint 9B.2 — the provider's own verification case.
export * from './verification';
// Sprint 7 — server-authoritative capability set (docs/adr/0006). The
// Provider app renders gating from this instead of re-deriving it from
// `profile.status`.
export * from './capabilities';
// Sprint 9B.9 — the redacted marketplace preview. Read-only by construction.
export * from './preview';
// Sprint 9B.10 — the public provider portfolio. Strictly separate from the
// RESTRICTED verification evidence surface.
export * from './portfolio';
// Sprint 9B.22 — the shape a CUSTOMER receives. Its own module because it is
// an allowlist: a field that is not declared there cannot be published.
export * from './public-profile';
