/* eslint-disable @typescript-eslint/no-require-imports */
export {}; // module marker — see migration-bootstrap.spec.ts.

// D-1 — the AGGREGATE registration budget across API replicas.
//
// The defect this pins: with @nestjs/throttler's default in-memory storage,
// each API instance kept its own counter, so a deployment with N replicas
// actually allowed N × limit registrations per window. An attacker only had to
// let the load balancer spread their requests.
//
// This spec constructs TWO independent RegistrationThrottleService graphs —
// separate objects, separate in-process state, exactly as two API pods would
// be — pointed at ONE real Redis, and asserts that the sixth request is
// refused no matter which instance receives it.
//
// Gated by RUN_REDIS_INTEGRATION=1 so the default `pnpm test` stays hermetic.

const shouldRun = process.env.RUN_REDIS_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(60_000);

d('Registration throttle — aggregate budget across API instances (real Redis)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Redis: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let RateLimitStore: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let RegistrationThrottleService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let RegistrationThrottledError: any;

  const LIMIT = 5;
  const WINDOW_SECONDS = 3600;

  // Distinct per run so a re-run never inherits a previous run's counters.
  const runId = `it-${process.pid}-${Date.now()}`;

  const config = {
    get: (key: string) => {
      if (key === 'AUTH_REGISTER_THROTTLE_LIMIT') return LIMIT;
      if (key === 'AUTH_REGISTER_THROTTLE_TTL_SECONDS') return WINDOW_SECONDS;
      if (key === 'THROTTLE_REDIS_REQUIRED') return true;
      return undefined;
    },
  };

  // One RegistrationThrottleService per simulated API instance. They share
  // only Redis — never a JS object.
  function makeInstance() {
    const redisService = { getClient: () => client };
    const store = new RateLimitStore(redisService, config);
    return new RegistrationThrottleService(store, config);
  }

  beforeAll(async () => {
    Redis = require('ioredis');
    client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number(process.env.REDIS_DB ?? 0),
      maxRetriesPerRequest: 3,
    });
    await client.ping();

    ({ RateLimitStore } = require('../../src/infrastructure/throttle/rate-limit.store'));
    ({
      RegistrationThrottleService,
      RegistrationThrottledError,
    } = require('../../src/infrastructure/throttle/registration-throttle.service'));
  });

  afterAll(async () => {
    if (client) {
      const keys = await client.keys(`rl:auth:register:*${runId}*`);
      if (keys.length > 0) await client.del(...keys);
      await client.quit();
    }
  });

  it('blocks the sixth request when attempts alternate between two instances', async () => {
    const instanceA = makeInstance();
    const instanceB = makeInstance();
    const ip = `198.51.100.1-${runId}`;

    const results: Array<'ok' | 'throttled'> = [];
    for (let i = 1; i <= 6; i += 1) {
      // Alternate replicas AND use a different email every time, so the only
      // thing that can accumulate is the shared IP bucket in Redis.
      const instance = i % 2 === 1 ? instanceA : instanceB;
      try {
        await instance.assertWithinBudget({
          ipAddress: ip,
          email: `alternating-${i}-${runId}@example.com`,
        });
        results.push('ok');
      } catch (err) {
        expect(err).toBeInstanceOf(RegistrationThrottledError);
        results.push('throttled');
      }
    }

    // Five accepted, the sixth refused — the aggregate budget, not 5-per-pod.
    expect(results).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'throttled']);
  });

  it('blocks a repeated email on a second instance after the first exhausted it', async () => {
    const instanceA = makeInstance();
    const instanceB = makeInstance();
    const email = `victim-${runId}@example.com`;

    // Instance A burns the whole email budget, each attempt from a different
    // IP so the IP bucket cannot be what trips.
    for (let i = 1; i <= LIMIT; i += 1) {
      await instanceA.assertWithinBudget({ ipAddress: `203.0.113.${i}-${runId}`, email });
    }

    // Instance B has never seen this address in memory — Redis has.
    await expect(
      instanceB.assertWithinBudget({ ipAddress: `203.0.113.200-${runId}`, email }),
    ).rejects.toBeInstanceOf(RegistrationThrottledError);
  });

  it('collapses email casing/whitespace variants into one budget across instances', async () => {
    const instanceA = makeInstance();
    const instanceB = makeInstance();
    const base = `case-${runId}@example.com`;
    const variants = [
      base,
      base.toUpperCase(),
      `  ${base}`,
      `${base}  `,
      ` ${base.toUpperCase()} `,
    ];

    for (const [i, email] of variants.entries()) {
      const instance = i % 2 === 0 ? instanceA : instanceB;
      await instance.assertWithinBudget({ ipAddress: `192.0.2.${i + 1}-${runId}`, email });
    }

    await expect(
      instanceB.assertWithinBudget({ ipAddress: `192.0.2.250-${runId}`, email: base }),
    ).rejects.toBeInstanceOf(RegistrationThrottledError);
  });

  it('reports a positive Retry-After from whichever instance refuses', async () => {
    const instanceA = makeInstance();
    const instanceB = makeInstance();
    const ip = `198.51.100.9-${runId}`;
    for (let i = 1; i <= LIMIT; i += 1) {
      await instanceA.assertWithinBudget({
        ipAddress: ip,
        email: `retry-${i}-${runId}@example.com`,
      });
    }
    try {
      await instanceB.assertWithinBudget({
        ipAddress: ip,
        email: `retry-final-${runId}@example.com`,
      });
      throw new Error('expected the over-budget attempt to be refused');
    } catch (err) {
      const throttled = err as { retryAfterSeconds: number; status: number; code: string };
      expect(throttled.status).toBe(429);
      expect(throttled.code).toBe('RATE_LIMITED');
      expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
      expect(throttled.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_SECONDS);
    }
  });
});
