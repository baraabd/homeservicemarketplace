import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { EventEmitter } from 'node:events';
import type Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';

import type { AppConfigService } from '../../config/app-config.service';
import {
  MAX_REALTIME_PAYLOAD_BYTES,
  REALTIME_TRANSPORT,
  RealtimeSocketAdapter,
} from './realtime-socket.adapter';

// D-4 requirement 4 — "In production, do not silently claim cross-instance
// security if Redis is unavailable."
//
// Without the Socket.IO Redis adapter, `disconnectSockets` reaches only the
// sockets held by the current process. A logout or suspension served by one
// replica would leave the victim's socket alive on every other replica, while
// the logs happily report a successful eviction. These tests pin that a
// hardened environment REFUSES TO BOOT in that state unless the operator has
// explicitly acknowledged a single-instance deployment.
//
// The adapter builds its own pub/sub connections (it runs before Nest's
// onModuleInit, so it cannot borrow the shared RedisService), so "Redis is
// unavailable" is driven here by pointing it at an address nothing answers on.

// RFC 5737 TEST-NET-1 with the discard port: reserved for documentation, so
// nothing can answer and the host's real Redis is never involved.
const UNREACHABLE_HOST = '192.0.2.1';
const UNREACHABLE_PORT = 9;

function build(
  over: { nodeEnv?: string; realtime?: boolean; allowSingle?: boolean } = {},
): RealtimeSocketAdapter {
  const values: Record<string, unknown> = {
    NODE_ENV: over.nodeEnv ?? 'production',
    REALTIME_SOCKET_IO: over.realtime ?? true,
    REALTIME_ALLOW_SINGLE_INSTANCE: over.allowSingle ?? false,
    REDIS_HOST: UNREACHABLE_HOST,
    REDIS_PORT: UNREACHABLE_PORT,
    REDIS_PASSWORD: undefined,
    REDIS_DB: 0,
    REDIS_TLS: false,
    // Keep each case fast: the connect gives up almost immediately.
    REDIS_CONNECT_TIMEOUT_MS: 150,
    FRONTEND_URL: 'http://localhost:5173',
    CORS_ORIGINS: [],
  };
  const config = { get: (k: string) => values[k] } as unknown as AppConfigService;
  return new RealtimeSocketAdapter({} as INestApplicationContext, config);
}

jest.setTimeout(30_000);

describe('RealtimeSocketAdapter — cross-instance guarantee', () => {
  it.each(['production', 'staging'])(
    'REFUSES to boot in %s when realtime is on and Redis is unreachable',
    async (nodeEnv) => {
      const adapter = build({ nodeEnv });
      await expect(adapter.connectToRedis()).rejects.toThrow(
        /Socket\.IO Redis adapter is unavailable/i,
      );
    },
  );

  it('names the escape hatch in the failure message so the operator is not left guessing', async () => {
    const adapter = build({ nodeEnv: 'production' });
    await expect(adapter.connectToRedis()).rejects.toThrow(/REALTIME_ALLOW_SINGLE_INSTANCE/);
  });

  it('explains WHICH security property is missing, not just that Redis is down', async () => {
    // An operator reading only "Redis unavailable" would reasonably restart and
    // move on; they need to know what stops working.
    const adapter = build({ nodeEnv: 'production' });
    await expect(adapter.connectToRedis()).rejects.toThrow(/cross-instance socket eviction/i);
  });

  it('boots in production when single-instance mode is EXPLICITLY acknowledged', async () => {
    const adapter = build({ nodeEnv: 'production', allowSingle: true });
    await expect(adapter.connectToRedis()).resolves.toBeUndefined();
  });

  it.each(['development', 'test'])(
    'degrades with a warning instead of failing in %s',
    async (nodeEnv) => {
      const adapter = build({ nodeEnv });
      await expect(adapter.connectToRedis()).resolves.toBeUndefined();
    },
  );

  it('does not require Redis at all when the realtime channel is switched off', async () => {
    // REALTIME_SOCKET_IO=off closes every handshake at the door, so there are
    // no sockets to evict and no cross-instance claim to make.
    const adapter = build({ nodeEnv: 'production', realtime: false });
    await expect(adapter.connectToRedis()).resolves.toBeUndefined();
  });

  it('closing is safe when no clients were ever established', async () => {
    const adapter = build({ nodeEnv: 'development' });
    await adapter.connectToRedis();
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});

describe('R25 runtime Redis failure and transport bounds', () => {
  function fakeClient() {
    return Object.assign(new EventEmitter(), {
      status: 'ready',
      connect: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
      eval: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      publish: jest.fn().mockResolvedValue(1),
    });
  }
  async function runtime() {
    const adapter = build();
    const pub = fakeClient();
    const sub = fakeClient();
    const transport = adapter as unknown as { buildClient(): Redis };
    jest
      .spyOn(transport, 'buildClient')
      .mockReturnValueOnce(pub as never)
      .mockReturnValueOnce(sub as never);
    // This fixture tests registered control and bounded command/error paths.
    // The enabled two-replica integration checks actual Redis client events.
    await adapter.connectToRedis();
    const server = { adapter: jest.fn(), local: { disconnectSockets: jest.fn() } };
    const create = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(server);
    const io = adapter.createIOServer(0);
    const options = create.mock.calls[0][1] as Partial<ServerOptions>;
    create.mockRestore();
    return {
      adapter,
      pub,
      sub,
      server,
      control: (
        io as never as {
          [REALTIME_TRANSPORT]: NonNullable<
            ReturnType<(typeof import('./realtime-socket.adapter'))['realtimeTransport']>
          >;
        }
      )[REALTIME_TRANSPORT],
      options,
    };
  }

  it('bounds Engine.IO payload, heartbeat, handshake and compression memory', async () => {
    const { adapter, options } = await runtime();
    expect(options.maxHttpBufferSize).toBe(MAX_REALTIME_PAYLOAD_BYTES);
    expect(options.pingInterval).toBe(25_000);
    expect(options.pingTimeout).toBe(20_000);
    expect(options.connectTimeout).toBe(10_000);
    expect(options.perMessageDeflate).toBe(false);
    expect(options.httpCompression).toBe(false);
    expect(options.transports).toEqual(['websocket', 'polling']);
    await adapter.close();
  });

  it('rejects WebSocket and polling requests from an unapproved origin', async () => {
    const { adapter, options } = await runtime();
    const callback = jest.fn();
    options.allowRequest!(
      { headers: { origin: 'https://attacker.invalid', cookie: 'hsm_at=x' } } as never,
      callback,
    );
    expect(callback).toHaveBeenCalledWith(null, false);
    options.allowRequest!(
      { headers: { origin: 'http://localhost:5173', cookie: 'hsm_at=x' } } as never,
      callback,
    );
    expect(callback).toHaveBeenLastCalledWith(null, true);
    await adapter.close();
  });

  it('makes a failed cluster reservation close local sockets and block subsequent handshakes', async () => {
    const { adapter, pub, server, control } = await runtime();
    expect(control.isReady()).toBe(true);
    pub.eval.mockRejectedValueOnce(new Error('private redis address must not be logged'));
    expect(await control.reserve('u-1', 'socket-1')).toBe(false);
    expect(control.isReady()).toBe(false);
    expect(server.local.disconnectSockets).toHaveBeenCalledWith(true);
    expect(await control.reserve('u-1', 'socket-2')).toBe(false);
    await adapter.close();
  });

  it('uses one atomic Redis lease with a bounded expiry and opaque user key', async () => {
    const { adapter, pub, control } = await runtime();
    expect(await control.reserve('private-user-id', 'socket-1')).toBe(true);
    const args = pub.eval.mock.calls[0];
    expect(args[0]).toContain("redis.call('TIME')");
    expect(args[0]).toContain("redis.call('ZCARD'");
    expect(args.slice(1)).toEqual([
      1,
      expect.stringMatching(/^socketio:hsm:connections:[a-f0-9]{64}$/),
      'socket-1',
      6,
      45_000,
    ]);
    expect(args[2]).not.toContain('private-user-id');
    await control.release('private-user-id', 'socket-1');
    expect(pub.zrem).toHaveBeenCalledWith(args[2], 'socket-1');
    await adapter.close();
  });

  it('turns off ioredis offline replay and bounds commands while keeping reconnect backoff bounded', async () => {
    const adapter = build();
    const client = (adapter as unknown as { buildClient(): Redis }).buildClient();
    expect(client.options.enableOfflineQueue).toBe(false);
    expect(client.options.autoResendUnfulfilledCommands).toBe(false);
    expect(client.options.maxRetriesPerRequest).toBe(1);
    expect(client.options.commandTimeout).toBe(2_000);
    for (const attempt of [1, 2, 10, 100_000]) {
      const delay = client.options.retryStrategy!(attempt);
      expect(delay).toBeGreaterThanOrEqual(200);
      expect(delay).toBeLessThanOrEqual(5_250);
    }
    client.disconnect();
    await adapter.close();
  });

  it('bounds the adapter fire-and-forget publication backlog and closes delivery on overflow', async () => {
    const { adapter, pub, server, control } = await runtime();
    let release!: (result: number) => void;
    pub.publish.mockReturnValue(
      new Promise<number>((resolve) => {
        release = resolve;
      }),
    );
    const guarded = (adapter as unknown as { adapterClient(client: Redis): Redis }).adapterClient(
      pub as never,
    );
    const pending = Array.from({ length: 129 }, () =>
      guarded.publish('private-channel', 'bounded-packet'),
    );
    expect(await pending[128]).toBe(0);
    expect(pub.publish).toHaveBeenCalledTimes(128);
    expect(control.isReady()).toBe(false);
    expect(server.local.disconnectSockets).toHaveBeenCalledWith(true);
    release(1);
    await Promise.all(pending);
    await adapter.close();
  });

  it('observes a vendor fire-and-forget publish rejection and fails closed without an unhandled rejection', async () => {
    const { adapter, pub, control } = await runtime();
    pub.publish.mockRejectedValue(new Error('offline transport'));
    const guarded = (adapter as unknown as { adapterClient(client: Redis): Redis }).adapterClient(
      pub as never,
    );
    await expect(guarded.publish('private-channel', 'packet')).resolves.toBe(0);
    expect(control.isReady()).toBe(false);
    await adapter.close();
  });

  it('requires a successful fresh probe of both Redis directions before recovering from a command timeout', async () => {
    const { adapter, pub, sub, control } = await runtime();
    pub.eval.mockRejectedValueOnce(new Error('command timeout'));
    expect(await control.reserve('user-1', 'socket-1')).toBe(false);
    const probe = adapter as unknown as { probeRecovery(): Promise<void> };
    sub.ping.mockRejectedValueOnce(new Error('subscriber unavailable'));
    await probe.probeRecovery();
    expect(control.isReady()).toBe(false);
    await probe.probeRecovery();
    expect(control.isReady()).toBe(true);
    expect(sub.ping).toHaveBeenCalledTimes(2);
    expect(pub.ping).toHaveBeenCalledTimes(3);
    await adapter.close();
  });
});
