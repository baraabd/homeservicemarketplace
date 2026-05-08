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
  // Location filter (Sprint 7.x): the caller may supply EITHER a city
  // (cityKey equality on the JSON snapshot — the legacy primitive) OR
  // a `bbox` (lat/lng range on the JSON snapshot — the new primitive
  // that powers the Haversine radius match). When both are supplied we
  // OR them together so requests with no captured lat/lng (legacy rows
  // or seekers who declined geolocation) still surface via the
  // cityKey path while geocoded rows participate in the radius match.
  // When NEITHER is supplied the feed is unscoped by location.
  //
  // The bbox is a CHEAP pre-filter — it returns the circumscribed
  // square around the desired radius, which over-includes corners. The
  // caller MUST follow up with the exact Haversine check on the
  // returned rows (see `available-requests.service.ts`).
  listAvailableForProvider(
    args: {
      excludeSeekerUserId: string | null;
      categoryIds?: string[];
      city?: string;
      bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
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
  ): Promise<ServiceRequestWithCategory[]> {
    const where: Prisma.ServiceRequestWhereInput = {
      status: 'OPEN_FOR_BIDS' as ServiceRequestStatus,
      deletedAt: null,
      ...(args.excludeSeekerUserId ? { seekerUserId: { not: args.excludeSeekerUserId } } : {}),
      ...(args.categoryIds && args.categoryIds.length > 0
        ? { categoryId: { in: args.categoryIds } }
        : {}),
      ...buildLocationFilter(args.city, args.bbox),
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
      include: { category: true },
    });
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
      // Sprint 7.x — bbox-OR-cityKey location match (mirrors
      // listAvailableForProvider). Detail visibility tracks list
      // visibility exactly so a probing provider can't fetch the row
      // by id when the list filter would have hidden it.
      city?: string;
      bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
      excludeBidsByProviderId?: string;
    },
    tx?: PrismaTx,
  ): Promise<ServiceRequestWithCategory | null> {
    return this.db(tx).serviceRequest.findFirst({
      where: {
        id: requestId,
        status: 'OPEN_FOR_BIDS' as ServiceRequestStatus,
        deletedAt: null,
        ...(args.excludeSeekerUserId ? { seekerUserId: { not: args.excludeSeekerUserId } } : {}),
        ...(args.categoryIds && args.categoryIds.length > 0
          ? { categoryId: { in: args.categoryIds } }
          : {}),
        ...buildLocationFilter(args.city, args.bbox),
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

// Build the location half of the available-requests `where` clause.
//
// The provider feed accepts EITHER a normalised cityKey (legacy
// primitive — exact equality on `addressSnapshot.cityKey`) OR a
// bounding box (the new primitive — lat/lng range on
// `addressSnapshot.lat/lng`). Whichever the caller supplies, we OR them
// together so the filter degrades gracefully:
//
//   - Geocoded providers + geocoded requests → bbox match (Haversine
//     post-filter clips the corners in the service layer).
//   - Geocoded providers + un-geocoded requests → cityKey equality
//     keeps the legacy match alive.
//   - Un-geocoded providers → cityKey-only path (legacy behaviour).
//   - Neither side: no location filter (callers are expected to gate
//     this on profile completeness — see available-requests.service.ts).
//
// Prisma's JSON `path` filter on Postgres supports `gte/lte` for
// numeric values, so the bbox lookup runs as four index-friendly JSON
// path comparisons. There's no GIN index on the JSON paths today, so
// at scale this becomes a sequential scan; future work is to
// denormalise lat/lng into top-level columns + add a `(lat, lng)`
// btree (the same pattern the cityKey commit used for the equality
// path).
function buildLocationFilter(
  city: string | undefined,
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number } | undefined,
): Prisma.ServiceRequestWhereInput {
  const cityClause: Prisma.ServiceRequestWhereInput | null = city
    ? {
        addressSnapshot: {
          path: ['cityKey'],
          equals: city,
        },
      }
    : null;

  const bboxClause: Prisma.ServiceRequestWhereInput | null = bbox
    ? {
        AND: [
          { addressSnapshot: { path: ['lat'], gte: bbox.minLat } },
          { addressSnapshot: { path: ['lat'], lte: bbox.maxLat } },
          { addressSnapshot: { path: ['lng'], gte: bbox.minLng } },
          { addressSnapshot: { path: ['lng'], lte: bbox.maxLng } },
        ],
      }
    : null;

  if (cityClause && bboxClause) {
    return { OR: [cityClause, bboxClause] };
  }
  if (bboxClause) return bboxClause;
  if (cityClause) return cityClause;
  return {};
}
