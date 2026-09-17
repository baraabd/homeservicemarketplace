import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Engineering defaults are NOT a publication or legal approval. Enforce mode
 * requires the deployment's explicit approval reference; every job pins this
 * complete snapshot so changing the environment cannot re-date queued work. */
export const retentionPolicySchema = z
  .object({
    format: z.literal(1),
    approvalReference: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/),
    verifiedDays: z.number().int().min(1).max(3650),
    rejectedDays: z.number().int().min(1).max(3650),
    abandonedDays: z.number().int().min(1).max(3650),
    quarantineDays: z.number().int().min(1).max(3650),
    retainChecksum: z.boolean().default(false),
    maxAttempts: z.number().int().min(1).max(20),
  })
  .strict();
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;
export type RetentionTrigger = 'VERIFIED' | 'REJECTED' | 'ABANDONED';

export function policyVersion(policy: RetentionPolicy): string {
  const p = retentionPolicySchema.parse(policy);
  // Fixed field order, including the independent deployment approval reference.
  return `retention.v1:${createHash('sha256').update(JSON.stringify(p)).digest('hex')}`;
}

export interface RetentionFacts {
  assetId: string;
  visibility: string;
  completedAt: Date | null;
  deletedAt: Date | null;
  caseId: string | null;
  documentCaseId: string | null;
  caseState: string | null;
  casePolicyVersion: string | null;
  lastActivityAt: Date | null;
  decidedAt: Date | null;
  scanState: string;
  scannedAt: Date | null;
}
export interface RetentionPlan {
  intentKey: string;
  caseId: string;
  casePolicyVersion: string;
  policyVersion: string;
  triggerCode: RetentionTrigger;
  basisAt: Date;
  dueAt: Date;
}

/** Live reviews are never reclassified as abandoned. Missing/contradictory
 * clocks or canonical links require review, not a guessed deletion date. */
export function planRetention(
  facts: RetentionFacts,
  policy: RetentionPolicy,
  now: Date,
): RetentionPlan | null {
  policy = retentionPolicySchema.parse(policy);
  if (
    facts.visibility !== 'RESTRICTED' ||
    facts.deletedAt ||
    !facts.completedAt ||
    !facts.caseId ||
    facts.documentCaseId !== facts.caseId ||
    !facts.casePolicyVersion
  )
    return null;
  let triggerCode: RetentionTrigger;
  let basisAt: Date | null;
  let days: number;
  switch (facts.caseState) {
    case 'VERIFIED':
    case 'EXPIRED':
      triggerCode = 'VERIFIED';
      basisAt = facts.decidedAt;
      days = policy.verifiedDays;
      break;
    case 'REJECTED':
      triggerCode = 'REJECTED';
      basisAt = facts.decidedAt;
      days = policy.rejectedDays;
      break;
    case 'DRAFT':
      triggerCode = 'ABANDONED';
      basisAt = facts.lastActivityAt;
      days = policy.abandonedDays;
      break;
    default:
      return null;
  }
  if (
    !basisAt ||
    !Number.isFinite(basisAt.getTime()) ||
    basisAt > now ||
    facts.completedAt > now ||
    basisAt < facts.completedAt
  )
    return null;
  let dueMs = basisAt.getTime() + days * 86_400_000;
  if (facts.scanState === 'QUARANTINED') {
    if (!facts.scannedAt || !Number.isFinite(facts.scannedAt.getTime()) || facts.scannedAt > now)
      return null;
    // An incident window may lengthen ordinary retention, never shorten it.
    dueMs = Math.max(dueMs, facts.scannedAt.getTime() + policy.quarantineDays * 86_400_000);
  }
  if (!Number.isFinite(dueMs)) return null;
  const version = policyVersion(policy);
  const intentKey = createHash('sha256')
    .update(
      JSON.stringify([
        facts.assetId,
        facts.caseId,
        facts.casePolicyVersion,
        version,
        triggerCode,
        basisAt.toISOString(),
        new Date(dueMs).toISOString(),
      ]),
    )
    .digest('hex');
  return {
    intentKey,
    caseId: facts.caseId,
    casePolicyVersion: facts.casePolicyVersion,
    policyVersion: version,
    triggerCode,
    basisAt,
    dueAt: new Date(dueMs),
  };
}

export function retryAt(attempt: number, now: Date): Date {
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error('invalid-retention-attempt');
  return new Date(now.getTime() + Math.min(3_600_000, 30_000 * 2 ** Math.min(attempt - 1, 10)));
}
