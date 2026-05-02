// Admin disputes (Sprint 6.3).
//
//   GET  /v1/admin/disputes?status&limit&cursor
//   GET  /v1/admin/disputes/:disputeId
//   POST /v1/admin/disputes               { bookingId, openedById, reason }
//   POST /v1/admin/disputes/:id/resolve   { resolution, status }
//
// `status` on resolve maps to one of the terminal RESOLVED_* values.
// Mutations write ADMIN_DISPUTE_{OPENED,RESOLVED} audit rows.
export const DisputeStatusValues = {
  Open: 'OPEN',
  InReview: 'IN_REVIEW',
  ResolvedRefund: 'RESOLVED_REFUND',
  ResolvedPartial: 'RESOLVED_PARTIAL',
  ResolvedDenied: 'RESOLVED_DENIED',
  Cancelled: 'CANCELLED',
} as const;
export type DisputeStatusValue = (typeof DisputeStatusValues)[keyof typeof DisputeStatusValues];

export interface ListAdminDisputesQuery {
  status?: DisputeStatusValue;
  limit?: number;
  cursor?: string;
}

export interface OpenDisputeRequest {
  bookingId: string;
  openedById: string;
  reason: string;
}

export interface ResolveDisputeRequest {
  resolution: string;
  status: 'RESOLVED_REFUND' | 'RESOLVED_PARTIAL' | 'RESOLVED_DENIED';
}

export interface DisputeSummary {
  id: string;
  bookingId: string;
  openedById: string;
  status: DisputeStatusValue;
  reason: string;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListAdminDisputesResponse {
  items: DisputeSummary[];
  nextCursor: string | null;
}

export interface DisputeMutationResponse {
  dispute: DisputeSummary;
}
