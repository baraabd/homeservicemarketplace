import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
// Not re-exported from the package root in v6 — import from the interface
// module so the increment() return type is checked against the real contract.
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../redis/redis.service';

// D-1 — shared, cross-instance rate-limit counters.
//
// The previous setup used @nestjs/throttler's default in-memory storage, so
// every API replica kept its OWN counter. With N replicas behind a load
// balancer the effective budget was N × limit, and an attacker only had to
// spray connections to walk past any per-route limit. Counters now live in
// Redis, keyed by a caller-supplied identity, so the budget is aggregate.
//
// Failure policy — FAIL CLOSED. If Redis cannot be reached we do NOT fall
// back to a per-instance in-memory count (that is precisely the bypass we are
// closing) and we do NOT allow the request through. We report the caller as
// blocked. This is consistent with the rest of the hardening: the API already
// requires Redis to boot, and session validation fails closed on the same
// dependency, so "Redis is gone" is not a state in which requests should be
// served. `THROTTLE_REDIS_REQUIRED=false` (rejected in production/staging by
// env.validation.ts) opts a single-instance local run into an in-process
// fallback instead.

export interface RateLimitDecision {
  /** Hits recorded in the current window, INCLUDING this one. */
  totalHits: number;
  /** Whether this request exceeded the limit and must be rejected. */
  isBlocked: boolean;
  /** Whole seconds until the current window resets. Always >= 1. */
  secondsUntilReset: number;
  /** Whole seconds until the block lifts. Always >= 1 when blocked. */
  secondsUntilBlockExpires: number;
}

// Atomic increment-and-decide. Doing this in Lua rather than as
// INCR + EXPIRE + GET round-trips removes the race where two concurrent
// requests both observe `hits <= limit` and both pass.
//
// KEYS[1] hits counter, KEYS[2] block marker
// ARGV[1] window ttl (ms), ARGV[2] limit, ARGV[3] block duration (ms)
// -> { totalHits, ttlMs, isBlocked(0|1), blockRemainingMs }
const CONSUME_LUA = `
local blockRemaining = redis.call('PTTL', KEYS[2])
if blockRemaining > 0 then
  local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  local windowTtl = redis.call('PTTL', KEYS[1])
  if windowTtl < 0 then windowTtl = blockRemaining end
  return { current, windowTtl, 1, blockRemaining }
end

local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end

local blocked = 0
local remaining = 0
if hits > tonumber(ARGV[2]) then
  blocked = 1
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3], 'NX')
  remaining = redis.call('PTTL', KEYS[2])
  if remaining < 0 then remaining = tonumber(ARGV[3]) end
end

return { hits, ttl, blocked, remaining }
`;

const KEY_PREFIX = 'rl:';

@Injectable()
export class RateLimitStore implements ThrottlerStorage {
  private readonly logger = new Logger(RateLimitStore.name);
  // In-process fallback, used ONLY when THROTTLE_REDIS_REQUIRED=false (local
  // single-instance runs). Never reachable in production/staging.
  private readonly local = new Map<
    string,
    { hits: number; resetAt: number; blockedUntil: number }
  >();

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Records one hit against `identity` inside `bucket` and decides whether it
   * is over budget.
   *
   * @param bucket    logical limiter name, e.g. `auth:register:ip`
   * @param identity  already-normalised caller identity (IP, email, user id)
   */
  async consume(params: {
    bucket: string;
    identity: string;
    limit: number;
    windowMs: number;
    blockMs?: number;
  }): Promise<RateLimitDecision> {
    const { bucket, identity, limit, windowMs } = params;
    const blockMs = params.blockMs ?? windowMs;
    const hitsKey = `${KEY_PREFIX}${bucket}:${identity}`;
    const blockKey = `${KEY_PREFIX}${bucket}:${identity}:blocked`;

    try {
      const raw = (await this.redis
        .getClient()
        .eval(
          CONSUME_LUA,
          2,
          hitsKey,
          blockKey,
          String(windowMs),
          String(limit),
          String(blockMs),
        )) as [number, number, number, number];

      const [totalHits, ttlMs, blockedFlag, blockRemainingMs] = raw.map(Number) as [
        number,
        number,
        number,
        number,
      ];
      return {
        totalHits,
        isBlocked: blockedFlag === 1,
        secondsUntilReset: toSeconds(ttlMs, windowMs),
        secondsUntilBlockExpires: toSeconds(blockRemainingMs, blockMs),
      };
    } catch (err) {
      return this.onRedisFailure(bucket, hitsKey, limit, windowMs, blockMs, err as Error);
    }
  }

  // ThrottlerStorage contract used by the global ThrottlerGuard. `ttl` and
  // `blockDuration` arrive in MILLISECONDS; `timeToExpire` /
  // `timeToBlockExpire` are returned in SECONDS (that is what the guard puts
  // in Retry-After / X-RateLimit-Reset).
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const decision = await this.consume({
      bucket: `throttler:${throttlerName}`,
      identity: key,
      limit,
      windowMs: ttl,
      blockMs: blockDuration,
    });
    return {
      totalHits: decision.totalHits,
      timeToExpire: decision.secondsUntilReset,
      isBlocked: decision.isBlocked,
      timeToBlockExpire: decision.secondsUntilBlockExpires,
    };
  }

  private onRedisFailure(
    bucket: string,
    hitsKey: string,
    limit: number,
    windowMs: number,
    blockMs: number,
    err: Error,
  ): RateLimitDecision {
    if (this.config.get('THROTTLE_REDIS_REQUIRED')) {
      // Fail closed. Log the bucket, never the identity (it can be an email).
      this.logger.error({
        msg: 'rate-limit.redis.unavailable.fail-closed',
        bucket,
        err: err.message,
      });
      return {
        totalHits: limit + 1,
        isBlocked: true,
        secondsUntilReset: toSeconds(windowMs, windowMs),
        secondsUntilBlockExpires: toSeconds(blockMs, blockMs),
      };
    }

    this.logger.warn({
      msg: 'rate-limit.redis.unavailable.local-fallback',
      bucket,
      err: err.message,
    });
    return this.consumeLocal(hitsKey, limit, windowMs, blockMs);
  }

  // Deliberately simple: a single-instance dev convenience, not a security
  // control. Entries are evicted lazily on next touch of the same key.
  private consumeLocal(
    key: string,
    limit: number,
    windowMs: number,
    blockMs: number,
  ): RateLimitDecision {
    const now = Date.now();
    let entry = this.local.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { hits: 0, resetAt: now + windowMs, blockedUntil: 0 };
      this.local.set(key, entry);
    }
    if (entry.blockedUntil > now) {
      return {
        totalHits: entry.hits,
        isBlocked: true,
        secondsUntilReset: toSeconds(entry.resetAt - now, windowMs),
        secondsUntilBlockExpires: toSeconds(entry.blockedUntil - now, blockMs),
      };
    }
    entry.hits += 1;
    if (entry.hits > limit) {
      entry.blockedUntil = now + blockMs;
      return {
        totalHits: entry.hits,
        isBlocked: true,
        secondsUntilReset: toSeconds(entry.resetAt - now, windowMs),
        secondsUntilBlockExpires: toSeconds(blockMs, blockMs),
      };
    }
    return {
      totalHits: entry.hits,
      isBlocked: false,
      secondsUntilReset: toSeconds(entry.resetAt - now, windowMs),
      secondsUntilBlockExpires: 0,
    };
  }
}

// Retry-After must never be 0 or negative — a client that reads "retry after
// 0 seconds" retries immediately and hammers the endpoint.
function toSeconds(ms: number, fallbackMs: number): number {
  const value = Number.isFinite(ms) && ms > 0 ? ms : fallbackMs;
  return Math.max(1, Math.ceil(value / 1000));
}
