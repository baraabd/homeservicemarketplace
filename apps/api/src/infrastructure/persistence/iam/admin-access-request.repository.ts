import { Injectable } from '@nestjs/common';
import type {
  AdminAccessRequest,
  AdminAccessRequestStatus,
  PrismaTx,
  User,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Phase 4 — persistence for the admin ACCESS-REQUEST axis.
//
// Every read that a reviewer sees pulls the applicant through the relation, so
// the review screen can show the three axes (account status, roles, request
// status) side by side without a second query per row.

export type AdminAccessRequestWithApplicant = AdminAccessRequest & {
  user: Pick<
    User,
    'id' | 'email' | 'firstName' | 'lastName' | 'status' | 'isActive' | 'emailVerifiedAt'
  > & {
    userRoles: Array<{ role: { name: string } }>;
  };
};

const APPLICANT_SELECT = {
  select: {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    status: true,
    isActive: true,
    emailVerifiedAt: true,
    userRoles: { select: { role: { select: { name: true } } } },
  },
} as const;

@Injectable()
export class AdminAccessRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  create(
    input: { userId: string; justification: string | null },
    tx?: PrismaTx,
  ): Promise<AdminAccessRequest> {
    return this.db(tx).adminAccessRequest.create({
      data: { userId: input.userId, justification: input.justification },
    });
  }

  findById(id: string, tx?: PrismaTx): Promise<AdminAccessRequestWithApplicant | null> {
    return this.db(tx).adminAccessRequest.findUnique({
      where: { id },
      include: { user: APPLICANT_SELECT },
    }) as Promise<AdminAccessRequestWithApplicant | null>;
  }

  // The one-pending-per-user rule. Prisma has no partial unique index, and a
  // strict unique on userId would block a legitimate re-application after a
  // rejection, so uniqueness is enforced in the service — inside the same
  // transaction that inserts, using this read.
  findPendingByUserId(userId: string, tx?: PrismaTx): Promise<AdminAccessRequest | null> {
    return this.db(tx).adminAccessRequest.findFirst({
      where: { userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
  }

  findLatestByUserId(userId: string, tx?: PrismaTx): Promise<AdminAccessRequest | null> {
    return this.db(tx).adminAccessRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Atomic decision write. Scoped to `status: 'PENDING'` so two reviewers
  // racing on the same request produce exactly one winner — the loser sees
  // count 0 and is told the request was already decided, rather than silently
  // overwriting the first decision.
  async decideIfPending(
    id: string,
    input: {
      status: Extract<AdminAccessRequestStatus, 'APPROVED' | 'REJECTED' | 'CANCELLED'>;
      decidedByUserId: string | null;
      decisionNote: string | null;
    },
    tx?: PrismaTx,
  ): Promise<number> {
    const result = await this.db(tx).adminAccessRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: input.status,
        decidedByUserId: input.decidedByUserId,
        decisionNote: input.decisionNote,
        decidedAt: new Date(),
      },
    });
    return result.count;
  }

  listForReview(
    params: { status?: AdminAccessRequestStatus; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<AdminAccessRequestWithApplicant[]> {
    return this.db(tx).adminAccessRequest.findMany({
      where: params.status ? { status: params.status } : {},
      include: { user: APPLICANT_SELECT },
      // Oldest first: a review queue should drain in the order people applied,
      // not surface the newest applicant repeatedly.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: params.take,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }) as Promise<AdminAccessRequestWithApplicant[]>;
  }
}
