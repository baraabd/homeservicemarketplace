import { Injectable } from '@nestjs/common';
import type {
  DisputeEvent as DisputeEventDto,
  DisputeMutationResponse,
  DisputeSummary,
  ListAdminDisputesQuery,
  ListAdminDisputesResponse,
  OpenDisputeRequest,
  ResolveDisputeRequest,
  UpdateDisputeRequest,
} from '@homeservicemarketplace/contracts';
import {
  NotificationResourceType,
  NotificationType,
  type AuditEventType,
} from '@homeservicemarketplace/database';

import {
  DisputeRepository,
  type DisputeRow,
} from '../../../infrastructure/persistence/disputes/dispute.repository';
import {
  DisputeEventRepository,
  type DisputeEventRow,
} from '../../../infrastructure/persistence/disputes/dispute-event.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { NotificationsService } from '../../notifications/notifications.service';
import { AdminAuditService } from '../admin-audit.service';

const DEFAULT_PAGE_SIZE = 50;
const DETAIL_EVENTS_LIMIT = 20;

// Sprint 6.3 refined — admin dispute service.
//
// Handles the full workflow: list (with status + priority filters),
// detail (with recentEvents inline), open, update (PATCH — status /
// priority / description), resolve. Every mutation writes:
//   • An AuditEvent row (admin-scoped audit log)
//   • A DisputeEvent row (dispute-scoped timeline w/ before/after)
// State transitions are validated:
//   - resolve only from OPEN / IN_REVIEW
//   - status PATCH cannot move out of a terminal state
@Injectable()
export class AdminDisputesService {
  constructor(
    private readonly disputes: DisputeRepository,
    private readonly events: DisputeEventRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    private readonly tx: TransactionRunner,
  ) {}

  async list(query: ListAdminDisputesQuery): Promise<ListAdminDisputesResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.disputes.list({
      status: query.status,
      priority: query.priority,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items = page.map((r) => toSummary(r));
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async detail(id: string): Promise<DisputeSummary> {
    const row = await this.disputes.findById(id);
    if (!row) throw new AppError('NOT_FOUND', 'Dispute not found.', 404);
    const events = await this.events.listForDispute(id, DETAIL_EVENTS_LIMIT);
    return toSummary(row, events);
  }

  async open(adminUserId: string, input: OpenDisputeRequest): Promise<DisputeMutationResponse> {
    const result = await this.tx.run(async (tx) => {
      const created = await this.disputes.create(
        {
          bookingId: input.bookingId,
          openedById: input.openedById,
          reason: input.reason,
          description: input.description ?? null,
          priority: input.priority,
        },
        tx,
      );
      await this.events.create(
        {
          disputeId: created.id,
          actorUserId: adminUserId,
          type: 'OPENED',
          after: {
            status: created.status,
            priority: created.priority,
            reason: created.reason,
            description: created.description,
          },
        },
        tx,
      );
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_DISPUTE_OPENED' as AuditEventType,
          metadata: {
            disputeId: created.id,
            bookingId: input.bookingId,
            openedById: input.openedById,
            priority: created.priority,
          },
        },
        tx,
      );
      return created;
    });
    return { dispute: toSummary(result) };
  }

  // Sprint 6.3 — PATCH /v1/admin/disputes/:id. Allows updating status,
  // priority, and description in any combination. Each changed field
  // emits its own DisputeEvent row so the timeline reads top-to-bottom
  // as a sequence of single-field transitions.
  async update(
    adminUserId: string,
    disputeId: string,
    input: UpdateDisputeRequest,
  ): Promise<DisputeMutationResponse> {
    if (
      input.status === undefined &&
      input.priority === undefined &&
      input.description === undefined
    ) {
      throw new AppError('VALIDATION_ERROR', 'At least one field must be provided.', 400);
    }
    const result = await this.tx.run(async (tx) => {
      const existing = await this.disputes.findById(disputeId, tx);
      if (!existing) throw new AppError('NOT_FOUND', 'Dispute not found.', 404);
      if (input.status !== undefined && existing.status !== input.status) {
        // Reject moves OUT of a terminal RESOLVED_* / CANCELLED state.
        // Reaching one of those statuses goes through resolve()
        // (which carries the resolution text) — PATCH is for the
        // OPEN ↔ IN_REVIEW transition only.
        const isTerminal = (s: string) =>
          s === 'RESOLVED_REFUND' ||
          s === 'RESOLVED_PARTIAL' ||
          s === 'RESOLVED_DENIED' ||
          s === 'CANCELLED';
        if (isTerminal(existing.status)) {
          throw new AppError(
            'CONFLICT',
            'Dispute is in a terminal state and cannot be reopened.',
            409,
          );
        }
        if (isTerminal(input.status)) {
          throw new AppError(
            'CONFLICT',
            'Use the resolve endpoint to move a dispute into a terminal state.',
            409,
          );
        }
      }
      const updated = await this.disputes.update(
        disputeId,
        {
          status: input.status,
          priority: input.priority,
          description: input.description,
        },
        tx,
      );
      // One DisputeEvent per changed field — keeps the timeline
      // semantically clean (a single "PATCH" can show up as
      // STATUS_CHANGED + PRIORITY_CHANGED side-by-side).
      if (input.status !== undefined && existing.status !== input.status) {
        await this.events.create(
          {
            disputeId,
            actorUserId: adminUserId,
            type: 'STATUS_CHANGED',
            before: { status: existing.status },
            after: { status: updated.status },
          },
          tx,
        );
      }
      if (input.priority !== undefined && existing.priority !== input.priority) {
        await this.events.create(
          {
            disputeId,
            actorUserId: adminUserId,
            type: 'PRIORITY_CHANGED',
            before: { priority: existing.priority },
            after: { priority: updated.priority },
          },
          tx,
        );
      }
      if (input.description !== undefined && existing.description !== input.description) {
        await this.events.create(
          {
            disputeId,
            actorUserId: adminUserId,
            type: 'DESCRIPTION_UPDATED',
            before: { description: existing.description },
            after: { description: updated.description },
          },
          tx,
        );
      }
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_DISPUTE_UPDATED' as AuditEventType,
          metadata: {
            disputeId,
            changes: {
              ...(input.status !== undefined ? { status: input.status } : {}),
              ...(input.priority !== undefined ? { priority: input.priority } : {}),
              ...(input.description !== undefined
                ? { descriptionLength: (input.description ?? '').length }
                : {}),
            },
          },
        },
        tx,
      );
      // Notify the opener when status changes — keeps them in the
      // loop without flooding them on routine priority bumps.
      if (input.status !== undefined && existing.status !== input.status) {
        await this.notifications.createForUser(
          {
            userId: existing.openedById,
            type: NotificationType.SYSTEM,
            title: 'Dispute updated',
            body: `Your dispute is now ${input.status.toLowerCase().replace('_', ' ')}.`,
            resourceType: NotificationResourceType.BOOKING,
            resourceId: existing.bookingId,
            deepLink: `/home/bookings/${existing.bookingId}`,
            metadata: { disputeId, status: input.status },
          },
          tx,
        );
      }
      return updated;
    });
    const events = await this.events.listForDispute(disputeId, DETAIL_EVENTS_LIMIT);
    return { dispute: toSummary(result, events) };
  }

  async resolve(
    adminUserId: string,
    disputeId: string,
    input: ResolveDisputeRequest,
  ): Promise<DisputeMutationResponse> {
    const result = await this.tx.run(async (tx) => {
      const existing = await this.disputes.findById(disputeId, tx);
      if (!existing) throw new AppError('NOT_FOUND', 'Dispute not found.', 404);
      if (existing.status !== 'OPEN' && existing.status !== 'IN_REVIEW') {
        throw new AppError('CONFLICT', 'Dispute is not in a resolvable state.', 409);
      }
      const updated = await this.disputes.resolve(
        disputeId,
        {
          status: input.status,
          resolution: input.resolution,
          resolvedById: adminUserId,
        },
        tx,
      );
      await this.events.create(
        {
          disputeId,
          actorUserId: adminUserId,
          type: 'RESOLVED',
          before: { status: existing.status },
          after: { status: updated.status, resolution: updated.resolution },
          message: input.resolution,
        },
        tx,
      );
      await this.audit.record(
        {
          adminUserId,
          type: 'ADMIN_DISPUTE_RESOLVED' as AuditEventType,
          metadata: {
            disputeId,
            previousStatus: existing.status,
            newStatus: input.status,
            resolution: input.resolution,
          },
        },
        tx,
      );
      await this.notifications.createForUser(
        {
          userId: existing.openedById,
          type: NotificationType.SYSTEM,
          title: 'Dispute resolved',
          body: `Your dispute has been resolved: ${input.status.replace('RESOLVED_', '').toLowerCase()}.`,
          resourceType: NotificationResourceType.BOOKING,
          resourceId: existing.bookingId,
          deepLink: `/home/bookings/${existing.bookingId}`,
          metadata: { disputeId, status: input.status },
        },
        tx,
      );
      return updated;
    });
    const events = await this.events.listForDispute(disputeId, DETAIL_EVENTS_LIMIT);
    return { dispute: toSummary(result, events) };
  }
}

function toSummary(row: DisputeRow, events?: DisputeEventRow[]): DisputeSummary {
  return {
    id: row.id,
    bookingId: row.bookingId,
    openedById: row.openedById,
    status: row.status,
    priority: row.priority,
    reason: row.reason,
    description: row.description,
    resolution: row.resolution,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedById: row.resolvedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(events ? { recentEvents: events.map(toEventDto) } : {}),
  };
}

function toEventDto(row: DisputeEventRow): DisputeEventDto {
  return {
    id: row.id,
    type: row.type,
    actorUserId: row.actorUserId,
    before: row.before,
    after: row.after,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
  };
}
