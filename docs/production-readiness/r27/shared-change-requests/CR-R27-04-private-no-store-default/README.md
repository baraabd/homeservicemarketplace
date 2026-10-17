# CR-R27-04 — default `Cache-Control: private, no-store` for API JSON

- **Path:** `apps/api/src/main.ts` (coordinator-owned early global middleware).
  A Nest interceptor alone cannot establish this default on requests rejected
  before interception; any interceptor-based design also needs early rejection
  coverage.
- **State:** proposal, not applied by R27. The current G1 negatives below pass;
  the HTTP/security owner reviews and applies this policy in serialized integration.

## Current G1 evidence

The retained baseline and candidate reports from workflow 38982468755 each
show **15 of 17 authenticated reads without `Cache-Control`**. Complete repaired
run 39032727959 on afec37ae reproduces this count on both sources. Seeker
notifications and provider available requests already send `no-store`. The
other sampled private reads include `/v1/auth/me`, seeker requests/bookings,
provider bids/bookings, admin users and admin audit logs. These counts are
sample coverage, not an inventory of every private API route. Final evidence
identities and any subsequent measurements are recorded in `../../ACCEPTANCE.md`.

The original pre-G1 `query-profile-baseline.json` reported 16/17 missing
headers. That historical number does not replace current G1 evidence.
Dispute, metrics and private-media routes have their own policies and must
be audited separately during integration.

The audit records contain ten asserted negatives plus three informational
same-user ETag observations. Only the asserted negatives establish the
following outcomes against the real API:

| Probe                                                                                    | Result         |
| ---------------------------------------------------------------------------------------- | -------------- |
| Anonymous read of a seeker list                                                          | 401            |
| Seeker B reads A's request, or the bids on it                                            | 404            |
| Seeker or provider reads the admin user list                                             | 403            |
| Seeker reads provider bids                                                               | 403            |
| A's ETag replayed with B's session (`/v1/auth/me`, `/v1/me/requests`, `/v1/me/bookings`) | 200, never 304 |
| Session cookies replayed after logout                                                    | 401            |

## Why change anyway

The sampled responses have no explicit HTTP instruction prohibiting storage.
Passing authorization and ETag replay probes does not prove every browser or
intermediary cache configuration is safe. The client already removes
cached queries at session end (`apps/web/src/lib/auth-session-reset.ts`), and
cross-tab sign-out uses the `hsm.auth.boundary.v1` storage event
(`apps/web/src/lib/auth-provider.tsx:144`). Neither controls the HTTP cache.

## Proposed patch (sketch for the coordinator)

```ts
// main.ts, before body parsers and request-rejecting middleware/guards:
app.use((req, res, next) => {
  // Routes with their own policy (immutable public media) set it later and win.
  if (req.path.startsWith('/v1/')) res.setHeader('Cache-Control', 'private, no-store');
  next();
});
```

Routes that legitimately cache must set their header after this middleware.
The public immutable media handler in `media.controller.ts` already does. A
public cache for the catalogue (`/v1/services`) is a separate, opt-in
decision.

## Tests and acceptance

- Parse cache directives case-insensitively. Every sampled private JSON response
  must contain `no-store`, with neither `public` nor a contradictory cache policy.
  Existing controller-level `no-store` is valid; do not require one literal
  `private, no-store` string unless the owner separately normalizes all overrides.
- A route with no controller override receives the proposed `private, no-store`
  default. Review the inventory beyond the 17 measured reads, including private
  documents and financial decisions, and document every public exception.
- Private 401/403/404/429, validation and parser-error responses also retain
  the default. Preserve existing raw upload/feedback body handling when choosing
  the middleware's exact registration point.
- Preserve all ten asserted real API authority/ETag/logout negatives, record
  the three informational conditional-response observations, and retain the real browser
  account-switch checks. Add the owner's stale-role, revoked-permission and
  cross-tab tests; R27's current probes do not establish all of those cases.
- Public immutable media retains `public, max-age=31536000, immutable` on the
  explicitly public route only. Private media retains its stricter policy.

## Cost and rollback

Measure transfer/revalidation effects on the sampled reads after integration;
the header alone does not prove a server cannot emit a conditional 304.
Rollback is a reviewed revert of the new default middleware, preserving the
pre-existing route-specific cache headers. No dependencies, contracts, schema
or migration changes are required.
