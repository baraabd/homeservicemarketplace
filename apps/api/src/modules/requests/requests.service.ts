import { Injectable } from '@nestjs/common';
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
  Prisma,
  ScheduleType,
  ServiceRequestEventType,
  ServiceRequestStatus,
} from '@homeservicemarketplace/database';

import { AddressRepository } from '../../infrastructure/persistence/addresses/address.repository';
import { ServiceCategoryRepository } from '../../infrastructure/persistence/services/service-category.repository';
import { ServiceRequestRepository } from '../../infrastructure/persistence/requests/service-request.repository';
import { ServiceRequestEventRepository } from '../../infrastructure/persistence/requests/service-request-event.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import type { ServiceRequestWithCategory } from '../../infrastructure/persistence/requests/service-request.repository';

// Default page size when the query carries no explicit limit. Matches
// the upper bound on the addresses module for consistency.
const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class RequestsService {
  constructor(
    private readonly requests: ServiceRequestRepository,
    private readonly events: ServiceRequestEventRepository,
    private readonly addresses: AddressRepository,
    private readonly categories: ServiceCategoryRepository,
    private readonly tx: TransactionRunner,
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
    return toSummary(created);
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
function toSummary(row: ServiceRequestWithCategory): ServiceRequestSummary {
  const snapshot = row.addressSnapshot as unknown as AddressSnapshot;
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
    bidsCount: 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
