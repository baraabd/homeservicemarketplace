import 'reflect-metadata';

import { EvidenceUploadController } from './evidence-upload.controller';

// Sprint 9B.4 — the evidence upload routes carry their own rate limit.
//
// The global backstop is 100 requests per 60 seconds, which is a sensible
// default for reading a list and a poor one for a route that moves a whole file
// and then hands it to a scanner to read again. A caller looping on
// prepare -> content would spend storage and scanner time far faster than any
// legitimate provider, whose document count is bounded by maxDocumentsPerCase.
//
// Asserted from the metadata rather than by making 31 HTTP requests: this is a
// statement about the route's configuration, and driving a real limiter would
// test @nestjs/throttler instead.

/** The keys @nestjs/throttler v6 writes, per named throttler. Verified by
 *  enumerating the handler's metadata rather than assumed from the docs. */
const LIMIT_META = 'THROTTLER:LIMITdefault';
const TTL_META = 'THROTTLER:TTLdefault';

const ROUTES = ['prepare', 'content', 'finalize'] as const;

/** The global default this must be tighter than (app.module.ts). */
const GLOBAL = { limit: 100, ttl: 60_000 };

function budgetFor(route: (typeof ROUTES)[number]): { limit: number; ttl: number } {
  const handler = (EvidenceUploadController.prototype as unknown as Record<string, unknown>)[route];
  const limit = Reflect.getMetadata(LIMIT_META, handler as object) as unknown;
  const ttl = Reflect.getMetadata(TTL_META, handler as object) as unknown;
  if (limit === undefined || ttl === undefined) {
    throw new Error(`no throttler metadata on ${route}`);
  }
  return { limit: Number(limit), ttl: Number(ttl) };
}

describe('evidence upload rate limiting', () => {
  it.each(ROUTES)('%s carries an explicit budget', (route) => {
    expect(() => budgetFor(route)).not.toThrow();
  });

  it.each(ROUTES)('%s is stricter than the global backstop', (route) => {
    const { limit, ttl } = budgetFor(route);
    // Strictly fewer requests per unit time than the global default. Comparing
    // rates rather than raw limits, because a larger limit over a much longer
    // window is not more permissive.
    expect(limit / ttl).toBeLessThan(GLOBAL.limit / GLOBAL.ttl);
  });

  it('leaves room for a real provider to retry', () => {
    // The other direction matters too. A budget so tight that a provider
    // re-uploading a rejected document gets a 429 turns a security control into
    // a support ticket.
    for (const route of ROUTES) {
      expect(budgetFor(route).limit).toBeGreaterThanOrEqual(10);
    }
  });

  it('uses the same budget for all three, so the tightest one is not the bottleneck', () => {
    // prepare, content and finalize are called in sequence for one document.
    // Different budgets would mean the smallest silently governs the flow while
    // the others read as if they were the limit.
    const budgets = ROUTES.map(budgetFor);
    expect(new Set(budgets.map((b) => `${b.limit}/${b.ttl}`)).size).toBe(1);
  });
});
