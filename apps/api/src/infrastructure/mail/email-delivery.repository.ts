import { Injectable } from '@nestjs/common';
import type { EmailCategory, EmailDelivery, PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../prisma/prisma.service';

export interface NewEmailDelivery {
  messageKey: string;
  category: EmailCategory;
  template: string;
  userId: string | null;
  recipientHash: string;
  envelope: Buffer;
  expiresAt: Date;
  maxAttempts: number;
}

/** Statuses after which nothing is ever sent again. The envelope (which can
 *  hold a one-time secret) is cleared on entry to every one of them. */
export const TERMINAL_SEND_STATUSES = [
  'ACCEPTED',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'SUPPRESSED',
  'FAILED',
  'EXPIRED',
] as const;

// R21 — persistence for EmailDelivery. Claiming mirrors the outbox
// (docs/adr/0004-transactional-outbox.md): one UPDATE … RETURNING over a CTE
// with FOR UPDATE SKIP LOCKED, so replicas never hand one row to two senders.
// Every later transition is fenced on (id, leasedBy): a sender whose lease
// expired and was taken over cannot overwrite its successor's outcome.
@Injectable()
export class EmailDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Insert the intent inside the producer's transaction. ON CONFLICT DO
   *  NOTHING on messageKey, so a duplicate enqueue does not abort the
   *  surrounding Postgres transaction the way a caught P2002 would. Returns
   *  the row for the key, whether new or pre-existing. */
  async insertIfAbsent(row: NewEmailDelivery, tx: PrismaTx): Promise<EmailDelivery> {
    await tx.emailDelivery.createMany({ data: [row], skipDuplicates: true });
    return tx.emailDelivery.findUniqueOrThrow({ where: { messageKey: row.messageKey } });
  }

  /** Throttle window count. Counts every intent, sent or not, so a flood of
   *  requests cannot be laundered through failures. */
  countRecent(recipientHash: string, template: string, since: Date, tx: PrismaTx): Promise<number> {
    return tx.emailDelivery.count({
      where: { recipientHash, template, createdAt: { gte: since } },
    });
  }

  /** Claim one specific row for the post-commit first attempt.
   *
   *  A never-attempted row is claimable regardless of `nextAttemptAt`: that
   *  default is stamped by the application host's clock, and comparing it
   *  with the database's NOW() made the immediate attempt silently miss
   *  whenever the app clock ran even milliseconds ahead (observed: ~0.3 s on
   *  the Docker VM). Retries still honour their backoff. */
  async claimOne(id: string, workerId: string, leaseMs: number): Promise<EmailDelivery | null> {
    const rows = await this.prisma.client.$queryRaw<EmailDelivery[]>`
      UPDATE "EmailDelivery"
      SET "status" = 'SENDING'::"EmailDeliveryStatus",
          "leasedBy" = ${workerId},
          "leaseUntil" = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
          "updatedAt" = NOW()
      WHERE "id" = ${id}
        AND (("status" = 'QUEUED'::"EmailDeliveryStatus" AND ("attempts" = 0 OR "nextAttemptAt" <= NOW()))
          OR ("status" = 'SENDING'::"EmailDeliveryStatus" AND "leaseUntil" < NOW()))
      RETURNING *;
    `;
    return rows[0] ?? null;
  }

  /** Claim up to `limit` due rows: queued and due, or SENDING with an expired
   *  lease (the previous sender died mid-flight). */
  claimBatch(workerId: string, limit: number, leaseMs: number): Promise<EmailDelivery[]> {
    return this.prisma.client.$queryRaw<EmailDelivery[]>`
      WITH due AS (
        SELECT d."id"
        FROM "EmailDelivery" AS d
        WHERE (d."status" = 'QUEUED'::"EmailDeliveryStatus" AND (d."attempts" = 0 OR d."nextAttemptAt" <= NOW()))
           OR (d."status" = 'SENDING'::"EmailDeliveryStatus" AND d."leaseUntil" < NOW())
        ORDER BY d."nextAttemptAt" ASC, d."id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "EmailDelivery" AS e
      SET "status" = 'SENDING'::"EmailDeliveryStatus",
          "leasedBy" = ${workerId},
          "leaseUntil" = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
          "updatedAt" = NOW()
      FROM due
      WHERE e."id" = due."id"
      RETURNING e.*;
    `;
  }

  async markAccepted(
    id: string,
    workerId: string,
    attempts: number,
    smtpCode: number | null,
  ): Promise<boolean> {
    const r = await this.prisma.client.emailDelivery.updateMany({
      where: { id, leasedBy: workerId, status: 'SENDING' },
      data: {
        status: 'ACCEPTED',
        attempts,
        acceptedAt: new Date(),
        lastSmtpCode: smtpCode,
        lastErrorClass: null,
        envelope: null,
        leaseUntil: null,
        leasedBy: null,
      },
    });
    return r.count === 1;
  }

  async markRetry(
    id: string,
    workerId: string,
    attempts: number,
    nextAttemptAt: Date,
    errorClass: string,
    smtpCode: number | null,
  ): Promise<boolean> {
    const r = await this.prisma.client.emailDelivery.updateMany({
      where: { id, leasedBy: workerId, status: 'SENDING' },
      data: {
        status: 'QUEUED',
        attempts,
        nextAttemptAt,
        lastErrorClass: errorClass,
        lastSmtpCode: smtpCode,
        leaseUntil: null,
        leasedBy: null,
      },
    });
    return r.count === 1;
  }

  async markClosed(
    id: string,
    workerId: string,
    status: 'FAILED' | 'EXPIRED' | 'SUPPRESSED',
    attempts: number,
    errorClass: string,
    smtpCode: number | null,
  ): Promise<boolean> {
    const r = await this.prisma.client.emailDelivery.updateMany({
      where: { id, leasedBy: workerId, status: 'SENDING' },
      data: {
        status,
        attempts,
        outcomeAt: new Date(),
        lastErrorClass: errorClass,
        lastSmtpCode: smtpCode,
        envelope: null,
        leaseUntil: null,
        leasedBy: null,
      },
    });
    return r.count === 1;
  }

  async isSuppressed(recipientHash: string): Promise<boolean> {
    const hit = await this.prisma.client.emailSuppression.findFirst({
      where: { recipientHash, liftedAt: null },
      select: { id: true },
    });
    return hit !== null;
  }

  // --- retention -----------------------------------------------------------

  /** QUEUED rows whose validity window closed: never sendable, and still
   *  holding a sealed secret. */
  async expireOverdue(now: Date): Promise<number> {
    const r = await this.prisma.client.emailDelivery.updateMany({
      where: { status: 'QUEUED', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', outcomeAt: now, lastErrorClass: 'expired', envelope: null },
    });
    return r.count;
  }

  /** Defence in depth: no terminal row keeps an envelope, whatever path
   *  closed it. */
  async purgeTerminalEnvelopes(): Promise<number> {
    const r = await this.prisma.client.emailDelivery.updateMany({
      where: { status: { in: [...TERMINAL_SEND_STATUSES] }, envelope: { not: null } },
      data: { envelope: null },
    });
    return r.count;
  }

  async deleteFeedbackBefore(cutoff: Date): Promise<number> {
    const r = await this.prisma.client.emailFeedbackEvent.deleteMany({
      where: { receivedAt: { lt: cutoff } },
    });
    return r.count;
  }

  /** Bounded chunk of closed deliveries older than the cutoff. */
  async deleteClosedBefore(cutoff: Date, chunk: number): Promise<number> {
    const rows = await this.prisma.client.emailDelivery.findMany({
      where: { status: { in: [...TERMINAL_SEND_STATUSES] }, createdAt: { lt: cutoff } },
      select: { id: true },
      take: chunk,
    });
    if (rows.length === 0) return 0;
    const r = await this.prisma.client.emailDelivery.deleteMany({
      where: { id: { in: rows.map((x) => x.id) } },
    });
    return r.count;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.prisma.client.emailDelivery.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }
}
