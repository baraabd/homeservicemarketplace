import { EventEmitter } from 'node:events';

import type { AppConfigService } from '../../config/app-config.service';

// Behavior queue consulted by FakeRedis.connect(). Tests push outcomes before
// invoking onModuleInit so each attempt consumes the next queued outcome.
const connectQueue: Array<'resolve' | Error> = [];

class FakeRedis extends EventEmitter {
  public status: 'wait' | 'ready' | 'end' = 'wait';
  public connect = jest.fn().mockImplementation(async () => {
    const next = connectQueue.shift();
    if (next instanceof Error) throw next;
    // On success simulate the driver emitting 'ready' so listeners fire.
    this.status = 'ready';
    this.emit('ready');
  });
  public ping = jest.fn();
  public quit = jest.fn().mockResolvedValue('OK');
}

const fakeInstances: FakeRedis[] = [];

jest.mock('ioredis', () => {
  const ctor = jest.fn().mockImplementation(() => {
    const inst = new FakeRedis();
    fakeInstances.push(inst);
    return inst;
  });
  return { __esModule: true, default: ctor };
});

import Redis from 'ioredis';

import { RedisService } from './redis.service';

// The default export is the jest.fn() ctor produced by jest.mock('ioredis')
// above (jest.mock calls are hoisted before imports by ts-jest).
const ioredisCtor = Redis as unknown as jest.Mock;

function mkConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const defaults: Record<string, unknown> = {
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: '',
    REDIS_DB: 0,
    REDIS_TLS: false,
    REDIS_CONNECT_TIMEOUT_MS: 10,
    STARTUP_MAX_RETRIES: 3,
    STARTUP_RETRY_BASE_MS: 1,
    STARTUP_RETRY_CAP_MS: 2,
  };
  const values = { ...defaults, ...overrides };
  return { get: (k: string) => values[k] } as unknown as AppConfigService;
}

describe('RedisService', () => {
  beforeEach(() => {
    fakeInstances.length = 0;
    connectQueue.length = 0;
  });

  it('connects on the first attempt and reports isReady', async () => {
    connectQueue.push('resolve');
    const svc = new RedisService(mkConfig());
    await svc.onModuleInit();
    expect(svc.isReady()).toBe(true);
    expect(fakeInstances[0].connect).toHaveBeenCalledTimes(1);
  });

  it('retries connect failures up to STARTUP_MAX_RETRIES then succeeds', async () => {
    connectQueue.push(new Error('ECONNREFUSED'), new Error('ECONNREFUSED'), 'resolve');
    const svc = new RedisService(mkConfig({ STARTUP_MAX_RETRIES: 4 }));
    await svc.onModuleInit();
    expect(fakeInstances[0].connect).toHaveBeenCalledTimes(3);
    expect(svc.isReady()).toBe(true);
  });

  it('fails (no degraded fallback) when all connect attempts throw', async () => {
    connectQueue.push(new Error('persistent-redis-down'), new Error('persistent-redis-down'));
    const svc = new RedisService(mkConfig({ STARTUP_MAX_RETRIES: 2 }));
    await expect(svc.onModuleInit()).rejects.toThrow(/persistent-redis-down/);
    expect(svc.isReady()).toBe(false);
    expect(fakeInstances[0].connect).toHaveBeenCalledTimes(2);
  });

  it('after a failed init, onModuleDestroy can still quit() the abandoned client', async () => {
    // Prevents ioredis retryStrategy from keeping timers alive when startup fails.
    connectQueue.push(new Error('down'), new Error('down'));
    const svc = new RedisService(mkConfig({ STARTUP_MAX_RETRIES: 2 }));
    await expect(svc.onModuleInit()).rejects.toThrow();
    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
    expect(fakeInstances[0].quit).toHaveBeenCalledTimes(1);
  });

  it('ping returns true on PONG, false on throw', async () => {
    connectQueue.push('resolve');
    const svc = new RedisService(mkConfig());
    await svc.onModuleInit();

    fakeInstances[0].ping.mockResolvedValueOnce('PONG');
    await expect(svc.ping()).resolves.toBe(true);

    fakeInstances[0].ping.mockRejectedValueOnce(new Error('down'));
    await expect(svc.ping()).resolves.toBe(false);
  });

  it('onModuleDestroy calls quit and flips ready to false', async () => {
    connectQueue.push('resolve');
    const svc = new RedisService(mkConfig());
    await svc.onModuleInit();

    await svc.onModuleDestroy();
    expect(fakeInstances[0].quit).toHaveBeenCalledTimes(1);
    expect(svc.isReady()).toBe(false);
  });

  it('onModuleDestroy swallows quit errors so shutdown never crashes', async () => {
    connectQueue.push('resolve');
    const svc = new RedisService(mkConfig());
    await svc.onModuleInit();

    fakeInstances[0].quit.mockRejectedValueOnce(new Error('connection gone'));
    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
  });

  describe('ioredis constructor options (current behavior pin)', () => {
    // These tests pin the options surface we pass to ioredis. They do not
    // assert "correct" values — they pin the values the current implementation
    // chooses, so any accidental drift is surfaced in review.

    let ctorArgs: Record<string, unknown> | undefined;

    beforeEach(() => {
      ctorArgs = undefined;
      // Grab the options the next time new Redis(...) is invoked.
      ioredisCtor.mockImplementationOnce((opts: Record<string, unknown>) => {
        ctorArgs = opts;
        const inst = new FakeRedis();
        fakeInstances.push(inst);
        return inst;
      });
    });

    it('forwards host, port, db, and connectTimeout from config', async () => {
      connectQueue.push('resolve');
      const svc = new RedisService(
        mkConfig({
          REDIS_HOST: 'redis.internal',
          REDIS_PORT: 6390,
          REDIS_DB: 2,
          REDIS_CONNECT_TIMEOUT_MS: 7_777,
        }),
      );
      await svc.onModuleInit();
      expect(ctorArgs).toMatchObject({
        host: 'redis.internal',
        port: 6390,
        db: 2,
        connectTimeout: 7_777,
      });
    });

    it('omits password when the config value is empty', async () => {
      connectQueue.push('resolve');
      const svc = new RedisService(mkConfig({ REDIS_PASSWORD: '' }));
      await svc.onModuleInit();
      expect(ctorArgs?.password).toBeUndefined();
    });

    it('passes password through when set', async () => {
      connectQueue.push('resolve');
      const svc = new RedisService(mkConfig({ REDIS_PASSWORD: 's3cret' }));
      await svc.onModuleInit();
      expect(ctorArgs?.password).toBe('s3cret');
    });

    it('enables TLS (empty object) when REDIS_TLS=true, undefined otherwise', async () => {
      connectQueue.push('resolve');
      let svc = new RedisService(mkConfig({ REDIS_TLS: true }));
      await svc.onModuleInit();
      expect(ctorArgs?.tls).toEqual({});

      // Second round — fresh mock, new instance.
      // Cast resets the narrowed type so subsequent assignments inside the
      // mock callback don't get inferred as `undefined`.
      ctorArgs = undefined as Record<string, unknown> | undefined;
      ioredisCtor.mockImplementationOnce((opts: Record<string, unknown>) => {
        ctorArgs = opts;
        const inst = new FakeRedis();
        fakeInstances.push(inst);
        return inst;
      });
      connectQueue.push('resolve');
      svc = new RedisService(mkConfig({ REDIS_TLS: false }));
      await svc.onModuleInit();
      expect((ctorArgs as Record<string, unknown> | undefined)?.tls).toBeUndefined();
    });

    it('sets the hardened defaults: maxRetriesPerRequest=3, enableReadyCheck, enableAutoPipelining, lazyConnect', async () => {
      connectQueue.push('resolve');
      const svc = new RedisService(mkConfig());
      await svc.onModuleInit();
      expect(ctorArgs).toMatchObject({
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        enableAutoPipelining: true,
        lazyConnect: true,
      });
    });

    it('retryStrategy is a function with bounded linear growth capped at 5000ms', async () => {
      connectQueue.push('resolve');
      const svc = new RedisService(mkConfig());
      await svc.onModuleInit();
      const strategy = ctorArgs?.retryStrategy as (times: number) => number;
      expect(typeof strategy).toBe('function');
      // Linear progression within the cap
      expect(strategy(1)).toBe(200);
      expect(strategy(5)).toBe(1_000);
      // Cap
      expect(strategy(25)).toBe(5_000);
      expect(strategy(1_000)).toBe(5_000);
    });
  });
});
