# Identity, Role, Provider Status, and App Context

Sprint 5.1.2 hardened the identity / authorization / app-context model
that every Sprint 5.x slice builds on. This document is the single
source of truth for how those four concerns relate.

## Three independent axes

The platform deliberately keeps four concerns separated so they can
evolve without leaking into each other:

| Concern               | Type                                                  | Scope                        | Owner                      |
| --------------------- | ----------------------------------------------------- | ---------------------------- | -------------------------- |
| **Identity**          | `User` row                                            | Who you are                  | DB / IAM module            |
| **Role**              | `Role` rows joined via `UserRole`                     | What you may do              | DB / `RolesGuard`          |
| **Profile readiness** | `ProviderProfile.status`                              | Whether the provider may bid | DB / `ProviderActiveGuard` |
| **App context**       | `intendedApp` (sessionStorage) + `auth-experience.ts` | Which UX you see             | Frontend only              |

Mixing these is how marketplaces grow ad-hoc auth bugs. The rules:

- One `User` = one identity. `User.email` is `@unique`.
- A user may hold any number of roles. Roles are `customer`, `provider`,
  `admin`. The composite primary key on `UserRole(userId, roleId)`
  prevents duplicate assignments at the DB level.
- App selection on `/select` is UX only. It writes
  `sessionStorage.intendedApp` and navigates the user to the chosen app
  path. It does **not** grant authorization.
- Authorization is roles + (for provider marketplace endpoints) profile
  readiness. The frontend never enforces authorization on its own.
- `ProviderProfile.status` controls **marketplace readiness** (may
  this provider bid?). It is independent of `availability`
  (ONLINE/OFFLINE/PAUSED), which is the live working state toggle.
- Admin role is never self-upgraded. The provider role is granted via
  `POST /v1/me/provider/upgrade` (idempotent, takes no `userId`,
  derives identity from the session).

## Provider profile state machine

```
        ┌───────────────────── admin moderation ────────────────────┐
        ▼                                                          │
DRAFT ──► PENDING_REVIEW ──► ACTIVE ──► SUSPENDED ──► (admin) ─────┘
                  │                              │
                  └──────► REJECTED  ◄───────────┘
```

| Status           | Meaning                                | UX                                 | Marketplace allowed? |
| ---------------- | -------------------------------------- | ---------------------------------- | -------------------- |
| `DRAFT`          | Profile created, onboarding incomplete | "Continue onboarding" surface      | No                   |
| `PENDING_REVIEW` | Awaiting admin approval                | "Pending review" surface           | No                   |
| `ACTIVE`         | Approved                               | Live Provider shell                | Yes                  |
| `SUSPENDED`      | Admin-applied temporary block          | "Account suspended" surface        | No                   |
| `REJECTED`       | Admin-applied permanent denial         | "Application not approved" surface | No                   |

### Defaults

- Schema column default: `DRAFT`. Safe-by-default — any direct insert
  that bypasses the upgrade service ends up unable to bid until an
  operator promotes the row.
- `POST /v1/me/provider/upgrade` explicitly stamps `ACTIVE` for the
  local/dev auto-approval flow. Production tightens this to
  `PENDING_REVIEW` by changing a single constant
  (`UPGRADE_DEFAULT_STATUS` in `provider.service.ts`) once admin
  moderation ships.

### Backfill

The 5 seed `ProviderProfile` rows used by the Seeker `BidsScreen`
(`pp-omar`, `pp-khalid`, `pp-ali`, `pp-mohammed`, `pp-hassan`) were
backfilled to `ACTIVE` by migration
`20260501020000_add_provider_profile_status` so they remain visible to
seekers during local dev.

## Frontend route guards

| Route       | Unauth                      | Auth-no-role                                       | Auth-correct-role                                    | Auth-active         |
| ----------- | --------------------------- | -------------------------------------------------- | ---------------------------------------------------- | ------------------- |
| `/home`     | `→ /login` (Seeker theme)   | Live Seeker shell                                  | —                                                    | Live Seeker shell   |
| `/provider` | `→ /login` (Provider theme) | Live Provider shell ⇒ Profile tab shows "Activate" | Live Provider shell ⇒ status gate routes by `status` | Live Provider shell |
| `/admin`    | `→ /login` (Admin theme)    | `AdminAccessRequired`                              | —                                                    | Admin dashboard     |
| `/select`   | Public                      | Public                                             | Public                                               | Public              |

- `RequireAuth` gates `/home` and `/provider`.
- `RequireAdmin` (which composes `RequireAuth`) gates `/admin`.
- `GuestOnly` keeps already-authenticated users off `/login`,
  `/signup`, `/forgot-password`, `/check-email`. The post-auth
  destination resolver is `resolvePostAuthDestination` in
  `apps/web/src/lib/auth-experience.ts`.

## Backend guards

- `JwtAuthGuard` — every authenticated route. Class-level on most
  controllers.
- `RolesGuard('role-name')` — rejects users without the named role
  with `403 { code: 'FORBIDDEN' }`.
- `ProviderActiveGuard` (Sprint 5.1.2, scaffold only) — rejects
  provider users whose profile is missing or `status !== 'ACTIVE'`.
  Will be mounted on Sprint 5.2 marketplace endpoints
  (available-requests feed, submit-bid, my-bids). Not mounted in this
  slice.
- Admin-only endpoints (none yet) will require `RolesGuard('admin')`
  when they land.

## Post-auth routing (multi-role precedence)

Implemented in `resolvePostAuthDestination`:

1. Sanitised `returnTo` (a deep link the user was bounced off of).
2. Recorded launcher intent (`sessionStorage.intendedApp`).
3. Resolved auth-surface experience (the theme the user just visually
   confirmed during login/signup).
4. Role inference:
   - exactly one of {`provider`, `admin`} → that app
   - both `provider` and `admin` → `/select` (let the user pick)
   - neither (e.g. just `customer`) → `/home`

A user who clicks the Provider card and lacks the `provider` role
still lands on `/provider` — the Provider app's onboarding screen
handles the upgrade. The same applies to Admin: a non-admin landing on
`/admin` sees `AdminAccessRequired`, never a silent redirect to
`/home`.

## Database integrity invariants

Verified by Sprint 5.1.2 audit (DB at the time of this writing):

- `lower(email)` duplicates: 0
- `UserRole` duplicates: 0 (composite PK enforces this)
- Orphan `ProviderProfile` (userId set, no User): 0
- `ProviderProfile`s where the user lacks the `provider` role: 0
- `provider`-role users without a `ProviderProfile`: 0
- `admin`-role users: 0 (admin is never self-upgraded; created out-of-band)
- All three system roles seeded with `isSystem = true`

These are the invariants the audit script in Sprint 5.1.2 pinned.
Re-run the audit before any future identity-related migration.

## What this slice does NOT change

Out of scope (Sprint 5.2 and beyond):

- Provider available-requests feed
- Submit Bid / My Bids
- Provider Bookings / Earnings / Wallet (real backend)
- Admin feature implementation (UI exists; APIs do not)
- Notifications split
- Payments / Payouts
- Any UI redesign

The marketplace guard scaffolding shipped here is wiring waiting to be
mounted, not a feature.
