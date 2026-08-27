import type {
  AdminVerificationCase,
  AdminVerificationQueuePage,
  AdminVerificationQueueQuery,
  VerificationCaseActionCode,
} from '@homeservicemarketplace/contracts';

import { api } from '../../../../lib/api';

// Sprint 9B.12 — the reviewer's queue and the case commands behind it.
//
// docs/sprint-09b12/ADMIN_VERIFICATION_UX.md
//
// TWO AXES, TWO MODULES. This file speaks only to
// /v1/admin/verification/cases — the CASE lifecycle (9B.5–9B.7). The provider
// ACCOUNT lifecycle (approve/reject/suspend/reactivate on
// /v1/admin/providers) already has its own hooks and stays there.
//
// They are not merged, and the reason is not tidiness: approving a case is a
// judgement about documents and suspending an account is a judgement about
// conduct. One combined action list would have to pick a single verb for two
// different decisions, and a reviewer would eventually make one meaning the
// other.
//
// THE CLIENT OWNS NO TRANSITION RULE. Every action rendered comes from the
// server's `availableActions`; there is deliberately no table here mapping
// state to buttons. A second copy of the rules would disagree with the first
// one, and the copy in React would be the one the reviewer sees.

export async function listVerificationQueue(
  query: AdminVerificationQueueQuery,
): Promise<AdminVerificationQueuePage> {
  const { data } = await api.get<AdminVerificationQueuePage>('/v1/admin/verification/cases', {
    params: query,
  });
  return data;
}

export async function getVerificationCase(caseId: string): Promise<AdminVerificationCase> {
  const { data } = await api.get<AdminVerificationCase>(`/v1/admin/verification/cases/${caseId}`);
  return data;
}

export interface CaseAuditPage {
  items: Array<{
    id: string;
    type: string;
    createdAt: string;
    userId: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  nextCursor: string | null;
}

export async function getCaseAudit(caseId: string, cursor?: string): Promise<CaseAuditPage> {
  const { data } = await api.get<CaseAuditPage>(`/v1/admin/verification/cases/${caseId}/audit`, {
    params: cursor ? { cursor } : undefined,
  });
  return data;
}

/** The route each action posts to. A lookup of NAMES, not of rules: the server
 *  decided whether the action is available, this only knows where it lives. */
const ACTION_PATH: Record<VerificationCaseActionCode, string> = {
  assign: 'assign',
  requestAction: 'request-action',
  approve: 'approve',
  reject: 'reject',
  reverify: 'reverify',
  revoke: 'revoke',
};

export interface CaseCommandInput {
  caseId: string;
  action: VerificationCaseActionCode;
  reasonCode?: string;
  note?: string;
  /** The state the reviewer was LOOKING at. The server refuses with 409 when
   *  the case has moved on, which is the whole point: two reviewers with the
   *  same case open must not both decide it. */
  expectedState?: string;
}

export async function runCaseCommand(input: CaseCommandInput): Promise<unknown> {
  const { data } = await api.post(
    `/v1/admin/verification/cases/${input.caseId}/${ACTION_PATH[input.action]}`,
    {
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.expectedState ? { expectedState: input.expectedState } : {}),
    },
  );
  return data;
}
