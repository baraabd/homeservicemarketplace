// ─────────────────────────────────────────────────────────────────────────────
// Seeker bounded-context contracts.
//
// This barrel is intentionally empty in Sprint 0 — the directory structure
// exists so Sprint 1 can drop DTOs into the right subdomain without
// reshaping the package. Subdomains mirror the planned backend modules:
//
//   services/       service-category catalog (read-only lookup)         [S1]
//   requests/       service-request lifecycle + state machine           [S1]
//   addresses/      authenticated user's saved addresses                [S1]
//   bids/           provider bids on a request                          [S2]
//   bookings/       a confirmed engagement (accepted bid → completion)  [S2]
//   notifications/  in-app notification feed                            [S2]
//   chat/           seeker ↔ provider conversations (Mongo-backed)      [S3]
//
// Each subdomain re-exports its own request/, response/, enums/ tree the
// same way iam/ does today. The TS compiler is happy with empty barrels;
// they cost nothing at build time and signal scope to anyone reading the
// package.
// ─────────────────────────────────────────────────────────────────────────────
export * from './services';
export * from './requests';
export * from './addresses';
export * from './bids';
export * from './bookings';
export * from './notifications';
export * from './chat';
