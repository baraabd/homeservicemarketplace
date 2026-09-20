import { Injectable } from '@nestjs/common';
import type { DisputeWorkspace, PrismaTx, Prisma } from '@homeservicemarketplace/database';
import { OutboxRepository } from '../../../infrastructure/outbox/outbox.repository';
import { WORKSPACE_EVENT } from './workspace.policy';

export const PRIVATE_RETENTION_EVENT = 'dispute.private.erased.v1';

@Injectable()
export class WorkspaceEvents {
  constructor(private readonly outbox: OutboxRepository) {}
  async draftErased(
    tx: PrismaTx,
    draftId: string,
    revision: number,
    reasonCode: string,
    now: Date,
  ) {
    const audit = await tx.auditEvent.create({
      data: {
        type: 'DISPUTE_PRIVATE_RETENTION',
        createdAt: now,
        metadata: {
          schemaVersion: 1,
          draftId,
          revision,
          reasonCode,
          actor: 'SYSTEM',
          scope: 'DRAFT_PRIMARY_DATABASE',
        },
      },
    });
    await this.outbox.enqueue(
      {
        aggregateType: 'DisputePrivateDraft',
        aggregateId: draftId,
        eventType: PRIVATE_RETENTION_EVENT,
        dedupeKey: `dispute.private.erased.v1:${draftId}:${revision}`,
        payload: { schemaVersion: 1, auditId: audit.id },
      },
      tx,
    );
  }
  async append(
    tx: PrismaTx,
    workspace: DisputeWorkspace,
    input: {
      actorId: string | null;
      actorRole: string;
      kind: string;
      reasonCode: string;
      facts?: Prisma.InputJsonValue;
      notify?: string[];
    },
  ) {
    const revision = workspace.revision + 1;
    const event = await tx.disputeWorkspaceEvent.create({
      data: {
        disputeId: workspace.disputeId,
        revision,
        actorUserId: input.actorId,
        actorRole: input.actorRole,
        kind: input.kind,
        reasonCode: input.reasonCode,
        policyVersion: workspace.policyVersion,
        facts: input.facts ?? {},
      },
    });
    await tx.disputeWorkspace.update({
      where: { disputeId: workspace.disputeId },
      data: { revision },
    });
    const notificationIds: string[] = [];
    for (const userId of [...new Set(input.notify ?? [])]) {
      const preference = await tx.disputeNotificationPreference.findUnique({ where: { userId } });
      if (preference?.enabled === false) continue;
      const ar = preference?.language === 'ar';
      // No narrative/evidence/identity/decision detail in previews.
      const row = await tx.notification.create({
        data: {
          userId,
          type: 'SYSTEM',
          title: ar ? 'تحديث طلب الدعم' : 'Support case update',
          body: ar
            ? 'افتح طلبات الدعم للاطلاع على التحديث.'
            : 'Open Support cases to view the update.',
          deepLink: `/disputes/${workspace.disputeId}`,
          resourceType: 'DISPUTE',
          resourceId: workspace.disputeId,
          metadata: { purpose: 'DISPUTE_WORKSPACE_V1', disputeId: workspace.disputeId },
        },
      });
      notificationIds.push(row.id);
    }
    await this.outbox.enqueue(
      {
        aggregateType: 'DisputeWorkspace',
        aggregateId: workspace.disputeId,
        eventType: WORKSPACE_EVENT,
        dedupeKey: `dispute.workspace.v1:${event.id}`,
        payload: {
          schemaVersion: 1,
          eventId: event.id,
          disputeId: workspace.disputeId,
          notificationIds,
        },
      },
      tx,
    );
    return revision;
  }
}
