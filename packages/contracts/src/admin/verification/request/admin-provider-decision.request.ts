// Body for /approve | /reject | /suspend | /reactivate.
//
// Approve takes an optional admin `note` (audit-only). Reject and
// suspend take an optional `reason` — when present it lands in the
// audit metadata AND the user-facing notification body, when absent
// the audit row records the transition without commentary and the
// notification falls back to a generic message. Reactivate is
// body-less. (Sprint 5.1.4 relaxed reject/suspend reason from
// required to optional so the admin UI can ship a one-click
// transition without a modal.)
export interface AdminProviderApproveRequest {
  note?: string | null;
}

export interface AdminProviderRejectRequest {
  reason?: string | null;
}

export interface AdminProviderSuspendRequest {
  reason?: string | null;
}

export type AdminProviderReactivateRequest = Record<string, never>;
