// Admin disputes (Sprint 6.3 refined — full workflow).
//
//   GET   /v1/admin/disputes?status&priority&limit&cursor
//   GET   /v1/admin/disputes/:disputeId       (carries recentEvents)
//   POST  /v1/admin/disputes                  { bookingId, openedById, reason, description?, priority? }
//   PATCH /v1/admin/disputes/:disputeId       { status?, priority?, description? }
//   POST  /v1/admin/disputes/:id/resolve      { resolution, status }
//
// `status` on resolve maps to one of the terminal RESOLVED_* values.
// Mutations write ADMIN_DISPUTE_{OPENED,UPDATED,RESOLVED} audit rows
// AND a DisputeEvent row scoped to the dispute timeline.

export const DisputeStatusValues = {
  Open: 'OPEN',
  InReview: 'IN_REVIEW',
  ResolvedRefund: 'RESOLVED_REFUND',
  ResolvedPartial: 'RESOLVED_PARTIAL',
  ResolvedDenied: 'RESOLVED_DENIED',
  Cancelled: 'CANCELLED',
} as const;
export type DisputeStatusValue = (typeof DisputeStatusValues)[keyof typeof DisputeStatusValues];

// Sprint 6.3 admin triage priority. `MEDIUM` is the default new
// disputes ship at; `URGENT` rows are the operator's top concern
// when sorting by priority.
export const DisputePriorityValues = {
  Urgent: 'URGENT',
  High: 'HIGH',
  Medium: 'MEDIUM',
  Low: 'LOW',
} as const;
export type DisputePriorityValue =
  (typeof DisputePriorityValues)[keyof typeof DisputePriorityValues];

export const DisputeEventTypeValues = {
  Opened: 'OPENED',
  StatusChanged: 'STATUS_CHANGED',
  PriorityChanged: 'PRIORITY_CHANGED',
  DescriptionUpdated: 'DESCRIPTION_UPDATED',
  Resolved: 'RESOLVED',
  Commented: 'COMMENTED',
} as const;
export type DisputeEventTypeValue =
  (typeof DisputeEventTypeValues)[keyof typeof DisputeEventTypeValues];

export interface ListAdminDisputesQuery {
  status?: DisputeStatusValue;
  priority?: DisputePriorityValue;
  limit?: number;
  cursor?: string;
}

export interface OpenDisputeRequest {
  bookingId: string;
  openedById: string;
  reason: string;
  description?: string | null;
  priority?: DisputePriorityValue;
}

export interface UpdateDisputeRequest {
  status?: DisputeStatusValue;
  priority?: DisputePriorityValue;
  description?: string | null;
}

export interface ResolveDisputeRequest {
  resolution: string;
  status: 'RESOLVED_REFUND' | 'RESOLVED_PARTIAL' | 'RESOLVED_DENIED';
}

// One row of the dispute's verification timeline.
export interface DisputeEvent {
  id: string;
  type: DisputeEventTypeValue;
  actorUserId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  message: string | null;
  createdAt: string;
}

export interface DisputeSummary {
  id: string;
  bookingId: string;
  openedById: string;
  status: DisputeStatusValue;
  priority: DisputePriorityValue;
  reason: string;
  description: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
  updatedAt: string;
  // Last N events (default 20) so the detail drawer can render the
  // timeline without a second round-trip. Undefined on the list
  // response, populated on detail.
  recentEvents?: DisputeEvent[];
}

export interface ListAdminDisputesResponse {
  items: DisputeSummary[];
  nextCursor: string | null;
}

export interface DisputeMutationResponse {
  dispute: DisputeSummary;
}
