// Sprint 6 — the deprecated route registry.
//
// ONE list. The middleware reads it to set headers and count usage, the
// migration table in the sprint report is generated from it, and a future
// removal PR deletes an entry here plus the controller it names.
//
// This started as a `@DeprecatedRoute` decorator plus an interceptor. That was
// wrong in a way worth recording: Nest runs guards BEFORE interceptors, so a
// request rejected by RolesGuard never reached it and a 403 from a deprecated
// route carried no Deprecation header at all. Deprecation describes the
// RESOURCE, not the outcome — a client being told "you may not call this"
// should also be told "and it is going away". Middleware runs before guards,
// so the headers are unconditional.

export interface DeprecatedRoute {
  /** Path prefix, AFTER the global version segment — e.g. `/v1/me/provider/bids`.
   *  Matched as a prefix so the whole family is covered by one entry. */
  prefix: string;
  /** The replacement, as a path a client can call. */
  canonical: string;
  /** ISO-8601 date the route MAY be removed.
   *
   *  A date, not a promise: removal additionally requires
   *  `deprecated_route_requests_total{route="<prefix>"}` to have been flat at
   *  zero across a full client-release cycle. A deprecation with no date is a
   *  label rather than a plan, so this field is required. */
  sunset: string;
  reason: string;
}

/** Sprint 6 route convergence.
 *
 *  Canonical family is `/v1/provider/*`. It already had four members
 *  (available-requests, bids, bookings, earnings) when `/v1/me/provider/*`
 *  was still serving the same surfaces from a second controller.
 *
 *  NOT deprecated, and deliberately so:
 *    /v1/me/provider                        — the provider's own PROFILE.
 *                                             "me" is the right noun for it;
 *                                             it has no canonical twin.
 *    /v1/me/provider/categories/applications — likewise, an application the
 *                                             caller owns. No twin exists. */
export const DEPRECATED_ROUTES: readonly DeprecatedRoute[] = [
  {
    prefix: '/v1/me/provider/jobs',
    canonical: '/v1/provider/available-requests',
    sunset: '2027-02-01',
    reason:
      'Superseded by /v1/provider/available-requests, which returns a richer summary (distanceKm, budget, seeker preview).',
  },
  {
    prefix: '/v1/me/provider/bids',
    canonical: '/v1/provider/bids',
    sunset: '2027-02-01',
    reason: 'Superseded by /v1/provider/bids. Identical request and response shapes.',
  },
  {
    prefix: '/v1/me/provider/bookings',
    canonical: '/v1/provider/bookings',
    sunset: '2027-02-01',
    reason: 'Superseded by /v1/provider/bookings. Identical request and response shapes.',
  },
  {
    prefix: '/v1/me/provider/earnings',
    canonical: '/v1/provider/earnings',
    sunset: '2027-02-01',
    reason: 'Superseded by /v1/provider/earnings.',
  },
] as const;

/** The registry entry covering this path, if any.
 *
 *  Longest prefix wins, so a more specific entry can override a broader one
 *  later without the order of the array mattering.
 */
export function findDeprecatedRoute(path: string): DeprecatedRoute | undefined {
  let best: DeprecatedRoute | undefined;
  for (const route of DEPRECATED_ROUTES) {
    if (path === route.prefix || path.startsWith(`${route.prefix}/`)) {
      if (!best || route.prefix.length > best.prefix.length) best = route;
    }
  }
  return best;
}
