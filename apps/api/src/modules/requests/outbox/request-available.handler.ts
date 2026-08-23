import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationResourceType,
  NotificationType,
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
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { matchServiceArea, type RequestLocation } from '../../../shared/geo/service-area';
import { RealtimeEventsPublisher } from '../../realtime/realtime-events.publisher';

/** Payload of `request.available`, written by RequestsService inside the
 *  request-creation transaction.
 *
 *  Self-contained on purpose. A handler that re-read the ServiceRequest row
 *  would see whatever it looks like NOW — possibly cancelled, edited, or
 *  deleted — and fan out a notification describing a state that never
 *  triggered it. The event describes what happened, not what is. */
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
    private readonly providers: ProviderProfileRepository,
    private readonly outbox: OutboxRepository,
    private readonly config: AppConfigService,
  ) {}

  async handle(event: OutboxEvent, tx: PrismaTx): Promise<OutboxHandlerResult> {
    const payload = event.payload as unknown as RequestAvailablePayload;
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

    // Keyset scan. Bounded memory regardless of how many providers match.
    for (;;) {
      const page = await this.providers.listEligibleRecipientsPage(
        {
          categoryId: payload.categoryId,
          location,
          excludeSeekerUserId: payload.seekerUserId,
          take: RequestAvailableDispatchHandler.SCAN_PAGE,
          cursorId,
        },
        tx,
      );
      if (page.length === 0) break;
      scanned += page.length;

      for (const provider of page) {
        // The SQL selected a SUPERSET (see listEligibleRecipientsPage): it
        // cannot evaluate each provider's own radius. This is where the exact
        // per-provider rule is applied — the same function the feed uses, so
        // a provider is notified only about jobs their feed will show.
        const verdict = matchServiceArea(
          {
            lat: provider.serviceAreaLat,
            lng: provider.serviceAreaLng,
            radiusKm: provider.serviceAreaRadiusKm,
            cityKey: provider.serviceAreaCityKey,
          },
          location,
        );
        if (!verdict.matches) continue;
        // Defensive: the query already excludes the seeker and null userIds.
        if (!provider.userId || provider.userId === payload.seekerUserId) continue;

        matched += 1;
        pending.push(provider.userId);
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
  ) {}

  async handle(event: OutboxEvent, tx: PrismaTx): Promise<OutboxHandlerResult> {
    const payload = event.payload as unknown as RequestAvailableBatchPayload;
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
      payload.recipientUserIds.map((userId) => ({
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
        for (const userId of payload.recipientUserIds) {
          this.realtime.publishFor(
            userId,
            'request.available',
            { requestId: payload.requestId },
            { actorUserId: payload.seekerUserId },
          );
        }
      },
      stats: { recipients: payload.recipientUserIds.length, written },
    };
  }
}
