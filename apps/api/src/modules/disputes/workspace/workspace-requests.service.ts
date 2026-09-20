import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DisputeWorkspace, PrismaTx } from '@homeservicemarketplace/database';
import { WorkspaceCipher } from './workspace-cipher.service';
import { WorkspaceRepository, type WorkspaceActor } from './workspace.repository';
import {
  conflict,
  forbidden,
  frozenPolicy,
  hoursAfter,
  WORKSPACE_PERMISSIONS,
  type WorkspaceCommand,
} from './workspace.policy';

@Injectable()
export class WorkspaceRequests {
  constructor(
    private readonly cipher: WorkspaceCipher,
    private readonly repository: WorkspaceRepository,
  ) {}
  async request(
    tx: PrismaTx,
    w: DisputeWorkspace,
    actor: WorkspaceActor,
    command: Extract<WorkspaceCommand, { action: 'REQUEST_INFORMATION' }>,
  ) {
    this.repository.requireAssigned(actor, w, WORKSPACE_PERMISSIONS.REQUEST_INFORMATION);
    if (!['GATHERING', 'APPEALED'].includes(w.state)) throw conflict('CASE_NOT_GATHERING');
    const open = await tx.disputeInformationRequest.count({
      where: { disputeId: w.disputeId, status: 'OPEN' },
    });
    if (open >= 10) throw conflict('TOO_MANY_OPEN_REQUESTS');
    const id = randomUUID();
    const p = frozenPolicy(w.policySnapshot);
    await tx.disputeInformationRequest.create({
      data: {
        id,
        disputeId: w.disputeId,
        requestedById: actor.id,
        recipientId: command.recipient === 'SEEKER' ? w.seekerUserId : w.providerUserId,
        questionCipher: this.cipher.encode(command.question, `request:${id}`),
        reasonCode: 'INFORMATION_REQUIRED',
        dueAt: hoursAfter(new Date(), p.requestWindowHours),
      },
    });
    return id;
  }
  async respond(
    tx: PrismaTx,
    w: DisputeWorkspace,
    actor: WorkspaceActor,
    command: Extract<WorkspaceCommand, { action: 'RESPOND' }>,
  ) {
    if (actor.role === 'REVIEWER') throw forbidden();
    if (!['GATHERING', 'APPEALED'].includes(w.state)) throw conflict('CASE_NOT_GATHERING');
    if (command.requestId) {
      const request = await tx.disputeInformationRequest.findFirst({
        where: { id: command.requestId, disputeId: w.disputeId, recipientId: actor.id },
      });
      if (!request) throw forbidden();
      if (request.status !== 'OPEN' || request.dueAt <= new Date())
        throw conflict('REQUEST_DEADLINE_PASSED');
      await tx.disputeInformationRequest.update({
        where: { id: request.id },
        data: { status: 'ANSWERED', answeredAt: new Date() },
      });
    }
    if (
      (await tx.disputeStatement.count({
        where: { disputeId: w.disputeId, authorId: actor.id },
      })) >= 100
    )
      throw conflict('RESPONSE_LIMIT');
    const id = randomUUID();
    await tx.disputeStatement.create({
      data: {
        id,
        disputeId: w.disputeId,
        authorId: actor.id,
        requestId: command.requestId,
        contentCipher: this.cipher.encode(command.text, `statement:${id}`),
      },
    });
    return id;
  }
}
