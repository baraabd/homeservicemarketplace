/** Sprint 12A: participant-safe intake. Administrative DTOs are never reused here. */
export const DISPUTE_ISSUE_CODES = [
  'SERVICE_QUALITY',
  'MISSED_APPOINTMENT',
  'SCOPE_DISAGREEMENT',
  'PROPERTY_CONCERN',
  'COMMUNICATION',
  'OTHER',
] as const;
export type DisputeIssueCode = (typeof DISPUTE_ISSUE_CODES)[number];

/** A requested outcome is not a decision, payment instruction, or promise of compensation. */
export const DISPUTE_REQUESTED_OUTCOMES = [
  'CLARIFICATION',
  'RESCHEDULE',
  'REPERFORM',
  'PARTIAL_REMEDY',
  'CANCELLATION',
  'REVIEW',
] as const;
export type DisputeRequestedOutcome = (typeof DISPUTE_REQUESTED_OUTCOMES)[number];
export type DisputeParticipantRole = 'SEEKER' | 'PROVIDER';
export type ParticipantDisputeState = 'SUBMITTED' | 'IN_REVIEW' | 'DECISION_RECORDED' | 'CLOSED';
export type DisputeIntakeBlocker =
  | 'NOT_ENABLED'
  | 'BOOKING_STATE'
  | 'WINDOW_ELAPSED'
  | 'TIMESTAMP_UNAVAILABLE'
  | 'ALREADY_OPEN'
  | 'LEGACY_REVIEW';

export interface DisputeIntakeContext {
  booking: {
    id: string;
    status: string;
    serviceLabelEn: string | null;
    serviceLabelAr: string | null;
  };
  role: DisputeParticipantRole;
  canOpen: boolean;
  serverDrafts?: boolean;
  blocker: DisputeIntakeBlocker | null;
  existingCaseId: string | null;
  policyVersion: string | null;
  openingDeadline: string | null;
  issueCodes: readonly DisputeIssueCode[];
  requestedOutcomes: readonly DisputeRequestedOutcome[];
}
export interface CreateParticipantDisputeRequest {
  bookingId: string;
  idempotencyKey: string;
  policyVersion: string;
  issueCode: DisputeIssueCode;
  requestedOutcome: DisputeRequestedOutcome;
  statement: string;
}
export interface ParticipantDisputeEvent {
  id: string;
  kind: 'SUBMITTED' | 'STATUS_UPDATED' | 'DECISION_RECORDED';
  occurredAt: string;
}
export interface ParticipantDisputeSummary {
  id: string;
  reference: string;
  bookingId: string;
  state: ParticipantDisputeState;
  workspaceState?: import('./workspace').DisputeWorkspaceState;
  role: DisputeParticipantRole;
  openedByYou: boolean;
  submittedAt: string;
  updatedAt: string;
}
export interface ParticipantDisputeDetail extends ParticipantDisputeSummary {
  workspaceAvailable?: boolean;
  issueCode: DisputeIssueCode | null;
  requestedOutcome: DisputeRequestedOutcome | null;
  /** Visible only to its author in the intake pilot. No automatic counterparty disclosure. */
  statement: string | null;
  policyVersion: string | null;
  events: ParticipantDisputeEvent[];
  eventsTruncated: boolean;
  /** No SLA/appeal deadline is invented before the corresponding policy is implemented. */
  nextAction: 'WAIT_FOR_REVIEW' | 'CONTACT_SUPPORT';
  capabilities: { uploadEvidence: false; respond: false; appeal: false };
}
export interface ParticipantDisputeList {
  items: ParticipantDisputeSummary[];
  nextCursor: string | null;
}
export interface CreateParticipantDisputeResponse {
  dispute: ParticipantDisputeSummary;
  created: boolean;
  replayed: boolean;
}

export interface DisputeBookingChoice {
  id: string;
  status: string;
  role: DisputeParticipantRole;
  serviceLabelEn: string | null;
  serviceLabelAr: string | null;
  scheduledAt: string | null;
  createdAt: string;
}
export interface DisputeBookingChoices {
  items: DisputeBookingChoice[];
  nextCursor: string | null;
}
