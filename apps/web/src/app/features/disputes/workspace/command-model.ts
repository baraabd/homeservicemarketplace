import type {
  DisputeRemedy,
  DisputeWorkspaceAction,
  DisputeWorkspaceCommand,
  DisputeWorkspaceView,
} from '@homeservicemarketplace/contracts';
import { WORKSPACE_COPY } from './copy';
export interface CommandSelection {
  action: DisputeWorkspaceAction;
  entityId?: string;
  accepted?: boolean;
}
export interface CommandFields {
  text: string;
  recipient: 'SEEKER' | 'PROVIDER' | '';
  reviewerId: string;
  summary: string;
  remedies: DisputeRemedy[];
  proposalId: string;
  reasonCode: string;
  basisEventIds: string[];
  evidenceIds: string[];
  accepted: boolean;
  holdUntil: string;
  releaseHold: boolean;
  acknowledged: boolean;
}
export const blankRemedy = (): DisputeRemedy => ({
  type: 'CLARIFICATION',
  description: '',
  conditions: '',
  dueAt: null,
});
export function initialCommandFields(
  selection: CommandSelection,
  view: DisputeWorkspaceView,
): CommandFields {
  return {
    text: '',
    recipient: '',
    reviewerId: '',
    summary: '',
    remedies: [blankRemedy()],
    proposalId: selection.action === 'DECIDE_APPEAL' ? (view.decisions[0]?.proposalId ?? '') : '',
    reasonCode: selection.action === 'DECIDE_APPEAL' ? 'INDEPENDENT_REVIEW' : 'INSUFFICIENT_BASIS',
    basisEventIds: [],
    evidenceIds: [],
    accepted: selection.accepted ?? false,
    holdUntil: '',
    releaseHold: false,
    acknowledged: false,
  };
}
export function commandPayload(
  selection: CommandSelection,
  f: CommandFields,
): DisputeWorkspaceCommand['command'] {
  const action = selection.action;
  switch (action) {
    case 'ASSIGN':
      return { action, reviewerId: f.reviewerId };
    case 'REQUEST_INFORMATION':
      return { action, recipient: f.recipient, question: f.text.trim() };
    case 'RESPOND':
      return { action, requestId: selection.entityId ?? null, text: f.text.trim() };
    case 'PROPOSE':
      return {
        action,
        summary: f.summary.trim(),
        remedies: f.remedies.map((r) => ({
          ...r,
          description: r.description.trim(),
          conditions: r.conditions.trim(),
          dueAt: r.dueAt ? new Date(r.dueAt).toISOString() : null,
        })),
      };
    case 'CONSENT':
      return { action, proposalId: selection.entityId, accepted: f.accepted };
    case 'DECIDE':
    case 'DECIDE_APPEAL':
      return {
        action,
        ...(action === 'DECIDE_APPEAL' ? { appealId: selection.entityId } : {}),
        reasonCode: f.reasonCode,
        rationale: f.text.trim(),
        proposalId: f.proposalId || null,
        basisEventIds: f.basisEventIds,
        evidenceIds: f.evidenceIds,
      };
    case 'APPEAL':
      return { action, decisionId: selection.entityId, grounds: f.text.trim() };
    case 'CONFIRM_FULFILMENT':
      return { action, proposalId: selection.entityId };
    case 'HOLD_PRIVATE_TEXT':
    case 'HOLD_EVIDENCE':
      return {
        action,
        ...(action === 'HOLD_EVIDENCE' ? { evidenceId: selection.entityId } : {}),
        holdUntil: f.releaseHold ? null : new Date(f.holdUntil).toISOString(),
        reasonCode: f.releaseHold
          ? 'HOLD_RELEASED'
          : f.reasonCode === 'LEGAL_HOLD'
            ? 'LEGAL_HOLD'
            : 'ACTIVE_REVIEW',
      };
    case 'REQUEUE_EVIDENCE':
      return { action, evidenceId: selection.entityId, reasonCode: 'DEPENDENCY_RESTORED' };
    case 'SHARE_REDACTED_EVIDENCE':
      return {
        action,
        evidenceId: selection.entityId,
        reasonCode: 'REDACTED_FOR_PARTICIPANTS',
        redactionConfirmed: true,
      };
    case 'CLOSE':
      return { action };
  }
}
export function commandConfirmation(action: DisputeWorkspaceAction, lang: 'en' | 'ar') {
  const t = WORKSPACE_COPY[lang];
  return action === 'SHARE_REDACTED_EVIDENCE'
    ? t.publishAck
    : action === 'CONSENT'
      ? t.consentConfirm
      : action === 'CONFIRM_FULFILMENT'
        ? t.fulfilConfirm
        : action === 'CLOSE'
          ? t.closeConfirm
          : t.reviewConfirm;
}
