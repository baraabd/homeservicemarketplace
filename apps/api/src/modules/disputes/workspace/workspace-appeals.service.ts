import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DisputeWorkspace, PrismaTx } from '@homeservicemarketplace/database';
import { WorkspaceCipher } from './workspace-cipher.service';
import { WorkspaceResolution } from './workspace-resolution.service';
import { type WorkspaceActor } from './workspace.repository';
import { conflict, forbidden, type WorkspaceCommand } from './workspace.policy';

@Injectable()
export class WorkspaceAppeals {
  constructor(
    private readonly cipher: WorkspaceCipher,
    private readonly resolution: WorkspaceResolution,
  ) {}
  async open(
    tx: PrismaTx,
    w: DisputeWorkspace,
    actor: WorkspaceActor,
    c: Extract<WorkspaceCommand, { action: 'APPEAL' }>,
  ) {
    if (actor.role === 'REVIEWER') throw forbidden();
    const decision = await tx.disputeDecisionRecord.findFirst({
      where: { id: c.decisionId, disputeId: w.disputeId },
    });
    if (
      w.state !== 'DECIDED' ||
      !decision ||
      decision.supersedesId ||
      decision.appealUntil <= new Date()
    )
      throw conflict('APPEAL_WINDOW_CLOSED');
    if (await tx.disputeAppealRecord.count({ where: { disputeId: w.disputeId, status: 'OPEN' } }))
      throw conflict('APPEAL_ALREADY_OPEN');
    const id = randomUUID();
    await tx.disputeAppealRecord.create({
      data: {
        id,
        disputeId: w.disputeId,
        decisionId: c.decisionId,
        appellantId: actor.id,
        groundsCipher: this.cipher.encode(c.grounds, `appeal:${id}`),
      },
    });
    await tx.disputeWorkspace.update({
      where: { disputeId: w.disputeId },
      data: { state: 'APPEALED', assignedToUserId: null },
    });
    return id;
  }
  async decide(
    tx: PrismaTx,
    w: DisputeWorkspace,
    actor: WorkspaceActor,
    c: Extract<WorkspaceCommand, { action: 'DECIDE_APPEAL' }>,
  ) {
    const appeal = await tx.disputeAppealRecord.findFirst({
      where: { id: c.appealId, disputeId: w.disputeId, status: 'OPEN' },
      include: { decision: true },
    });
    if (!appeal) throw conflict('APPEAL_UNAVAILABLE');
    if (actor.id === appeal.decision.decidedById || actor.id === appeal.appellantId)
      throw forbidden();
    const id = await this.resolution.decide(tx, w, actor, c, appeal.decisionId);
    await tx.disputeAppealRecord.update({
      where: { id: appeal.id },
      data: { status: 'DECIDED', reviewerId: actor.id, reviewedAt: new Date(), newDecisionId: id },
    });
    return id;
  }
}
