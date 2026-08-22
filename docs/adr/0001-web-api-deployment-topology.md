# ADR 0001 — Supported deployment topology for the web app and the API

- **Status:** Accepted
- **Date:** 2026-08-22
- **Sprint:** 3 (dependency + HTTP security)
- **Supersedes:** nothing
- **Owner:** Platform / Backend

## Context

The web app authenticates with cookies, not with a token in `localStorage`.
That choice was made earlier and is not revisited here — it is the right one,
because an `HttpOnly` cookie survives an XSS that would hand an attacker a
`localStorage` token outright.

It does, however, put the **browser** in charge of whether a session exists on
any given request, and the browser's rules are not configurable by us. The
cookie contract the API issues today (`apps/api/src/modules/iam/authentication/helpers/cookies.ts`):

| Cookie     | HttpOnly                 | SameSite                          | Path               | Purpose                  |
| ---------- | ------------------------ | --------------------------------- | ------------------ | ------------------------ |
| `hsm_at`   | yes                      | `COOKIE_SAMESITE` (default `lax`) | `/`                | access token             |
| `hsm_rt`   | yes                      | **`strict`** (hard-coded)         | `/v1/auth/refresh` | refresh token            |
| `hsm_csrf` | **no** (JS must read it) | **`strict`** (hard-coded)         | `/`                | double-submit CSRF token |

Two of the three are `SameSite=Strict` and are not configurable. `Strict` means
the browser attaches the cookie **only** when the request's site matches the
cookie's site. `Lax` is barely more permissive: it allows top-level GET
navigations and nothing else — in particular, not `fetch`/XHR.

The consequence is not theoretical. It is measured, in a real Chromium, by
`apps/web/e2e/auth-cookies.spec.ts`:

> With the cross-site origin **explicitly allowed by CORS**, so that CORS
> cannot be the thing that fails, a `fetch(..., { credentials: 'include' })`
> from a page on a different site to `/v1/auth/me` arrives **anonymous** and
> the API answers **401**.

So a deployment that puts the web app and the API on different registrable
domains has no working session at all — not a degraded one. Login appears to
succeed (the cookies are set) and then every subsequent request is
unauthenticated, refresh never fires, and CSRF can never be satisfied because
the token cookie is withheld too.

## Decision

**The web app and the API must be served from the same site.** Exactly two
topologies are supported.

### Topology A — same-origin via a path prefix (preferred)

The web app and the API answer on one origin; the edge routes `/v1/*` to the
API and everything else to the static bundle.

```
https://app.example.com/            → static SPA
https://app.example.com/v1/*        → API
```

- `COOKIE_DOMAIN` unset. Cookies default to the exact host, which is the
  tightest scope available.
- `COOKIE_SAMESITE=strict` is achievable here, because nothing is cross-site.
- CORS is not involved at all; `CORS_ORIGINS` may be left empty.
- The `Path=/v1/auth/refresh` scoping on the refresh cookie continues to work
  unchanged, because the prefix is preserved.

This is preferred because it is the only topology where a
misconfiguration cannot silently widen cookie scope: there is no shared parent
domain for a cookie to leak to.

### Topology B — sibling hosts under one registrable domain

```
https://app.example.com/            → static SPA
https://api.example.com/            → API
```

- `COOKIE_DOMAIN=.example.com` is **required**, otherwise the cookies belong to
  `api.example.com` and the SPA's requests, though same-_site_, will still be
  fine — but the CSRF cookie will not be readable by the SPA's JavaScript,
  which needs to echo it as `X-CSRF-Token`. This is the failure mode most
  likely to be discovered late.
- `CORS_ORIGINS=https://app.example.com` is required, with credentials.
- `COOKIE_SAMESITE=lax` is the maximum here; `strict` would break navigations
  from external links back into an authenticated view.
- Every host under `example.com` can now read `hsm_csrf`. That is the price of
  this topology and the reason A is preferred.

### Explicitly unsupported

**Different registrable domains** — for example the SPA on `*.vercel.app` with
the API on `example.com`. There is no configuration of `COOKIE_DOMAIN`,
`CORS_ORIGINS`, or `COOKIE_SAMESITE` that makes this work, because
`hsm_rt` and `hsm_csrf` are `SameSite=Strict` in code. A preview deployment on
a Vercel-generated hostname therefore cannot talk to a production API, and
should be pointed at an API behind the same preview domain or given a
rewrite (Topology A) instead.

## Consequences

- `vercel.json` keeps a `rewrites` entry sending everything to `index.html`;
  Topology A additionally requires a rewrite of `/v1/*` to the API origin,
  which is a deployment-time concern and is **not** committed here because the
  API hostname differs per environment.
- The `browser-e2e` job stubs `/v1/**`, so it does not exercise this. The
  cookie contract is covered by `auth-cookies.spec.ts` against a real API
  instead, gated on `E2E_REAL_API`.
- If a future requirement genuinely needs cross-domain auth (a native app, a
  partner embed), the change is to move `hsm_rt`/`hsm_csrf` to
  `SameSite=None; Secure` **and** add an origin allowlist plus a
  re-examination of CSRF, since `None` re-opens exactly what `Strict` closes.
  That is a new ADR, not a config change.

## Alternatives considered

**Make `SameSite` configurable for all three cookies.** Rejected: it converts a
property that is currently guaranteed by code into one that depends on an
environment variable being right, and the failure mode (silently accepting
cross-site requests) is invisible until someone exploits it.

**Bearer tokens for the web app.** Rejected: it trades a CSRF problem we have
already solved (double-submit, enforced globally, tested in a real browser) for
an XSS problem we would then have to solve, on a codebase that renders
user-supplied content.

**Same-origin via a Node proxy in front of the SPA.** Rejected as the default:
it works, but it puts a hop we maintain on the critical path of every static
asset. Topology A achieves the same thing at the CDN edge.
