# ADR 0001 — Immediate access-token blocking

- Status: Accepted
- Date: 2026-08-01
- Sprint: Sprint 01 — auth / provider / session hardening

## Context

Access tokens are stateless HS256 JWTs (`TokenService.signAccessToken`).
Once signed, a token stays cryptographically valid until its `exp`
(default `JWT_ACCESS_TTL_SECONDS = 600`). `JwtStrategy.validate()`
previously only checked the token's signature and claim shape — it never
consulted the database. Consequences:

- An admin could suspend or lock a user, but that user's already-issued
  access token kept passing every guard for up to the token TTL.
- A soft-deleted or deactivated user had the same residual access.
- Refresh minted new access tokens without re-checking account state
  (fixed separately: `refresh()` now loads the user and rejects
  non-good-standing accounts).

We need **immediate** blocking: once an account leaves good standing, the
next authenticated request must fail — not merely eventually, when the
token expires.

## Decision

Use a **measured cached session check**, not a `tokenVersion` column.

`JwtStrategy.validate()` calls `SessionValidationService.assertInGoodStanding(userId)`
on every authenticated request:

- A per-user "in good standing" flag is cached in Redis
  (`iam:session:standing:{userId}`) with a short TTL
  (`AUTH_SESSION_CACHE_TTL_SECONDS`, default 30s), so the hot path is a
  single `GET`.
- **Only the positive result is cached.** A bad account is never cached,
  so it is re-checked against the DB on every request and can never be
  readmitted by a stale entry.
- Suspend / lock (admin) delete the flag via
  `SessionValidationService.invalidate(userId)` **after** the status flip
  and session revoke commit, so revocation is effective on the very next
  request. The TTL is only a safety net for nodes an explicit
  invalidation cannot reach.
- The database is always the source of truth. On a cache miss **or any
  Redis error**, we fall through to a DB read and enforce the result. We
  fail toward correctness (re-check), never open.

"Good standing" is defined once in `helpers/account-standing.ts` and is
shared with the refresh path so the two cannot drift: the user row must
exist, not be soft-deleted, be `isActive`, and have `status === ACTIVE`
(which excludes `PENDING_VERIFICATION`, `LOCKED`, `SUSPENDED`, `DELETED`).

## Alternatives considered

**`tokenVersion` column.** Add `User.tokenVersion`, embed it as a JWT
claim, and increment it on suspend/lock. Rejected because it requires a
schema migration and threading the value through every token-issue site
(login + refresh), for no correctness gain over the cached check — both
approaches still need one lookup per request to learn the current state.
The cached check keeps the blast radius smaller and reuses the existing
Redis cache idiom already proven by `PermissionResolverService`.

## Consequences

- Every authenticated request does one Redis `GET` (amortized); a miss
  adds one indexed `User` lookup. Cost is bounded by the TTL.
- Admin suspend/lock blocks access **immediately** (next request), backed
  by both the standing-cache invalidation and the in-transaction session
  revocation.
- **Residual:** user-initiated `logout-all` and `password-reset` revoke
  refresh tokens immediately (no new access tokens can be minted), but do
  not change account standing, so any already-issued access token for
  those sessions remains valid until it expires (≤ `JWT_ACCESS_TTL_SECONDS`).
  This matches standard JWT semantics and is acceptable for the
  self-service case; the security-critical admin case is immediate.

## Rollback

Remove the `assertInGoodStanding` call from `JwtStrategy.validate()`
(revert to the stateless validate). The `SessionValidationService`, the
env var, and the admin invalidation calls can remain dormant without
effect. No migration to unwind.
