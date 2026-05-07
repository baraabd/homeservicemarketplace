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
      this.log.warn(
        'Redis not ready at startup — Socket.IO will run single-instance until Redis recovers',
      );
      return;
    }
    try {
      const pub = this.redis.getClient().duplicate();
      const sub = pub.duplicate();
      await Promise.all([pub.connect?.(), sub.connect?.()]);
      // The redis-adapter is namespace-aware; createAdapter returns
      // a function that the IoAdapter will set on every namespace it
      // creates.
      this.redisAdapterFactory = createAdapter(pub, sub, {
        key: 'socketio:hsm',
      }) as unknown as typeof this.redisAdapterFactory;
      this.log.log('Socket.IO Redis adapter wired (key=socketio:hsm)');
    } catch (err) {
      this.log.error(`Failed to wire Socket.IO Redis adapter: ${(err as Error).message}`);
      // Soft-fail — keep the gateway running single-instance instead
      // of crashing the API.
    }
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
