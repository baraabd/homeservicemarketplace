import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis, { type RedisOptions } from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { Server } from 'socket.io';

import { AppConfigService } from '../../config/app-config.service';

// Startup-only budget for bringing the pub/sub pair up. Long enough to absorb a
// slow container start, short enough that a genuinely absent Redis fails the
// boot promptly instead of hanging the deployment.
const REDIS_CONNECT_TIMEOUT_MS = 10_000;

// Socket.IO IoAdapter that wires the Redis pub/sub adapter when
// REALTIME_SOCKET_IO=on.
//
// ── Why this owns its Redis clients ──────────────────────────────────────────
// It used to take the shared RedisService and check `isReady()`. That could
// not work: the adapter is constructed in bootstrap() BEFORE `app.listen()`
// triggers Nest's `onModuleInit`, so RedisService had not connected yet and
// `isReady()` was always false at that moment. The old code merely warned and
// carried on, so the failure was invisible — every boot silently ran without
// the Redis adapter. Once D-4 made that state fail the boot, the same ordering
// bug turned into "the API never starts".
//
// The pub/sub pair must be dedicated connections anyway (a client in
// subscriber mode cannot serve normal commands, and socket fan-out should not
// multiplex with the session/rate-limit command stream), so the adapter builds
// its own from configuration and does not depend on Nest's lifecycle at all.
export class RealtimeSocketAdapter extends IoAdapter {
  private readonly log = new Logger(RealtimeSocketAdapter.name);
  private redisAdapterFactory:
    | ((nsp: { name: string; server: { _nsps: Map<string, unknown> } }) => unknown)
    | null = null;
  private clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly config: AppConfigService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    if (!this.config.get('REALTIME_SOCKET_IO')) {
      this.log.log('REALTIME_SOCKET_IO=off — running without Redis adapter');
      return;
    }

    const pub = this.buildClient();
    const sub = this.buildClient();

    try {
      await Promise.all([
        withTimeout(pub.connect(), REDIS_CONNECT_TIMEOUT_MS, 'pub connect'),
        withTimeout(sub.connect(), REDIS_CONNECT_TIMEOUT_MS, 'sub connect'),
      ]);
      // A successful PING is the unambiguous "commands will be served" signal;
      // ioredis reports a connect event before the ready check completes.
      await withTimeout(pub.ping(), REDIS_CONNECT_TIMEOUT_MS, 'pub ping');

      this.clients = [pub, sub];
      // The redis-adapter is namespace-aware; createAdapter returns a function
      // the IoAdapter sets on every namespace it creates.
      this.redisAdapterFactory = createAdapter(pub, sub, {
        key: 'socketio:hsm',
      }) as unknown as typeof this.redisAdapterFactory;
      this.log.log('Socket.IO Redis adapter wired (key=socketio:hsm) — cross-instance eviction ON');
    } catch (err) {
      // Never leave half-open clients retrying in the background — they would
      // keep the process alive after a refused boot.
      await Promise.allSettled([pub.quit(), sub.quit()]).catch(() => undefined);
      pub.disconnect();
      sub.disconnect();
      this.failOrDegrade((err as Error).message);
    }
  }

  // Called from the shutdown path so a graceful SIGTERM does not leave the
  // pub/sub connections open.
  async close(): Promise<void> {
    await Promise.allSettled(this.clients.map((c) => c.quit()));
    this.clients = [];
  }

  private buildClient(): Redis {
    const options: RedisOptions = {
      host: this.config.get('REDIS_HOST'),
      port: this.config.get('REDIS_PORT'),
      password: this.config.get('REDIS_PASSWORD') || undefined,
      db: this.config.get('REDIS_DB'),
      tls: this.config.get('REDIS_TLS') ? {} : undefined,
      connectTimeout: this.config.get('REDIS_CONNECT_TIMEOUT_MS'),
      lazyConnect: true,
      enableReadyCheck: true,
      // Bounded at startup: give up rather than retrying forever behind a
      // timeout that has already fired.
      retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2_000)),
      maxRetriesPerRequest: 3,
    };
    const client = new Redis(options);
    // ioredis emits 'error' on an unconnectable host; without a listener that
    // becomes an unhandled 'error' event and takes the process down before the
    // boot decision below can be made.
    client.on('error', (err) => this.log.debug(`Socket.IO Redis client error: ${err.message}`));
    return client;
  }

  // D-4 — never silently claim cross-instance security we do not have.
  //
  // Without the Redis adapter, `disconnectSockets` only reaches sockets held by
  // THIS process. A logout or suspension served by one replica would leave the
  // victim's socket alive on every other replica — the control looks like it
  // works and does not. In a hardened environment that is a boot failure, not a
  // warning, unless the operator has explicitly acknowledged a single-instance
  // deployment via REALTIME_ALLOW_SINGLE_INSTANCE.
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
      // Cast around the loose adapter type; @socket.io/redis-adapter returns a
      // (nsp) => Adapter factory, which is exactly what server.adapter expects.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      server.adapter(this.redisAdapterFactory as any);
    }
    return server;
  }
}

// ioredis' own connectTimeout does not bound the full connect+ready sequence,
// so the startup budget is enforced here.
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
