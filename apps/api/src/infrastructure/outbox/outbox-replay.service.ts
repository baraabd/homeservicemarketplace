import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../prisma/prisma.service';

// R22 — operator replay of dead-lettered outbox events.
// Runbook: infra/production/workers/OUTBOX_PLAYBOOKS.md ("Dead letters").
//
// What replay IS: moving selected DEAD rows back to PENDING with a fresh retry
// budget, so the normal worker delivers them again under every normal rule.
//
// What replay is NOT, by construction:
//
//   * an edit — payload, aggregate, event type and handler-run markers are
//     never written. A handler that already completed for an event is still
//     skipped by its marker, so a replay cannot repeat a committed effect
//     (ledger posting, notification row, receipt). Financial history is not
//     touchable from here at all; this service only ever writes OutboxEvent
//     status/attempt columns and one AuditEvent row.
//   * a bypass — the redelivered event goes through the same handler, which
//     re-reads current state and applies its own policy, retention and
//     security checks at delivery time.
//   * anonymous — every execution needs an ACTIVE operator holding the
//     `outbox:replay` permission, a written reason, and writes an AuditEvent
//     in the SAME transaction as the state change. If the audit type is not
//     present in the database, execution refuses (fail closed); dry-run still
//     works so an operator can inspect what would happen.

export const OUTBOX_REPLAY_PERMISSION = 'outbox:replay';
/** Requested via docs/production-readiness/r22/shared-change-requests/CR-01. */
export const OUTBOX_REPLAY_AUDIT_TYPE = 'OUTBOX_DEAD_LETTER_REPLAYED';

/** Hard ceilings. Not configurable on purpose: a replay larger than this is an
 *  incident response, which should be several deliberate, audited steps. */
export const REPLAY_MAX_EVENTS_PER_CALL = 50;
export const REPLAY_MAX_CALLS_PER_OPERATOR_HOUR = 10;
export const REPLAY_MAX_EVENTS_PER_OPERATOR_HOUR = 200;
/** Dead letters older than this are not replayable: the world their payload
 *  describes has very likely moved on, and a stale redelivery is a new bug. */
export const REPLAY_MAX_DEAD_AGE_DAYS = 30;

export interface OutboxReplayScope {
  eventIds?: string[];
  eventType?: string;
  aggregateType?: string;
  aggregateId?: string;
}

export interface OutboxReplayRequest {
  operatorUserId: string;
  reason: string;
  scope: OutboxReplayScope;
  limit: number;
  dryRun: boolean;
  /** Correlates the audit row with a ticket or CLI invocation. */
  requestId?: string;
}

export interface OutboxReplayCandidate {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  attempts: number;
  deadSince: Date;
  /** First line of the last error, truncated. Never the payload. */
  lastErrorSummary: string | null;
}

export interface OutboxReplayResult {
  dryRun: boolean;
  candidates: OutboxReplayCandidate[];
  replayedIds: string[];
  auditEventId: string | null;
}

export type OutboxReplayRefusal =
  | 'invalid-request'
  | 'unauthorized'
  | 'audit-unavailable'
  | 'rate-limited';

export class OutboxReplayRefusedError extends Error {
  constructor(
    readonly code: OutboxReplayRefusal,
    detail: string,
  ) {
    super(`Outbox replay refused (${code}): ${detail}`);
    this.name = 'OutboxReplayRefusedError';
  }
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const NAME = /^[A-Za-z0-9._:-]{1,100}$/;

/** Validate shape only; authorization and limits are checked in the
 *  transaction. Exported for unit tests. */
export function validateReplayRequest(req: OutboxReplayRequest): void {
  const fail = (detail: string) => {
    throw new OutboxReplayRefusedError('invalid-request', detail);
  };
  if (!ID.test(req.operatorUserId ?? '')) fail('operatorUserId is required');
  const reason = (req.reason ?? '').trim();
  if (reason.length < 10 || reason.length > 500) fail('reason must be 10-500 characters');
  if (!Number.isInteger(req.limit) || req.limit < 1 || req.limit > REPLAY_MAX_EVENTS_PER_CALL) {
    fail(`limit must be an integer in 1..${REPLAY_MAX_EVENTS_PER_CALL}`);
  }
  if (typeof req.dryRun !== 'boolean') fail('dryRun must be explicit');
  const s = req.scope ?? {};
  const ids = s.eventIds ?? [];
  if (ids.length > REPLAY_MAX_EVENTS_PER_CALL) fail('too many eventIds');
  if (ids.some((id) => !ID.test(id))) fail('malformed eventId');
  for (const [key, value] of [
    ['eventType', s.eventType],
    ['aggregateType', s.aggregateType],
  ] as const) {
    if (value !== undefined && !NAME.test(value)) fail(`malformed ${key}`);
  }
  if (s.aggregateId !== undefined && !ID.test(s.aggregateId)) fail('malformed aggregateId');
  if (s.aggregateId !== undefined && s.aggregateType === undefined) {
    fail('aggregateId requires aggregateType');
  }
  // "Replay every dead letter" is never a single command.
  if (ids.length === 0 && !s.eventType && !s.aggregateType) {
    fail('scope must name eventIds, an eventType or an aggregate');
  }
}

@Injectable()
export class OutboxReplayService {
  constructor(private readonly prisma: PrismaService) {}

  async replay(req: OutboxReplayRequest): Promise<OutboxReplayResult> {
    validateReplayRequest(req);

    return this.prisma.client.$transaction(
      async (tx) => {
        // One replay at a time, cluster-wide. Serialises the rate-limit read
        // with its own audit write, so two concurrent invocations cannot both
        // pass the hourly budget.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('r22:outbox:replay'))`;

        await this.authorize(tx, req.operatorUserId);
        const candidates = await this.select(tx, req);

        if (req.dryRun) {
          return { dryRun: true, candidates, replayedIds: [], auditEventId: null };
        }

        if (!(await this.auditTypePresent(tx))) {
          throw new OutboxReplayRefusedError(
            'audit-unavailable',
            `AuditEventType.${OUTBOX_REPLAY_AUDIT_TYPE} is not migrated; execution is disabled`,
          );
        }
        await this.enforceRateLimit(tx, req.operatorUserId, candidates.length);

        if (candidates.length === 0) {
          // Still audited: an operator asserting "replay X" that matched
          // nothing is part of the incident record.
          const auditEventId = await this.audit(tx, req, candidates, []);
          return { dryRun: false, candidates, replayedIds: [], auditEventId };
        }

        const ids = candidates.map((c) => c.id);
        // Re-fenced on DEAD: rows were locked by the SELECT, but the guard
        // keeps the statement correct even if it is ever reused unlocked.
        const replayed = await tx.$queryRaw<Array<{ id: string }>>`
          UPDATE "OutboxEvent"
          SET "status" = 'PENDING'::"OutboxStatus",
              "attempts" = 0,
              "availableAt" = NOW(),
              "claimedAt" = NULL,
              "claimedBy" = NULL,
              "updatedAt" = NOW()
          WHERE "id" = ANY(${ids})
            AND "status" = 'DEAD'::"OutboxStatus"
          RETURNING "id"
        `;
        const replayedIds = replayed.map((r) => r.id).sort();
        const auditEventId = await this.audit(tx, req, candidates, replayedIds);
        return { dryRun: false, candidates, replayedIds, auditEventId };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  private async authorize(tx: PrismaTx, operatorUserId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "User" u
        JOIN "UserRole" ur ON ur."userId" = u."id"
        JOIN "Role" r ON r."id" = ur."roleId" AND r."deletedAt" IS NULL
        JOIN "RolePermission" rp ON rp."roleId" = r."id"
        JOIN "Permission" p ON p."id" = rp."permissionId"
        WHERE u."id" = ${operatorUserId}
          AND u."status" = 'ACTIVE'::"AccountStatus"
          AND u."deletedAt" IS NULL
          AND p."key" = ${OUTBOX_REPLAY_PERMISSION}
      ) AS ok
    `;
    if (!rows[0]?.ok) {
      // One message for every reason (no user, inactive, no permission) so the
      // refusal does not enumerate accounts.
      throw new OutboxReplayRefusedError(
        'unauthorized',
        `operator must be an active user holding ${OUTBOX_REPLAY_PERMISSION}`,
      );
    }
  }

  private async select(tx: PrismaTx, req: OutboxReplayRequest): Promise<OutboxReplayCandidate[]> {
    const s = req.scope;
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"status" = 'DEAD'::"OutboxStatus"`,
      Prisma.sql`"updatedAt" >= NOW() - make_interval(days => ${REPLAY_MAX_DEAD_AGE_DAYS}::int)`,
    ];
    if (s.eventIds?.length) conditions.push(Prisma.sql`"id" = ANY(${s.eventIds})`);
    if (s.eventType) conditions.push(Prisma.sql`"eventType" = ${s.eventType}`);
    if (s.aggregateType) conditions.push(Prisma.sql`"aggregateType" = ${s.aggregateType}`);
    if (s.aggregateId) conditions.push(Prisma.sql`"aggregateId" = ${s.aggregateId}`);

    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        eventType: string;
        aggregateType: string;
        aggregateId: string;
        attempts: number;
        updatedAt: Date;
        lastError: string | null;
      }>
    >`
      SELECT "id", "eventType", "aggregateType", "aggregateId", "attempts", "updatedAt", "lastError"
      FROM "OutboxEvent"
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY "updatedAt" ASC, "id" ASC
      LIMIT ${req.limit}
      ${req.dryRun ? Prisma.empty : Prisma.sql`FOR UPDATE`}
    `;
    return rows.map((r) => ({
      id: r.id,
      eventType: r.eventType,
      aggregateType: r.aggregateType,
      aggregateId: r.aggregateId,
      attempts: r.attempts,
      deadSince: r.updatedAt,
      lastErrorSummary: r.lastError ? r.lastError.split('\n', 1)[0].slice(0, 200) : null,
    }));
  }

  private async auditTypePresent(tx: PrismaTx): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ present: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e JOIN pg_type t ON t."oid" = e."enumtypid"
        WHERE t."typname" = 'AuditEventType' AND e."enumlabel" = ${OUTBOX_REPLAY_AUDIT_TYPE}
      ) AS present
    `;
    return rows[0]?.present === true;
  }

  /** The audit trail is the rate-limit ledger: what this operator replayed in
   *  the last hour is exactly what the audit rows say they replayed. */
  private async enforceRateLimit(
    tx: PrismaTx,
    operatorUserId: string,
    adding: number,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ calls: bigint; events: bigint | null }>>`
      SELECT COUNT(*) AS calls,
             COALESCE(SUM(("metadata"->>'replayedCount')::int), 0) AS events
      FROM "AuditEvent"
      WHERE "userId" = ${operatorUserId}
        AND "type"::text = ${OUTBOX_REPLAY_AUDIT_TYPE}
        AND "createdAt" > NOW() - INTERVAL '1 hour'
    `;
    const calls = Number(rows[0]?.calls ?? 0);
    const events = Number(rows[0]?.events ?? 0);
    if (calls >= REPLAY_MAX_CALLS_PER_OPERATOR_HOUR) {
      throw new OutboxReplayRefusedError(
        'rate-limited',
        `at most ${REPLAY_MAX_CALLS_PER_OPERATOR_HOUR} replays per operator per hour`,
      );
    }
    if (events + adding > REPLAY_MAX_EVENTS_PER_OPERATOR_HOUR) {
      throw new OutboxReplayRefusedError(
        'rate-limited',
        `at most ${REPLAY_MAX_EVENTS_PER_OPERATOR_HOUR} replayed events per operator per hour`,
      );
    }
  }

  private async audit(
    tx: PrismaTx,
    req: OutboxReplayRequest,
    candidates: OutboxReplayCandidate[],
    replayedIds: string[],
  ): Promise<string> {
    const id = `oxr_${randomUUID()}`;
    // No payloads and no error text: the audit row records the decision and
    // its scope, not the data the events carried.
    const metadata = {
      reason: req.reason.trim(),
      scope: req.scope,
      limit: req.limit,
      replayedCount: replayedIds.length,
      events: candidates.map((c) => ({
        id: c.id,
        eventType: c.eventType,
        aggregateType: c.aggregateType,
        aggregateId: c.aggregateId,
        attemptsBefore: c.attempts,
        replayed: replayedIds.includes(c.id),
      })),
    };
    // Raw SQL with a text cast because the generated client's AuditEventType
    // union only gains this value once CR-01 is migrated and regenerated.
    await tx.$executeRaw`
      INSERT INTO "AuditEvent" ("id", "userId", "type", "metadata", "requestId", "createdAt")
      VALUES (
        ${id},
        ${req.operatorUserId},
        ${OUTBOX_REPLAY_AUDIT_TYPE}::"AuditEventType",
        ${JSON.stringify(metadata)}::jsonb,
        ${req.requestId ?? null},
        NOW()
      )
    `;
    return id;
  }
}
