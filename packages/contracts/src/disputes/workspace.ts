/** Only role-scoped projections cross this boundary. No storage key, cipher or raw audit row. */
export const DISPUTE_WORKSPACE_STATES = [
  'GATHERING',
  'PROPOSED',
  'DECIDED',
  'APPEALED',
  'CLOSED',
] as const;
export type DisputeWorkspaceState = (typeof DISPUTE_WORKSPACE_STATES)[number];
export const DISPUTE_REMEDY_TYPES = [
  'CLARIFICATION',
  'RESCHEDULE',
  'REPERFORM',
  'PARTIAL_REMEDY',
  'CANCELLATION',
  'ESCALATION',
] as const;
export type DisputeRemedyType = (typeof DISPUTE_REMEDY_TYPES)[number];
export type DisputeActorRole = 'SEEKER' | 'PROVIDER' | 'REVIEWER';
export type DisputeWorkspaceAction =
  | 'ASSIGN'
  | 'REQUEST_INFORMATION'
  | 'RESPOND'
  | 'PROPOSE'
  | 'CONSENT'
  | 'DECIDE'
  | 'APPEAL'
  | 'DECIDE_APPEAL'
  | 'CONFIRM_FULFILMENT'
  | 'CLOSE'
  | 'HOLD_PRIVATE_TEXT'
  | 'HOLD_EVIDENCE'
  | 'REQUEUE_EVIDENCE'
  | 'SHARE_REDACTED_EVIDENCE';
export interface DisputeRemedy {
  type: DisputeRemedyType;
  description: string;
  conditions: string;
  dueAt: string | null;
}
export interface DisputeWorkspaceCommand {
  idempotencyKey: string;
  expectedRevision: number;
  command: Record<string, unknown> & { action: DisputeWorkspaceAction };
}
export interface DisputeWorkspaceReceipt {
  revision: number;
  entityId: string | null;
  replayed: boolean;
}
export interface DisputeDraftContent {
  issueCode: string;
  requestedOutcome: string;
  statement: string;
  step: number;
}
export interface DisputeDraftView {
  version: number;
  content: DisputeDraftContent;
  savedAt: string | null;
  expiresAt: string | null;
}
export interface DisputeWorkspaceView {
  disputeId: string;
  reference: string;
  state: DisputeWorkspaceState;
  revision: number;
  role: DisputeActorRole;
  assignedToYou: boolean;
  assignedReviewer: { id: string; label: string } | null;
  reviewers: { id: string; label: string }[];
  participants: { role: 'SEEKER' | 'PROVIDER'; label: string }[];
  availableActions: DisputeWorkspaceAction[];
  canUploadEvidence: boolean;
  privacy?: {
    textState: 'RETAINED' | 'EXPIRED' | 'ERASED';
    textDueAt: string | null;
    textErasedAt: string | null;
    textHeld: boolean;
  };
  policy: { version: string; appealWindowHours: number; resolutionDueAt: string };
  facts: {
    id: string;
    source: 'BOOKING' | 'SUBMISSION' | 'BOOKING_EVENT';
    label: string;
    value: string;
    recordedAt: string;
  }[];
  events: {
    id: string;
    kind: string;
    reasonCode: string;
    actorRole: string;
    revision: number;
    occurredAt: string;
  }[];
  eventsTruncated: boolean;
  requests: {
    id: string;
    question: string;
    status: string;
    dueAt: string;
    yours: boolean;
    createdAt: string;
  }[];
  statements: {
    id: string;
    text: string;
    requestId: string | null;
    authorRole: string;
    createdAt: string;
  }[];
  evidence: {
    id: string;
    state: string;
    mimeType: string;
    sizeBytes: number;
    viewable: boolean;
    shared: boolean;
    redactedDerivative: boolean;
    uploadedByYou: boolean;
    createdAt: string;
    retainUntil: string;
  }[];
  proposals: {
    id: string;
    status: string;
    summary: string;
    remedies: DisputeRemedy[];
    expiresAt: string;
    acceptedByYou: boolean | null;
    acceptedCount: number;
    fulfilledByYou: boolean;
    fulfilledCount: number;
  }[];
  decisions: {
    id: string;
    reasonCode: string;
    rationale: string;
    proposalId: string | null;
    supersedesId: string | null;
    policyVersion: string;
    basisEventIds: string[];
    evidenceIds: string[];
    appealUntil: string;
    createdAt: string;
  }[];
  appeals: {
    id: string;
    decisionId: string;
    status: string;
    grounds: string | null;
    yours: boolean;
    newDecisionId: string | null;
    createdAt: string;
  }[];
}
export interface DisputeWorkspaceHistory {
  items: DisputeWorkspaceView['events'];
  beforeRevision: number | null;
}
export interface DisputeAdminQueue {
  counts: { all: number; unassigned: number; overdue: number; appeals: number };
  items: {
    disputeId: string;
    reference: string;
    state: DisputeWorkspaceState;
    revision: number;
    priority: string;
    assignedToYou: boolean;
    unassigned: boolean;
    dueAt: string;
    overdue: boolean;
    createdAt: string;
  }[];
  nextCursor: string | null;
}
