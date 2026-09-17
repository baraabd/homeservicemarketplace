import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { DisputeIntakeBlocker } from '@homeservicemarketplace/contracts';

export const DISPUTE_INTAKE_SETTING = 'disputes.self_service.intake';
export const DISPUTE_INTAKE_EVENT = 'dispute.intake.opened.v1';
export const INTAKE_ID_PREFIX = 'di_';
const bookingStates = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

/** Missing, malformed, or unapproved settings never enable intake. No policy is seeded. */
const policySchema = z.object({
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  enabled: z.boolean(),
  // This increment deliberately supports only an explicit internal/pilot cohort.
  pilotUserIds: z.array(z.string().min(1).max(64)).min(1).max(500),
  allowedBookingStates: z.array(z.enum(bookingStates)).min(1).max(4),
  terminalWindowHours: z.number().int().min(1).max(2160),
}).strict();
export type DisputeIntakePolicy = z.infer<typeof policySchema> & { revision: string };

export function parseIntakePolicy(value: unknown): DisputeIntakePolicy | null {
  const parsed = policySchema.safeParse(value);
  if (!parsed.success) return null;
  const normalized = {
    ...parsed.data,
    pilotUserIds: [...new Set(parsed.data.pilotUserIds)].sort(),
    allowedBookingStates: [...new Set(parsed.data.allowedBookingStates)].sort(),
  };
  return {
    ...normalized,
    revision: `${normalized.version}:${createHash('sha256').update(JSON.stringify(normalized)).digest('hex')}`,
  };
}

export function intakeEligibility(input: {
  policy: DisputeIntakePolicy | null;
  actorUserId: string;
  bookingState: string;
  terminalAt: Date | null;
  now: Date;
}): { blocker: DisputeIntakeBlocker | null; deadline: Date | null } {
  const { policy, actorUserId, bookingState, terminalAt, now } = input;
  if (!policy?.enabled || !policy.pilotUserIds.includes(actorUserId))
    return { blocker: 'NOT_ENABLED', deadline: null };
  if (!policy.allowedBookingStates.some((state) => state === bookingState))
    return { blocker: 'BOOKING_STATE', deadline: null };
  if (bookingState !== 'COMPLETED' && bookingState !== 'CANCELLED')
    return { blocker: null, deadline: null };
  // updatedAt is not a closure clock: editing a booking must not extend the window.
  if (!terminalAt || !Number.isFinite(terminalAt.getTime()) || terminalAt > now)
    return { blocker: 'TIMESTAMP_UNAVAILABLE', deadline: null };
  const deadline = new Date(terminalAt.getTime() + policy.terminalWindowHours * 3_600_000);
  return { blocker: now >= deadline ? 'WINDOW_ELAPSED' : null, deadline };
}

/** Server-generated durable intent id; the raw client key is never persisted or logged. */
export function intakeIntentId(actorUserId: string, key: string): string {
  return `${INTAKE_ID_PREFIX}${createHash('sha256')
    .update(JSON.stringify(['dispute-intake/v1', actorUserId, key])).digest('hex').slice(0, 40)}`;
}
export function intakeRequestHash(input: {
  bookingId: string; policyVersion: string; issueCode: string; requestedOutcome: string; statement: string;
}): string {
  return createHash('sha256').update(JSON.stringify({
    bookingId: input.bookingId,
    policyVersion: input.policyVersion,
    issueCode: input.issueCode,
    requestedOutcome: input.requestedOutcome,
    statement: input.statement.trim(),
  })).digest('hex');
}
