import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis, { type RedisOptions } from 'ioredis';
import { Server, type ServerOptions } from 'socket.io';

import { AppConfigService } from '../../config/app-config.service';

export const MAX_REALTIME_PAYLOAD_BYTES = 64 * 1024;
export const MAX_REALTIME_CONNECTIONS_PER_USER = 6;
export const MAX_REALTIME_CONNECTIONS_PER_INSTANCE = 1_000;
export const REALTIME_LEASE_TTL_MS = 45_000;
const REDIS_CONNECT_TIMEOUT_MS = 10_000;
const REDIS_COMMAND_TIMEOUT_MS = 2_000;
const CHANNEL_PREFIX = 'socketio:hsm';

/** Transport health belongs to the actual server. An unregistered adapter
 * cannot silently claim to enforce cross-instance authorization. */
export interface RealtimeTransportControl {
  isReady(): boolean;
  reserve(userId: string, socketId: string): Promise<boolean>;
  release(userId: string, socketId: string): Promise<void>;
}
export const REALTIME_TRANSPORT = Symbol('hsm.realtime.transport');
export type ManagedRealtimeServer = Server & {
  [REALTIME_TRANSPORT]?: RealtimeTransportControl;
};
export function realtimeTransport(
  server: Server | undefined,
): RealtimeTransportControl | undefined {
  return (server as ManagedRealtimeServer | undefined)?.[REALTIME_TRANSPORT];
}

/** Exact REST origins; native clients may omit Origin only without cookies.
 * Subscriptions are reads. Business writes still require REST and its CSRF. */
export function realtimeOriginAllowed(
  config: AppConfigService,
  origin: string | string[] | undefined,
  hasCookie: boolean,
): boolean {
  if (origin === undefined) return !hasCookie;
  if (typeof origin !== 'string' || origin === 'null') return false;
  const allowed = [config.get('FRONTEND_URL'), ...(config.get('CORS_ORIGINS') ?? [])];
  return allowed.some((candidate) => candidate === origin);
}

// Atomic, cluster-wide reservations. Redis TIME avoids dependence on API
// clocks. Active sockets renew every ten seconds; crashed replicas expire.
const RESERVE_CONNECTION = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local existing = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not existing and redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], now + tonumber(ARGV[3]), ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
`;

/** Classic Redis Pub/Sub has no durable replay. If either connection fails,
 * close socket delivery and handshakes. REST/polling remains authoritative.
 * An established cluster never silently downgrades to local-only broadcasts. */
export class RealtimeSocketAdapter extends IoAdapter {
  private readonly log = new Logger(RealtimeSocketAdapter.name);
  private redisAdapterFactory: ReturnType<typeof createAdapter> | null = null;
  private clients: Redis[] = [];
  private readonly servers = new Set<Server>();
  private readonly singleInstanceLeases = new Map<string, Map<string, number>>();
  private ready = false;
  private singleInstance = false;
  private stopped = false;
  private readinessTimer?: NodeJS.Timeout;
  private probeRunning = false;
  private outageGeneration = 0;

  constructor(
    app: INestApplicationContext,
    private readonly config: AppConfigService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    if (!this.config.get('REALTIME_SOCKET_IO')) return;
    this.stopped = false;
    const pub = this.buildClient();
    const sub = this.buildClient();
    this.clients = [pub, sub];
    try {
      await withTimeout(Promise.all([pub.connect(), sub.connect()]), REDIS_CONNECT_TIMEOUT_MS);
      await withTimeout(pub.ping(), REDIS_COMMAND_TIMEOUT_MS);
      this.redisAdapterFactory = createAdapter(this.adapterClient(pub), this.adapterClient(sub), {
        key: CHANNEL_PREFIX,
        requestsTimeout: REDIS_COMMAND_TIMEOUT_MS,
        publishOnSpecificResponseChannel: true,
      });
      this.ready = true;
      this.readinessTimer = setInterval(() => void this.probeRecovery(), 2_000);
      this.readinessTimer.unref();
      this.log.log('Socket.IO Redis ready; authorized cross-instance delivery enabled');
    } catch {
      // quit() on a client that never became ready can wait indefinitely.
      pub.disconnect();
      sub.disconnect();
      this.clients = [];
      this.failOrDegrade();
    }
  }

  async close(server?: Server): Promise<void> {
    this.stopped = true;
    if (this.readinessTimer) clearInterval(this.readinessTimer);
    this.markUnavailable();
    await Promise.allSettled(
      this.clients.map(async (client) => {
        try {
          if (client.status === 'ready') await withTimeout(client.quit(), REDIS_COMMAND_TIMEOUT_MS);
        } finally {
          client.disconnect();
        }
      }),
    );
    this.clients = [];
    this.singleInstanceLeases.clear();
    this.servers.clear();
    if (server) await super.close(server);
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
      enableOfflineQueue: false,
      autoResendUnfulfilledCommands: false,
      maxRetriesPerRequest: 1,
      commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
      // Reconnect at a bounded, jittered cadence without buffering events.
      retryStrategy: (times) =>
        Math.min(200 * 2 ** Math.min(times, 5), 5_000) + Math.floor(Math.random() * 250),
    };
    const client = new Redis(options);
    client.on('error', () => this.markUnavailable());
    client.on('close', () => this.markUnavailable());
    client.on('end', () => this.markUnavailable());
    client.on('reconnecting', () => this.markUnavailable());
    client.on('ready', () => {
      if (
        !this.stopped &&
        this.redisAdapterFactory &&
        this.clients.length === 2 &&
        this.clients.every((connection) => connection.status === 'ready')
      ) {
        this.ready = true;
        this.log.log('Socket.IO Redis restored; new connections require REST recovery');
      }
    });
    return client;
  }

  private adapterClient(client: Redis): Redis {
    // redis-adapter 8.3 intentionally does not await these fire-and-forget
    // operations. With offline queues disabled their rejected promises must
    // still be observed. Keep command/lease failures rejecting normally.
    const bestEffort = new Set([
      'publish',
      'subscribe',
      'psubscribe',
      'unsubscribe',
      'punsubscribe',
    ]);
    let pendingPublications = 0;
    let pendingBytes = 0;
    return new Proxy(client, {
      get: (target, property, receiver) => {
        const value: unknown = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        if (typeof property === 'string' && bestEffort.has(property)) {
          return (...args: unknown[]) => {
            const bytes = args.reduce<number>(
              (total, arg) =>
                total +
                (typeof arg === 'string'
                  ? Buffer.byteLength(arg)
                  : Buffer.isBuffer(arg)
                    ? arg.length
                    : 0),
              0,
            );
            if (
              property === 'publish' &&
              (pendingPublications >= 128 || pendingBytes + bytes > 8 * 1024 * 1024)
            ) {
              this.markUnavailable();
              return Promise.resolve(0);
            }
            if (property === 'publish') {
              pendingPublications += 1;
              pendingBytes += bytes;
            }
            return Promise.resolve()
              .then(() => Reflect.apply(value, target, args))
              .catch(() => {
                this.markUnavailable();
                return 0;
              })
              .finally(() => {
                if (property === 'publish') {
                  pendingPublications -= 1;
                  pendingBytes -= bytes;
                }
              });
          };
        }
        return value.bind(target);
      },
    });
  }

  private markUnavailable(): void {
    const wasReady = this.ready;
    this.ready = false;
    this.outageGeneration += 1;
    if (this.stopped) this.singleInstance = false;
    for (const server of this.servers) {
      // The broken Redis adapter cannot guarantee remote eviction. Each
      // replica monitors its own pair and authorizes every delivery as well.
      server.local.disconnectSockets(true);
    }
    if (wasReady && !this.stopped) {
      this.log.warn('Socket.IO Redis unavailable; socket delivery closed, REST recovery required');
    }
  }

  private async probeRecovery(): Promise<void> {
    if (
      this.ready ||
      this.stopped ||
      this.probeRunning ||
      !this.redisAdapterFactory ||
      this.clients.length !== 2 ||
      this.clients.some((client) => client.status !== 'ready')
    )
      return;
    this.probeRunning = true;
    const generation = this.outageGeneration;
    try {
      // Command timeout/backpressure can close delivery without closing TCP.
      // Both directions must serve a fresh bounded PING before readmission.
      await withTimeout(
        Promise.all(this.clients.map((client) => client.ping())),
        REDIS_COMMAND_TIMEOUT_MS,
      );
      if (
        !this.stopped &&
        generation === this.outageGeneration &&
        this.clients.every((client) => client.status === 'ready')
      )
        this.ready = true;
    } catch {
      this.markUnavailable();
    } finally {
      this.probeRunning = false;
    }
  }

  private failOrDegrade(): void {
    const hardened =
      this.config.isProduction || ['production', 'staging'].includes(this.config.get('NODE_ENV'));
    const acknowledged = this.config.get('REALTIME_ALLOW_SINGLE_INSTANCE');
    if (hardened && !acknowledged) {
      throw new Error(
        'Realtime is enabled but the Socket.IO Redis adapter is unavailable. ' +
          'Cross-instance socket eviction cannot be guaranteed; boot refused. Fix Redis, or ' +
          'set REALTIME_ALLOW_SINGLE_INSTANCE=true only for an explicit single-instance deployment.',
      );
    }
    // Development can boot for REST; only explicit acknowledgement enables
    // local-only sockets, with no cross-instance security claim.
    this.singleInstance = Boolean(acknowledged);
    this.log.warn(
      this.singleInstance
        ? 'Socket.IO explicitly limited to one API instance'
        : 'Socket.IO unavailable; API remains available for authenticated REST polling',
    );
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      transports: ['websocket', 'polling'],
      maxHttpBufferSize: MAX_REALTIME_PAYLOAD_BYTES,
      pingInterval: 25_000,
      pingTimeout: 20_000,
      connectTimeout: 10_000,
      perMessageDeflate: false,
      httpCompression: false,
      // CORS alone does not protect WebSocket upgrades.
      cors: {
        credentials: true,
        origin: [
          this.config.get('FRONTEND_URL'),
          ...(this.config.get('CORS_ORIGINS') ?? []),
        ].filter(Boolean),
      },
      allowRequest: (
        request: IncomingMessage,
        callback: (error: string | null, allowed: boolean) => void,
      ) => {
        const allowed = realtimeOriginAllowed(
          this.config,
          request.headers.origin,
          Boolean(request.headers.cookie),
        );
        callback(null, allowed && !this.stopped && (this.ready || this.singleInstance));
      },
    }) as ManagedRealtimeServer;
    if (this.redisAdapterFactory) server.adapter(this.redisAdapterFactory);
    this.servers.add(server);
    server[REALTIME_TRANSPORT] = {
      isReady: () => !this.stopped && (this.ready || this.singleInstance),
      reserve: (userId, socketId) => this.reserve(userId, socketId),
      release: (userId, socketId) => this.release(userId, socketId),
    };
    return server;
  }

  private leaseKey(userId: string): string {
    return `${CHANNEL_PREFIX}:connections:${createHash('sha256').update(userId).digest('hex')}`;
  }

  private async reserve(userId: string, socketId: string): Promise<boolean> {
    if (this.stopped) return false;
    if (this.ready && this.clients[0]) {
      try {
        const result = await this.clients[0].eval(
          RESERVE_CONNECTION,
          1,
          this.leaseKey(userId),
          socketId,
          MAX_REALTIME_CONNECTIONS_PER_USER,
          REALTIME_LEASE_TTL_MS,
        );
        return result === 1 && this.ready;
      } catch {
        this.markUnavailable();
        return false;
      }
    }
    if (!this.singleInstance) return false;
    const leases = this.singleInstanceLeases.get(userId) ?? new Map<string, number>();
    const now = Date.now();
    for (const [id, expires] of leases) if (expires <= now) leases.delete(id);
    if (!leases.has(socketId) && leases.size >= MAX_REALTIME_CONNECTIONS_PER_USER) return false;
    leases.set(socketId, now + REALTIME_LEASE_TTL_MS);
    this.singleInstanceLeases.set(userId, leases);
    return true;
  }

  private async release(userId: string, socketId: string): Promise<void> {
    const leases = this.singleInstanceLeases.get(userId);
    leases?.delete(socketId);
    if (leases?.size === 0) this.singleInstanceLeases.delete(userId);
    if (!this.ready || !this.clients[0]) return;
    try {
      await this.clients[0].zrem(this.leaseKey(userId), socketId);
    } catch {
      this.markUnavailable();
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Realtime operation timed out')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
