import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaTx, type DisputeWorkspace } from '@homeservicemarketplace/database';
import type {
  DisputeAdminQueue,
  DisputeWorkspaceHistory,
  DisputeWorkspaceAction,
  DisputeWorkspaceView,
  DisputeRemedy,
} from '@homeservicemarketplace/contracts';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { WorkspaceRepository, type WorkspaceActor } from './workspace.repository';
import { WorkspaceCipher } from './workspace-cipher.service';
import { WorkspaceEvents } from './workspace-events.service';
import {
  conflict,
  forbidden,
  frozenPolicy,
  hoursAfter,
  missing,
  workspacePolicy,
  WORKSPACE_PERMISSIONS as P,
  WORKSPACE_SETTING,
} from './workspace.policy';

@Injectable()
export class DisputeWorkspaceService {
  constructor(
    private readonly repository: WorkspaceRepository,
    private readonly transactions: TransactionRunner,
    private readonly cipher: WorkspaceCipher,
    private readonly events: WorkspaceEvents,
  ) {}
  async initialize(tx: PrismaTx, disputeId: string, actorId: string) {
    const policy = workspacePolicy(
      (await tx.platformSetting.findUnique({ where: { key: WORKSPACE_SETTING } }))?.value,
    );
    if (!policy?.enabled || !policy.pilotUserIds.includes(actorId)) return null;
    this.cipher.ready();
    const row = await tx.dispute.findFirst({
      where: { id: disputeId, deletedAt: null },
      include: { booking: { include: { provider: { select: { userId: true } } } } },
    });
    if (
      !row ||
      !row.id.startsWith('di_') ||
      row.booking.deletedAt ||
      !row.booking.provider.userId ||
      ![row.booking.seekerUserId, row.booking.provider.userId].includes(actorId)
    )
      throw missing();
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Booking" WHERE "id" = ${row.bookingId} FOR UPDATE`,
    );
    const existing = await tx.disputeWorkspace.findUnique({ where: { disputeId } });
    if (existing) return existing;
    const current = await tx.dispute.findUnique({ where: { id: disputeId } });
    if (!current || !['OPEN', 'IN_REVIEW'].includes(current.status))
      throw conflict('LEGACY_CASE_TERMINAL');
    const w = await tx.disputeWorkspace.create({
      data: {
        disputeId,
        policyVersion: policy.revision,
        policySnapshot: policy,
        seekerUserId: row.booking.seekerUserId,
        providerUserId: row.booking.provider.userId,
        resolutionDueAt: hoursAfter(new Date(), policy.resolutionWindowHours),
      },
    });
    const original = await tx.disputeEvent.findFirst({
      where: { disputeId, type: 'OPENED' },
      orderBy: { createdAt: 'asc' },
    });
    if (original?.message) {
      const id = `original_${original.id}`;
      await tx.disputeStatement.create({
        data: {
          id,
          disputeId,
          authorId: row.openedById,
          contentCipher: this.cipher.encode(original.message, `statement:${id}`),
        },
      });
      // Conversion is atomic with adoption; preserve the exact original under AEAD,
      // not a second plaintext copy in legacy event prose.
      await tx.disputeEvent.update({ where: { id: original.id }, data: { message: null } });
    }
    await tx.disputePrivateDraft.updateMany({
      where: { userId: actorId, bookingId: row.bookingId, erasedAt: null },
      data: { contentCipher: '', erasedAt: new Date(), version: { increment: 1 } },
    });
    await this.events.append(tx, w, {
      actorId,
      actorRole: actorId === w.seekerUserId ? 'SEEKER' : 'PROVIDER',
      kind: 'WORKSPACE_OPENED',
      reasonCode: 'POLICY_APPLIED',
    });
    return w;
  }
  async exists(actorId: string, disputeId: string) {
    return this.transactions.run(async (tx) => {
      const w = await tx.disputeWorkspace.findUnique({ where: { disputeId } });
      if (!w) return false;
      await this.repository.actor(actorId, w, tx);
      return true;
    });
  }
  async originalStatement(
    actorId: string,
    disputeId: string,
    eventId: string | undefined,
  ): Promise<string | null> {
    if (!eventId) return null;
    return this.transactions.run(async (tx) => {
      const w = await tx.disputeWorkspace.findUnique({ where: { disputeId } });
      if (!w) return null;
      await this.repository.actor(actorId, w, tx);
      if (w.privateTextErasedAt || (w.privateTextDueAt && w.privateTextDueAt <= new Date()))
        return null;
      const s = await tx.disputeStatement.findFirst({
        where: { id: `original_${eventId}`, disputeId, authorId: actorId, erasedAt: null },
      });
      return s ? this.cipher.decode<string>(s.contentCipher, `statement:${s.id}`) : null;
    });
  }
  async open(actorId: string, disputeId: string) {
    return this.transactions.run(async (tx) => {
      const w = await this.initialize(tx, disputeId, actorId);
      if (!w) throw missing();
      return { disputeId };
    });
  }
  async available(actorId: string): Promise<boolean> {
    const p = workspacePolicy(
      (
        await this.repository.prisma.client.platformSetting.findUnique({
          where: { key: WORKSPACE_SETTING },
        })
      )?.value,
    );
    if (!p?.enabled || !p.pilotUserIds.includes(actorId)) return false;
    this.cipher.ready();
    return true;
  }
  async view(actorId: string, disputeId: string, reviewer = false): Promise<DisputeWorkspaceView> {
    return this.transactions.run(
      async (tx) => {
        const w = await tx.disputeWorkspace.findUnique({ where: { disputeId } });
        if (!w) throw missing();
        const actor = await this.repository.actor(actorId, w, tx, reviewer);
        const p = frozenPolicy(w.policySnapshot);
        const now = new Date();
        const privateTextUnavailable =
          !!w.privateTextErasedAt || (!!w.privateTextDueAt && w.privateTextDueAt <= now);
        const [
          requests,
          statements,
          evidence,
          proposals,
          decisions,
          appeals,
          events,
          dispute,
          original,
        ] = await Promise.all([
          tx.disputeInformationRequest.findMany({
            where: { disputeId, ...(actor.role === 'REVIEWER' ? {} : { recipientId: actorId }) },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
          tx.disputeStatement.findMany({
            where: {
              disputeId,
              erasedAt: null,
              ...(actor.role === 'REVIEWER' ? {} : { authorId: actorId }),
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
          tx.disputeEvidence.findMany({
            where: {
              disputeId,
              ...(actor.role === 'REVIEWER' && actor.permissions.has(P.EVIDENCE_READ)
                ? {}
                : {
                    OR: [
                      { authorId: actorId },
                      { sharedAt: { not: null }, sourceEvidenceId: { not: null } },
                    ],
                  }),
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
          tx.disputeResolutionProposal.findMany({
            where: { disputeId },
            include: { consents: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 30,
          }),
          tx.disputeDecisionRecord.findMany({
            where: { disputeId },
            orderBy: [
              { supersedesId: { sort: 'desc', nulls: 'last' } },
              { createdAt: 'desc' },
              { id: 'desc' },
            ],
            take: 30,
          }),
          tx.disputeAppealRecord.findMany({
            where: { disputeId },
            orderBy: { createdAt: 'desc' },
            take: 30,
          }),
          tx.disputeWorkspaceEvent.findMany({
            where: { disputeId },
            orderBy: { revision: 'desc' },
            take: 201,
          }),
          tx.dispute.findUniqueOrThrow({ where: { id: disputeId }, include: { booking: true } }),
          tx.disputeEvent.findFirst({
            where: { disputeId, type: 'OPENED' },
            orderBy: { createdAt: 'asc' },
          }),
        ]);
        const actions = this.actions(w, actor);
        if (
          actor.role === 'REVIEWER' &&
          w.assignedToUserId === actor.id &&
          actor.permissions.has(P.HOLD_PRIVATE_TEXT) &&
          !w.privateTextErasedAt
        )
          actions.push('HOLD_PRIVATE_TEXT');
        const reviewers =
          actor.role === 'REVIEWER' && actor.permissions.has(P.ASSIGN) && w.state !== 'CLOSED'
            ? await this.repository.assignableReviewers(w, tx)
            : [];
        const assigned =
          actor.role === 'REVIEWER' && w.assignedToUserId
            ? await tx.user.findUnique({
                where: { id: w.assignedToUserId },
                select: { id: true, firstName: true, lastName: true },
              })
            : null;
        const parties = await tx.user.findMany({
          where: { id: { in: [w.seekerUserId, w.providerUserId] } },
          select: { id: true, firstName: true, lastName: true },
        });
        const label = (u: { firstName: string; lastName: string }) =>
          `${u.firstName} ${u.lastName}`.trim();
        if (actor.role !== 'REVIEWER') {
          const decision = decisions[0];
          if (
            w.state === 'DECIDED' &&
            decision &&
            !decision.supersedesId &&
            decision.appealUntil > now
          )
            actions.push('APPEAL');
        }
        if (decisions[0]?.appealUntil && decisions[0].appealUntil > now) {
          const index = actions.indexOf('CONFIRM_FULFILMENT');
          if (index !== -1) actions.splice(index, 1);
        }
        const originalVisible = actor.role === 'REVIEWER' || dispute.openedById === actorId;
        return {
          disputeId,
          reference: disputeId,
          state: w.state,
          revision: w.revision,
          role: actor.role,
          assignedToYou: w.assignedToUserId === actorId,
          availableActions: actions,
          canApproveException:
            actor.role === 'REVIEWER' && actor.permissions.has(P.APPROVE_EXCEPTION),
          assignedReviewer: assigned ? { id: assigned.id, label: label(assigned) } : null,
          reviewers: reviewers.map((u) => ({ id: u.id, label: label(u) })),
          participants: parties.map((u) => ({
            role: u.id === w.seekerUserId ? 'SEEKER' : 'PROVIDER',
            label: label(u),
          })),
          privacy: {
            textErasedAt: w.privateTextErasedAt?.toISOString() ?? null,
            textState: w.privateTextErasedAt
              ? 'ERASED'
              : privateTextUnavailable
                ? 'EXPIRED'
                : 'RETAINED',
            textDueAt: w.privateTextDueAt?.toISOString() ?? null,
            textHeld: !!w.privateTextHoldUntil && w.privateTextHoldUntil > now,
          },
          canUploadEvidence:
            ['GATHERING', 'APPEALED'].includes(w.state) &&
            (actor.role !== 'REVIEWER' ||
              (w.assignedToUserId === actorId &&
                actor.permissions.has(P.EVIDENCE_READ) &&
                actor.permissions.has(P.SHARE_REDACTED_EVIDENCE))),
          policy: {
            version: w.policyVersion,
            appealWindowHours: p.appealWindowHours,
            resolutionDueAt: w.resolutionDueAt.toISOString(),
          },
          facts: [
            {
              id: dispute.booking.id,
              source: 'BOOKING',
              label: 'BOOKING_STATUS',
              value: dispute.booking.status,
              recordedAt: dispute.booking.updatedAt.toISOString(),
            },
            {
              id: dispute.booking.id,
              source: 'BOOKING',
              label: 'BOOKED_AMOUNT_NOT_PAYMENT',
              value: `${dispute.booking.priceAmount} ${dispute.booking.currency}`,
              recordedAt: dispute.booking.createdAt.toISOString(),
            },
            {
              id: original?.id ?? disputeId,
              source: 'SUBMISSION',
              label: 'SUBMITTED_AT',
              value: dispute.createdAt.toISOString(),
              recordedAt: dispute.createdAt.toISOString(),
            },
          ],
          events: events
            .slice(0, 200)
            .reverse()
            .map((e) => ({
              id: e.id,
              kind: e.kind,
              reasonCode: e.reasonCode,
              actorRole: e.actorRole,
              revision: e.revision,
              occurredAt: e.createdAt.toISOString(),
            })),
          eventsTruncated: events.length > 200,
          requests: requests.map((r) => ({
            id: r.id,
            question: privateTextUnavailable
              ? ''
              : this.cipher.decode<string>(r.questionCipher, `request:${r.id}`),
            status: r.status,
            dueAt: r.dueAt.toISOString(),
            yours: r.recipientId === actorId,
            createdAt: r.createdAt.toISOString(),
          })),
          statements: [
            ...(!privateTextUnavailable && originalVisible && original?.message
              ? [
                  {
                    id: original.id,
                    text: original.message,
                    requestId: null,
                    authorRole: dispute.openedById === w.seekerUserId ? 'SEEKER' : 'PROVIDER',
                    createdAt: original.createdAt.toISOString(),
                  },
                ]
              : []),
            ...(privateTextUnavailable ? [] : statements).map((s) => ({
              id: s.id,
              text: this.cipher.decode<string>(s.contentCipher, `statement:${s.id}`),
              requestId: s.requestId,
              authorRole: s.authorId === w.seekerUserId ? 'SEEKER' : 'PROVIDER',
              createdAt: s.createdAt.toISOString(),
            })),
          ],
          evidence: evidence.map((e) => ({
            id: e.id,
            state: e.erasedAt
              ? 'ERASED'
              : e.erasureStartedAt
                ? 'ERASING'
                : e.retainUntil <= now
                  ? 'EXPIRED'
                  : e.state,
            mimeType: e.mimeType,
            sizeBytes: e.sizeBytes,
            viewable:
              e.state === 'CLEAN' &&
              !e.erasedAt &&
              !e.erasureStartedAt &&
              e.retainUntil > now &&
              (actor.role !== 'REVIEWER' || actor.permissions.has(P.EVIDENCE_READ)),
            shared: !!e.sharedAt,
            redactedDerivative: !!e.sourceEvidenceId,
            uploadedByYou: e.authorId === actorId,
            createdAt: e.createdAt.toISOString(),
            retainUntil: e.retainUntil.toISOString(),
          })),
          proposals: proposals.map((r) => {
            const body = privateTextUnavailable
              ? { summary: '', remedies: [] }
              : this.cipher.decode<{ summary: string; remedies: DisputeRemedy[] }>(
                  r.contentCipher,
                  `proposal:${r.id}`,
                );
            const own = r.consents.find((c) => c.userId === actorId);
            return {
              id: r.id,
              status: r.status,
              ...body,
              expiresAt: r.expiresAt.toISOString(),
              acceptedByYou: own?.accepted ?? null,
              acceptedCount: r.consents.filter((c) => c.accepted).length,
              fulfilledByYou: !!own?.fulfilledAt,
              fulfilledCount: r.consents.filter((c) => c.fulfilledAt).length,
            };
          }),
          decisions: decisions.map((d) => ({
            id: d.id,
            reasonCode: d.reasonCode,
            rationale: privateTextUnavailable
              ? ''
              : this.cipher.decode<string>(d.rationaleCipher, `decision:${d.id}`),
            proposalId: d.proposalId,
            supersedesId: d.supersedesId,
            policyVersion: d.policyVersion,
            basisEventIds: d.basisEventIds,
            evidenceIds: d.evidenceIds,
            appealUntil: d.appealUntil.toISOString(),
            createdAt: d.createdAt.toISOString(),
          })),
          appeals: appeals.map((a) => ({
            id: a.id,
            decisionId: a.decisionId,
            status: a.status,
            grounds:
              !privateTextUnavailable && (actor.role === 'REVIEWER' || a.appellantId === actorId)
                ? this.cipher.decode<string>(a.groundsCipher, `appeal:${a.id}`)
                : null,
            yours: a.appellantId === actorId,
            newDecisionId: a.newDecisionId,
            createdAt: a.createdAt.toISOString(),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }
  async history(
    actorId: string,
    disputeId: string,
    before: string | undefined,
    reviewer = false,
  ): Promise<DisputeWorkspaceHistory> {
    const revision = before === undefined ? undefined : Number(before);
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1))
      throw conflict('INVALID_CURSOR');
    return this.transactions.run(async (tx) => {
      const w = await tx.disputeWorkspace.findUnique({ where: { disputeId } });
      if (!w) throw missing();
      await this.repository.actor(actorId, w, tx, reviewer);
      const rows = await tx.disputeWorkspaceEvent.findMany({
        where: { disputeId, ...(revision ? { revision: { lt: revision } } : {}) },
        orderBy: { revision: 'desc' },
        take: 101,
      });
      return {
        items: rows.slice(0, 100).map((e) => ({
          id: e.id,
          kind: e.kind,
          reasonCode: e.reasonCode,
          actorRole: e.actorRole,
          revision: e.revision,
          occurredAt: e.createdAt.toISOString(),
        })),
        beforeRevision: rows.length > 100 ? rows[99].revision : null,
      };
    });
  }
  private actions(w: DisputeWorkspace, a: WorkspaceActor): DisputeWorkspaceAction[] {
    if (w.state === 'CLOSED' && a.role !== 'REVIEWER') return [];
    if (a.role !== 'REVIEWER')
      return w.state === 'GATHERING'
        ? ['RESPOND']
        : w.state === 'PROPOSED'
          ? ['CONSENT']
          : w.state === 'DECIDED'
            ? ['CONFIRM_FULFILMENT']
            : w.state === 'APPEALED'
              ? ['RESPOND', 'CONSENT']
              : [];
    const actions: DisputeWorkspaceAction[] = [];
    if (w.state !== 'CLOSED' && a.permissions.has(P.ASSIGN)) actions.push('ASSIGN');
    if (w.assignedToUserId !== a.id) return actions;
    for (const action of ['HOLD_EVIDENCE', 'REQUEUE_EVIDENCE'] as const)
      if (a.permissions.has(P[action])) actions.push(action);
    if (w.state === 'GATHERING')
      for (const action of [
        'REQUEST_INFORMATION',
        'PROPOSE',
        'DECIDE',
        'SHARE_REDACTED_EVIDENCE',
      ] as const)
        if (a.permissions.has(P[action])) actions.push(action);
    if (w.state === 'PROPOSED')
      for (const action of ['PROPOSE', 'DECIDE', 'SHARE_REDACTED_EVIDENCE'] as const)
        if (a.permissions.has(P[action])) actions.push(action);
    if (w.state === 'APPEALED')
      for (const action of [
        'DECIDE_APPEAL',
        'REQUEST_INFORMATION',
        'PROPOSE',
        'SHARE_REDACTED_EVIDENCE',
      ] as const)
        if (a.permissions.has(P[action])) actions.push(action);
    if (w.state === 'DECIDED' && a.permissions.has(P.CLOSE)) actions.push('CLOSE');
    return actions;
  }
  async queue(
    actorId: string,
    query: { state?: string; cursor?: string; mine?: boolean },
  ): Promise<DisputeAdminQueue> {
    return this.transactions.run(async (tx) => {
      // Empty queues still require real current authorization.
      const actor = await tx.user.findUnique({
        where: { id: actorId },
        select: { status: true, deletedAt: true, isActive: true },
      });
      const permission = await tx.rolePermission.count({
        where: {
          permission: { key: P.READ },
          role: { deletedAt: null, userRoles: { some: { userId: actorId } } },
        },
      });
      if (!actor || actor.status !== 'ACTIVE' || !actor.isActive || actor.deletedAt || !permission)
        throw forbidden();
      const states = ['GATHERING', 'PROPOSED', 'DECIDED', 'APPEALED', 'CLOSED'] as const;
      if (query.state && !states.some((s) => s === query.state))
        throw conflict('INVALID_QUEUE_STATE');
      const state = query.state as (typeof states)[number] | undefined;
      if (
        query.cursor &&
        !(await tx.disputeWorkspace.findUnique({ where: { disputeId: query.cursor } }))
      )
        throw conflict('INVALID_CURSOR');
      const scope = { seekerUserId: { not: actorId }, providerUserId: { not: actorId } };
      const [all, unassigned, overdue, appealCount] = await Promise.all([
        tx.disputeWorkspace.count({ where: scope }),
        tx.disputeWorkspace.count({
          where: { ...scope, assignedToUserId: null, state: { not: 'CLOSED' } },
        }),
        tx.disputeWorkspace.count({
          where: { ...scope, state: { not: 'CLOSED' }, resolutionDueAt: { lt: new Date() } },
        }),
        tx.disputeWorkspace.count({ where: { ...scope, state: 'APPEALED' } }),
      ]);
      const rows = await tx.disputeWorkspace.findMany({
        where: {
          ...(state ? { state } : {}),
          ...(query.mine ? { assignedToUserId: actorId } : {}),
          seekerUserId: { not: actorId },
          providerUserId: { not: actorId },
        },
        include: { dispute: { select: { priority: true } } },
        take: 41,
        orderBy: [{ resolutionDueAt: 'asc' }, { disputeId: 'asc' }],
        ...(query.cursor ? { cursor: { disputeId: query.cursor }, skip: 1 } : {}),
      });
      return {
        counts: { all, unassigned, overdue, appeals: appealCount },
        items: rows.slice(0, 40).map((w) => ({
          disputeId: w.disputeId,
          reference: w.disputeId,
          state: w.state,
          revision: w.revision,
          priority: w.dispute.priority,
          assignedToYou: w.assignedToUserId === actorId,
          unassigned: !w.assignedToUserId,
          dueAt: w.resolutionDueAt.toISOString(),
          overdue: w.state !== 'CLOSED' && w.resolutionDueAt < new Date(),
          createdAt: w.createdAt.toISOString(),
        })),
        nextCursor: rows.length > 40 ? rows[39].disputeId : null,
      };
    });
  }
}
