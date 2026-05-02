// Provider bounded-context contracts. Sprint 5 ships:
//   profile/  ✓ slice 5.1 — identity, skills, availability, service area
//   feed/     ✓ slice 5.2 — available requests
//   bids/     ✓ slice 5.3 — submit, list mine, withdraw
//   bookings/ ✓ slice 5.4 — provider bookings + lifecycle transitions
//   wallet/   ✓ slice 5.6 — earnings read model (no payouts)
//
// Subdomains mirror the planned backend modules and follow the same
// request/, response/, enums/ shape used under seeker/.
export * from './profile';
export * from './feed';
export * from './bids';
export * from './bookings';
export * from './wallet';
