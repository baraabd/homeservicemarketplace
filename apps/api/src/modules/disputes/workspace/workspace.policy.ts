import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  DISPUTE_REMEDY_TYPES,
  DISPUTE_ISSUE_CODES,
  DISPUTE_REQUESTED_OUTCOMES,
} from '@homeservicemarketplace/contracts';
import { AppError } from '../../../shared/errors/app-error';

export const WORKSPACE_SETTING = 'disputes.workflow.v1';
export const WORKSPACE_EVENT = 'dispute.workspace.changed.v1';
export const WORKSPACE_PERMISSIONS = {
  READ: 'dispute:read:any',
  ASSIGN: 'dispute:assign',
  REQUEST_INFORMATION: 'dispute:request',
  PROPOSE: 'dispute:propose',
  DECIDE: 'dispute:decide',
  APPROVE_EXCEPTION: 'dispute:exception:approve',
  DECIDE_APPEAL: 'dispute:appeal:decide',
  HOLD_PRIVATE_TEXT: 'dispute:privacy:hold',
  HOLD_EVIDENCE: 'dispute:evidence:hold',
  REQUEUE_EVIDENCE: 'dispute:evidence:retry',
  CLOSE: 'dispute:close',
  EVIDENCE_READ: 'dispute:evidence:view',
  SHARE_REDACTED_EVIDENCE: 'dispute:evidence:publish',
} as const;
const policySchema = z
  .object({
    version: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
    enabled: z.boolean(),
    pilotUserIds: z.array(z.string().min(1).max(80)).min(1).max(500),
    appealWindowHours: z.number().int().min(24).max(2160),
    requestWindowHours: z.number().int().min(1).max(720),
    proposalWindowHours: z.number().int().min(1).max(720),
    resolutionWindowHours: z.number().int().min(24).max(2160),
    evidenceRetentionDays: z.number().int().min(1).max(365),
    privateTextRetentionDays: z.number().int().min(1).max(365).optional(),
    draftRetentionHours: z.number().int().min(1).max(168),
  })
  .strict();
export type WorkspacePolicy = z.infer<typeof policySchema> & { revision: string };
export function workspacePolicy(raw: unknown): WorkspacePolicy | null {
  const p = policySchema.safeParse(raw);
  if (!p.success) return null;
  const normalized = { ...p.data, pilotUserIds: [...new Set(p.data.pilotUserIds)].sort() };
  return { ...normalized, revision: `${p.data.version}:${digest(normalized)}` };
}
export function frozenPolicy(raw: unknown): WorkspacePolicy {
  const p = z
    .object({ ...policySchema.shape, revision: z.string() })
    .strict()
    .safeParse(raw);
  if (!p.success) throw conflict('POLICY_UNAVAILABLE');
  const { revision, ...settings } = p.data;
  if (workspacePolicy(settings)?.revision !== revision) throw conflict('POLICY_UNAVAILABLE');
  return p.data;
}
const id = z.string().min(1).max(100);
const prose = z.string().trim().min(10).max(4000);
const reason = z.enum([
  'INFORMATION_REQUIRED',
  'INFORMATION_REVIEWED',
  'SERVICE_REMEDY',
  'INSUFFICIENT_BASIS',
  'AGREED_RESOLUTION',
  'INDEPENDENT_REVIEW',
  'POLICY_EXCEPTION',
  'COMPLETED',
]);
const remedy = z
  .object({
    type: z.enum(DISPUTE_REMEDY_TYPES),
    description: prose,
    conditions: z.string().trim().max(2000),
    dueAt: z.string().datetime().nullable(),
  })
  .strict();
export const proposalSchema = z
  .object({ summary: prose, remedies: z.array(remedy).min(1).max(6) })
  .strict();
const decisionShape = {
  reasonCode: reason,
  rationale: prose,
  proposalId: id.nullable(),
  basisEventIds: z.array(id).min(1).max(50),
  evidenceIds: z.array(id).max(20),
};
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ASSIGN'), reviewerId: id }).strict(),
  z
    .object({
      action: z.literal('REQUEST_INFORMATION'),
      recipient: z.enum(['SEEKER', 'PROVIDER']),
      question: prose,
    })
    .strict(),
  z.object({ action: z.literal('RESPOND'), requestId: id.nullable(), text: prose }).strict(),
  z.object({ action: z.literal('PROPOSE'), ...proposalSchema.shape }).strict(),
  z.object({ action: z.literal('CONSENT'), proposalId: id, accepted: z.boolean() }).strict(),
  z.object({ action: z.literal('DECIDE'), ...decisionShape }).strict(),
  z.object({ action: z.literal('APPEAL'), decisionId: id, grounds: prose }).strict(),
  z.object({ action: z.literal('DECIDE_APPEAL'), appealId: id, ...decisionShape }).strict(),
  z.object({ action: z.literal('CONFIRM_FULFILMENT'), proposalId: id }).strict(),
  z.object({ action: z.literal('CLOSE') }).strict(),
  z
    .object({
      action: z.literal('HOLD_PRIVATE_TEXT'),
      holdUntil: z.string().datetime().nullable(),
      reasonCode: z.enum(['ACTIVE_REVIEW', 'LEGAL_HOLD', 'HOLD_RELEASED']),
    })
    .strict(),
  z
    .object({
      action: z.literal('HOLD_EVIDENCE'),
      evidenceId: id,
      holdUntil: z.string().datetime().nullable(),
      reasonCode: z.enum(['ACTIVE_REVIEW', 'LEGAL_HOLD', 'HOLD_RELEASED']),
    })
    .strict(),
  z
    .object({
      action: z.literal('REQUEUE_EVIDENCE'),
      evidenceId: id,
      reasonCode: z.literal('DEPENDENCY_RESTORED'),
    })
    .strict(),
  z
    .object({
      action: z.literal('SHARE_REDACTED_EVIDENCE'),
      evidenceId: id,
      reasonCode: z.literal('REDACTED_FOR_PARTICIPANTS'),
      redactionConfirmed: z.literal(true),
    })
    .strict(),
]);
export type WorkspaceCommand = z.infer<typeof commandSchema>;
export const commandEnvelope = z
  .object({
    idempotencyKey: z.string().uuid(),
    expectedRevision: z.number().int().min(0),
    command: commandSchema,
  })
  .strict();
export const draftSchema = z
  .object({
    version: z.number().int().min(0),
    content: z
      .object({
        issueCode: z.union([z.enum(DISPUTE_ISSUE_CODES), z.literal('')]),
        requestedOutcome: z.union([z.enum(DISPUTE_REQUESTED_OUTCOMES), z.literal('')]),
        statement: z.string().max(4000),
        step: z.number().int().min(0).max(2),
      })
      .strict(),
  })
  .strict();
export const conflict = (reasonCode: string) =>
  new AppError(
    'CONFLICT',
    'The case changed or the action is unavailable. Refresh before continuing.',
    409,
    { reasonCode },
  );
export const forbidden = () => new AppError('FORBIDDEN', 'This action is not permitted.', 403);
export const missing = () => new AppError('NOT_FOUND', 'Case or booking not found.', 404);
export function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function parseCommand(raw: unknown) {
  const result = commandEnvelope.safeParse(raw);
  if (!result.success) throw new AppError('VALIDATION_ERROR', 'Invalid case command.', 400);
  return result.data;
}
export function hoursAfter(now: Date, hours: number) {
  return new Date(now.getTime() + hours * 3_600_000);
}
