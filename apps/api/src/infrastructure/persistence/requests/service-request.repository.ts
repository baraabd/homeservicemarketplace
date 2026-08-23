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

import {
  normaliseCityKey,
  usesRadiusMatching,
  type ServiceArea,
} from '../../../shared/geo/service-area';
import {
  BOX_OVERSELECT_FACTOR,
  filterByExactRadius,
  serviceAreaWhere,
} from '../../../shared/geo/service-area.sql';

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
  // Sprint 7.12 — Prisma `_count` projection. The seeker finders
  // request `_count.bids` with a relational `where` so the wire DTO
  // can expose `bidsCount` (drives the Active Leads "X bids" label)
  // without N+1. Provider-side finders skip this projection — the
  // provider feed has its own bid filter.
  _count?: { bids: number };
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
        // Sprint 7.12 — relational bid count, scoped to non-WITHDRAWN
        // non-deleted bids so the UI label matches the "visible bids"
        // the seeker actually sees in BidsScreen. One extra Postgres
        // aggregate per row, no application-side join.
        _count: {
          select: {
            bids: {
              where: { deletedAt: null, status: { not: 'WITHDRAWN' } },
            },
          },
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
  async listAvailableForProvider(
    args: {
      excludeSeekerUserId: string | null;
      categoryIds?: string[];
      // Sprint 6 — the provider's service area replaces the bare `city`
      // string. The predicate lives in shared/geo so list, detail, and
      // fan-out cannot drift; see docs/adr/0003-service-area-geo-strategy.md.
      serviceArea: ServiceArea;
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
    // A null fragment means the area constrains NOTHING — an unonboarded
    // provider with neither a city nor a service-area centre. That must be an
    // empty feed, never an unfiltered one: omitting the clause would hand
    // them the global request list.
    const geoWhere = serviceAreaWhere(args.serviceArea);
    if (!geoWhere) return Promise.resolve([]);

    const where: Prisma.ServiceRequestWhereInput = {
      status: 'OPEN_FOR_BIDS' as ServiceRequestStatus,
      deletedAt: null,
      ...(args.excludeSeekerUserId ? { seekerUserId: { not: args.excludeSeekerUserId } } : {}),
      ...(args.categoryIds && args.categoryIds.length > 0
        ? { categoryId: { in: args.categoryIds } }
        : {}),
      // Sprint 6 — service-area predicate over the PROMOTED columns.
      //
      // This replaced `addressSnapshot: { path: ['cityKey'], equals }`, a
      // JSON-path equality that no index can serve: every feed page was a
      // sequential scan of ServiceRequest. `locationCityKey` /
      // `locationLat` / `locationLng` are real columns with composite
      // indexes behind them, and the same fragment expresses both the
      // city-equality fallback and the bounding-box radius filter.
      ...(geoWhere ?? {}),
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
    // Over-fetch before the exact-radius pass.
    //
    // The bounding box is a square around a circle, so it admits up to
    // 4/π ≈ 27% more rows than actually match, and `filterByExactRadius`
    // drops them. Taking exactly `take` rows here would return a short page
    // whenever any corner row was selected — and a short page is read by the
    // cursor pager as "end of feed", silently truncating the provider's
    // results. Ask for the corners too, then trim.
    const overFetch = usesRadiusMatching(args.serviceArea)
      ? Math.ceil(args.take * BOX_OVERSELECT_FACTOR) + 1
      : args.take;

    const rows = (await this.db(tx).serviceRequest.findMany({
      where,
      take: overFetch,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        category: true,
        // Sprint 7.4 — narrow projection: id + first + last only. Email /
        // phone / status / MFA cannot reach the mapper.
        seeker: { select: { id: true, firstName: true, lastName: true } },
      },
    })) as ServiceRequestForProvider[];

    // Exact Haversine over the box survivors. Sound in this direction only:
    // the SQL is a strict superset of the circle, so this can remove false
    // positives but can never invent or hide a true match.
    return filterByExactRadius(args.serviceArea, rows, toRequestPoint).slice(0, args.take);
  }

  // Sprint 5.2 (canonical): single-row variant of the above. Returns
  // a non-deleted, OPEN_FOR_BIDS request only when it passes the
  // same per-provider visibility rules. Used by the detail endpoint
  // — invisible rows surface as null and the service maps that to
  // 404, identical to "doesn't exist".
  async findAvailableForProvider(
    requestId: string,
    args: {
      excludeSeekerUserId: string | null;
      categoryIds?: string[];
      // Sprint 6 — the SAME service-area predicate the list uses. Detail
      // visibility and list visibility must be one rule: a request the feed
      // hides but the detail endpoint serves is an access-control hole that
      // an id guess walks straight through.
      serviceArea: ServiceArea;
      excludeBidsByProviderId?: string;
    },
    tx?: PrismaTx,
  ): Promise<ServiceRequestForProvider | null> {
    const geoWhere = serviceAreaWhere(args.serviceArea);
    // Constrains nothing → sees nothing. Same rule as the list.
    if (!geoWhere) return null;

    const row = (await this.db(tx).serviceRequest.findFirst({
      where: {
        id: requestId,
        status: 'OPEN_FOR_BIDS' as ServiceRequestStatus,
        deletedAt: null,
        ...(args.excludeSeekerUserId ? { seekerUserId: { not: args.excludeSeekerUserId } } : {}),
        ...(args.categoryIds && args.categoryIds.length > 0
          ? { categoryId: { in: args.categoryIds } }
          : {}),
        ...geoWhere,
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
    })) as ServiceRequestForProvider | null;

    if (!row) return null;
    // The bounding box admits the square's corners; the list trims them and so
    // must this. Without it a provider could open a request that their own
    // feed correctly refuses to show.
    return filterByExactRadius(args.serviceArea, [row], toRequestPoint)[0] ?? null;
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
        // Sprint 7.12 — same bidsCount projection as the list path so
        // detail + summary stay in lockstep on a hard refresh.
        _count: {
          select: {
            bids: {
              where: { deletedAt: null, status: { not: 'WITHDRAWN' } },
            },
          },
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
        // Sprint 6 — the queryable mirror, derived HERE rather than by the
        // caller. One writer means the columns cannot drift from the snapshot
        // because some future call site forgot to set them.
        ...deriveLocationColumns(input.addressSnapshot),
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
      data: {
        ...input,
        // Re-derive whenever the address changes. Editing a request's address
        // without updating the promoted columns would leave it matching its
        // OLD location — the failure would look like a geo bug rather than a
        // missing write.
        ...(input.addressSnapshot !== undefined
          ? deriveLocationColumns(input.addressSnapshot)
          : {}),
      },
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

// Sprint 6 — persistence row → the shape the geo predicate speaks.
//
// One place that knows the promoted columns are called locationLat/locationLng,
// so shared/geo stays free of persistence naming and the two exact-radius call
// sites (list and detail) cannot project differently.
function toRequestPoint(row: { locationLat: number | null; locationLng: number | null }): {
  lat: number | null;
  lng: number | null;
} {
  return { lat: row.locationLat, lng: row.locationLng };
}

/** Snapshot JSON → the three promoted, indexable columns.
 *
 *  Mirrors the SQL backfill in the Sprint 6 migration exactly: same
 *  normalisation (btrim + lower), same cityKey-then-city preference, same
 *  range validation. If these two ever disagree, rows written before and
 *  after the migration match differently — a bug with no visible symptom
 *  except a feed that is subtly wrong for old data.
 *
 *  Invalid coordinates land as NULL rather than as a stored bad value: the
 *  predicate reads NULL as "unknown location" and falls back to city, which
 *  is the safe direction. */
function deriveLocationColumns(snapshot: Prisma.InputJsonValue): {
  locationCityKey: string | null;
  locationLat: number | null;
  locationLng: number | null;
} {
  const snap = (snapshot ?? {}) as {
    city?: unknown;
    cityKey?: unknown;
    lat?: unknown;
    lng?: unknown;
  };

  const rawCity =
    typeof snap.cityKey === 'string' && snap.cityKey.trim() !== ''
      ? snap.cityKey
      : typeof snap.city === 'string'
        ? snap.city
        : null;

  const lat = typeof snap.lat === 'number' && Number.isFinite(snap.lat) ? snap.lat : null;
  const lng = typeof snap.lng === 'number' && Number.isFinite(snap.lng) ? snap.lng : null;
  const coordsUsable = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  return {
    locationCityKey: normaliseCityKey(rawCity),
    // Both or neither: a half-known coordinate is not a location, and storing
    // one of the pair would make `locationLat IS NOT NULL` lie.
    locationLat: coordsUsable ? lat : null,
    locationLng: coordsUsable ? lng : null,
  };
}
