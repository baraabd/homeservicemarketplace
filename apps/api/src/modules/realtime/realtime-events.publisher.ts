import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Observable } from 'rxjs';
import type { RealtimeEvent, RealtimeEventType } from '@homeservicemarketplace/contracts';

import { RealtimeGateway } from './realtime.gateway';
import {
  MAX_REALTIME_CONNECTIONS_PER_INSTANCE,
  MAX_REALTIME_CONNECTIONS_PER_USER,
  MAX_REALTIME_PAYLOAD_BYTES,
} from './realtime-socket.adapter';

/** Additive wire fields, without changing the frozen workspace contracts.
 * Revision is persisted time/sequence when supplied, NEVER dispatch time. */
export type RealtimeDeliveryEvent = RealtimeEvent & { eventId: string; revision?: number };
const MAX_SSE_PENDING = 16;

@Injectable()
export class RealtimeEventsPublisher {
  private readonly log = new Logger(RealtimeEventsPublisher.name);
  private readonly bus = new EventEmitter();
  private subscribers = 0;
  private pendingSse = 0;
  private pendingSseBytes = 0;

  constructor(private readonly gateway: RealtimeGateway) {
    this.bus.setMaxListeners(MAX_REALTIME_CONNECTIONS_PER_USER);
  }

  publish<T>(event: RealtimeEvent<T>): void {
    try {
      const delivered = deliveryEnvelope(event, event.userId ? `user:${event.userId}` : '');
      if (!delivered) return;
      if (event.userId) {
        this.bus.emit(this.userChannel(event.userId), delivered);
        this.gateway.emitToRoom(`user:${event.userId}`, delivered);
      }
    } catch {
      // Transport failures never roll back the already committed domain work.
      this.log.warn({ msg: 'realtime.publish.failed' });
    }
  }

  publishFor(
    userId: string,
    type: RealtimeEventType,
    payload: unknown,
    options?: { actorUserId?: string | null },
  ): void {
    this.publish({
      v: 1,
      type,
      userId,
      actorUserId: options?.actorUserId ?? null,
      occurredAt: new Date().toISOString(),
      payload,
    });
  }

  publishToRoom(
    room: string,
    type: RealtimeEventType,
    payload: unknown,
    options?: { actorUserId?: string | null },
  ): void {
    try {
      const delivered = deliveryEnvelope(
        {
          v: 1,
          type,
          userId: null,
          actorUserId: options?.actorUserId ?? null,
          occurredAt: new Date().toISOString(),
          payload,
        },
        room,
      );
      if (delivered) this.gateway.emitToRoom(room, delivered);
    } catch {
      this.log.warn({ msg: 'realtime.publishToRoom.failed' });
    }
  }

  /** Legacy SSE is local and best effort. The real controller supplies a
   * fresh session/event check for EACH packet; queues and listener counts are
   * bounded and registration happens only on actual Observable subscription. */
  subscribe(
    userId: string,
    authorize?: (event: RealtimeEvent) => Promise<boolean>,
  ): Observable<RealtimeEvent> {
    return new Observable<RealtimeEvent>((subscriber) => {
      const channel = this.userChannel(userId);
      if (
        this.subscribers >= MAX_REALTIME_CONNECTIONS_PER_INSTANCE ||
        this.bus.listenerCount(channel) >= MAX_REALTIME_CONNECTIONS_PER_USER
      ) {
        subscriber.error(new Error('REALTIME_CONNECTION_LIMIT'));
        return;
      }
      const queue: Array<{ event: RealtimeEvent; bytes: number }> = [];
      let running = false;
      const drain = async () => {
        if (running) return;
        running = true;
        try {
          while (queue.length && !subscriber.closed) {
            const { event, bytes } = queue.shift()!;
            try {
              if (authorize && !(await authorize(event))) {
                subscriber.error(new Error('AUTH_INVALID_CREDENTIALS'));
                return;
              }
              if (!subscriber.closed) subscriber.next(event);
            } finally {
              this.pendingSse -= 1;
              this.pendingSseBytes -= bytes;
            }
          }
        } catch {
          subscriber.error(new Error('AUTH_INVALID_CREDENTIALS'));
        } finally {
          running = false;
        }
      };
      const listener = (event: RealtimeEvent) => {
        if (subscriber.closed) return;
        if (!authorize) {
          subscriber.next(event);
          return;
        }
        const bytes = Buffer.byteLength(JSON.stringify(event));
        if (
          queue.length >= MAX_SSE_PENDING ||
          this.pendingSse >= 512 ||
          this.pendingSseBytes + bytes > 16 * 1024 * 1024
        ) {
          subscriber.error(new Error('REALTIME_BACKPRESSURE'));
          return;
        }
        this.pendingSse += 1;
        this.pendingSseBytes += bytes;
        queue.push({ event, bytes });
        void drain();
      };
      this.subscribers += 1;
      this.bus.on(channel, listener);
      return () => {
        this.subscribers -= 1;
        this.bus.off(channel, listener);
        for (const { bytes } of queue) {
          this.pendingSse -= 1;
          this.pendingSseBytes -= bytes;
        }
        queue.length = 0;
      };
    });
  }

  private userChannel(userId: string): string {
    return `user:${userId}`;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Durable creation IDs survive an outbox retry and changing readAt. State
 * updates with a persisted revision are stable too. Legacy transitions that
 * provide neither an event ID nor a revision get a delivery ID only; clients
 * MUST refetch and cannot infer ordering from it. */
function deliveryEnvelope(event: RealtimeEvent, room: string): RealtimeDeliveryEvent | null {
  try {
    const serialized = JSON.stringify(event);
    if (Buffer.byteLength(serialized) > MAX_REALTIME_PAYLOAD_BYTES - 128) return null;
    const payload = record(event.payload);
    const entity = record(payload.message ?? payload.booking ?? payload.bid ?? payload);
    const id = entity.id ?? payload.notificationId ?? payload.bookingId ?? payload.requestId;
    const persistedTime =
      entity.updatedAt ?? payload.updatedAt ?? entity.createdAt ?? payload.createdAt;
    const parsedTime = typeof persistedTime === 'string' ? Date.parse(persistedTime) : NaN;
    const revision =
      typeof payload.revision === 'number' &&
      Number.isSafeInteger(payload.revision) &&
      payload.revision >= 0
        ? payload.revision
        : Number.isSafeInteger(parsedTime) && parsedTime >= 0
          ? parsedTime
          : undefined;
    const durableCreation = event.type.endsWith('.created') && typeof id === 'string';
    const identity = durableCreation
      ? [event.type, room, payload.conversationId ?? null, id]
      : revision !== undefined
        ? [event.type, room, id ?? null, revision, stableValue(event.payload)]
        : [event.type, room, randomUUID()];
    const eventId = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    return { ...event, eventId, ...(revision === undefined ? {} : { revision }) };
  } catch {
    return null;
  }
}

function stableValue(value: unknown, depth = 0): unknown {
  if (depth > 32) throw new Error('Realtime payload nesting limit');
  if (Array.isArray(value)) return value.map((item) => stableValue(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item, depth + 1)]),
    );
  }
  return value;
}
