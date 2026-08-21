// Phase 4 — the THIRD account axis, distinct from `AccountStatus` (may this
// identity authenticate?) and from the role set (what may it do?).
//
// A public signup must never grant the admin role. Signing up through the
// Admin-themed entry point creates an ordinary verified account; if the person
// explicitly asks for admin access, that produces a PENDING request which a
// DIFFERENT authorized administrator approves or rejects.
//
//   PENDING   — submitted, awaiting review
//   APPROVED  — the minimum admin role has been granted
//   REJECTED  — refused; the applicant keeps their ordinary account
//   CANCELLED — withdrawn by the applicant before a decision
//
// APPROVED / REJECTED / CANCELLED are terminal for a given request; the user
// may submit a new one, which creates a new row so history is preserved.
export const ADMIN_ACCESS_REQUEST_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;

export type AdminAccessRequestStatus = (typeof ADMIN_ACCESS_REQUEST_STATUSES)[number];
