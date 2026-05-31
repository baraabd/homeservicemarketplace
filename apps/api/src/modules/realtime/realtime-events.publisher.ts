import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Observable, Subject } from 'rxjs';
import type { RealtimeEvent, RealtimeEventType } from '@homeservicemarketplace/contracts';

import { RealtimeGateway } from './realtime.gateway';

// Sprint 7.0 (refined): realtime publisher.
//
// Originally an in-process EventEmitter only (Phase A — SSE delivery).
// Phase B (this sprint) adds Socket.IO room-based fan-out alongside
// the EventEmitter so:
//   - existing /v1/me/events SSE subscribers keep working (in-process)
//   - new socket clients receive events through Socket.IO rooms
//   - production multi-instance deployments get cross-instance fan-out
//     through @socket.io/redis-adapter (wired in main.ts)
//
// Service-layer callers (NotificationsService, ConversationsService,
// BookingsService, BidsService) keep the existing publish() /
// publishFor() API. The new publishToRoom() is for events whose
// recipient set is a room rather than a single user (chat messages,
// admin broadcasts).
//
// The publisher SWALLOWS its own errors. A bus failure must never
// roll back the calling REST transaction — the audit trail + REST
// response are the source of truth, the realtime overlay is best-
// effort.
@Injectable()
export class RealtimeEventsPublisher {
  private readonly log = new Logger(RealtimeEventsPublisher.name);
  private readonly bus = new EventEmitter();

  constructor(private readonly gateway: RealtimeGateway) {
    this.bus.setMaxListeners(0);
  }

  publish<T>(event: RealtimeEvent<T>): void {
    try {
      // Local in-process bus → SSE subscribers.
      if (event.userId) this.bus.emit(this.userChannel(event.userId), event);
      // Socket.IO room → user-targeted events go to user:{userId}.
      if (event.userId) this.gateway.emitToRoom(`user:${event.userId}`, event);
    } catch (err) {
      this.log.warn({ msg: 'realtime.publish.failed', err: String(err) });
    }
  }

  // Sprint 7.6 — `options.actorUserId` is the OPTIONAL identity of
  // the user whose action produced this event. Surfaced on the
  // envelope so the client side-effects bridge can suppress
  // self-feedback (the actor's own connected tabs receive the event
  // for cache invalidation but don't toast / sound / vibrate).
  //
  // System-generated events (e.g. matcher emitting request.available)
  // omit the option; the envelope's `actorUserId` is then `null` and
  // the bridge treats every recipient as a non-actor.
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

  // Fan-out to a server-owned room. Used for events whose recipient
  // set is bigger than one user (chat threads, admin broadcasts,
  // provider-targeted events). Bus listeners are NOT notified for
  // room-targeted events — the SSE channel is per-user only.
  //
  // Sprint 7.6 — also supports `actorUserId` so room broadcasts that
  // produce UX side-effects (e.g. chat `message.created`) can still
  // be anti-echo gated per-recipient by the client bridge.
  publishToRoom(
    room: string,
    type: RealtimeEventType,
    payload: unknown,
    options?: { actorUserId?: string | null },
  ): void {
    try {
      this.gateway.emitToRoom(room, {
        v: 1,
        type,
        userId: null,
        actorUserId: options?.actorUserId ?? null,
        occurredAt: new Date().toISOString(),
        payload,
      });
    } catch (err) {
      this.log.warn({ msg: 'realtime.publishToRoom.failed', room, err: String(err) });
    }
  }

  // Per-user Observable used by the SSE controller. Unchanged from
  // Phase A so the SSE fallback keeps working without Socket.IO.
  subscribe(userId: string): Observable<RealtimeEvent> {
    const subject = new Subject<RealtimeEvent>();
    const listener = (event: RealtimeEvent) => subject.next(event);
    this.bus.on(this.userChannel(userId), listener);
    return new Observable<RealtimeEvent>((sub) => {
      const inner = subject.subscribe(sub);
      return () => {
        inner.unsubscribe();
        this.bus.off(this.userChannel(userId), listener);
      };
    });
  }

  private userChannel(userId: string): string {
    return `user:${userId}`;
  }
}
