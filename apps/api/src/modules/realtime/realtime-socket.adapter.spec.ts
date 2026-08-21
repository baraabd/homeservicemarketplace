import type { INestApplicationContext } from '@nestjs/common';

import type { AppConfigService } from '../../config/app-config.service';
import type { RedisService } from '../../infrastructure/redis/redis.service';
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

function build(
  over: { nodeEnv?: string; realtime?: boolean; allowSingle?: boolean; redisReady?: boolean } = {},
) {
  const values: Record<string, unknown> = {
    NODE_ENV: over.nodeEnv ?? 'production',
    REALTIME_SOCKET_IO: over.realtime ?? true,
    REALTIME_ALLOW_SINGLE_INSTANCE: over.allowSingle ?? false,
  };
  const config = { get: (k: string) => values[k] } as unknown as AppConfigService;
  const redis = {
    isReady: () => over.redisReady ?? false,
    getClient: () => {
      throw new Error('not used in these cases');
    },
  } as unknown as RedisService;
  const app = {} as INestApplicationContext;
  return new RealtimeSocketAdapter(app, config, redis);
}

describe('RealtimeSocketAdapter — cross-instance guarantee', () => {
  it.each(['production', 'staging'])(
    'REFUSES to boot in %s when realtime is on and Redis is unavailable',
    async (nodeEnv) => {
      const adapter = build({ nodeEnv, redisReady: false });
      await expect(adapter.connectToRedis()).rejects.toThrow(
        /Redis adapter is unavailable|was not ready/i,
      );
    },
  );

  it('names the escape hatch in the failure message so the operator is not left guessing', async () => {
    const adapter = build({ nodeEnv: 'production', redisReady: false });
    await expect(adapter.connectToRedis()).rejects.toThrow(/REALTIME_ALLOW_SINGLE_INSTANCE/);
  });

  it('boots in production when single-instance mode is EXPLICITLY acknowledged', async () => {
    const adapter = build({ nodeEnv: 'production', redisReady: false, allowSingle: true });
    await expect(adapter.connectToRedis()).resolves.toBeUndefined();
  });

  it.each(['development', 'test'])(
    'degrades with a warning instead of failing in %s',
    async (nodeEnv) => {
      const adapter = build({ nodeEnv, redisReady: false });
      await expect(adapter.connectToRedis()).resolves.toBeUndefined();
    },
  );

  it('does not require Redis at all when the realtime channel is switched off', async () => {
    // REALTIME_SOCKET_IO=off closes every handshake at the door, so there are
    // no sockets to evict and no cross-instance claim to make.
    const adapter = build({ nodeEnv: 'production', realtime: false, redisReady: false });
    await expect(adapter.connectToRedis()).resolves.toBeUndefined();
  });
});
