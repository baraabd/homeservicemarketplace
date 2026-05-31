import { Injectable } from '@nestjs/common';
import type {
  BookingStatus,
  Prisma,
  PrismaTx,
  ScheduleType,
  ServiceCategory,
  ServiceRequest,
  ServiceRequestStatus,
  User,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Sprint 7.4 — privacy-safe seeker projection eager-loaded for the
// provider available-requests feed. ONLY first + last name are
// selected so the mapper can build the public label ("Layla M.")
// without ever touching email / phone / status / MFA fields. Even a
// careless future mapper change cannot leak PII because those fields
// never reach the application layer.
export type ServiceRequestSeekerPreview = Pick<User, 'id' | 'firstName' | 'lastName'>;

export interface CreateServiceRequestInput {
  seekerUserId: string;
  categoryId: string | null;
  customServiceText: string | null;
  description: string | null;
  /** Sprint 7.x — pre-uploaded media URLs forwarded verbatim from the
   *  seeker's create-request payload. Empty array when the seeker
   *  attached no media; the column has `@default([])` so omitting it
   *  is also safe. */
  mediaUrls?: string[];
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
//
// Sprint 7.x — seeker-side reads also eager-load the LATEST live
// booking row (one row max; ordered by updatedAt desc) so the wire
// DTO can surface activeBookingStatus + activeBookingUpdatedAt.
// Without this, Active Leads cards stay visually stuck at
// "Pro Assigned" (BID_ACCEPTED) after the provider transitions the
// booking to IN_PROGRESS / COMPLETED / CANCELLED, because the
// parent ServiceRequest.status intentionally never changes across
// booking lifecycle.
export type ServiceRequestWithCategory = ServiceRequest & {
  category: ServiceCategory | null;
  // OPTIONAL — only populated by the seeker finders (listForSeeker /
  // findOwned). Provider-side finders don't include it.
  bookings?: { id: string; status: BookingStatus; updatedAt: Date }[];
};

// Provider-feed row shape — adds the privacy-safe seeker preview on
// top of the seeker-side projection. Used ONLY by
// listAvailableForProvider / findAvailableForProvider; the seeker-
// side surfaces do NOT need the seeker join because the row belongs
// to them.
export type ServiceRequestForProvider = ServiceRequestWithCategory & {
  seeker: ServiceRequestSeekerPreview;
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
      include: {
        category: true,
        // Sprint 7.x — latest non-deleted booking, projected narrowly
        // (id / status / updatedAt only). The service maps this onto
        // ServiceRequestSummary.activeBooking* so the seeker's Active
        // Leads carousel renders the booking lifecycle status (e.g.
        // "In Progress") even though the parent ServiceRequest stays
        // at BID_ACCEPTED across the booking transitions.
        bookings: {
          where: { deletedAt: null },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true, status: true, updatedAt: true },
        },
      },
    }) as Promise<ServiceRequestWithCategory[]>;
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
      // Sprint 5.2 (canonical): when set, hide every request the
      // calling provider has already submitted a non-WITHDRAWN bid
      // on. Implemented via the relational `bids: { none: ... }`
      // filter so the SQL stays one round-trip — a single LEFT JOIN
      // + correlated NOT EXISTS plan from Postgres.
      excludeBidsByProviderId?: string;
    },
    tx?: PrismaTx,
  ): Promise<ServiceRequestForProvider[]> {
    const where: Prisma.ServiceRequestWhereInput = {
      status: 'OPEN_FOR_BIDS' as ServiceRequestStatus,
      deletedAt: null,
      ...(args.excludeSeekerUserId ? { seekerUserId: { not: args.excludeSeekerUserId } } : {}),
      ...(args.categoryIds && args.categoryIds.length > 0
        ? { categoryId: { in: args.categoryIds } }
        : {}),
      ...(args.city
        ? {
            // Postgres JSON `path` lookup against the snapshotted
            // `cityKey` — a denormalised lowercase-trimmed mirror of
            // the original city, written by requests.service.ts
            // alongside `city`. Filtering on `cityKey` means we get
            // case-insensitive equality (e.g. "Aleppo" matches
            // "aleppo" matches "ALEPPO") without losing the original
            // casing for display, and without the false-positive
            // risk of `string_contains: insensitive` (e.g. "York"
            // would match "New York"). Caller MUST pass an
            // already-normalised value — see normaliseCityKey() in
            // requests.service.ts.
            addressSnapshot: {
              path: ['cityKey'],
              equals: args.city,
            },
          }
        : {}),
      ...(args.excludeBidsByProviderId
        ? {
            bids: {
              none: {
                providerId: args.excludeBidsByProviderId,
                deletedAt: null,
                status: { not: 'WITHDRAWN' },
              },
            },
          }
        : {}),
    };
    return this.db(tx).serviceRequest.findMany({
      where,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        category: true,
        // Sprint 7.4 — narrow projection: id + first + last only. Email /
        // phone / status / MFA cannot reach the mapper.
        seeker: { select: { id: true, firstName: true, lastName: true } },
      },
    }) as Promise<ServiceRequestForProvider[]>;
  }

  // Sprint 5.2 (canonical): single-row variant of the above. Returns
  // a non-deleted, OPEN_FOR_BIDS request only when it passes the
  // same per-provider visibility rules. Used by the detail endpoint
  // — invisible rows surface as null and the service maps that to
  // 404, identical to "doesn't exist".
  findAvailableForProvider(
    requestId: string,
    args: {
      excludeSeekerUserId: string | null;
      categoryIds?: string[];
      // Sprint 7.x — strict city match (mirrors listAvailableForProvider).
      city?: string;
      excludeBidsByProviderId?: string;
    },
    tx?: PrismaTx,
  ): Promise<ServiceRequestForProvider | null> {
    return this.db(tx).serviceRequest.findFirst({
      where: {
        id: requestId,
        status: 'OPEN_FOR_BIDS' as ServiceRequestStatus,
        deletedAt: null,
        ...(args.excludeSeekerUserId ? { seekerUserId: { not: args.excludeSeekerUserId } } : {}),
        ...(args.categoryIds && args.categoryIds.length > 0
          ? { categoryId: { in: args.categoryIds } }
          : {}),
        ...(args.city
          ? {
              addressSnapshot: {
                // Same case-insensitive contract as
                // listAvailableForProvider — caller normalises via
                // normaliseCityKey() and we filter on the denormalised
                // lowercase-trimmed `cityKey` field of the snapshot.
                path: ['cityKey'],
                equals: args.city,
              },
            }
          : {}),
        ...(args.excludeBidsByProviderId
          ? {
              bids: {
                none: {
                  providerId: args.excludeBidsByProviderId,
                  deletedAt: null,
                  status: { not: 'WITHDRAWN' },
                },
              },
            }
          : {}),
      },
      include: {
        category: true,
        // Same narrow projection as the list variant.
        seeker: { select: { id: true, firstName: true, lastName: true } },
      },
    }) as Promise<ServiceRequestForProvider | null>;
  }

  // Returns the row only when it belongs to the given seeker AND is not
  // soft-deleted. Used at every ownership-checked call site.
  //
  // Sprint 7.x — also includes the latest live booking for the
  // ServiceRequestSummary.activeBooking* mapping. Identical to the
  // listForSeeker include block so the wire DTO is uniform across
  // list + detail (Active Leads card → detail overlay both see the
  // same status without the second fetch returning stale data).
  findOwned(
    requestId: string,
    seekerUserId: string,
    tx?: PrismaTx,
  ): Promise<ServiceRequestWithCategory | null> {
    return this.db(tx).serviceRequest.findFirst({
      where: { id: requestId, seekerUserId, deletedAt: null },
      include: {
        category: true,
        bookings: {
          where: { deletedAt: null },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true, status: true, updatedAt: true },
        },
      },
    }) as Promise<ServiceRequestWithCategory | null>;
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
        // Empty array when the seeker attached nothing — same shape
        // the column's default produces, but explicit so a future
        // schema change doesn't silently flip the wire behaviour.
        mediaUrls: input.mediaUrls ?? [],
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
