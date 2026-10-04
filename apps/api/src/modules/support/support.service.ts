import { Injectable } from '@nestjs/common';
import type {
  AdminSupportTicketDetailView,
  AdminSupportTicketSummaryView,
  SendSupportMessageResponse,
  SupportMessageView,
  SupportTicketDetailView,
  SupportTicketSummaryView,
} from '@homeservicemarketplace/contracts';
import { AuditEventType, SupportTicketStatus } from '@homeservicemarketplace/database';
import type { PrismaTx, SupportMessage, SupportTicket } from '@homeservicemarketplace/database';

import {
  SupportRepository,
  isSupportUniqueViolation,
  type AdminSupportTicket,
  type SupportTicketWithMessages,
} from '../../infrastructure/persistence/support/support.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import { AuditService } from '../iam/audit/audit.service';
import { PermissionResolverService } from '../iam/authorization/services/permission-resolver.service';

const SUPPORT_READ = 'support:read';
const SUPPORT_RESPOND = 'support:respond';
const SUBJECT_MAX = 160;
const MESSAGE_MAX = 4000;
const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;

@Injectable()
export class SupportService {
  constructor(
    private readonly repo: SupportRepository,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
    private readonly permissions: PermissionResolverService,
  ) {}

  async createTicket(
    requesterUserId: string,
    input: { subject: string; message: string; idempotencyKey: string },
  ): Promise<{ ticket: SupportTicketDetailView; replayed: boolean }> {
    const subject = normalizeText(input.subject, SUBJECT_MAX, 'A support subject is required.');
    const body = normalizeText(input.message, MESSAGE_MAX, 'A support message is required.');
    const key = normalizeKey(input.idempotencyKey);

    try {
      return await this.tx.run(async (tx) => {
        const existing = await this.repo.findByCreationKey(requesterUserId, key, tx);
        if (existing) return this.replayTicket(existing, subject, body);

        const ticket = await this.repo.createTicket(
          { requesterUserId, subject, creationKey: key },
          tx,
        );
        const message = await this.repo.createMessage(
          {
            ticketId: ticket.id,
            authorUserId: requesterUserId,
            authorRole: 'REQUESTER',
            body,
            idempotencyKey: key,
          },
          tx,
        );
        await this.audit.record(
          {
            type: AuditEventType.SUPPORT_TICKET_CREATED,
            userId: requesterUserId,
            metadata: { supportTicketId: ticket.id, supportMessageId: message.id },
          },
          tx,
        );
        const detail = await this.repo.findOwnedDetail(ticket.id, requesterUserId, tx);
        if (!detail) throw new AppError('INTERNAL_ERROR', 'Failed to reload support ticket.', 500);
        return { ticket: toDetail(detail), replayed: false };
      });
    } catch (error) {
      if (!isSupportUniqueViolation(error, 'creationKey')) throw error;
      const existing = await this.repo.findByCreationKey(requesterUserId, key);
      if (!existing) throw error;
      return this.replayTicket(existing, subject, body);
    }
  }

  async listMine(requesterUserId: string, limit = 25, cursor?: string) {
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.repo.listOwned(requesterUserId, take + 1, cursor);
    const page = rows.slice(0, take);
    return {
      items: page.map(toSummary),
      nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async detailMine(requesterUserId: string, ticketId: string): Promise<SupportTicketDetailView> {
    const row = await this.repo.findOwnedDetail(ticketId, requesterUserId);
    if (!row) throw new AppError('NOT_FOUND', 'Support ticket not found.', 404);
    return toDetail(row);
  }

  sendMine(
    requesterUserId: string,
    ticketId: string,
    input: { body: string; idempotencyKey: string },
  ): Promise<SendSupportMessageResponse> {
    return this.send(requesterUserId, ticketId, input, 'REQUESTER');
  }

  async listAdmin(
    actorUserId: string,
    status: SupportTicketStatus | undefined,
    limit = 25,
    cursor?: string,
  ) {
    await this.requireSupport(actorUserId, SUPPORT_READ);
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.repo.listAdmin(status, take + 1, cursor);
    const page = rows.slice(0, take);
    return {
      items: page.map(
        (row): AdminSupportTicketSummaryView => ({
          ...toSummary(row),
          requester: row.requester,
        }),
      ),
      nextCursor: rows.length > take ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async detailAdmin(actorUserId: string, ticketId: string): Promise<AdminSupportTicketDetailView> {
    await this.requireSupport(actorUserId, SUPPORT_READ);
    const row = await this.repo.findAdminDetail(ticketId);
    if (!row) throw new AppError('NOT_FOUND', 'Support ticket not found.', 404);
    return toAdminDetail(row);
  }

  sendAdmin(
    actorUserId: string,
    ticketId: string,
    input: { body: string; idempotencyKey: string },
  ): Promise<SendSupportMessageResponse> {
    return this.send(actorUserId, ticketId, input, 'SUPPORT');
  }

  closeAdmin(actorUserId: string, ticketId: string): Promise<AdminSupportTicketDetailView> {
    return this.changeStatus(
      actorUserId,
      ticketId,
      SupportTicketStatus.OPEN,
      SupportTicketStatus.CLOSED,
    );
  }

  reopenAdmin(actorUserId: string, ticketId: string): Promise<AdminSupportTicketDetailView> {
    return this.changeStatus(
      actorUserId,
      ticketId,
      SupportTicketStatus.CLOSED,
      SupportTicketStatus.OPEN,
    );
  }

  private async send(
    authorUserId: string,
    ticketId: string,
    input: { body: string; idempotencyKey: string },
    role: 'REQUESTER' | 'SUPPORT',
  ): Promise<SendSupportMessageResponse> {
    const body = normalizeText(input.body, MESSAGE_MAX, 'A support message is required.');
    const key = normalizeKey(input.idempotencyKey);

    try {
      return await this.tx.run(async (tx) => {
        if (role === 'SUPPORT') await this.requireSupport(authorUserId, SUPPORT_RESPOND, tx);
        await this.repo.lock(ticketId, tx);
        const ticket =
          role === 'REQUESTER'
            ? await this.repo.findOwnedDetail(ticketId, authorUserId, tx)
            : await this.repo.findAdminDetail(ticketId, tx);
        if (!ticket) throw new AppError('NOT_FOUND', 'Support ticket not found.', 404);

        // A retry of a send that was stored before the ticket closed replays
        // the stored message; only a genuinely new message is refused.
        const existing = await this.repo.findMessageByKey(ticketId, authorUserId, key, tx);
        if (existing) return replayMessage(existing, body);

        if (ticket.status !== SupportTicketStatus.OPEN) {
          throw new AppError('CONFLICT', 'This support ticket is closed.', 409, {
            reason: 'SUPPORT_TICKET_CLOSED',
          });
        }

        const created = await this.repo.createMessage(
          { ticketId, authorUserId, authorRole: role, body, idempotencyKey: key },
          tx,
        );
        await this.repo.touch(ticketId, tx);
        await this.audit.record(
          {
            type:
              role === 'SUPPORT'
                ? AuditEventType.ADMIN_SUPPORT_REPLIED
                : AuditEventType.SUPPORT_MESSAGE_SENT,
            userId: authorUserId,
            metadata: { supportTicketId: ticketId, supportMessageId: created.id },
          },
          tx,
        );
        return { message: toMessage(created), replayed: false };
      });
    } catch (error) {
      if (!isSupportUniqueViolation(error, 'idempotencyKey')) throw error;
      const existing = await this.repo.findMessageByKey(ticketId, authorUserId, key);
      if (!existing) throw error;
      return replayMessage(existing, body);
    }
  }

  private async changeStatus(
    actorUserId: string,
    ticketId: string,
    from: SupportTicketStatus,
    to: SupportTicketStatus,
  ): Promise<AdminSupportTicketDetailView> {
    await this.tx.run(async (tx) => {
      await this.requireSupport(actorUserId, SUPPORT_RESPOND, tx);
      await this.repo.lock(ticketId, tx);
      const ticket = await this.repo.findAdminDetail(ticketId, tx);
      if (!ticket) throw new AppError('NOT_FOUND', 'Support ticket not found.', 404);
      const changed = await this.repo.setStatus(ticketId, from, to, actorUserId, tx);
      if (changed === 0) {
        throw new AppError(
          'CONFLICT',
          to === SupportTicketStatus.CLOSED
            ? 'This support ticket is already closed.'
            : 'This support ticket is already open.',
          409,
        );
      }
      await this.audit.record(
        {
          type:
            to === SupportTicketStatus.CLOSED
              ? AuditEventType.ADMIN_SUPPORT_CLOSED
              : AuditEventType.ADMIN_SUPPORT_REOPENED,
          userId: actorUserId,
          metadata: { supportTicketId: ticketId, previousStatus: from, newStatus: to },
        },
        tx,
      );
    });
    return this.detailAdmin(actorUserId, ticketId);
  }

  private async requireSupport(actorUserId: string, permission: string, tx?: PrismaTx) {
    const rights = await this.permissions.resolveFreshForUser(actorUserId, tx);
    if (!rights.has(permission)) {
      throw new AppError(
        'FORBIDDEN',
        'You do not have permission to operate support tickets.',
        403,
      );
    }
  }

  private replayTicket(
    existing: SupportTicketWithMessages,
    subject: string,
    body: string,
  ): { ticket: SupportTicketDetailView; replayed: boolean } {
    const first = existing.messages[0];
    if (existing.subject !== subject || !first || first.body !== body) {
      throw new AppError(
        'CONFLICT',
        'This support submission key was already used for different content.',
        409,
        { reason: 'SUPPORT_IDEMPOTENCY_CONFLICT' },
      );
    }
    return { ticket: toDetail(existing), replayed: true };
  }
}

function normalizeText(raw: unknown, max: number, emptyMessage: string): string {
  if (typeof raw !== 'string') throw new AppError('VALIDATION_ERROR', emptyMessage, 400);
  const value = raw.normalize('NFC').trim();
  if (!value) throw new AppError('VALIDATION_ERROR', emptyMessage, 400);
  if ([...value].length > max) {
    throw new AppError('VALIDATION_ERROR', `Text can be up to ${max} characters.`, 400);
  }
  return value;
}

function normalizeKey(raw: unknown): string {
  if (typeof raw !== 'string' || !KEY_RE.test(raw)) {
    throw new AppError('VALIDATION_ERROR', 'A valid support submission key is required.', 400);
  }
  return raw;
}

function replayMessage(existing: SupportMessage, body: string): SendSupportMessageResponse {
  if (existing.body !== body) {
    throw new AppError(
      'CONFLICT',
      'This support submission key was already used for different content.',
      409,
      { reason: 'SUPPORT_IDEMPOTENCY_CONFLICT' },
    );
  }
  return { message: toMessage(existing), replayed: true };
}

function toMessage(row: SupportMessage): SupportMessageView {
  return {
    id: row.id,
    authorRole: row.authorRole,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSummary(row: SupportTicket & { messages?: SupportMessage[] }): SupportTicketSummaryView {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    lastMessageAt: latestMessageAt(row.messages)?.toISOString() ?? null,
  };
}

// List rows carry only their newest message, detail rows every message in
// ascending order; the latest timestamp is correct for both shapes.
function latestMessageAt(messages: SupportMessage[] | undefined): Date | null {
  let latest: Date | null = null;
  for (const message of messages ?? []) {
    if (!latest || message.createdAt > latest) latest = message.createdAt;
  }
  return latest;
}

function toDetail(row: SupportTicketWithMessages): SupportTicketDetailView {
  return { ...toSummary(row), messages: row.messages.map(toMessage) };
}

function toAdminDetail(row: AdminSupportTicket): AdminSupportTicketDetailView {
  return { ...toDetail(row), requester: row.requester };
}
