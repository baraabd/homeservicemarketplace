# CR-R27-04 — default `Cache-Control: private, no-store` for API JSON

- **Path:** `apps/api/src/main.ts` (coordinator-owned global middleware), or a
  global Nest interceptor registered there.
- **State:** proposal. The negatives below already pass; this change is defence in depth.

## Measured (`query-profile-baseline.json`, 17 authenticated reads)

16 of the 17 reads send **no `Cache-Control`**, but do send an Express weak
`ETag` and `Vary: Origin`. They include `/v1/auth/me`, seeker requests and
bookings, the provider's bids and bookings, admin users and admin audit logs.
Only `/v1/provider/available-requests` sends `no-store`. Dispute, metrics and
private-media routes set their own headers.

These negatives already pass against the real API:

| Probe                                                                                    | Result         |
| ---------------------------------------------------------------------------------------- | -------------- |
| Anonymous read of a seeker list                                                          | 401            |
| Seeker B reads A's request, or the bids on it                                            | 404            |
| Seeker or provider reads the admin user list                                             | 403            |
| Seeker reads provider bids                                                               | 403            |
| A's ETag replayed with B's session (`/v1/auth/me`, `/v1/me/requests`, `/v1/me/bookings`) | 200, never 304 |
| Session cookies replayed after logout                                                    | 401            |

## Why change anyway

Without an explicit directive, personal JSON may be written to the browser's
disk cache on shared devices. Any intermediary configured to cache
cookie-bearing responses could also store it. The client already removes
cached queries at session end (`apps/web/src/lib/auth-session-reset.ts`), and
cross-tab sign-out uses the `hsm.auth.boundary.v1` storage event
(`apps/web/src/lib/auth-provider.tsx:144`). Neither controls the HTTP cache.

## Proposed patch (sketch for the coordinator)

```ts
// main.ts, after cookieParser():
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

## Tests

- API e2e: every `/v1` JSON route returns `private, no-store` unless it is allow-listed.
- `query-profile.mjs` header audit: all 17 reads report `private, no-store`.
- Public media keeps `public, max-age=31536000, immutable`.

## Cost and rollback

These reads lose 304 revalidation; their bodies are small. Rollback: remove
the middleware.
