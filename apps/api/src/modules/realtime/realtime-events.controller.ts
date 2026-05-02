import { Controller, MessageEvent, Sse, UseGuards } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { RealtimeEvent } from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { RealtimeEventsPublisher } from './realtime-events.publisher';

// /v1/me/events — Server-Sent Events stream (Sprint 7.0).
//
// JWT-guarded; the userId is taken from the session — never the wire.
// Each emitted event is wrapped in NestJS's MessageEvent (which
// becomes a `data:` line in the response stream).
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me', version: '1' })
export class RealtimeEventsController {
  constructor(private readonly publisher: RealtimeEventsPublisher) {}

  @Sse('events')
  events(@CurrentUser() user: AuthenticatedUser): Observable<MessageEvent> {
    return this.publisher.subscribe(user.id).pipe(
      map(
        (event: RealtimeEvent): MessageEvent => ({
          // SSE id field — clients echo Last-Event-ID on reconnect.
          id: `${event.occurredAt}-${event.type}`,
          type: event.type,
          // The wire payload is the entire envelope so the client
          // can route on `type` without re-parsing the SSE event
          // type field.
          data: event,
        }),
      ),
    );
  }
}
