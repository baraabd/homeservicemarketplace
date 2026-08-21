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
