import { Injectable } from '@nestjs/common';
import type {
  Prisma,
  PrismaTx,
  ScheduleType,
  ServiceCategory,
  ServiceRequest,
  ServiceRequestStatus,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateServiceRequestInput {
  seekerUserId: string;
  categoryId: string | null;
  customServiceText: string | null;
  description: string | null;
  scheduleType: ScheduleType;
  scheduledAt: Date | null;
  addressId: string | null;
  addressSnapshot: Prisma.InputJsonValue;
}

export interface UpdateServiceRequestInput {
  categoryId?: string | null;
  customServiceText?: string | null;
  description?: string | null;
  scheduleType?: ScheduleType;
  scheduledAt?: Date | null;
  addressId?: string | null;
  addressSnapshot?: Prisma.InputJsonValue;
}

// Row shape returned by the listing/detail finders. Includes the
// related ServiceCategory because the response DTO needs the category
// labels and we'd rather pay one join than N+1 lookups in the service.
export type ServiceRequestWithCategory = ServiceRequest & {
  category: ServiceCategory | null;
};

// Service-request persistence. Every read site filters `deletedAt: null`
// so soft-deleted rows never escape the repository. Mutating call sites
// match on { id, seekerUserId, deletedAt: null } so a foreign id from
// one user can never touch another user's row.
@Injectable()
export class ServiceRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  listForSeeker(
    args: { seekerUserId: string; status?: ServiceRequestStatus; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<ServiceRequestWithCategory[]> {
    const where: Prisma.ServiceRequestWhereInput = {
      seekerUserId: args.seekerUserId,
      deletedAt: null,
      ...(args.status ? { status: args.status } : {}),
    };
    return this.db(tx).serviceRequest.findMany({
      where,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      // Compound order: createdAt DESC plus id DESC tie-breaker so
      // cursor-by-id is deterministic even when two rows share a
      // createdAt — without the secondary key, cursor pagination can
      // skip or duplicate rows.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { category: true },
    });
  }

  // Provider-side feed. Returns only OPEN_FOR_BIDS rows, scoped away
  // from the calling provider's own seeker user (a provider who is
  // also a seeker should not see their own request in the feed) and
  // away from soft-deleted rows.
  //
  // `categoryIds`, when non-empty, restricts results to those
  // categories (used for the provider's own configured skills, or for
  // an explicit categoryId filter from the query string). When empty,
  // the feed is global.
  //
  // `city`, when set, filters by the request's snapshotted city. The
  // snapshot is JSON, so we use Prisma's `path` filter on the
  // `addressSnapshot` column, equality + case-insensitive.
  listAvailableForProvider(
    args: {
      excludeSeekerUserId: string | null;
      categoryIds?: string[];
      city?: string;
      take: number;
      cursor?: string;
    },
    tx?: PrismaTx,
  ): Promise<ServiceRequestWithCategory[]> {
    const where: Prisma.ServiceRequestWhereInput = {
      status: 'OPEN_FOR_BIDS' as ServiceRequestStatus,
      deletedAt: null,
      ...(args.excludeSeekerUserId ? { seekerUserId: { not: args.excludeSeekerUserId } } : {}),
      ...(args.categoryIds && args.categoryIds.length > 0
        ? { categoryId: { in: args.categoryIds } }
        : {}),
      ...(args.city
        ? {
            // Postgres JSON `path` lookup, equals match against the
            // snapshotted city. Case-insensitive at the SQL level via
            // mode: 'insensitive' on `string_contains`-style filters
            // would be ideal but Prisma JSON filters do not support
            // mode — keep this as exact-match and document.
            addressSnapshot: {
              path: ['city'],
              equals: args.city,
            },
          }
        : {}),
    };
    return this.db(tx).serviceRequest.findMany({
      where,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { category: true },
    });
  }

  // Returns the row only when it belongs to the given seeker AND is not
  // soft-deleted. Used at every ownership-checked call site.
  findOwned(
    requestId: string,
    seekerUserId: string,
    tx?: PrismaTx,
  ): Promise<ServiceRequestWithCategory | null> {
    return this.db(tx).serviceRequest.findFirst({
      where: { id: requestId, seekerUserId, deletedAt: null },
      include: { category: true },
    });
  }

  // Plain non-ownership-scoped finder. Used on the provider side
  // where the caller is NOT the seeker (submit-bid). Soft-deleted
  // rows are still filtered out. Callers must enforce their own
  // authorisation rule on the returned row.
  findById(requestId: string, tx?: PrismaTx): Promise<ServiceRequestWithCategory | null> {
    return this.db(tx).serviceRequest.findFirst({
      where: { id: requestId, deletedAt: null },
      include: { category: true },
    });
  }

  create(input: CreateServiceRequestInput, tx?: PrismaTx): Promise<ServiceRequestWithCategory> {
    return this.db(tx).serviceRequest.create({
      data: {
        seekerUserId: input.seekerUserId,
        categoryId: input.categoryId,
        customServiceText: input.customServiceText,
        description: input.description,
        scheduleType: input.scheduleType,
        scheduledAt: input.scheduledAt,
        addressId: input.addressId,
        addressSnapshot: input.addressSnapshot,
      },
      include: { category: true },
    });
  }

  // Updates only when the row is owned and not soft-deleted; the
  // composite where prevents cross-user mutation even if the caller
  // passes a foreign id.
  updateOwned(
    requestId: string,
    seekerUserId: string,
    input: UpdateServiceRequestInput,
    tx?: PrismaTx,
  ): Promise<Prisma.BatchPayload> {
    return this.db(tx).serviceRequest.updateMany({
      where: { id: requestId, seekerUserId, deletedAt: null },
      data: input,
    });
  }

  // Status transition helper used by cancel/reopen. Only applies the
  // transition when the row is in one of the expected `from` states —
  // an unexpected status returns count: 0, which the service maps to
  // a CONFLICT response.
  setStatusOwned(
    requestId: string,
    seekerUserId: string,
    from: ServiceRequestStatus[],
    to: ServiceRequestStatus,
    tx?: PrismaTx,
  ): Promise<Prisma.BatchPayload> {
    return this.db(tx).serviceRequest.updateMany({
      where: {
        id: requestId,
        seekerUserId,
        deletedAt: null,
        status: { in: from },
      },
      data: { status: to },
    });
  }
}
