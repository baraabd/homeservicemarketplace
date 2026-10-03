import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type PrismaTx,
  type SupportMessage,
  type SupportTicket,
  type SupportTicketStatus,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export type SupportTicketWithMessages = SupportTicket & {
  messages: SupportMessage[];
};

export type AdminSupportTicket = SupportTicketWithMessages & {
  requester: { id: string; email: string; firstName: string; lastName: string };
};

@Injectable()
export class SupportRepository {
  constructor(private readonly prisma: PrismaService) {}

  createTicket(
    input: { requesterUserId: string; subject: string; creationKey: string },
    tx: PrismaTx,
  ): Promise<SupportTicket> {
    return tx.supportTicket.create({ data: input });
  }

  createMessage(
    input: {
      ticketId: string;
      authorUserId: string;
      authorRole: 'REQUESTER' | 'SUPPORT';
      body: string;
      idempotencyKey: string;
    },
    tx: PrismaTx,
  ): Promise<SupportMessage> {
    return tx.supportMessage.create({ data: input });
  }

  findByCreationKey(requesterUserId: string, creationKey: string, tx?: PrismaTx) {
    return (tx ?? this.prisma.client).supportTicket.findUnique({
      where: { requesterUserId_creationKey: { requesterUserId, creationKey } },
      include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    }) as Promise<SupportTicketWithMessages | null>;
  }

  findOwnedDetail(ticketId: string, requesterUserId: string, tx?: PrismaTx) {
    return (tx ?? this.prisma.client).supportTicket.findFirst({
      where: { id: ticketId, requesterUserId },
      include: { messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    }) as Promise<SupportTicketWithMessages | null>;
  }

  findAdminDetail(ticketId: string, tx?: PrismaTx) {
    return (tx ?? this.prisma.client).supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        requester: { select: { id: true, email: true, firstName: true, lastName: true } },
        messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    }) as Promise<AdminSupportTicket | null>;
  }

  listOwned(requesterUserId: string, take: number, cursor?: string) {
    return this.prisma.client.supportTicket.findMany({
      where: { requesterUserId },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { messages: { orderBy: [{ createdAt: 'desc' }], take: 1 } },
    });
  }

  listAdmin(status: SupportTicketStatus | undefined, take: number, cursor?: string) {
    return this.prisma.client.supportTicket.findMany({
      where: status ? { status } : {},
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        requester: { select: { id: true, email: true, firstName: true, lastName: true } },
        messages: { orderBy: [{ createdAt: 'desc' }], take: 1 },
      },
    });
  }

  findMessageByKey(
    ticketId: string,
    authorUserId: string,
    idempotencyKey: string,
    tx?: PrismaTx,
  ) {
    return (tx ?? this.prisma.client).supportMessage.findUnique({
      where: {
        ticketId_authorUserId_idempotencyKey: { ticketId, authorUserId, idempotencyKey },
      },
    });
  }

  async lock(ticketId: string, tx: PrismaTx): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "SupportTicket" WHERE "id" = ${ticketId} FOR UPDATE`;
  }

  touch(ticketId: string, tx: PrismaTx): Promise<SupportTicket> {
    return tx.supportTicket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
  }

  async setStatus(
    ticketId: string,
    from: SupportTicketStatus,
    to: SupportTicketStatus,
    actorUserId: string,
    tx: PrismaTx,
  ): Promise<number> {
    const result = await tx.supportTicket.updateMany({
      where: { id: ticketId, status: from },
      data:
        to === 'CLOSED'
          ? { status: to, closedAt: new Date(), closedByUserId: actorUserId }
          : { status: to, closedAt: null, closedByUserId: null },
    });
    return result.count;
  }
}

export function isSupportUniqueViolation(error: unknown, column: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = (error.meta as { target?: string | string[] } | undefined)?.target;
  const columns = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  return columns.includes(column);
}
