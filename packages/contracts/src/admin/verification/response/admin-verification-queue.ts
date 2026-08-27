import type {
  VerificationCaseActionCode,
  VerificationCaseStateCode,
} from './admin-verification-case';

// Sprint 9B.12 — the review queue, as a contract.
//
// These shapes previously existed only as interfaces inside the API service,
// so the admin client had nothing to type against and would have re-declared
// them — two copies of one wire format, drifting from the first edit.

export interface AdminVerificationQueueItem {
  id: string;
  providerProfileId: string;
  providerDisplayName: string | null;
  state: VerificationCaseStateCode;
  policyVersion: string;
  country: string | null;
  submittedAt: string | null;
  assignedToUserId: string | null;
  documentCount: number;
  /** Server-computed, per reviewer. The client renders these and owns no
   *  transition rule — a self-review is already absent rather than
   *  rendered-then-refused. */
  availableActions: VerificationCaseActionCode[];
  blockedReason: 'SELF_REVIEW' | null;
}

export interface AdminVerificationQueuePage {
  items: AdminVerificationQueueItem[];
  nextCursor: string | null;
}

export interface AdminVerificationQueueQuery {
  state?: VerificationCaseStateCode;
  policyVersion?: string;
  /** Matches the provider's display name. */
  search?: string;
  /** Sprint 9B.12 — submission window, inclusive. A queue with no date filter
   *  forces a reviewer working a backlog to page through everything to find
   *  last week's submissions. */
  submittedFrom?: string;
  submittedTo?: string;
  limit?: number;
  cursor?: string;
}
