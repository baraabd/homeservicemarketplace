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

## Granting admin / provider access (operator runbook)

There is **no public HTTP endpoint** that grants the `admin` role. Any
admin role assignment goes through one of two sanctioned paths:

1. **Local / dev convenience** — the operator script
   `packages/database/src/admin-access-grant.ts` (compiled to
   `dist/admin-access-grant.js` and exposed as the pnpm script
   `grant:admin-provider`).
2. **Production** — a reviewed admin moderation tool, **not** this
   script. The script refuses to run with `NODE_ENV=production` unless
   `ALLOW_PROD_GRANT=true` is set explicitly, and even then the
   intended use is one-off operator access for an emergency.

### Usage

```bash
# Default: target admin@admin.com (the local operator account)
pnpm --filter @homeservicemarketplace/database grant:admin-provider

# Custom target
pnpm --filter @homeservicemarketplace/database grant:admin-provider -- foo@example.com

# Or via env
GRANT_EMAIL=foo@example.com pnpm --filter @homeservicemarketplace/database grant:admin-provider

# Create a passwordless placeholder when the email does not yet exist
# (operator MUST then set a password via the forgot-password flow)
pnpm --filter @homeservicemarketplace/database grant:admin-provider -- foo@example.com --create-if-missing
```

### What the script does

For the target email it:

- Looks the user up by case-insensitive email.
- Attaches the `customer`, `provider`, and `admin` roles if missing
  (idempotent — composite PK makes a re-run a no-op).
- Upserts a `ProviderProfile` for that user with `status = ACTIVE`.
  An existing profile keeps its editable fields; only the status is
  promoted to `ACTIVE` if it was something else (DRAFT / PENDING_REVIEW
  / SUSPENDED / REJECTED).
- Logs a single safe summary line — never prints passwords, hashes,
  tokens, OTPs, or session ids.

### What the script does NOT do

- It never sets a password. If the user does not exist yet and
  `--create-if-missing` is passed, a passwordless placeholder is
  created (with `emailVerifiedAt` populated so login does not throw
  `AUTH_ACCOUNT_UNVERIFIED`); the operator must then run the standard
  forgot-password flow to set a usable password.
- It never creates a duplicate identity. The lookup is keyed on
  `lower(email)` and the User row's `email @unique` is the final
  backstop.
- It never overwrites a ProviderProfile's editable fields
  (displayName, bio, headline, service area, …).

### Why no public admin-upgrade endpoint?

A public `/v1/me/admin/upgrade` route — even gated behind a "secret
code" or "admin email allowlist" — has historically leaked privilege
in marketplaces. The audit decision is therefore architectural: the
admin role is granted only through reviewed code paths that touch the
DB directly, never through a request that an attacker could reach.
The complete list of legitimate sources of an admin role assignment
is:

1. The seed (currently does not assign admin to any user — only the
   `admin` role row itself is created).
2. This script (`grant-admin-provider-access`), which is local-only
   by default and refuses production without an explicit override.
3. A future admin moderation surface, which will be a separate
   `RolesGuard('admin')`-protected slice (out of scope for the
   current sprint).

If you find any other code path that writes to `UserRole` with
`roleId = (admin role id)`, treat it as a security defect — file it
and remove it.

## Registration / upgrade injection hardening

The audit pinned the following input-rejection rules. They are
enforced by the global `ValidationPipe { whitelist: true,
forbidNonWhitelisted: true }` in conjunction with each endpoint's
DTO:

- **`POST /v1/auth/register`** rejects (with 400 `VALIDATION_ERROR`)
  any of: `role`, `roles`, `roleName`, `isAdmin`, `admin`, `status`,
  `providerProfile`, `permissions`, `userId`, `id`. The `customer`
  role is the only role auto-assigned by registration; provider /
  admin must go through their own paths.
- **`POST /v1/me/provider/upgrade`** uses an empty-body DTO. ANY
  field in the request body is rejected. Identity is sourced from
  `@CurrentUser()` (the authenticated session). The upgrade is
  idempotent at the service layer.
- **`PATCH /v1/me/provider/profile`** and **`PATCH /v1/me/profile`**
  reject all of: `userId`, `email`, `role`, `status`, `password`,
  `passwordHash`, `ratingAvg`, `reviewCount`, `completedJobs`,
  `verified`, `topPro`, `availability`. Availability has its own
  dedicated single-field endpoint.

Each rule is pinned by an e2e test (`apps/api/test/e2e/auth.e2e.spec.ts`,
`apps/api/test/e2e/provider.e2e.spec.ts`) that iterates the vectors
and asserts a 400 response with no service call.

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
