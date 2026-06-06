import { Injectable, Logger } from '@nestjs/common';
import type {
  AddressSnapshot,
  CreateServiceRequestRequest,
  ListServiceRequestsQuery,
  ServiceRequestDetail,
  ServiceRequestListResponse,
  ServiceRequestSummary,
  ServiceRequestTimelineResponse,
  UpdateServiceRequestRequest,
} from '@homeservicemarketplace/contracts';
import {
  NotificationResourceType,
  NotificationType,
  Prisma,
  ScheduleType,
  ServiceRequestEventType,
  ServiceRequestStatus,
} from '@homeservicemarketplace/database';

// Sprint 7.x — `REQUEST_AVAILABLE` is added to the NotificationType
// enum via the 20260531120000 migration. Until the generated Prisma
// client is regenerated, the runtime `NotificationType` const may not
// yet include the new value (typeof NotificationType.REQUEST_AVAILABLE
// === 'undefined' on the stale client). We reference the literal
// directly + cast to the enum type so the fan-out works the moment
// the migration is applied — regenerate is purely a TS-side concern.
const REQUEST_AVAILABLE: NotificationType =
  (NotificationType as Record<string, NotificationType>).REQUEST_AVAILABLE ??
  ('REQUEST_AVAILABLE' as NotificationType);

import { AddressRepository } from '../../infrastructure/persistence/addresses/address.repository';
import { ProviderProfileRepository } from '../../infrastructure/persistence/bids/provider-profile.repository';
import { ServiceCategoryRepository } from '../../infrastructure/persistence/services/service-category.repository';
import { ServiceRequestRepository } from '../../infrastructure/persistence/requests/service-request.repository';
import { ServiceRequestEventRepository } from '../../infrastructure/persistence/requests/service-request-event.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import type { ServiceRequestWithCategory } from '../../infrastructure/persistence/requests/service-request.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeEventsPublisher } from '../realtime/realtime-events.publisher';

// Default page size when the query carries no explicit limit. Matches
// the upper bound on the addresses module for consistency.
const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class RequestsService {
  private readonly log = new Logger(RequestsService.name);

  constructor(
    private readonly requests: ServiceRequestRepository,
    private readonly events: ServiceRequestEventRepository,
    private readonly addresses: AddressRepository,
    private readonly categories: ServiceCategoryRepository,
    private readonly tx: TransactionRunner,
    // Sprint 7.x — provider fan-out on request create. Post-commit
    // only; a failed fan-out must not roll back the request.
    private readonly providers: ProviderProfileRepository,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeEventsPublisher,
  ) {}

  // ─── list ──────────────────────────────────────────────────────────────────
  async list(
    seekerUserId: string,
    query: ListServiceRequestsQuery,
  ): Promise<ServiceRequestListResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.requests.listForSeeker({
      seekerUserId,
      status: query.status,
      take: take + 1, // fetch one extra to detect a next page
      cursor: query.cursor,
    });
    const items = rows.slice(0, take).map(toSummary);
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  // ─── detail ────────────────────────────────────────────────────────────────
  async detail(seekerUserId: string, requestId: string): Promise<ServiceRequestDetail> {
    const row = await this.requests.findOwned(requestId, seekerUserId);
    if (!row) {
      throw new AppError('NOT_FOUND', 'Request not found.', 404);
    }
    return toSummary(row);
  }

  // ─── create ────────────────────────────────────────────────────────────────
  // Transactional: address validation + snapshot capture + insert + initial
  // timeline event happen atomically. If any step fails the whole thing
  // rolls back, so a request never lives without a REQUEST_CREATED event
  // and never references an address the seeker doesn't own.
  async create(
    seekerUserId: string,
    input: CreateServiceRequestRequest,
  ): Promise<ServiceRequestSummary> {
    this.assertHasService(input.categoryId, input.customServiceText);
    this.assertHasLocation(input.addressId, input.manualAddress);
    this.assertScheduledAtMatchesType(input.scheduleType, input.scheduledAt ?? null);

    const created = await this.tx.run(async (tx) => {
      const categoryId = await this.resolveCategory(input.categoryId ?? null, tx);
      const { addressId, snapshot } = await this.resolveAddress(seekerUserId, input, tx);

      const row = await this.requests.create(
        {
          seekerUserId,
          categoryId,
          customServiceText: input.customServiceText ?? null,
          description: input.description ?? null,
          // Sprint 7.x — pre-uploaded media URLs forwarded verbatim.
          // The DTO already capped the array length + URL shape; no
          // extra service-side validation needed here.
          mediaUrls: input.mediaUrls ?? [],
          scheduleType: input.scheduleType,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          addressId,
          addressSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
      await this.events.create(
        {
          requestId: row.id,
          actorUserId: seekerUserId,
          type: ServiceRequestEventType.REQUEST_CREATED,
        },
        tx,
      );
      return row;
    });

    // Sprint 7.x — fan-out matching-provider notifications POST-COMMIT.
    // Done outside the request-creation tx so:
    //   1. a slow / failing notification path can never block the
    //      seeker from getting their request saved
    //   2. a fan-out failure cannot roll back the request itself
    // Eligibility mirrors the strict rules in AvailableRequestsService
    // so a provider only gets a notification for a request that ALSO
    // surfaces in their feed. See ProviderProfileRepository
    // .listEligibleUserIdsForRequest for the exact filter set.
    await this.fanOutRequestAvailable(created, seekerUserId);

    return toSummary(created);
  }

  // Best-effort fan-out — every failure is logged and swallowed so the
  // seeker-facing create response is never blocked or torn down. Each
  // provider's notification is created in its own transaction
  // (NotificationsService.createForUser default behaviour) so a single
  // failure doesn't poison the rest of the batch.
  private async fanOutRequestAvailable(
    request: ServiceRequestWithCategory,
    seekerUserId: string,
  ): Promise<void> {
    try {
      const snapshot = request.addressSnapshot as unknown as AddressSnapshot;
      // The cityKey on the snapshot is the canonical lowercase-trimmed
      // mirror used by the available-requests feed. Fall back to a
      // computed key from `city` for legacy snapshots that pre-date
      // the cityKey denormalisation.
      const cityKey =
        (snapshot.cityKey && snapshot.cityKey.trim().length > 0
          ? snapshot.cityKey
          : normaliseCityKey(snapshot.city ?? '')) ?? '';
      if (!cityKey) {
        this.log.warn({
          msg: 'request.fanout.skipped_no_city',
          requestId: request.id,
        });
        return;
      }
      const recipients = await this.providers.listEligibleUserIdsForRequest({
        categoryId: request.categoryId,
        cityKey,
        excludeSeekerUserId: seekerUserId,
      });
      if (recipients.length === 0) return;

      const categoryLabel = request.category?.labelEn ?? 'service';
      const deepLink = `/provider/requests/${request.id}`;
      const safeMetadata = {
        requestId: request.id,
        categoryId: request.categoryId,
        city: snapshot.city ?? null,
      };

      for (const { userId } of recipients) {
        // Skip the safety check covered by the repo filter — defensive
        // double-check: never deliver to the seeker's own userId.
        if (!userId || userId === seekerUserId) continue;
        try {
          // Persisted notification → drives the drawer + unread badge.
          // The createForUser path also publishes notification.created
          // on the realtime bus with the actor metadata so the
          // recipient's side-effects bridge fires toast + sound (and
          // a same-account seeker tab is silenced by anti-echo).
          await this.notifications.createForUser({
            userId,
            type: REQUEST_AVAILABLE,
            title: 'New request available',
            body: `A new ${categoryLabel} request matches your profile.`,
            resourceType: NotificationResourceType.REQUEST,
            resourceId: request.id,
            deepLink,
            metadata: safeMetadata,
            actorUserId: seekerUserId,
          });
          // Targeted realtime invalidation event so the provider's
          // available-requests feed refetches immediately. The cache
          // dispatcher (use-realtime-socket.ts) maps `request.available`
          // to invalidate providerQueryKeys.availableRequests.root.
          this.realtime.publishFor(
            userId,
            'request.available',
            { requestId: request.id },
            { actorUserId: seekerUserId },
          );
        } catch (err) {
          // Single-recipient failure must not poison the rest. Log and
          // continue — the notification can also be picked up via the
          // available-requests polling fallback.
          this.log.warn({
            msg: 'request.fanout.recipient_failed',
            requestId: request.id,
            recipientUserId: userId,
            err: String(err),
          });
        }
      }
    } catch (err) {
      // Any failure outside per-recipient handling (e.g. repo query
      // throws) — log and swallow. The request itself is already
      // committed so the seeker's flow is unaffected.
      this.log.warn({
        msg: 'request.fanout.failed',
        requestId: request.id,
        err: String(err),
      });
    }
  }

  // ─── update ────────────────────────────────────────────────────────────────
  // Patches an owned request and emits a REQUEST_UPDATED event carrying
  // the changed field set. Status changes are NOT permitted here — those
  // go through cancel / reopen so the transition stays explicit.
  async update(
    seekerUserId: string,
    requestId: string,
    input: UpdateServiceRequestRequest,
  ): Promise<ServiceRequestDetail> {
    if (input.scheduleType !== undefined || input.scheduledAt !== undefined) {
      this.assertScheduledAtMatchesType(
        input.scheduleType ?? ScheduleType.LATER,
        input.scheduledAt ?? null,
        // When the patch only carries scheduledAt without scheduleType,
        // we don't know the resulting type — the resolveSchedule call
        // below loads the existing row to check.
        true,
      );
    }

    const updated = await this.tx.run(async (tx) => {
      const existing = await this.requests.findOwned(requestId, seekerUserId, tx);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Request not found.', 404);
      }
      // Forbid editing terminal-state requests so the audit trail stays
      // honest. CANCELLED is recoverable via reopen — patching a
      // cancelled record would silently mutate the cancelled state.
      if (existing.status !== ServiceRequestStatus.OPEN_FOR_BIDS) {
        throw new AppError('CONFLICT', 'This request is no longer editable.', 409);
      }

      const data: Record<string, unknown> = {};
      const changedFields: string[] = [];

      if (input.categoryId !== undefined) {
        if (input.categoryId !== null) {
          const resolved = await this.resolveCategory(input.categoryId, tx);
          data.categoryId = resolved;
        } else {
          data.categoryId = null;
        }
        changedFields.push('categoryId');
      }
      if (input.customServiceText !== undefined) {
        data.customServiceText = input.customServiceText;
        changedFields.push('customServiceText');
      }
      if (input.description !== undefined) {
        data.description = input.description;
        changedFields.push('description');
      }
      if (input.scheduleType !== undefined) {
        data.scheduleType = input.scheduleType;
        changedFields.push('scheduleType');
      }
      if (input.scheduledAt !== undefined) {
        data.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
        changedFields.push('scheduledAt');
      }
      if (input.addressId !== undefined || input.manualAddress !== undefined) {
        const resolution = await this.resolveAddress(
          seekerUserId,
          {
            addressId: input.addressId ?? null,
            manualAddress: input.manualAddress ?? null,
          },
          tx,
        );
        data.addressId = resolution.addressId;
        data.addressSnapshot = resolution.snapshot;
        changedFields.push('address');
      }
      // After applying the patch we still need to satisfy the same
      // invariants the create path enforces. Reload the row with the
      // pending changes merged in to validate.
      const merged = { ...existing, ...data } as ServiceRequestWithCategory;
      this.assertHasService(
        (merged.categoryId as string | null) ?? null,
        (merged.customServiceText as string | null) ?? null,
      );
      this.assertScheduledAtMatchesType(
        merged.scheduleType,
        merged.scheduledAt ? merged.scheduledAt.toISOString() : null,
      );

      // No-op patch (every key undefined) → still emit an event? No:
      // skip the event so the timeline stays meaningful.
      if (changedFields.length === 0) {
        return existing;
      }

      const result = await this.requests.updateOwned(requestId, seekerUserId, data, tx);
      if (result.count === 0) {
        // Should be unreachable — we just verified ownership — but
        // defend against a concurrent soft-delete racing the update.
        throw new AppError('NOT_FOUND', 'Request not found.', 404);
      }
      await this.events.create(
        {
          requestId,
          actorUserId: seekerUserId,
          type: ServiceRequestEventType.REQUEST_UPDATED,
          metadata: { changed: changedFields },
        },
        tx,
      );
      const reloaded = await this.requests.findOwned(requestId, seekerUserId, tx);
      if (!reloaded) {
        throw new AppError('NOT_FOUND', 'Request not found.', 404);
      }
      return reloaded;
    });
    return toSummary(updated);
  }

  // ─── cancel ────────────────────────────────────────────────────────────────
  // OPEN_FOR_BIDS → CANCELLED. Idempotent return semantics: re-cancelling
  // an already-CANCELLED request returns 409 so the client knows the
  // transition didn't actually happen. Other terminal-or-active statuses
  // (BID_ACCEPTED / BOOKED / IN_PROGRESS / COMPLETED) are out of scope
  // for this slice; if a future slice introduces them, a request in
  // those states cannot be cancelled here either.
  async cancel(seekerUserId: string, requestId: string): Promise<ServiceRequestDetail> {
    const updated = await this.tx.run(async (tx) => {
      const existing = await this.requests.findOwned(requestId, seekerUserId, tx);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Request not found.', 404);
      }
      if (existing.status === ServiceRequestStatus.CANCELLED) {
        throw new AppError('CONFLICT', 'Request is already cancelled.', 409);
      }
      if (existing.status !== ServiceRequestStatus.OPEN_FOR_BIDS) {
        throw new AppError('CONFLICT', 'This request can no longer be cancelled.', 409);
      }
      const result = await this.requests.setStatusOwned(
        requestId,
        seekerUserId,
        [ServiceRequestStatus.OPEN_FOR_BIDS],
        ServiceRequestStatus.CANCELLED,
        tx,
      );
      if (result.count === 0) {
        throw new AppError('CONFLICT', 'This request can no longer be cancelled.', 409);
      }
      await this.events.create(
        {
          requestId,
          actorUserId: seekerUserId,
          type: ServiceRequestEventType.REQUEST_CANCELLED,
        },
        tx,
      );
      const reloaded = await this.requests.findOwned(requestId, seekerUserId, tx);
      if (!reloaded) {
        throw new AppError('NOT_FOUND', 'Request not found.', 404);
      }
      return reloaded;
    });
    return toSummary(updated);
  }

  // ─── reopen ────────────────────────────────────────────────────────────────
  // CANCELLED → OPEN_FOR_BIDS. Only a cancelled request is reopenable;
  // attempting to reopen anything else returns 409.
  async reopen(seekerUserId: string, requestId: string): Promise<ServiceRequestDetail> {
    const updated = await this.tx.run(async (tx) => {
      const existing = await this.requests.findOwned(requestId, seekerUserId, tx);
      if (!existing) {
        throw new AppError('NOT_FOUND', 'Request not found.', 404);
      }
      if (existing.status !== ServiceRequestStatus.CANCELLED) {
        throw new AppError('CONFLICT', 'Only cancelled requests can be reopened.', 409);
      }
      const result = await this.requests.setStatusOwned(
        requestId,
        seekerUserId,
        [ServiceRequestStatus.CANCELLED],
        ServiceRequestStatus.OPEN_FOR_BIDS,
        tx,
      );
      if (result.count === 0) {
        throw new AppError('CONFLICT', 'Only cancelled requests can be reopened.', 409);
      }
      await this.events.create(
        {
          requestId,
          actorUserId: seekerUserId,
          type: ServiceRequestEventType.REQUEST_REOPENED,
        },
        tx,
      );
      const reloaded = await this.requests.findOwned(requestId, seekerUserId, tx);
      if (!reloaded) {
        throw new AppError('NOT_FOUND', 'Request not found.', 404);
      }
      return reloaded;
    });
    return toSummary(updated);
  }

  // ─── timeline ──────────────────────────────────────────────────────────────
  async timeline(seekerUserId: string, requestId: string): Promise<ServiceRequestTimelineResponse> {
    // Ownership check first — never reveal the existence of someone
    // else's request via a timeline endpoint.
    const owned = await this.requests.findOwned(requestId, seekerUserId);
    if (!owned) {
      throw new AppError('NOT_FOUND', 'Request not found.', 404);
    }
    const rows = await this.events.listForRequest(requestId);
    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  // ─── invariants ────────────────────────────────────────────────────────────
  private assertHasService(
    categoryId: string | null | undefined,
    customServiceText: string | null | undefined,
  ): void {
    const hasCategory = typeof categoryId === 'string' && categoryId.length > 0;
    const hasCustom = typeof customServiceText === 'string' && customServiceText.trim().length > 0;
    if (!hasCategory && !hasCustom) {
      throw new AppError(
        'VALIDATION_ERROR',
        'Either categoryId or customServiceText is required.',
        400,
      );
    }
  }

  private assertHasLocation(
    addressId: string | null | undefined,
    manualAddress: { line1?: string } | null | undefined,
  ): void {
    const hasAddressId = typeof addressId === 'string' && addressId.length > 0;
    const hasManual =
      manualAddress !== null &&
      manualAddress !== undefined &&
      typeof manualAddress.line1 === 'string';
    if (!hasAddressId && !hasManual) {
      throw new AppError('VALIDATION_ERROR', 'Either addressId or manualAddress is required.', 400);
    }
  }

  private assertScheduledAtMatchesType(
    scheduleType: ScheduleType,
    scheduledAt: string | null,
    isPatch = false,
  ): void {
    if (scheduleType === ScheduleType.LATER) {
      if (!scheduledAt && !isPatch) {
        throw new AppError(
          'VALIDATION_ERROR',
          'scheduledAt is required when scheduleType is LATER.',
          400,
        );
      }
    } else if (scheduleType === ScheduleType.ASAP && scheduledAt) {
      throw new AppError(
        'VALIDATION_ERROR',
        'scheduledAt must not be set when scheduleType is ASAP.',
        400,
      );
    }
  }

  // Verify the supplied category exists and is active. Returns the
  // resolved categoryId (echoes the input on success) so the caller
  // can use it directly. Throws VALIDATION_ERROR / NOT_FOUND otherwise.
  private async resolveCategory(
    categoryId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    if (!categoryId) return null;
    const category = await this.categories.findById(categoryId, tx);
    if (!category) {
      throw new AppError('VALIDATION_ERROR', 'Selected category does not exist.', 400);
    }
    if (!category.isActive) {
      throw new AppError('VALIDATION_ERROR', 'Selected category is no longer available.', 400);
    }
    return categoryId;
  }

  // Resolve the address payload into (addressId, addressSnapshot).
  //
  // When `addressId` is supplied, the address is loaded from the DB
  // via the OWNERSHIP-checked finder and snapshotted from the
  // server-side row — any address fields the client also sent are
  // ignored. When only `manualAddress` is supplied, we snapshot the
  // user-typed values directly.
  private async resolveAddress(
    seekerUserId: string,
    input: {
      addressId?: string | null;
      manualAddress?: {
        label?: string | null;
        line1?: string;
        city?: string;
        country?: string | null;
        lat?: number | null;
        lng?: number | null;
      } | null;
    },
    tx: Prisma.TransactionClient,
  ): Promise<{ addressId: string | null; snapshot: AddressSnapshot }> {
    if (input.addressId) {
      const address = await this.addresses.findOwned(input.addressId, seekerUserId, tx);
      if (!address) {
        // Same NOT_FOUND-vs-FORBIDDEN reasoning as the addresses
        // module: don't distinguish ownership from existence.
        throw new AppError('NOT_FOUND', 'Address not found.', 404);
      }
      return {
        addressId: address.id,
        snapshot: {
          label: address.label,
          line1: address.line1,
          city: address.city,
          cityKey: normaliseCityKey(address.city),
          country: address.country,
          lat: address.lat,
          lng: address.lng,
        },
      };
    }
    const m = input.manualAddress;
    if (!m || typeof m.line1 !== 'string' || typeof m.city !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'manualAddress requires line1 and city.', 400);
    }
    return {
      addressId: null,
      snapshot: {
        label: m.label ?? null,
        line1: m.line1,
        city: m.city,
        cityKey: normaliseCityKey(m.city),
        country: m.country ?? '',
        lat: m.lat ?? null,
        lng: m.lng ?? null,
      },
    };
  }
}

/** Lowercase-trimmed key for case-insensitive city matching. Single
 *  source of truth for both the snapshot writer above and the
 *  available-requests filter — keeping it in one place means the two
 *  sides can never drift on what "the same city" means.
 *
 *  Exported so the available-requests service can normalise the
 *  provider's serviceAreaCity exactly the same way before it hits
 *  the repository's JSON-path equality filter on `cityKey`. */
export function normaliseCityKey(city: string): string {
  return city.trim().toLowerCase();
}

// Persistence row → wire DTO. Drops infra-only fields and re-shapes the
// bundled category to the lightweight ref the request views need.
//
// Sprint 7.x — also surfaces the latest live booking's id / status /
// updatedAt onto activeBooking* so the seeker's Active Leads card can
// derive the lifecycle state (e.g. "In Progress") even after a hard
// refresh (the parent ServiceRequest stays at BID_ACCEPTED across
// booking transitions). When no booking exists yet — or the request
// is still OPEN_FOR_BIDS — all three fields are null and the card
// falls back to the request status.
function toSummary(row: ServiceRequestWithCategory): ServiceRequestSummary {
  const snapshot = row.addressSnapshot as unknown as AddressSnapshot;
  const latestBooking = row.bookings && row.bookings.length > 0 ? row.bookings[0] : null;
  return {
    id: row.id,
    status: row.status,
    category: row.category
      ? {
          id: row.category.id,
          slug: row.category.slug,
          labelEn: row.category.labelEn,
          labelAr: row.category.labelAr,
        }
      : null,
    customServiceText: row.customServiceText,
    description: row.description,
    scheduleType: row.scheduleType,
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    addressSnapshot: snapshot,
    // Sprint 7.13 — surface the persisted media so the seeker sees
    // their own photos on request/booking detail after a hard refresh.
    mediaUrls: row.mediaUrls ?? [],
    // Sprint 7.12 — repository's `_count.bids` projection (scoped to
    // non-WITHDRAWN non-deleted bids). Falls back to 0 only for rows
    // that come from finders without the projection — never silently
    // hides bids on the seeker-side surfaces.
    bidsCount: row._count?.bids ?? 0,
    activeBookingId: latestBooking?.id ?? null,
    activeBookingStatus: latestBooking?.status ?? null,
    activeBookingUpdatedAt: latestBooking?.updatedAt ? latestBooking.updatedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
