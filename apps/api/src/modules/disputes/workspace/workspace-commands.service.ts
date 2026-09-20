import { Injectable } from '@nestjs/common';
import { Prisma } from '@homeservicemarketplace/database';
import type { DisputeWorkspaceReceipt } from '@homeservicemarketplace/contracts';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { WorkspaceRepository } from './workspace.repository';
import { WorkspaceRequests } from './workspace-requests.service';
import { WorkspaceResolution } from './workspace-resolution.service';
import { WorkspaceAppeals } from './workspace-appeals.service';
import { WorkspaceEvents } from './workspace-events.service';
import {
  conflict,
  digest,
  forbidden,
  parseCommand,
  WORKSPACE_PERMISSIONS,
} from './workspace.policy';

@Injectable()
export class WorkspaceCommands {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly repository: WorkspaceRepository,
    private readonly requests: WorkspaceRequests,
    private readonly resolution: WorkspaceResolution,
    private readonly appeals: WorkspaceAppeals,
    private readonly events: WorkspaceEvents,
  ) {}
  async execute(
    actorId: string,
    disputeId: string,
    raw: unknown,
    reviewer = false,
  ): Promise<DisputeWorkspaceReceipt> {
    const input = parseCommand(raw);
    const c = input.command;
    const intentId = `dw_${digest([disputeId, actorId, input.idempotencyKey])}`;
    const requestDigest = digest(input);
    try {
      return await this.transactions.run(
        async (tx) => {
          const w = await this.repository.lock(disputeId, tx);
          const actor = await this.repository.actor(actorId, w, tx, reviewer);
          const receipt = await tx.disputeCommandReceipt.findUnique({ where: { id: intentId } });
          if (receipt) {
            if (receipt.actorUserId !== actorId || receipt.requestDigest !== requestDigest)
              throw conflict('INTENT_REUSED');
            const result = receipt.result as { entityId: string | null };
            return { revision: receipt.revision, entityId: result.entityId, replayed: true };
          }
          if (w.revision !== input.expectedRevision) throw conflict('STALE_REVISION');
          if (
            w.state === 'CLOSED' &&
            !['HOLD_PRIVATE_TEXT', 'HOLD_EVIDENCE', 'REQUEUE_EVIDENCE'].includes(c.action)
          )
            throw conflict('CASE_CLOSED');
          let entityId: string | null = null;
          switch (c.action) {
            case 'ASSIGN': {
              if (actor.role !== 'REVIEWER' || !actor.permissions.has(WORKSPACE_PERMISSIONS.ASSIGN))
                throw forbidden();
              await this.repository.assertAssignableReviewer(c.reviewerId, w, tx);
              if (w.state === 'APPEALED') {
                const open = await tx.disputeAppealRecord.findFirst({
                  where: { disputeId, status: 'OPEN' },
                  include: { decision: true },
                });
                if (!open || open.decision.decidedById === c.reviewerId) throw forbidden();
                await this.repository.reviewerCan(
                  c.reviewerId,
                  w,
                  WORKSPACE_PERMISSIONS.DECIDE_APPEAL,
                  tx,
                );
              }
              await tx.disputeWorkspace.update({
                where: { disputeId },
                data: {
                  assignedToUserId: c.reviewerId,
                },
              });
              break;
            }
            case 'REQUEST_INFORMATION':
              entityId = await this.requests.request(tx, w, actor, c);
              break;
            case 'RESPOND':
              entityId = await this.requests.respond(tx, w, actor, c);
              break;
            case 'PROPOSE':
              entityId = await this.resolution.propose(tx, w, actor, c);
              break;
            case 'CONSENT':
              entityId = await this.resolution.consent(tx, w, actor, c);
              break;
            case 'DECIDE':
              entityId = await this.resolution.decide(tx, w, actor, c);
              break;
            case 'APPEAL':
              entityId = await this.appeals.open(tx, w, actor, c);
              break;
            case 'DECIDE_APPEAL':
              entityId = await this.appeals.decide(tx, w, actor, c);
              break;
            case 'CONFIRM_FULFILMENT':
              entityId = await this.resolution.fulfil(tx, w, actor, c);
              break;
            case 'CLOSE':
              entityId = await this.resolution.close(tx, w, actor);
              break;
            case 'HOLD_PRIVATE_TEXT': {
              this.repository.requireAssigned(actor, w, WORKSPACE_PERMISSIONS.HOLD_PRIVATE_TEXT);
              const until = c.holdUntil ? new Date(c.holdUntil) : null;
              if (
                w.privateTextErasedAt ||
                (until && (until <= new Date() || until.getTime() > Date.now() + 90 * 86400000)) ||
                (!until && c.reasonCode !== 'HOLD_RELEASED') ||
                (until && c.reasonCode === 'HOLD_RELEASED')
              )
                throw conflict('HOLD_NOT_ALLOWED');
              await tx.disputeWorkspace.update({
                where: { disputeId },
                data: { privateTextHoldUntil: until },
              });
              break;
            }
            case 'HOLD_EVIDENCE': {
              this.repository.requireAssigned(actor, w, WORKSPACE_PERMISSIONS.HOLD_EVIDENCE);
              await tx.$queryRaw(
                Prisma.sql`SELECT "id" FROM "DisputeEvidence" WHERE "id"=${c.evidenceId} FOR UPDATE`,
              );
              const e = await tx.disputeEvidence.findFirst({
                where: { id: c.evidenceId, disputeId, erasedAt: null, erasureStartedAt: null },
              });
              const until = c.holdUntil ? new Date(c.holdUntil) : null;
              if (
                !e ||
                (until && (until <= new Date() || until.getTime() > Date.now() + 90 * 86400000)) ||
                (!until && c.reasonCode !== 'HOLD_RELEASED')
              )
                throw conflict('HOLD_NOT_ALLOWED');
              await tx.disputeEvidence.update({ where: { id: e.id }, data: { holdUntil: until } });
              entityId = e.id;
              break;
            }
            case 'REQUEUE_EVIDENCE': {
              this.repository.requireAssigned(actor, w, WORKSPACE_PERMISSIONS.REQUEUE_EVIDENCE);
              await tx.$queryRaw(
                Prisma.sql`SELECT "id" FROM "DisputeEvidence" WHERE "id"=${c.evidenceId} FOR UPDATE`,
              );
              const e = await tx.disputeEvidence.findFirst({
                where: {
                  id: c.evidenceId,
                  disputeId,
                  erasedAt: null,
                  state: { in: ['DEAD', 'ERASURE_DEAD'] },
                },
              });
              if (!e || !e.storageKey) throw conflict('NO_RETRYABLE_EVIDENCE');
              await tx.disputeEvidence.update({
                where: { id: e.id },
                data: {
                  state: e.erasureStartedAt ? 'ERASING' : 'STORED',
                  attempts: 0,
                  leaseToken: null,
                  leaseUntil: null,
                  nextAttemptAt: new Date(),
                  lastErrorCode: null,
                },
              });
              entityId = e.id;
              break;
            }
            case 'SHARE_REDACTED_EVIDENCE': {
              this.repository.requireAssigned(
                actor,
                w,
                WORKSPACE_PERMISSIONS.SHARE_REDACTED_EVIDENCE,
              );
              if (!['GATHERING', 'PROPOSED', 'APPEALED'].includes(w.state))
                throw conflict('EVIDENCE_SHARING_CLOSED');
              const evidence = await tx.disputeEvidence.findFirst({
                where: {
                  id: c.evidenceId,
                  disputeId,
                  sourceEvidenceId: { not: null },
                  state: 'CLEAN',
                  sharedAt: null,
                  erasedAt: null,
                  erasureStartedAt: null,
                  retainUntil: { gt: new Date() },
                },
              });
              if (!evidence) throw conflict('REDACTED_EVIDENCE_REQUIRED');
              await tx.disputeEvidence.update({
                where: { id: evidence.id },
                data: { sharedAt: new Date(), sharedById: actor.id, shareReasonCode: c.reasonCode },
              });
              entityId = evidence.id;
              break;
            }
          }
          if (
            !w.firstResponseAt &&
            actor.role === 'REVIEWER' &&
            ['REQUEST_INFORMATION', 'PROPOSE', 'DECIDE', 'DECIDE_APPEAL'].includes(c.action)
          )
            await tx.disputeWorkspace.update({
              where: { disputeId },
              data: { firstResponseAt: new Date() },
            });
          const revision = await this.events.append(tx, w, {
            actorId,
            actorRole: actor.role,
            kind: c.action,
            reasonCode: 'reasonCode' in c ? c.reasonCode : c.action,
            facts: entityId ? { entityId } : {},
            notify: [w.seekerUserId, w.providerUserId].filter((id) => id !== actorId),
          });
          await tx.disputeCommandReceipt.create({
            data: {
              id: intentId,
              disputeId,
              actorUserId: actorId,
              requestDigest,
              revision,
              result: { entityId },
            },
          });
          return { revision, entityId, replayed: false };
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      )
        throw conflict('CONCURRENT_COMMAND');
      throw error;
    }
  }
}
