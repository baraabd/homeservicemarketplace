import {
  DISPUTE_ISSUE_CODES,
  DISPUTE_REQUESTED_OUTCOMES,
  type ParticipantDisputeSummary,
  type ParticipantDisputeState,
} from '@homeservicemarketplace/contracts';
import { z } from 'zod';
import type { IntakeCase } from './dispute-intake.repository';

export const intakeReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestHash: z.string().length(64),
    policyVersion: z.string(),
    issueCode: z.enum(DISPUTE_ISSUE_CODES),
    requestedOutcome: z.enum(DISPUTE_REQUESTED_OUTCOMES),
    terminalWindowHours: z.number().int().positive(),
  })
  .passthrough();

const STATES: Record<IntakeCase['status'], ParticipantDisputeState> = {
  RESOLVED: 'CLOSED',
  OPEN: 'SUBMITTED',
  IN_REVIEW: 'IN_REVIEW',
  CANCELLED: 'CLOSED',
  RESOLVED_REFUND: 'DECISION_RECORDED',
  RESOLVED_PARTIAL: 'DECISION_RECORDED',
  RESOLVED_DENIED: 'DECISION_RECORDED',
};
export function participantSummary(
  row: IntakeCase,
  actorUserId: string,
): ParticipantDisputeSummary {
  return {
    id: row.id,
    ...(row.workspace ? { workspaceState: row.workspace.state } : {}),
    // Full opaque identifier, not a truncated reference with collision ambiguity.
    reference: row.id,
    bookingId: row.bookingId,
    state: STATES[row.status],
    role: row.booking.seekerUserId === actorUserId ? 'SEEKER' : 'PROVIDER',
    openedByYou: row.openedById === actorUserId,
    submittedAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
