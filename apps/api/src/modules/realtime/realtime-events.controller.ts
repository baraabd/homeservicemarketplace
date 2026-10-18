import { Controller, Get, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Subscription } from 'rxjs';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { SessionValidationService } from '../iam/authentication/services/session-validation.service';
import { TokenService } from '../iam/authentication/services/token.service';
import { resolveAccessToken } from '../iam/authentication/strategies/jwt.strategy';
import { RealtimeEventsPublisher, type RealtimeDeliveryEvent } from './realtime-events.publisher';
import { RealtimeGateway, userRoom } from './realtime.gateway';
import { MAX_REALTIME_PAYLOAD_BYTES } from './realtime-socket.adapter';

/** Legacy local SSE delivery. A direct response deliberately avoids Nest's
 * @Sse concatMap/writeMessage queue: that queue can otherwise retain packets
 * after upstream authorization expires. REST cursor reads remain recovery. */
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me', version: '1' })
export class RealtimeEventsController {
  constructor(
    private readonly publisher: RealtimeEventsPublisher,
    private readonly sessions: SessionValidationService,
    private readonly tokens: TokenService,
    private readonly gateway: RealtimeGateway,
  ) {}

  @Get('events')
  events(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    const token = resolveAccessToken(request);
    if (!token) throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });
    const claims = this.tokens.verifyAccessToken(token);
    const expiresAt = claims.exp * 1000;
    if (
      claims.sub !== user.id ||
      claims.sid !== user.sessionId ||
      claims.jti !== user.jti ||
      !Number.isSafeInteger(claims.exp) ||
      expiresAt <= Date.now()
    )
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS' });

    let subscription: Subscription | undefined;
    let expiry: NodeJS.Timeout | undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    let stopped = false;
    let checking = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (expiry) clearTimeout(expiry);
      if (heartbeat) clearInterval(heartbeat);
      expiry = undefined;
      heartbeat = undefined;
      subscription?.unsubscribe();
      subscription = undefined;
      // end() drains buffered payloads. destroy() drops them immediately.
      if (!response.destroyed) response.destroy();
    };
    const write = (frame: string) => {
      if (
        stopped ||
        response.destroyed ||
        expiresAt <= Date.now() ||
        response.writableLength + Buffer.byteLength(frame) > MAX_REALTIME_PAYLOAD_BYTES
      )
        return stop();
      try {
        // Do not install a drain queue. A slow reader reconnects and resyncs
        // through REST rather than retaining an unlimited private history.
        if (!response.write(frame)) stop();
      } catch {
        stop();
      }
    };
    const assertCurrent = async () => {
      if (stopped || expiresAt <= Date.now()) return false;
      await this.sessions.assertSessionActive({
        userId: user.id,
        sessionId: user.sessionId,
        jti: user.jti,
      });
      return !stopped && expiresAt > Date.now();
    };

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.once('close', stop);
    response.once('error', stop);
    response.flushHeaders();
    expiry = setTimeout(stop, Math.min(expiresAt - Date.now(), 2_147_483_647));
    expiry.unref();
    write('retry: 15000\n\n');
    if (stopped) return;

    subscription = this.publisher
      .subscribe(user.id, async (event) => {
        if (!(await this.gateway.mayReceiveEvent(user.id, userRoom(user.id), event))) return false;
        return assertCurrent();
      })
      .subscribe({
        next: (event) => {
          const delivered = event as RealtimeDeliveryEvent;
          if (
            !/^[a-zA-Z0-9_-]{1,256}$/.test(delivered.eventId) ||
            !/^[a-z][a-z_.]{0,63}$/.test(delivered.type)
          )
            return stop();
          write(
            `id: ${delivered.eventId}\nevent: ${delivered.type}\ndata: ${JSON.stringify(delivered)}\n\n`,
          );
        },
        error: stop,
        complete: stop,
      });
    if (stopped) {
      subscription.unsubscribe();
      return;
    }
    heartbeat = setInterval(() => {
      if (checking || stopped) return;
      checking = true;
      void assertCurrent()
        .then((current) => {
          if (current) write(': keepalive\n\n');
          else stop();
        })
        .catch(stop)
        .finally(() => {
          checking = false;
        });
    }, 10_000);
    heartbeat.unref();
  }
}
