// One row of the provider verification timeline. The Sprint 6.2
// /v1/admin/providers/:id/audit endpoint returns these in
// reverse-chronological order (newest first), filtered by
// `metadata.providerProfileId === :id`.
//
// The event is wire-compatible with the generic AuditEvent shape: the
// type names map onto the AuditEventType enum (ADMIN_PROVIDER_*), and
// the metadata bag carries the same keys the service writes
// (`previousStatus`, `newStatus`, `note`, `reason`, …).
export interface ProviderAuditEvent {
  id: string;
  type: string; // AuditEventType enum value
  // The admin actor's userId (the reviewer). Null for any historical
  // row that pre-dates the auditor identity binding.
  adminUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ListProviderAuditEventsResponse {
  items: ProviderAuditEvent[];
  nextCursor: string | null;
}
