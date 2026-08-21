import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../redis/redis.service';
import { RateLimitStore } from './rate-limit.store';

// D-1 — the shared rate-limit store.
//
// These tests run the real Lua-dispatch code path against a small in-test
// Redis double that implements the exact commands the script uses, so the
// counter/expiry/block semantics are pinned without needing a live server.
// The two-instance aggregate test in
// test/integration/registration-throttle.integration.spec.ts exercises a real
// Redis and is the authoritative proof for the cross-replica requirement.

interface Entry {
  value: number;
  expiresAt: number; // epoch ms; Infinity = no ttl
}

// Minimal Redis double supporting INCR / GET / PTTL / PEXPIRE / SET ... PX NX,
// driven through a hand-rolled evaluator for the store's Lua script. Rather
// than parse Lua, we re-implement the same decision here — the store's job
// under test is the CONTRACT it exposes (RateLimitDecision), including the
// millisecond→second conversion and the never-zero Retry-After.
class FakeRedis {
  readonly store = new Map<string, Entry>();
  now = 1_000_000;
  failNext = false;

  private live(key: string): Entry | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  private pttl(key: string): number {
    const e = this.live(key);
    if (!e) return -2;
    if (e.expiresAt === Infinity) return -1;
    return e.expiresAt - this.now;
  }

  // Matches ioredis' loose `eval` signature: a script, a key count, then the
  // keys and argv interleaved as strings/numbers.
  eval(
    _script: string,
    numKeys: number,
    ...args: Array<string | number>
  ): Promise<[number, number, number, number]> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('redis-down'));
    }
    const [hitsKey, blockKey] = args.slice(0, numKeys) as string[];
    const [windowMs, limit, blockMs] = args.slice(numKeys).map(Number) as number[];

    const blockRemaining = this.pttl(blockKey);
    if (blockRemaining > 0) {
      const current = this.live(hitsKey)?.value ?? 0;
      let windowTtl = this.pttl(hitsKey);
      if (windowTtl < 0) windowTtl = blockRemaining;
      return Promise.resolve([current, windowTtl, 1, blockRemaining]);
    }

    const existing = this.live(hitsKey);
    const hits = (existing?.value ?? 0) + 1;
    this.store.set(hitsKey, {
      value: hits,
      expiresAt: existing?.expiresAt ?? this.now + windowMs,
    });
    const ttl = this.pttl(hitsKey);

    let blocked = 0;
    let remaining = 0;
    if (hits > limit) {
      blocked = 1;
      if (!this.live(blockKey)) {
        this.store.set(blockKey, { value: 1, expiresAt: this.now + blockMs });
      }
      remaining = this.pttl(blockKey);
    }
    return Promise.resolve([hits, ttl, blocked, remaining]);
  }
}

function build(opts: { redisRequired?: boolean } = {}) {
  const redis = new FakeRedis();
  const redisService = { getClient: () => redis } as unknown as RedisService;
  const config = {
    get: (key: string) =>
      key === 'THROTTLE_REDIS_REQUIRED' ? (opts.redisRequired ?? true) : undefined,
  } as unknown as AppConfigService;
  return { redis, store: new RateLimitStore(redisService, config) };
}

const WINDOW_MS = 3_600_000;

describe('RateLimitStore', () => {
  describe('consume', () => {
    it('allows exactly `limit` hits and blocks the next one', async () => {
      const { store } = build();
      const call = () =>
        store.consume({ bucket: 'b', identity: 'id', limit: 5, windowMs: WINDOW_MS });

      for (let i = 1; i <= 5; i += 1) {
        const decision = await call();
        expect(decision.isBlocked).toBe(false);
        expect(decision.totalHits).toBe(i);
      }

      const sixth = await call();
      expect(sixth.isBlocked).toBe(true);
      expect(sixth.totalHits).toBe(6);
    });

    it('keeps rejecting after the limit is breached, without resetting the counter', async () => {
      const { store } = build();
      const call = () =>
        store.consume({ bucket: 'b', identity: 'id', limit: 2, windowMs: WINDOW_MS });
      await call();
      await call();
      expect((await call()).isBlocked).toBe(true);
      expect((await call()).isBlocked).toBe(true);
      expect((await call()).isBlocked).toBe(true);
    });

    it('keeps different identities in independent buckets', async () => {
      const { store } = build();
      for (let i = 0; i < 5; i += 1) {
        await store.consume({ bucket: 'b', identity: 'a', limit: 5, windowMs: WINDOW_MS });
      }
      expect(
        (await store.consume({ bucket: 'b', identity: 'a', limit: 5, windowMs: WINDOW_MS }))
          .isBlocked,
      ).toBe(true);
      expect(
        (await store.consume({ bucket: 'b', identity: 'b', limit: 5, windowMs: WINDOW_MS }))
          .isBlocked,
      ).toBe(false);
    });

    it('keeps different buckets independent for the same identity', async () => {
      const { store } = build();
      for (let i = 0; i < 5; i += 1) {
        await store.consume({ bucket: 'one', identity: 'id', limit: 5, windowMs: WINDOW_MS });
      }
      expect(
        (await store.consume({ bucket: 'one', identity: 'id', limit: 5, windowMs: WINDOW_MS }))
          .isBlocked,
      ).toBe(true);
      expect(
        (await store.consume({ bucket: 'two', identity: 'id', limit: 5, windowMs: WINDOW_MS }))
          .isBlocked,
      ).toBe(false);
    });

    it('lets the budget recover once the window elapses', async () => {
      const { redis, store } = build();
      const call = () =>
        store.consume({ bucket: 'b', identity: 'id', limit: 1, windowMs: WINDOW_MS });
      await call();
      expect((await call()).isBlocked).toBe(true);

      redis.now += WINDOW_MS + 1;
      const afterWindow = await call();
      expect(afterWindow.isBlocked).toBe(false);
      expect(afterWindow.totalHits).toBe(1);
    });

    it('never reports a zero or negative Retry-After', async () => {
      const { store } = build();
      for (let i = 0; i < 3; i += 1) {
        await store.consume({ bucket: 'b', identity: 'id', limit: 1, windowMs: 500 });
      }
      const decision = await store.consume({
        bucket: 'b',
        identity: 'id',
        limit: 1,
        windowMs: 500,
      });
      expect(decision.isBlocked).toBe(true);
      expect(decision.secondsUntilBlockExpires).toBeGreaterThanOrEqual(1);
      expect(decision.secondsUntilReset).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Redis failure policy', () => {
    it('FAILS CLOSED when THROTTLE_REDIS_REQUIRED is true', async () => {
      const { redis, store } = build({ redisRequired: true });
      redis.failNext = true;
      const decision = await store.consume({
        bucket: 'auth:register:ip',
        identity: '203.0.113.5',
        limit: 5,
        windowMs: WINDOW_MS,
      });
      // A limiter that cannot count must not let the request through — that
      // is the exact bypass D-1 closes.
      expect(decision.isBlocked).toBe(true);
      expect(decision.secondsUntilBlockExpires).toBeGreaterThan(0);
    });

    it('falls back to an in-process count only when Redis is explicitly optional', async () => {
      const { redis, store } = build({ redisRequired: false });
      redis.failNext = true;
      const decision = await store.consume({
        bucket: 'b',
        identity: 'id',
        limit: 5,
        windowMs: WINDOW_MS,
      });
      expect(decision.isBlocked).toBe(false);
      expect(decision.totalHits).toBe(1);
    });
  });

  describe('ThrottlerStorage adapter', () => {
    it('reports seconds (not milliseconds) so Retry-After is sane', async () => {
      const { store } = build();
      const record = await store.increment('key', WINDOW_MS, 5, WINDOW_MS, 'default');
      expect(record.totalHits).toBe(1);
      expect(record.isBlocked).toBe(false);
      // 3_600_000 ms == 3600 s. A millisecond value here would tell clients to
      // wait 41 days.
      expect(record.timeToExpire).toBe(3600);
    });

    it('marks the request blocked once the limit is exceeded', async () => {
      const { store } = build();
      for (let i = 0; i < 2; i += 1) {
        await store.increment('key', 60_000, 2, 60_000, 'default');
      }
      const record = await store.increment('key', 60_000, 2, 60_000, 'default');
      expect(record.isBlocked).toBe(true);
      expect(record.timeToBlockExpire).toBeGreaterThan(0);
    });
  });
});
