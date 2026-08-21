import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import type { ServerOptions } from 'socket.io';
import { Server } from 'socket.io';

import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

// Sprint 7.0 (refined): Socket.IO IoAdapter that wires the Redis
// pub/sub adapter when REALTIME_SOCKET_IO=on AND the Redis service
// reports ready. When Redis is unavailable the gateway still serves
// connected clients on the local instance — single-instance dev runs
// keep working with no Redis at all (the in-process path).
//
// Production multi-instance deploys MUST set REALTIME_SOCKET_IO=on
// and have a healthy Redis; the adapter then routes io.to('room')
// across instances. The adapter uses two dedicated ioredis clients
// (pub + sub) duplicated from the existing app Redis client so the
// socket pub/sub traffic doesn't multiplex with the session-cache
// command stream.
export class RealtimeSocketAdapter extends IoAdapter {
  private readonly log = new Logger(RealtimeSocketAdapter.name);
  private redisAdapterFactory:
    | ((nsp: { name: string; server: { _nsps: Map<string, unknown> } }) => unknown)
    | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    if (!this.config.get('REALTIME_SOCKET_IO')) {
      this.log.log('REALTIME_SOCKET_IO=off — running without Redis adapter');
      return;
    }

    if (!this.redis.isReady()) {
      this.failOrDegrade('Redis was not ready at startup');
      return;
    }

    try {
      const pub = this.redis.getClient().duplicate();
      const sub = pub.duplicate();
      await Promise.all([pub.connect?.(), sub.connect?.()]);
      // The redis-adapter is namespace-aware; createAdapter returns a function
      // the IoAdapter sets on every namespace it creates.
      this.redisAdapterFactory = createAdapter(pub, sub, {
        key: 'socketio:hsm',
      }) as unknown as typeof this.redisAdapterFactory;
      this.log.log('Socket.IO Redis adapter wired (key=socketio:hsm) — cross-instance eviction ON');
    } catch (err) {
      this.failOrDegrade(`Redis adapter wiring failed: ${(err as Error).message}`);
    }
  }

  // D-4 — never silently claim cross-instance security we do not have.
  //
  // Without the Redis adapter, `disconnectSockets` only reaches sockets held
  // by THIS process. A logout or suspension served by one replica would leave
  // the victim's socket alive on every other replica — the control looks like
  // it works and does not. In a hardened environment that is a boot failure,
  // not a warning, unless the operator has explicitly acknowledged a
  // single-instance deployment via REALTIME_ALLOW_SINGLE_INSTANCE.
  private failOrDegrade(reason: string): void {
    const nodeEnv = this.config.get('NODE_ENV');
    const hardened = nodeEnv === 'production' || nodeEnv === 'staging';
    const acknowledged = this.config.get('REALTIME_ALLOW_SINGLE_INSTANCE');

    if (hardened && !acknowledged) {
      throw new Error(
        `Realtime is enabled but the Socket.IO Redis adapter is unavailable (${reason}). ` +
          `Cross-instance socket eviction after logout / suspension / provider-status change ` +
          `would NOT work, so this boot is refused. Fix Redis, or set ` +
          `REALTIME_ALLOW_SINGLE_INSTANCE=true to explicitly accept single-instance mode.`,
      );
    }

    this.log.warn(
      `${reason} — Socket.IO running SINGLE-INSTANCE. Socket eviction reaches only this ` +
        `process; do not run more than one API replica in this mode.`,
    );
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.redisAdapterFactory) {
      // Cast around the loose adapter type; @socket.io/redis-adapter
      // returns a (nsp) => Adapter factory which is exactly what
      // server.adapter expects.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      server.adapter(this.redisAdapterFactory as any);
    }
    return server;
  }
}
