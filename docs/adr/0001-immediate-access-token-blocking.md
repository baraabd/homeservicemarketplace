# ADR 0001 — Immediate access-token revocation

- Status: Accepted (superseded the 2026-08-01 "cached account-standing" decision)
- Date: 2026-08-01, revised 2026-08-21
- Sprint: Sprint 01 — auth / provider / session hardening; revised by the
  Sprint 01 remediation (finding **D-2**)

## Context

Access tokens are stateless HS256 JWTs (`TokenService.signAccessToken`). Once
signed, a token stays cryptographically valid until its `exp` (default
`JWT_ACCESS_TTL_SECONDS = 600`). Whatever the API checks on each request is
therefore the only thing standing between a revoked credential and a
successful call.

The original decision (below, kept for the record) checked **account
standing**: on every authenticated request, `JwtStrategy.validate()` asked
"is the USER still allowed to hold a session?", answered from a short-TTL
Redis cache keyed by user id.

That closed the admin case and left everything else open. It never looked at
the `Session` row the token was minted for, so:

| Action               | Refresh token | Access token (before)                  |
| -------------------- | ------------- | -------------------------------------- |
| logout (one session) | revoked       | **still worked until `exp`**           |
| logout-all           | revoked       | **still worked until `exp`**           |
| password reset       | revoked       | **still worked until `exp`**           |
| refresh rotation     | rotated       | **old token still worked until `exp`** |
| admin suspend / lock | revoked       | blocked (account standing changed)     |

Four of the five rows are the defect. The original ADR acknowledged the
self-service rows as an accepted residual ("This matches standard JWT
semantics and is acceptable for the self-service case"). **That acceptance is
withdrawn.** A user who signs out on a shared machine, or who resets their
password because they believe they were compromised, is entitled to expect
that the credential is dead when the call returns — not up to ten minutes
later.

The cache had a second, independent problem: it was keyed by **user**, but the
thing being revoked is a **session**. A per-user flag cannot express "device A
is logged out, device B is still signed in", so it could not have implemented
single-session logout even if it had been consulted.

## Decision

`SessionValidationService.assertSessionActive({ userId, sessionId, jti })` is
the single authority, called by `JwtStrategy.validate()` for REST and by the
Socket.IO handshake for realtime (one method, so the two surfaces cannot
drift). It verifies:

1. the `Session` row exists;
2. `Session.userId === payload.sub`;
3. `Session.id === payload.sid`;
4. `Session.currentJti === payload.jti` — a token superseded by refresh
   rotation is rejected;
5. `Session.revokedAt === null`;
6. `Session.expiresAt` is in the future;
7. the owning `User` is in good standing (exists, not soft-deleted,
   `isActive`, `status === ACTIVE`).

Signature, `iss`, `aud`, and `exp` are verified before this runs, by
passport-jwt from the strategy options (`ignoreExpiration: false`, issuer and
audience pinned).

### No positive cache

The check reads Postgres on every authenticated request. There is deliberately
no cached "this session is fine" entry.

The requirement is that a revoked session is dead on the _next_ request, on
_every_ instance, with no window. Any positive cache reintroduces a window
whose size is "TTL, or forever if the invalidation call failed" — the exact
residual this ADR exists to remove. Bounding that window is not the same as
not having one.

The cost is one lookup on the session's primary key, which also pulls the four
`User` columns standing depends on through the relation — a single round trip,
no N+1, and a narrow projection that keeps `passwordHash` / `mfaSecret` off the
hot path. That is a defensible price for removing a class of bug rather than
shrinking it. If this ever shows up in a profile, the answer is a cache with a
revocation tombstone (fail-closed on the negative side), not a return to
positive caching.

`AUTH_SESSION_CACHE_TTL_SECONDS` is removed: there is no staleness left to
tune. The schema strips unknown keys, so deployments that still set it boot
normally.

### Fail closed

If the lookup cannot be completed — database unavailable, connection
terminated, anything — the request is **rejected**. A token is never admitted
because the check that would have refused it was unavailable; that would turn
an infrastructure blip into an authorization bypass. Every rejection returns
the same opaque `AUTH_INVALID_CREDENTIALS`, so the caller cannot distinguish
"revoked" from "never existed" from "suspended".

### Revocation call sites

Each of these revokes the `Session` row(s) — which is what makes the access
token stop working — inside the same transaction as its audit record:

| Trigger              | Scope                      | Where                                      |
| -------------------- | -------------------------- | ------------------------------------------ |
| logout               | current session only       | `AuthenticationService.logout`             |
| logout-all           | every session for the user | `AuthenticationService.logoutAll`          |
| password reset       | every session for the user | `AuthenticationService.resetPassword`      |
| admin suspend / lock | every session for the user | `AdminUsersService.setStatus` / `.suspend` |
| refresh rotation     | the replaced session row   | `SessionService.rotate`                    |
| refresh replay       | the entire session family  | `SessionService.rotate`                    |

After commit, each publishes on `SecurityEventsBus` so the realtime gateway can
disconnect already-connected sockets (see D-4). REST needs no notification —
the next request reads the revoked row directly.

## Alternatives considered

**`tokenVersion` column.** Rejected for the same reason as in the original
decision, and additionally because it is per-user: it cannot express
single-session logout.

**Keep the cache, add a revocation tombstone.** Check
`SET revoked:{sid}` before the positive entry, so a failed `DEL` cannot
resurrect a session. Rejected as premature: it is two Redis round trips plus a
second consistency argument to maintain, against one indexed Postgres lookup
with no argument to maintain at all. Revisit only with a profile that shows the
lookup mattering.

**Short access-token TTL instead of a stateful check.** Shrinking
`JWT_ACCESS_TTL_SECONDS` shrinks the window but never closes it, and trades it
for refresh traffic. It is a mitigation, not a fix.

## Consequences

- Every authenticated request costs one indexed primary-key lookup.
- logout, logout-all, password reset, admin suspend/lock, and refresh rotation
  all take effect on the **next request**, on every instance, with no residual
  window. The table at the top of this ADR now reads "blocked" in every row.
- Single-session logout is expressible and enforced: logging out one device
  leaves the user's other sessions working.
- The realtime surface reuses the same method, so a session that is dead for
  REST is dead for WebSockets.
- The check depends on Postgres availability. That is deliberate: the API
  cannot serve authenticated traffic without its database anyway, and failing
  closed is the correct behaviour when it is gone.

## Rollback

Revert `JwtStrategy.validate()` to the stateless validate. `SessionRepository`
gains an unused method; the security-events publishers become no-ops with no
subscriber effect. No migration to unwind — this decision added no schema.

Rolling back reopens every row of the defect table above.

---

## Superseded decision (2026-08-01), retained for the record

The original decision used a **measured cached session check** rather than a
`tokenVersion` column: `JwtStrategy.validate()` called
`SessionValidationService.assertInGoodStanding(userId)`, backed by a per-user
Redis flag (`iam:session:standing:{userId}`) with a short TTL, positive-only
caching, and explicit invalidation from the admin suspend/lock paths.

It correctly identified that the database must remain the source of truth and
that negative results must never be cached. Its stated residual —

> user-initiated `logout-all` and `password-reset` revoke refresh tokens
> immediately, but do not change account standing, so any already-issued access
> token for those sessions remains valid until it expires

— is precisely finding **D-2**, and is no longer accepted.
