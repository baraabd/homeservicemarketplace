import { Injectable } from '@nestjs/common';
import { Prisma } from '@homeservicemarketplace/database';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceEvents } from './workspace-events.service';
import { frozenPolicy, hoursAfter } from './workspace.policy';

/** Database-private prose has its own lifecycle; object deletion is a different receipt. */
@Injectable()
export class WorkspacePrivateLifecycle {
  constructor(
    private readonly repo: WorkspaceRepository,
    private readonly transactions: TransactionRunner,
    private readonly events: WorkspaceEvents,
  ) {}

  async counts(now = new Date()) {
    return {
      draftsDue: await this.repo.prisma.client.disputePrivateDraft.count({
        where: { erasedAt: null, expiresAt: { lte: now } },
      }),
      privateTextDue: await this.repo.prisma.client.disputeWorkspace.count({
        where: { state: 'CLOSED', privateTextErasedAt: null, privateTextDueAt: { lte: now } },
      }),
      privateTextHeld: await this.repo.prisma.client.disputeWorkspace.count({
        where: {
          state: 'CLOSED',
          privateTextErasedAt: null,
          privateTextDueAt: { lte: now },
          privateTextHoldUntil: { gt: now },
        },
      }),
    };
  }

  async eraseExpiredDraft(now = new Date()): Promise<boolean> {
    const candidate = await this.repo.prisma.client.disputePrivateDraft.findFirst({
      where: { erasedAt: null, expiresAt: { lte: now } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      select: { id: true, bookingId: true },
    });
    if (!candidate) return false;
    return this.transactions.run(async (tx) => {
      // Same lock order as draft save/intake. A row-only sweep can overwrite a
      // save that read the old version while holding its booking lock.
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Booking" WHERE "id"=${candidate.bookingId} FOR UPDATE`,
      );
      const row = await tx.disputePrivateDraft.findUnique({ where: { id: candidate.id } });
      if (!row || row.erasedAt || row.expiresAt > now) return false;
      const version = row.version + 1;
      await tx.disputePrivateDraft.update({
        where: { id: row.id },
        data: {
          contentCipher: '',
          erasedAt: now,
          version,
        },
      });
      await this.events.draftErased(tx, row.id, version, 'RETENTION_EXPIRED', now);
      return true;
    });
  }

  async eraseClosedCase(now = new Date()): Promise<boolean> {
    const candidate = await this.repo.prisma.client.disputeWorkspace.findFirst({
      where: {
        state: 'CLOSED',
        privateTextErasedAt: null,
        AND: [
          { OR: [{ privateTextDueAt: null }, { privateTextDueAt: { lte: now } }] },
          { OR: [{ privateTextHoldUntil: null }, { privateTextHoldUntil: { lte: now } }] },
        ],
      },
      orderBy: [{ closedAt: 'asc' }, { disputeId: 'asc' }],
      select: { disputeId: true },
    });
    if (!candidate) return false;
    return this.transactions.run(async (tx) => {
      const w = await this.repo.lock(candidate.disputeId, tx);
      if (
        w.state !== 'CLOSED' ||
        !w.closedAt ||
        w.privateTextErasedAt ||
        (w.privateTextHoldUntil && w.privateTextHoldUntil > now)
      )
        return false;
      const policy = frozenPolicy(w.policySnapshot);
      const due =
        w.privateTextDueAt ??
        hoursAfter(
          w.closedAt,
          24 * (policy.privateTextRetentionDays ?? policy.evidenceRetentionDays),
        );
      if (!w.privateTextDueAt)
        await tx.disputeWorkspace.update({
          where: { disputeId: w.disputeId },
          data: { privateTextDueAt: due },
        });
      if (due > now) return false;
      if (await tx.disputeAppealRecord.count({ where: { disputeId: w.disputeId, status: 'OPEN' } }))
        return false;
      // This transaction replaces private text only, not the decision facts,
      // actor IDs, timestamps, policy/source references or original/superseding links.
      await tx.disputeStatement.updateMany({
        where: { disputeId: w.disputeId, erasedAt: null },
        data: { contentCipher: '', erasedAt: now },
      });
      await tx.disputeInformationRequest.updateMany({
        where: { disputeId: w.disputeId },
        data: { questionCipher: '' },
      });
      await tx.disputeResolutionProposal.updateMany({
        where: { disputeId: w.disputeId },
        data: { contentCipher: '' },
      });
      await tx.disputeDecisionRecord.updateMany({
        where: { disputeId: w.disputeId },
        data: { rationaleCipher: '' },
      });
      await tx.disputeAppealRecord.updateMany({
        where: { disputeId: w.disputeId },
        data: { groundsCipher: '' },
      });
      await tx.disputeWorkspace.update({
        where: { disputeId: w.disputeId },
        data: {
          privateTextDueAt: due,
          privateTextErasedAt: now,
        },
      });
      await this.events.append(tx, w, {
        actorId: null,
        actorRole: 'SYSTEM',
        kind: 'PRIVATE_TEXT_ERASED',
        reasonCode: 'RETENTION_EXPIRED',
        facts: { scope: 'CASE_PRIVATE_PROSE_PRIMARY_DATABASE' },
      });
      return true;
    });
  }
}
