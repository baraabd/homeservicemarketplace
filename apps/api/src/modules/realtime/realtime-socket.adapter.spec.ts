import type { INestApplicationContext } from '@nestjs/common';

import type { AppConfigService } from '../../config/app-config.service';
import { RealtimeSocketAdapter } from './realtime-socket.adapter';

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
