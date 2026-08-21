import { AppConfigService } from '../../config/app-config.service';
import type { RateLimitStore } from './rate-limit.store';
import {
  RegistrationThrottleService,
  RegistrationThrottledError,
  normalizeEmailIdentity,
  normalizeIp,
} from './registration-throttle.service';

// D-1 — throttle identity + budget enforcement.
//
// The store is replaced with a deterministic in-memory counter so these tests
// pin WHAT is counted (the identity) and WHEN the request is refused, without
// depending on Redis. rate-limit.store.spec.ts pins the counting semantics and
// the integration spec pins the cross-replica aggregate.

const LIMIT = 5;
const WINDOW_SECONDS = 3600;

function build(limit = LIMIT) {
  const counts = new Map<string, number>();
  const store = {
    consume: jest.fn(async (p: { bucket: string; identity: string; limit: number }) => {
      const key = `${p.bucket}|${p.identity}`;
      const hits = (counts.get(key) ?? 0) + 1;
      counts.set(key, hits);
      return {
        totalHits: hits,
        isBlocked: hits > p.limit,
        secondsUntilReset: WINDOW_SECONDS,
        secondsUntilBlockExpires: hits > p.limit ? WINDOW_SECONDS : 0,
      };
    }),
  } as unknown as RateLimitStore;

  const config = {
    get: (key: string) => {
      if (key === 'AUTH_REGISTER_THROTTLE_LIMIT') return limit;
      if (key === 'AUTH_REGISTER_THROTTLE_TTL_SECONDS') return WINDOW_SECONDS;
      return undefined;
    },
  } as unknown as AppConfigService;

  return { counts, store, service: new RegistrationThrottleService(store, config) };
}

const attempt = (service: RegistrationThrottleService, ipAddress: string, email: string) =>
  service.assertWithinBudget({ ipAddress, email });

describe('RegistrationThrottleService', () => {
  it('admits exactly the configured number of attempts and refuses the next', async () => {
    const { service } = build();
    for (let i = 1; i <= LIMIT; i += 1) {
      await expect(
        attempt(service, '203.0.113.5', `user${i}@example.com`),
      ).resolves.toBeUndefined();
    }
    await expect(attempt(service, '203.0.113.5', 'user6@example.com')).rejects.toBeInstanceOf(
      RegistrationThrottledError,
    );
  });

  it('rejects with 429 / RATE_LIMITED and a positive Retry-After', async () => {
    const { service } = build(1);
    await attempt(service, '203.0.113.5', 'a@example.com');
    try {
      await attempt(service, '203.0.113.5', 'b@example.com');
      throw new Error('expected the second attempt to be throttled');
    } catch (err) {
      const throttled = err as RegistrationThrottledError;
      expect(throttled).toBeInstanceOf(RegistrationThrottledError);
      expect(throttled.status).toBe(429);
      expect(throttled.code).toBe('RATE_LIMITED');
      expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
      // The client-facing message must not name the dimension that tripped —
      // "this email has been used 5 times" would be an enumeration oracle.
      expect(throttled.message).not.toMatch(/email|ip|address/i);
    }
  });

  describe('identity — email dimension', () => {
    it('collapses casing and surrounding whitespace into ONE budget', async () => {
      const { service } = build();
      const variants = [
        'ada@example.com',
        'Ada@Example.com',
        '  ADA@EXAMPLE.COM',
        'ada@example.com  ',
        ' Ada@Example.Com ',
      ];
      // Each variant comes from a DIFFERENT IP so only the email bucket can
      // be what accumulates.
      for (const [i, email] of variants.entries()) {
        await expect(attempt(service, `203.0.113.${i + 1}`, email)).resolves.toBeUndefined();
      }
      await expect(attempt(service, '203.0.113.99', 'AdA@ExAmPlE.cOm')).rejects.toBeInstanceOf(
        RegistrationThrottledError,
      );
    });
  });

  describe('identity — IP dimension', () => {
    it('does NOT hand an abusive IP a fresh budget for each new email', async () => {
      const { service } = build();
      for (let i = 1; i <= LIMIT; i += 1) {
        await expect(
          attempt(service, '198.51.100.7', `throwaway-${i}@example.com`),
        ).resolves.toBeUndefined();
      }
      // Brand-new address, same source: the IP bucket is exhausted.
      await expect(
        attempt(service, '198.51.100.7', 'brand-new@example.com'),
      ).rejects.toBeInstanceOf(RegistrationThrottledError);
    });

    it('treats an IPv6-mapped IPv4 address and its bare form as one bucket', async () => {
      const { service } = build();
      await attempt(service, '::ffff:198.51.100.7', 'a@example.com');
      await attempt(service, '198.51.100.7', 'b@example.com');
      await attempt(service, '::ffff:198.51.100.7', 'c@example.com');
      await attempt(service, '198.51.100.7', 'd@example.com');
      await attempt(service, '::FFFF:198.51.100.7', 'e@example.com');
      await expect(attempt(service, '198.51.100.7', 'f@example.com')).rejects.toBeInstanceOf(
        RegistrationThrottledError,
      );
    });

    it('leaves an unrelated IP unaffected', async () => {
      const { service } = build();
      for (let i = 1; i <= LIMIT + 1; i += 1) {
        await attempt(service, '198.51.100.7', `x${i}@example.com`).catch(() => undefined);
      }
      await expect(attempt(service, '203.0.113.1', 'clean@example.com')).resolves.toBeUndefined();
    });
  });

  it('charges BOTH dimensions on every attempt', async () => {
    const { service, store } = build();
    await attempt(service, '203.0.113.5', 'ada@example.com');
    const buckets = (store.consume as jest.Mock).mock.calls.map((c) => c[0].bucket);
    expect(buckets).toEqual(expect.arrayContaining(['auth:register:ip', 'auth:register:email']));
  });

  it('charges the email bucket even when the IP bucket already tripped', async () => {
    // Otherwise an attacker could exhaust one IP cheaply and leave the victim
    // address budget untouched for a later distributed run.
    const { service, store } = build(1);
    await attempt(service, '203.0.113.5', 'victim@example.com');
    await attempt(service, '203.0.113.5', 'victim@example.com').catch(() => undefined);
    const emailCalls = (store.consume as jest.Mock).mock.calls.filter(
      (c) => c[0].bucket === 'auth:register:email',
    );
    expect(emailCalls).toHaveLength(2);
  });

  it('honours the configured limit rather than a hardcoded one', async () => {
    const { service } = build(2);
    await attempt(service, '203.0.113.5', 'a@example.com');
    await attempt(service, '203.0.113.5', 'b@example.com');
    await expect(attempt(service, '203.0.113.5', 'c@example.com')).rejects.toBeInstanceOf(
      RegistrationThrottledError,
    );
  });
});

describe('identity normalisation helpers', () => {
  it.each([
    ['ada@example.com', 'ada@example.com'],
    ['  Ada@Example.COM ', 'ada@example.com'],
    ['\tADA@EXAMPLE.COM\n', 'ada@example.com'],
  ])('normalizeEmailIdentity(%j) === %j', (input, expected) => {
    expect(normalizeEmailIdentity(input)).toBe(expected);
  });

  it.each([
    ['203.0.113.5', '203.0.113.5'],
    ['::ffff:203.0.113.5', '203.0.113.5'],
    ['::FFFF:203.0.113.5', '203.0.113.5'],
    ['  203.0.113.5 ', '203.0.113.5'],
    ['', 'unknown'],
  ])('normalizeIp(%j) === %j', (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });
});
