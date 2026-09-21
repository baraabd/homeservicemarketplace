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
export class WorkspaceResolution {
  constructor(
    private readonly cipher: WorkspaceCipher,
    private readonly repository: WorkspaceRepository,
  ) {}
  async propose(
    tx: PrismaTx,
    w: DisputeWorkspace,
    actor: WorkspaceActor,
    c: Extract<WorkspaceCommand, { action: 'PROPOSE' }>,
  ) {
    this.repository.requireAssigned(actor, w, WORKSPACE_PERMISSIONS.PROPOSE);
    if (!['GATHERING', 'PROPOSED', 'APPEALED'].includes(w.state))
      throw conflict('PROPOSAL_NOT_ALLOWED');
    if (
      await tx.disputeInformationRequest.count({
        where: { disputeId: w.disputeId, status: 'OPEN' },
      })
    )
      throw conflict('INFORMATION_REQUESTS_OPEN');
    const now = new Date();
    const p = frozenPolicy(w.policySnapshot);
    for (const remedy of c.remedies)
      if (remedy.dueAt && new Date(remedy.dueAt) <= now) throw conflict('REMEDY_DATE_PASSED');
    // No automatic money, sanctions, or booking mutation. These are agreed service
    // commitments; both parties later confirm actual fulfilment independently.
    const id = randomUUID();
    await tx.disputeResolutionProposal.updateMany({
      where: { disputeId: w.disputeId, status: 'OPEN' },
      data: { status: 'SUPERSEDED' },
    });
    await tx.disputeResolutionProposal.create({
      data: {
        id,
        disputeId: w.disputeId,
        authorId: actor.id,
        contentCipher: this.cipher.encode(
          { summary: c.summary, remedies: c.remedies },
          `proposal:${id}`,
        ),
        policyVersion: w.policyVersion,
        expiresAt: hoursAfter(now, p.proposalWindowHours),
      },
    });
    await tx.disputeWorkspace.update({
      where: { disputeId: w.disputeId },
      data: { state: w.state === 'APPEALED' ? 'APPEALED' : 'PROPOSED' },
    });
    return id;
  }
  async consent(
    tx: PrismaTx,
    w: DisputeWorkspace,
    actor: WorkspaceActor,
    c: Extract<WorkspaceCommand, { action: 'CONSENT' }>,
  ) {
    if (actor.role === 'REVIEWER') throw forbidden();
    const proposal = await tx.disputeResolutionProposal.findFirst({
      where: { id: c.proposalId, disputeId: w.disputeId, status: 'OPEN' },
    });
    if (
      !['PROPOSED', 'APPEALED'].includes(w.state) ||
      !proposal ||
      proposal.expiresAt <= new Date()
    )
      throw conflict('PROPOSAL_UNAVAILABLE');
    // A recorded response is immutable. A different proposal is needed to change
    // terms; a duplicate intent is handled by the outer command receipt.
    if (
      await tx.disputeResolutionConsent.findUnique({
        where: { proposalId_userId: { proposalId: proposal.id, userId: actor.id } },
      })
    )
      throw conflict('CONSENT_ALREADY_RECORDED');
    await tx.disputeResolutionConsent.create({
      data: { proposalId: proposal.id, userId: actor.id, accepted: c.accepted },
    });
    if (!c.accepted) {
      await tx.disputeResolutionProposal.update({
        where: { id: proposal.id },
        data: { status: 'DECLINED' },
      });
      await tx.disputeWorkspace.update({
        where: { disputeId: w.disputeId },
        data: { state: w.state === 'APPEALED' ? 'APPEALED' : 'GATHERING' },
      });
    }
    return proposal.id;
  }
  async decide(
    tx: PrismaTx,
    w: DisputeWorkspace,
    actor: WorkspaceActor,
    c: Extract<WorkspaceCommand, { action: 'DECIDE' | 'DECIDE_APPEAL' }>,
    supersedesId: string | null = null,
  ) {
    this.repository.requireAssigned(
      actor,
      w,
      supersedesId ? WORKSPACE_PERMISSIONS.DECIDE_APPEAL : WORKSPACE_PERMISSIONS.DECIDE,
    );
    if (supersedesId ? w.state !== 'APPEALED' : !['GATHERING', 'PROPOSED'].includes(w.state))
      throw conflict('DECISION_NOT_ALLOWED');
    if (
      await tx.disputeInformationRequest.count({
        where: { disputeId: w.disputeId, status: 'OPEN' },
      })
    )
      throw conflict('INFORMATION_REQUESTS_OPEN');
    if (
      c.reasonCode === 'POLICY_EXCEPTION' &&
      !actor.permissions.has(WORKSPACE_PERMISSIONS.APPROVE_EXCEPTION)
    )
      throw forbidden();
    const eventIds = [...new Set(c.basisEventIds)];
    if (
      eventIds.length !== c.basisEventIds.length ||
      (await tx.disputeWorkspaceEvent.count({
        where: { disputeId: w.disputeId, id: { in: eventIds } },
      })) !== eventIds.length
    )
      throw conflict('INVALID_FACT_SOURCES');
    if (c.evidenceIds.length && !actor.permissions.has(WORKSPACE_PERMISSIONS.EVIDENCE_READ))
      throw forbidden();
    await this.repository.evidenceReady(w.disputeId, c.evidenceIds, tx);
    if (c.proposalId) {
      const proposal = await tx.disputeResolutionProposal.findFirst({
        where: { id: c.proposalId, disputeId: w.disputeId },
        include: { consents: true },
      });
      if (
        !proposal ||
        !(supersedesId ? ['OPEN', 'DECIDED'] : ['OPEN']).includes(proposal.status) ||
        (proposal.status === 'OPEN' && proposal.expiresAt <= new Date())
      )
        throw conflict('PROPOSAL_UNAVAILABLE');
      if (
        ![w.seekerUserId, w.providerUserId].every((id) =>
          proposal.consents.some((a) => a.userId === id && a.accepted),
        )
      )
        throw conflict('PARTICIPANT_CONSENTS_REQUIRED');
      await tx.disputeResolutionProposal.update({
        where: { id: proposal.id },
        data: { status: 'DECIDED' },
      });
    } else if (!['INSUFFICIENT_BASIS', 'INDEPENDENT_REVIEW'].includes(c.reasonCode))
      throw conflict('AGREED_PROPOSAL_REQUIRED');
    // Finalizing a case must not leave a competing open offer actionable.
    await tx.disputeResolutionProposal.updateMany({
      where: { disputeId: w.disputeId, status: 'OPEN' },
      data: { status: 'SUPERSEDED' },
    });
    const id = randomUUID();
    const now = new Date();
    const p = frozenPolicy(w.policySnapshot);
    await tx.disputeDecisionRecord.create({
      data: {
        id,
        disputeId: w.disputeId,
        decidedById: actor.id,
        proposalId: c.proposalId,
        supersedesId,
        rationaleCipher: this.cipher.encode(c.rationale, `decision:${id}`),
        reasonCode: c.reasonCode,
        policyVersion: w.policyVersion,
        basisEventIds: eventIds,
        evidenceIds: c.evidenceIds,
        // One independent appeal. The superseding decision is final within this policy.
        appealUntil: supersedesId ? now : hoursAfter(now, p.appealWindowHours),
      },
    });
    await tx.disputeWorkspace.update({
      where: { disputeId: w.disputeId },
      data: { state: 'DECIDED' },
    });
    return id;
  }
  async fulfil(
    tx: PrismaTx,
    w: DisputeWorkspace,
    actor: WorkspaceActor,
    c: Extract<WorkspaceCommand, { action: 'CONFIRM_FULFILMENT' }>,
  ) {
    if (actor.role === 'REVIEWER') throw forbidden();
    if (w.state !== 'DECIDED') throw conflict('DECISION_REQUIRED');
    const latest = await tx.disputeDecisionRecord.findFirst({
      where: { disputeId: w.disputeId },
      orderBy: [
        { supersedesId: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    });
    if (latest?.proposalId !== c.proposalId) throw conflict('PROPOSAL_NOT_CURRENT');
    if (latest.appealUntil > new Date()) throw conflict('REVIEW_WINDOW_OPEN');
    const consent = await tx.disputeResolutionConsent.findUnique({
      where: { proposalId_userId: { proposalId: c.proposalId, userId: actor.id } },
    });
    if (!consent?.accepted || consent.fulfilledAt) throw conflict('FULFILMENT_NOT_AVAILABLE');
    await tx.disputeResolutionConsent.update({
      where: { id: consent.id },
      data: { fulfilledAt: new Date() },
    });
    return c.proposalId;
  }
  async close(tx: PrismaTx, w: DisputeWorkspace, actor: WorkspaceActor) {
    this.repository.requireAssigned(actor, w, WORKSPACE_PERMISSIONS.CLOSE);
    const latest = await tx.disputeDecisionRecord.findFirst({
      where: { disputeId: w.disputeId },
      orderBy: [
        { supersedesId: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
    });
    if (w.state !== 'DECIDED' || !latest || latest.appealUntil > new Date())
      throw conflict('REVIEW_WINDOW_OPEN');
    if (await tx.disputeAppealRecord.count({ where: { disputeId: w.disputeId, status: 'OPEN' } }))
      throw conflict('APPEAL_PENDING');
    if (latest.proposalId) {
      const confirmations = await tx.disputeResolutionConsent.findMany({
        where: { proposalId: latest.proposalId, accepted: true, fulfilledAt: { not: null } },
      });
      if (
        ![w.seekerUserId, w.providerUserId].every((id) =>
          confirmations.some((c) => c.userId === id),
        )
      )
        throw conflict('FULFILMENT_CONFIRMATION_REQUIRED');
    }
    // ONE clock read, not two.
    //
    // `closedAt` and `privateTextDueAt` were each taken from their own
    // `new Date()`. Whenever the millisecond ticked between the two calls, the
    // retention deadline was anchored to a different instant than the closure
    // it is supposed to be measured from, so the stored gap became the policy
    // window plus an arbitrary drift.
    //
    // The drift was tiny and intermittent, but the property it broke is the one
    // ADR-12B rests on: a retention basis is PINNED to the event that starts it.
    // A deadline derived from a second, unrelated clock read is pinned to
    // nothing. Reading the instant once makes the relationship exact by
    // construction instead of by timing luck.
    const closedAt = new Date();
    await tx.disputeWorkspace.update({
      where: { disputeId: w.disputeId },
      data: {
        state: 'CLOSED',
        closedAt,
        privateTextDueAt: hoursAfter(
          closedAt,
          24 *
            (frozenPolicy(w.policySnapshot).privateTextRetentionDays ??
              frozenPolicy(w.policySnapshot).evidenceRetentionDays),
        ),
      },
    });
    await tx.dispute.update({
      where: { id: w.disputeId },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedById: actor.id,
        resolution: 'RECORDED_CASE_DECISION',
      },
    });
    return latest.id;
  }
}
