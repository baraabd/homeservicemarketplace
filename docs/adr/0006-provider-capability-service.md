# ADR 0006 — One server-side ProviderCapabilityService

- **Status:** Accepted
- **Date:** 2026-08-23
- **Sprint:** 07
- **Related:** [0005](0005-provider-lifecycle-axes.md) (the axes and precedence this service implements)

## Context

[ADR 0005](0005-provider-lifecycle-axes.md) replaces one status with six axes and a precedence table. Six inputs and eight ordered rules is more than any call site should re-derive, and the codebase already shows what happens when a rule has more than one home:

- `ProviderActiveGuard` checks `profile.status === 'ACTIVE'` and **never looks at the User account** — correct today only because `assertSessionActive` rejects ineligible accounts first. The guard reads as if it were the authority and is not.
- The provider feed rule was written out three times and drifted for a whole sprint (see [ADR 0003](0003-service-area-geo-strategy.md)).
- Two route families — `/v1/provider/*` and `/v1/me/provider/*` — serve the same surfaces. Any rule added to one is a rule someone must remember to add to the other.
- The Provider app re-derives gating client-side from `profile.status`, which is how the DRAFT "Continue onboarding" loop shipped: the client's model of the rule and the server's disagreed, and neither was wrong about its own model.

## Decision

**One service — `ProviderCapabilityService` — is the only place that decides what a provider may do.** Everything else asks it.

```ts
capability.for(userId) → ProviderCapabilitySet
```

### Capability codes, not statuses

Callers ask `can('SUBMIT_BID')`, never `status === 'ACTIVE'`. Codes name the _action_, so adding an axis changes one file instead of every guard:

| Code                  | Meaning                                   |
| --------------------- | ----------------------------------------- |
| `VIEW_OWN_PROFILE`    | Read own provider profile                 |
| `EDIT_OWN_PROFILE`    | Edit profile fields                       |
| `COMPLETE_ONBOARDING` | Enter and progress the onboarding surface |
| `SUBMIT_FOR_REVIEW`   | Submit a complete application             |
| `VIEW_MARKETPLACE`    | See the available-requests feed           |
| `SUBMIT_BID`          | Bid on a request                          |
| `MANAGE_BOOKINGS`     | Act on accepted work                      |
| `VIEW_EARNINGS`       | See the wallet                            |
| `APPEAL_DECISION`     | Contest a standing decision               |

### Denials carry a reason

A boolean tells a provider nothing and tells support less. Every denial returns a stable `reason` code plus the `nextActions` that would lift it — which is what makes `GET /v1/me/provider/capabilities` useful rather than decorative.

Reasons are **stable codes with no policy detail**: `ACCOUNT_INELIGIBLE`, `ONBOARDING_INCOMPLETE`, `PROVIDER_SUSPENDED`, `NO_WORK_ACCESS`. The client maps them to localised copy. They deliberately do not say _which_ threshold failed, _when_ a grant expires, or which internal rule fired — a denial reason is read by whoever is being denied, including someone probing the boundary.

### Deny-by-default

The set starts empty and rules add to it. A new capability added to the enum and forgotten in the rules is **denied**, not granted. The opposite default turns every omission into a hole.

### Precedence is one ordered list

The eight ranks of [ADR 0005](0005-provider-lifecycle-axes.md) are one array in one file, evaluated in order, first-deny-wins. Rank 0 — account eligibility — is evaluated **before the provider profile is even loaded**, so an ineligible account cannot produce a capability regardless of what its provider row says.

This duplicates the session layer's check on purpose. Defence in depth is the reason: `assertSessionActive` is correct today, but the guarantee "a suspended user has no provider capability" should not rest on one call site continuing to be reached by every future code path.

### Reused, not re-implemented

Both route families resolve the same service. `ProviderActiveGuard` becomes a thin adapter that asks for a capability instead of comparing a string, so `/v1/provider/bids` and `/v1/me/provider/bids` cannot answer differently. Parity is asserted by a test that walks both families over the same fixtures.

### Server-authoritative

The client never re-derives. It reads `GET /v1/me/provider/capabilities` and renders from it. The server still enforces independently on every mutation — the endpoint exists so the UI stops _guessing_, not so the server can stop _checking_. A client that ignores the payload gets 403s, exactly as today.

## Alternatives rejected

**Extend `ProviderActiveGuard` with more conditions.** Keeps the rule in a guard, which the web app cannot call, so the client keeps its own copy and the DRAFT-loop class of bug survives.

**Compute capabilities in each service.** How the feed rule drifted three ways in [ADR 0003](0003-service-area-geo-strategy.md).

**Ship a policy engine (CASL/OPA).** Real power, real cost: a second language for authorization, and the precedence table stops being readable as a table. Eight ordered rules do not need one; revisit if the count grows or per-tenant policy appears.

**Put capabilities in the JWT.** Removes the per-request lookup and makes revocation asynchronous — a suspended provider keeps bidding until their token expires. Rank 0 exists precisely to close that window.

## Consequences

**Good** — one file to read for "what may a provider do"; route families cannot diverge; the client renders from the server's answer; new axes are one edit; denial reasons make support answerable without SQL.

**Costs / risks**

- **One extra query per guarded request** (profile + account). Indexed primary-key lookups, same order as the session check already performed. If it shows up, cache per-request — never across requests, or rank 0 goes stale, which is the one thing it exists to prevent.
- **A central service is a central blast radius.** A bug denies everything or grants everything. Mitigated by deny-by-default (bugs fail closed) and by testing the full state × capability cross-product rather than sampling.
- **Reason codes are a small API surface** clients will branch on. They are versioned with the contract and additive-only.
- The service must stay free of I/O beyond its two reads. Anything else (rate limits, quotas) belongs at a different layer, or "may I bid?" becomes a network call chain.

## Revisit

- Per-request memoisation, if profiling shows the double read matters.
- A policy engine, if the rule count outgrows a readable table or policy becomes per-tenant.
- Pushing a capability _digest_ (not the set) into the session, if the read ever becomes hot — with revocation still forcing re-evaluation.
