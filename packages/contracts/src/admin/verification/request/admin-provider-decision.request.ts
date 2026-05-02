// Body for /approve | /reject | /suspend. Approve permits an
// optional admin note (logged into the audit metadata only — not
// surfaced to the provider). Reject + suspend require a reason.
export interface AdminProviderApproveRequest {
  note?: string | null;
}

export interface AdminProviderRejectRequest {
  reason: string;
}

export interface AdminProviderSuspendRequest {
  reason: string;
}
