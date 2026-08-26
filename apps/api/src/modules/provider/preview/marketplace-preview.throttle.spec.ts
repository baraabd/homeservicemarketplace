import 'reflect-metadata';

import { MarketplacePreviewController } from './marketplace-preview.controller';

// Sprint 9B.9 — the preview route carries its own rate limit.
//
// The global backstop is 100 requests per 60 seconds — 6,000 an hour. Against
// a surface whose entire purpose is to disclose a redacted slice of the
// marketplace to UNVERIFIED callers, that is not a limit, it is an invitation:
// even with a 30-item reach cap, 6,000 requests an hour is enough to poll for
// newly-posted work continuously and rebuild a live feed the caller was
// deliberately not given.
//
// Asserted from the metadata rather than by making 61 HTTP requests: this is a
// statement about the route's configuration, and driving a real limiter would
// be testing @nestjs/throttler.
//
// The rate limit is the THIRD of three independent bounds, and it is worth
// being explicit that none of them is sufficient alone:
//
//   pageSize   bounds one response
//   maxItems   bounds the total ever reachable — without it a small page size
//              only slows a harvest instead of stopping it
//   this limit bounds how often the whole reach can be re-walked, which is
//              what turns a bounded snapshot into a live feed

/** The keys @nestjs/throttler v6 writes, per named throttler. */
const LIMIT_META = 'THROTTLER:LIMITdefault';
const TTL_META = 'THROTTLER:TTLdefault';

/** The global default this must be tighter than (app.module.ts). */
const GLOBAL = { limit: 100, ttl: 60_000 };

function budget(): { limit: number; ttl: number } {
  const handler = (MarketplacePreviewController.prototype as unknown as Record<string, unknown>)
    .list;
  const limit = Reflect.getMetadata(LIMIT_META, handler as object) as unknown;
  const ttl = Reflect.getMetadata(TTL_META, handler as object) as unknown;
  if (limit === undefined || ttl === undefined) {
    throw new Error('no throttler metadata on the preview route');
  }
  return { limit: Number(limit), ttl: Number(ttl) };
}

describe('marketplace preview rate limiting', () => {
  it('carries an explicit budget rather than inheriting the global one', () => {
    expect(() => budget()).not.toThrow();
  });

  it('is stricter than the global backstop', () => {
    // Compared as RATES, not raw limits: a larger limit over a much longer
    // window is stricter, and comparing the two numbers directly would call
    // that a regression.
    const { limit, ttl } = budget();
    expect(limit / ttl).toBeLessThan(GLOBAL.limit / GLOBAL.ttl);
  });

  it('is generous enough for a person and useless for a harvest', () => {
    // The judgement this route actually encodes. A provider browsing might
    // reasonably refresh a few dozen times an hour; a scraper wants thousands.
    const { limit, ttl } = budget();
    expect(ttl).toBe(60 * 60 * 1000);
    expect(limit).toBeGreaterThanOrEqual(20);
    expect(limit).toBeLessThanOrEqual(120);
  });

  it('cannot re-walk the default reach more than a handful of times an hour', () => {
    // Ties the limit to the other two bounds instead of asserting a bare
    // number. With a 30-item reach and a 10-item page, one full walk is 3
    // requests; the budget must not permit hundreds of walks per hour, or the
    // reach cap stops meaning anything.
    const { limit } = budget();
    const requestsPerFullWalk = Math.ceil(30 / 10);
    expect(limit / requestsPerFullWalk).toBeLessThanOrEqual(30);
  });
});
