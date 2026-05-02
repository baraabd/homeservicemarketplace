import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Observable, Subject } from 'rxjs';
import type { RealtimeEvent, RealtimeEventType } from '@homeservicemarketplace/contracts';

// Sprint 7.0: realtime publisher.
//
// Per the Sprint 5.5.5 spike, the production target is Redis pub/sub
// per user channel. This first cut uses an in-process EventEmitter
// + a Subject<RealtimeEvent> so single-instance dev environments
// already get end-to-end events. Swapping the in-memory emitter for
// a Redis subscriber is a one-method change (replace `bus.on` with
// the Redis client) and keeps the surface stable for callers.
//
// Service-layer callers (NotificationsService, ConversationsService,
// BookingsService, BidsService) call `publish()` post-commit so
// transactions that roll back never leak events onto the bus.
@Injectable()
export class RealtimeEventsPublisher {
  private readonly log = new Logger(RealtimeEventsPublisher.name);
  private readonly bus = new EventEmitter();

  constructor() {
    // Defensive: keep the listener cap high so we don't trip the
    // Node default (10) when many users connect to /me/events.
    this.bus.setMaxListeners(0);
  }

  publish<T>(event: RealtimeEvent<T>): void {
    try {
      this.bus.emit(this.channelFor(event.userId), event);
    } catch (err) {
      // Never let a publish error fail the calling transaction —
      // the audit trail + REST response are the source of truth;
      // realtime is a best-effort overlay.
      this.log.warn({ msg: 'realtime.publish.failed', err: String(err) });
    }
  }

  // Returns an Observable of events for a single user. The SSE
  // controller turns each emission into a `data:` line.
  subscribe(userId: string): Observable<RealtimeEvent> {
    const subject = new Subject<RealtimeEvent>();
    const listener = (event: RealtimeEvent) => subject.next(event);
    this.bus.on(this.channelFor(userId), listener);
    // The Observable contract requires a teardown so the listener
    // is removed when the subscriber unsubscribes (the SSE response
    // closes when the client disconnects).
    return new Observable<RealtimeEvent>((sub) => {
      const inner = subject.subscribe(sub);
      return () => {
        inner.unsubscribe();
        this.bus.off(this.channelFor(userId), listener);
      };
    });
  }

  // Helper for service layer — composes the type + userId +
  // occurredAt envelope.
  publishFor(userId: string, type: RealtimeEventType, payload: unknown): void {
    this.publish({
      v: 1,
      type,
      userId,
      occurredAt: new Date().toISOString(),
      payload,
    });
  }

  private channelFor(userId: string): string {
    return `user:${userId}`;
  }
}
