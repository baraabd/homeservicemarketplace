import { Injectable, Logger } from '@nestjs/common';
import { ProviderCapability } from '@homeservicemarketplace/contracts';
import {
  NotificationResourceType,
  NotificationType,
  ServiceRequestStatus,
  type OutboxEvent,
  type Prisma,
  type PrismaTx,
} from '@homeservicemarketplace/database';

import { AppConfigService } from '../../../config/app-config.service';
import type {
  OutboxHandler,
  OutboxHandlerResult,
} from '../../../infrastructure/outbox/outbox.handler';
import { OutboxEventType } from '../../../infrastructure/outbox/outbox.tokens';
import { OutboxRepository } from '../../../infrastructure/outbox/outbox.repository';
import { NotificationRepository } from '../../../infrastructure/persistence/notifications/notification.repository';
import { ServiceRequestRepository } from '../../../infrastructure/persistence/requests/service-request.repository';
import { BidRepository } from '../../../infrastructure/persistence/bids/bid.repository';
import {
  ProviderProfileRepository,
  type EligibleRecipient,
} from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { matchServiceArea, type RequestLocation } from '../../../shared/geo/service-area';
import { ProviderCapabilityService } from '../../provider/capability/provider-capability.service';
import { RealtimeEventsPublisher } from '../../realtime/realtime-events.publisher';

/** Payload of `request.available`, written by RequestsService inside the
 *  request-creation transaction.
 *
 *  Matching fields are a creation snapshot, but R07 also checks the live row
 *  before delivery. A delayed worker therefore never advertises a request that
 *  has already been cancelled or accepted. */
export interface RequestAvailablePayload {
  requestId: string;
  seekerUserId: string;
  categoryId: string | null;
  categoryLabel: string;
  city: string | null;
  cityKey: string | null;
  lat: number | null;
  lng: number | null;
}

/** Payload of one fan-out slice. */
export interface RequestAvailableBatchPayload extends RequestAvailablePayload {
  recipientUserIds: string[];
  batchIndex: number;
}

// `REQUEST_AVAILABLE` post-dates some generated clients; resolve it at runtime
// so a stale client cannot break the build. (Carried over from the previous
// in-request fan-out for the same reason.)
const REQUEST_AVAILABLE: NotificationType =
  (NotificationType as Record<string, NotificationType>).REQUEST_AVAILABLE ??
  ('REQUEST_AVAILABLE' as NotificationType);

// ─────────────────────────────────────────────────────────────────────────
// R17-E closure (E-13) — who may be told about a request.
//
// The invariant: a provider is notified only if, at that moment, the canonical
// provider surface would let them open the request — VIEW_MARKETPLACE (the
// guard on /v1/provider/available-requests and its detail route), one of their
// own categories, their service area, not their own request. The notification
// may be narrower than the feed; it must never be broader.
//
// Both stages use this one class. The SQL reads a SUPERSET (geo box, category,
// and the capability service's candidate predicate on indexed columns); every
// row is then decided exactly — the feed's geo function, and the capability
// precedence table through one bulk read per page. Before, the query read the
// legacy `status = 'ACTIVE'` column and nothing else: a suspended account, a
// RESTRICTED or unverified provider and one without a live grant were all
// notified about work the feed refused them.
// ─────────────────────────────────────────────────────────────────────────
@Injectable()
export class RequestAvailableAudience {
  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly capabilities: ProviderCapabilityService,
  ) {}

  /** One keyset page of candidates (a superset; see `decide`). */
  candidates(
    args: {
      categoryId: string;
      location: RequestLocation;
      excludeSeekerUserId: string;
      take: number;
      cursorId?: string;
      onlyUserIds?: readonly string[];
    },
    tx: PrismaTx,
  ): Promise<EligibleRecipient[]> {
    return this.providers.listEligibleRecipientsPage(
      { ...args, authority: this.capabilities.marketplaceCandidateWhere() },
      tx,
    );
  }

  /** The candidates who may open the request now, in page order. */
  async decide(
    page: readonly EligibleRecipient[],
    location: RequestLocation,
    seekerUserId: string,
    tx: PrismaTx,
  ): Promise<EligibleRecipient[]> {
    // The SQL cannot evaluate each provider's own radius: this is the same
    // function the feed uses (shared/geo/service-area).
    const inArea = page.filter(
      (provider) =>
        // Defensive: the query already excludes the seeker and null userIds.
        provider.userId !== null &&
        provider.userId !== seekerUserId &&
        matchServiceArea(
          {
            lat: provider.serviceAreaLat,
            lng: provider.serviceAreaLng,
            radiusKm: provider.serviceAreaRadiusKm,
            cityKey: provider.serviceAreaCityKey,
          },
          location,
        ).matches,
    );
    const holders = await this.capabilities.holdersAmong(
      inArea.map((provider) => provider.userId!),
      ProviderCapability.ViewMarketplace,
      tx,
    );
    return inArea.filter((provider) => holders.has(provider.userId!));
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Stage 1 — dispatcher.
//
// Resolves recipients and splits them into bounded slices, one outbox event
// each. It writes no notifications itself.
//
// Why two stages instead of one handler that notifies everyone:
//
//   * Transaction size is bounded by OUTBOX_FANOUT_BATCH_SIZE, not by how
//     many providers happen to match. A ten-thousand-recipient fan-out in one
//     transaction holds locks for its whole duration and redoes all of it on
//     any failure.
//   * Retries are per slice. One slice failing re-delivers 200 notifications,
//     not 10,000.
//   * Slices are independent rows, so N worker replicas drain them in
//     parallel through the ordinary claim path — no special-casing.
// ─────────────────────────────────────────────────────────────────────────
@Injectable()
export class RequestAvailableDispatchHandler implements OutboxHandler {
  readonly name = 'request-available.dispatch';
  readonly eventTypes = [OutboxEventType.REQUEST_AVAILABLE] as const;

  private readonly log = new Logger(RequestAvailableDispatchHandler.name);
  /** Recipients read from the database per page. Independent of the fan-out
   *  batch size: this bounds MEMORY, that bounds transaction size. */
  private static readonly SCAN_PAGE = 500;

  constructor(
    private readonly audience: RequestAvailableAudience,
    private readonly outbox: OutboxRepository,
    private readonly config: AppConfigService,
    private readonly requests: ServiceRequestRepository,
  ) {}

  async handle(event: OutboxEvent, tx: PrismaTx): Promise<OutboxHandlerResult> {
    const payload = event.payload as unknown as RequestAvailablePayload;
    const live = await this.requests.findById(payload.requestId, tx);
    if (!live || live.status !== ServiceRequestStatus.OPEN_FOR_BIDS) {
      this.log.log({ msg: 'request.fanout.skipped_not_open', requestId: payload.requestId });
      return { stats: { scanned: 0, matched: 0, batches: 0 } };
    }
    // R17-E — announce a request only to providers whose feed can show it.
    // Every provider surface requires the request's category to be one of the
    // provider's own (feedCategoryScope), so an uncategorised, custom-text
    // request is visible to nobody: announcing it sent every provider in the
    // area to a request their detail and bid endpoints refuse. Who may serve
    // custom-text requests is an open product decision (R17_E_PROVIDER_POLICY).
    // The live category is used for the same reason: the feed reads the row.
    const categoryId = live.categoryId;
    if (!categoryId) {
      this.log.log({ msg: 'request.fanout.skipped_uncategorised', requestId: payload.requestId });
      return { stats: { scanned: 0, matched: 0, batches: 0 } };
    }
    // The notification text names the category the request was created with;
    // if the row no longer carries it, announcing it would mislabel the job.
    if (categoryId !== payload.categoryId) {
      this.log.log({
        msg: 'request.fanout.skipped_category_changed',
        requestId: payload.requestId,
      });
      return { stats: { scanned: 0, matched: 0, batches: 0 } };
    }
    const location: RequestLocation = {
      lat: payload.lat,
      lng: payload.lng,
      cityKey: payload.cityKey,
    };

    const batchSize = this.config.get('OUTBOX_FANOUT_BATCH_SIZE');
    let cursorId: string | undefined;
    let scanned = 0;
    let matched = 0;
    let batches = 0;
    let pending: string[] = [];

    const flush = async (): Promise<void> => {
      if (pending.length === 0) return;
      const slice = pending;
      pending = [];
      const index = batches++;
      await this.outbox.enqueue(
        {
          aggregateType: 'ServiceRequest',
          aggregateId: payload.requestId,
          eventType: OutboxEventType.REQUEST_AVAILABLE_BATCH,
          // Cast through `unknown` to Prisma's JSON input type: the payload
          // interface is a plain object of JSON-safe primitives, but
          // TypeScript cannot prove that to InputJsonValue's recursive shape.
          payload: {
            ...payload,
            recipientUserIds: slice,
            batchIndex: index,
          } as unknown as Prisma.InputJsonValue,
          // Deterministic, so a redelivered dispatcher cannot double-enqueue a
          // slice. It cannot normally re-run at all (its handler marker sees
          // to that) — this is the second line of defence.
          dedupeKey: `request-available:${payload.requestId}:${index}`,
        },
        // Same transaction as the dispatcher's own idempotency marker: either
        // every slice exists or none does. A partial dispatch would silently
        // notify some providers and never the rest.
        tx,
      );
    };

    // Keyset scan. Bounded memory regardless of how many providers match, and
    // a fixed number of reads per page (candidates + one bulk capability
    // decision), never one per provider.
    for (;;) {
      const page = await this.audience.candidates(
        {
          categoryId,
          location,
          excludeSeekerUserId: payload.seekerUserId,
          take: RequestAvailableDispatchHandler.SCAN_PAGE,
          cursorId,
        },
        tx,
      );
      if (page.length === 0) break;
      scanned += page.length;

      // The SQL selected a SUPERSET; this is where each provider is decided
      // exactly, by the same geo function and capability table as the feed.
      for (const provider of await this.audience.decide(page, location, payload.seekerUserId, tx)) {
        matched += 1;
        pending.push(provider.userId!);
        if (pending.length >= batchSize) await flush();
      }

      if (page.length < RequestAvailableDispatchHandler.SCAN_PAGE) break;
      cursorId = page[page.length - 1].id;
    }

    await flush();

    if (matched === 0) {
      this.log.log({
        msg: 'request.fanout.no_recipients',
        requestId: payload.requestId,
        scanned,
      });
    }

    return { stats: { scanned, matched, batches } };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Stage 2 — one slice of recipients.
// ─────────────────────────────────────────────────────────────────────────
@Injectable()
export class RequestAvailableBatchHandler implements OutboxHandler {
  readonly name = 'request-available.batch';
  readonly eventTypes = [OutboxEventType.REQUEST_AVAILABLE_BATCH] as const;

  constructor(
    private readonly notifications: NotificationRepository,
    private readonly realtime: RealtimeEventsPublisher,
    private readonly requests: ServiceRequestRepository,
    private readonly audience: RequestAvailableAudience,
    private readonly capabilities: ProviderCapabilityService,
    private readonly bids: BidRepository,
  ) {}

  async handle(event: OutboxEvent, tx: PrismaTx): Promise<OutboxHandlerResult> {
    const payload = event.payload as unknown as RequestAvailableBatchPayload;
    const sliced = payload.recipientUserIds.length;
    if (!(await this.requests.lockForLifecycle(payload.requestId, tx))) {
      return { stats: { recipients: sliced, written: 0, skipped: 1 } };
    }
    const live = await this.requests.findById(payload.requestId, tx);
    if (!live || live.status !== ServiceRequestStatus.OPEN_FOR_BIDS) {
      return { stats: { recipients: sliced, written: 0, skipped: 1 } };
    }
    // The slice was chosen, and its text written, for one category. If the
    // request no longer carries it, nobody in the slice is the right audience
    // and the label would be wrong: deliver nothing (narrower, never broader).
    if (!live.categoryId || live.categoryId !== payload.categoryId) {
      return { stats: { recipients: sliced, written: 0, skipped: 1 } };
    }

    // R17-E closure (E-13) — the dispatcher's choice is minutes old by now.
    // Re-decide every recipient against the live rows before writing: lock
    // their account and profile rows FOR SHARE (request → account → profile,
    // the order canInTransaction uses), so a suspension committed first is
    // seen and one in flight waits for this slice; then the same candidate
    // query and exact decision as the dispatcher, limited to this slice; then
    // drop anyone who has already bid, whom the detail route answers 404.
    // A fixed number of statements per slice, whatever its size.
    const location: RequestLocation = {
      lat: payload.lat,
      lng: payload.lng,
      cityKey: payload.cityKey,
    };
    const sliceIds = [...new Set(payload.recipientUserIds)];
    await this.capabilities.lockProvidersForShare(sliceIds, tx);
    const candidates = await this.audience.candidates(
      {
        categoryId: live.categoryId,
        location,
        excludeSeekerUserId: payload.seekerUserId,
        take: sliceIds.length,
        onlyUserIds: sliceIds,
      },
      tx,
    );
    const allowed = await this.audience.decide(candidates, location, payload.seekerUserId, tx);
    const alreadyBid = await this.bids.findProviderIdsWithActiveBid(
      payload.requestId,
      allowed.map((provider) => provider.id),
      tx,
    );
    // Known before the write, because createMany reports only a count: the
    // realtime accelerator below must announce exactly the rows written.
    const recipients = allowed
      .filter((provider) => !alreadyBid.has(provider.id))
      .map((provider) => provider.userId!);

    const deepLink = `/provider/requests/${payload.requestId}`;
    // Deliberately narrow: no seeker identity, no address line, no
    // coordinates. This lands in a notification row that many providers can
    // read, so it carries only what the card renders.
    const metadata = {
      requestId: payload.requestId,
      categoryId: payload.categoryId,
      city: payload.city,
    };

    const written = await this.notifications.createMany(
      recipients.map((userId) => ({
        userId,
        type: REQUEST_AVAILABLE,
        title: 'New request available',
        body: `A new ${payload.categoryLabel} request matches your profile.`,
        resourceType: NotificationResourceType.REQUEST,
        resourceId: payload.requestId,
        deepLink,
        metadata,
      })),
      tx,
    );

    return {
      // Realtime is a NON-transactional accelerator and runs after commit.
      // The durable notification row above is the delivery guarantee; this
      // just saves the provider a poll. Publishing inside the transaction
      // would push an event for a row that might still roll back.
      afterCommit: async () => {
        for (const userId of recipients) {
          this.realtime.publishFor(
            userId,
            'request.available',
            { requestId: payload.requestId },
            { actorUserId: payload.seekerUserId },
          );
        }
      },
      // Counts only: provider ids stay out of logs and metrics.
      stats: { recipients: sliced, written, excluded: sliced - recipients.length },
    };
  }
}
