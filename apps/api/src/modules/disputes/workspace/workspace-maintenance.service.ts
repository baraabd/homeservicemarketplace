import { Injectable } from '@nestjs/common';
import { WorkspacePrivateLifecycle } from './workspace-private-lifecycle.service';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceEvents } from './workspace-events.service';
import { WorkspaceEvidence } from './workspace-evidence.service';

/** Dedicated process driver; API request paths never schedule maintenance. */
@Injectable()
export class WorkspaceMaintenance {
  constructor(
    private readonly repo: WorkspaceRepository,
    private readonly tx: TransactionRunner,
    private readonly events: WorkspaceEvents,
    private readonly evidence: WorkspaceEvidence,
    private readonly privacy: WorkspacePrivateLifecycle,
  ) {}
  async counts() {
    const db = this.repo.prisma.client;
    const now = new Date();
    return {
      ...(await this.privacy.counts(now)),
      requestsOverdue: await db.disputeInformationRequest.count({
        where: { status: 'OPEN', dueAt: { lte: now } },
      }),
      casesOverdue: await db.disputeWorkspace.count({
        where: { state: { not: 'CLOSED' }, resolutionDueAt: { lte: now } },
      }),
      evidenceDue: await db.disputeEvidence.count({
        where: { erasedAt: null, retainUntil: { lte: now } },
      }),
      scanDead: await db.disputeEvidence.count({ where: { state: 'DEAD' } }),
      erasureDead: await db.disputeEvidence.count({ where: { state: 'ERASURE_DEAD' } }),
    };
  }
  async runOnce(mode: 'shadow' | 'enforce', limit = 10, stop = () => false) {
    if (mode === 'shadow') return { processed: 0, ...(await this.counts()) };
    let processed = 0;
    for (let i = 0; i < Math.min(50, Math.max(1, limit)) && !stop(); i++) {
      if (await this.privacy.eraseExpiredDraft()) processed++;
      if (await this.privacy.eraseClosedCase()) processed++;
      if (await this.expireRequest()) processed++;
      if (await this.expireProposal()) processed++;
      if (await this.recoverExhaustedLease()) processed++;
      if (await this.evidence.eraseOne()) processed++;
      if (await this.evidence.scanOne()) processed++;
    }
    return { processed, ...(await this.counts()) };
  }
  async expireRequest() {
    const candidate = await this.repo.prisma.client.disputeInformationRequest.findFirst({
      where: { status: 'OPEN', dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
    });
    if (!candidate) return false;
    await this.tx.run(async (tx) => {
      const w = await this.repo.lock(candidate.disputeId, tx);
      const row = await tx.disputeInformationRequest.findUnique({ where: { id: candidate.id } });
      if (!row || row.status !== 'OPEN' || row.dueAt > new Date()) return;
      await tx.disputeInformationRequest.update({
        where: { id: row.id },
        data: { status: 'EXPIRED' },
      });
      await this.events.append(tx, w, {
        actorId: null,
        actorRole: 'SYSTEM',
        kind: 'REQUEST_EXPIRED',
        reasonCode: 'DEADLINE_PASSED',
        facts: { requestId: row.id },
        notify: [row.recipientId],
      });
    });
    return true;
  }
  async expireProposal() {
    const c = await this.repo.prisma.client.disputeResolutionProposal.findFirst({
      where: { status: 'OPEN', expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'asc' },
    });
    if (!c) return false;
    await this.tx.run(async (tx) => {
      const w = await this.repo.lock(c.disputeId, tx);
      const row = await tx.disputeResolutionProposal.findUnique({ where: { id: c.id } });
      if (!row || row.status !== 'OPEN' || row.expiresAt > new Date()) return;
      await tx.disputeResolutionProposal.update({
        where: { id: row.id },
        data: { status: 'EXPIRED' },
      });
      if (w.state === 'PROPOSED')
        await tx.disputeWorkspace.update({
          where: { disputeId: w.disputeId },
          data: { state: 'GATHERING' },
        });
      await this.events.append(tx, w, {
        actorId: null,
        actorRole: 'SYSTEM',
        kind: 'PROPOSAL_EXPIRED',
        reasonCode: 'DEADLINE_PASSED',
        facts: { proposalId: row.id },
        notify: [w.seekerUserId, w.providerUserId],
      });
    });
    return true;
  }
  async recoverExhaustedLease() {
    const c = await this.repo.prisma.client.disputeEvidence.findFirst({
      where: {
        state: { in: ['SCANNING', 'ERASING'] },
        attempts: { gte: 5 },
        leaseUntil: { lte: new Date() },
        erasedAt: null,
      },
      orderBy: { leaseUntil: 'asc' },
    });
    if (!c) return false;
    await this.tx.run(async (tx) => {
      const w = await this.repo.lock(c.disputeId, tx);
      const claimed = await tx.disputeEvidence.updateMany({
        where: {
          id: c.id,
          state: c.state,
          attempts: { gte: 5 },
          leaseUntil: { lte: new Date() },
          erasedAt: null,
        },
        data: {
          state: c.erasureStartedAt ? 'ERASURE_DEAD' : 'DEAD',
          leaseToken: null,
          leaseUntil: null,
          lastErrorCode: 'ATTEMPTS_EXHAUSTED',
        },
      });
      if (claimed.count)
        await this.events.append(tx, w, {
          actorId: null,
          actorRole: 'SYSTEM',
          kind: 'EVIDENCE_DEAD_LETTER',
          reasonCode: 'ATTEMPTS_EXHAUSTED',
          facts: { evidenceId: c.id },
        });
    });
    return true;
  }
}
