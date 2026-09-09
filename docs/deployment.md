# Deployment Guide

This document covers the three runtime profiles the app must support today and the exact env/cookie/CORS policy for each. It is the source of truth for "which knob changes between local, preview, and prod" — update it whenever the auth contract or hosting shape changes.

## 1. Environments

| Profile              | Web origin                        | API origin                          | Transport  | Relationship                          |
| -------------------- | --------------------------------- | ----------------------------------- | ---------- | ------------------------------------- |
| Local dev            | `http://localhost:5173`           | `http://localhost:4000`             | plain HTTP | cross-origin (different ports)        |
| Preview (same-site)  | `https://preview.<your-domain>`   | `https://api-preview.<your-domain>` | HTTPS      | same-site (shared registrable domain) |
| Preview (cross-site) | `https://<branch>-web.vercel.app` | `https://api.<your-domain>`         | HTTPS      | cross-site                            |
| Production           | `https://app.<your-domain>`       | `https://api.<your-domain>`         | HTTPS      | same-site (recommended)               |

Same-site preview/prod is the recommended shape — it keeps the refresh cookie's `SameSite=Strict` protection intact. Cross-site deployments work but require `SameSite=None; Secure`.

## 2. Frontend (Vercel)

### 2.1 Required env vars

| Variable       | Scope                | Value                                                                                               |
| -------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | Preview + Production | Absolute URL of the backend API (no trailing slash). Must match the API origin that issues cookies. |

Vite inlines `VITE_*` at build time — **not** at runtime. Preview and production each need their own value; set them in Vercel → Project → Settings → Environment Variables.

### 2.2 Vercel project settings

- **Framework preset**: Vite (auto-detected; `apps/web/vercel.json` also declares it).
- **Root directory**: `apps/web`.
- **Install command**: `pnpm install --frozen-lockfile` (declared in `vercel.json`).
- **Build command**: `pnpm --filter @homeservicemarketplace/web build` (declared in `vercel.json`).
- **Output directory**: `dist`.
- **SPA rewrites**: `/(.*) → /index.html` is declared in `vercel.json` so deep links don't 404.

### 2.3 Security headers

`vercel.json` sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and one-year immutable caching for `/assets/*`.

## 3. Backend (Node host — Fly / Render / Railway / ECS / Kubernetes)

The API is a plain Node/Nest process. It needs:

- Postgres, Mongo, Redis reachable from the container.
- SMTP reachable for verification/reset emails.
- Outbound `.env` with the variables below.

### 3.1 Required env vars for browser integration

| Variable                          | Purpose                                                                                         | Example                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `FRONTEND_URL`                    | Primary allowed origin for CORS (always allowed)                                                | `https://app.example.com`                                   |
| `CORS_ORIGINS`                    | Comma-separated additional allowed origins (preview deployments, alt domains)                   | `https://preview-web.example.com,https://admin.example.com` |
| `COOKIE_DOMAIN`                   | Leave empty for host-only cookies; set to `.example.com` only for same-site deployment          | `.example.com` or empty                                     |
| `COOKIE_SECURE`                   | `true` for anything HTTPS                                                                       | `true`                                                      |
| `COOKIE_SAMESITE`                 | `lax` same-site; `none` cross-site; never `strict` (breaks the access cookie on top-level navs) | `lax` or `none`                                             |
| `JWT_ACCESS_SECRET`               | ≥32 chars; rotate by re-deploy                                                                  | long random base64url                                       |
| `FRONTEND_URL`                    | Used in verification/reset email links                                                          | same as CORS                                                |
| `SMTP_*`                          | Real SMTP provider                                                                              | see `.env.example`                                          |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Must be `true` in preview/prod                                                                  | `true`                                                      |
| `NODE_ENV`                        | `production` in prod                                                                            | `production`                                                |

### 3.2 CORS policy by environment

Implemented in `apps/api/src/main.ts`.

| Profile                   | `origin` value                    | Behavior                                                                        |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------------- |
| Production, allowlist set | `[FRONTEND_URL, ...CORS_ORIGINS]` | Only listed origins allowed; all others blocked.                                |
| Production, no allowlist  | `false`                           | All cross-origin blocked. Boot log: `CORS: blocked (production, no allowlist)`. |
| Dev, allowlist set        | `[FRONTEND_URL, ...CORS_ORIGINS]` | Same as production.                                                             |
| Dev, no allowlist         | `true` (reflect request origin)   | Convenience for local tooling. Never relied upon in deployment.                 |

`credentials: true` is always on; wildcard is never combined with credentials (browsers reject this).

### 3.3 Cookie policy by environment

Implemented in `apps/api/src/modules/iam/authentication/helpers/cookies.ts`.

| Cookie     | Purpose            | Path               | SameSite               | Secure               | HttpOnly           |
| ---------- | ------------------ | ------------------ | ---------------------- | -------------------- | ------------------ |
| `hsm_at`   | Access JWT         | `/`                | from `COOKIE_SAMESITE` | from `COOKIE_SECURE` | true               |
| `hsm_rt`   | Refresh token      | `/v1/auth/refresh` | **always Strict**      | from `COOKIE_SECURE` | true               |
| `hsm_csrf` | CSRF double-submit | `/`                | **always Strict**      | from `COOKIE_SECURE` | false (read by JS) |

Environment profiles:

| Profile                 | `COOKIE_DOMAIN` | `COOKIE_SECURE` | `COOKIE_SAMESITE` | Notes                                                                                                                                                                                                    |
| ----------------------- | --------------- | --------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local dev               | empty           | `false`         | `lax`             | Plain HTTP localhost.                                                                                                                                                                                    |
| Same-site preview/prod  | `.example.com`  | `true`          | `lax`             | Web + API share registrable domain; refresh `Strict` cookie works.                                                                                                                                       |
| Cross-site preview/prod | empty           | `true`          | `none`            | Required for cross-site XHR. Refresh still `Strict` → web refresh must happen via a same-site top-level request **or** the client must switch to Bearer (`X-Client-Kind: mobile` transport) for refresh. |

**Important**: the refresh cookie is hardcoded `SameSite=Strict` and scoped to `Path=/v1/auth/refresh`. For a truly cross-site web deployment you have two options:

1. Deploy web + API on the same registrable domain and rely on cookies (recommended).
2. Switch the web client to the mobile transport (`X-Client-Kind: mobile`) and handle tokens explicitly. This removes the CSRF layer and increases XSS blast radius — only do this if option 1 is impossible.

### 3.4 Deploying the backend to a Vercel frontend

Vercel does not host a long-lived Nest server comfortably. Deploy the API separately (Fly.io / Render / Railway are a good first stop) and point `VITE_API_URL` at it. Vercel's Serverless or Edge Functions are **not** a drop-in for the Nest process.

## 4. Local integration smoke

```bash
# 1. Bring up infra (Postgres, Mongo, Redis, Mailpit)
pnpm docker:up

# 2. Apply schema + seed
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database seed

# 3. Start the API
pnpm --filter @homeservicemarketplace/api dev

# 4. In another terminal, start the web app
pnpm --filter @homeservicemarketplace/web dev
```

Visit `http://localhost:5173`. Register → open http://localhost:8025 for the verification email → verify → log in → refresh the tab (session should survive via cookies). Network throttling / temporary backend outage should NOT flip you back to `/login` — the web app treats non-401 `/me` failures as a transient "degraded session".

## 5. Production checklist

Before promoting to production, confirm:

- [ ] `NODE_ENV=production` on the API.
- [ ] `AUTH_REQUIRE_EMAIL_VERIFICATION=true`.
- [ ] `JWT_ACCESS_SECRET` is ≥32 chars and unique per environment (never reused from dev).
- [ ] `FRONTEND_URL` + `CORS_ORIGINS` cover exactly the browser origins that should be allowed — no wildcards.
- [ ] `COOKIE_SECURE=true`.
- [ ] The active `COOKIE_SAMESITE` + `COOKIE_DOMAIN` combination matches the same-site-vs-cross-site shape of this deployment.
- [ ] Real SMTP credentials configured (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).
- [ ] TLS termination in front of the API; `X-Forwarded-*` headers trusted by the platform.
- [ ] Database backups enabled on Postgres.
- [ ] `/health/ready` green before traffic is shifted.

## 6. Provider verification and work access (Sprint 09B.29)

The provider journey ends in a `ProviderWorkAccessGrant`. Nothing issues one
except an approved verification case, and a verification case cannot be
submitted until the uploaded identity evidence has been scanned CLEAN. That
makes the scan sweep a **hard prerequisite for onboarding any provider at all**.

### 6.1 The chain, and what gates each link

| Link                                       | Requires                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| provider submits onboarding                | nothing extra                                                                          |
| admin approves the application             | `admin` role                                                                           |
| admin approves the specialty               | `admin` role                                                                           |
| provider uploads evidence                  | —                                                                                      |
| **evidence is scanned CLEAN**              | **`EVIDENCE_SCANNER_DRIVER` = a real scanner AND `EVIDENCE_SCAN_WORKER_ENABLED=true`** |
| provider submits the case                  | evidence CLEAN                                                                         |
| admin approves the case → **grant issued** | `verification:decide` permission                                                       |

### 6.2 Required settings

```bash
EVIDENCE_MAX_BYTES=10485760          # REQUIRED — the API will not boot without it
EVIDENCE_SCANNER_DRIVER=clamav       # `test` THROWS at boot in production, by design
CLAMAV_HOST=…                        # see clamav-scanner.adapter.ts
EVIDENCE_SCAN_WORKER_ENABLED=true    # default false
EVIDENCE_SCAN_INTERVAL_MS=60000
EVIDENCE_SCAN_BATCH_SIZE=25
WORK_ACCESS_ENFORCED=true            # decide work access from the grant
VERIFICATION_ENFORCED=true           # decide on the verification axis
```

### 6.3 Failure modes, and which direction each fails in

- **Worker off** — evidence is stored and never judged. Providers can complete
  onboarding and submit an application, and then cannot proceed: case
  submission is refused `EVIDENCE_NOT_CLEAN` indefinitely. Denies access; never
  grants it.
- **Worker on, `EVIDENCE_SCANNER_DRIVER=none`** — the sweep runs, examines
  every asset and clears none: `EvidenceScanService` refuses to write CLEAN
  unless the adapter reports `isRealScanner`. Same outcome as off.
- **`EVIDENCE_SCANNER_DRIVER=test` in production** — the API refuses to boot.
  That adapter can mark a file CLEAN without scanning it, so
  `resolveScannerSelection` throws rather than start.

It is safe to run the sweep on every replica. Selection is not a claim: the
write is conditional on the state the worker observed, so a racing replica's
write moves zero rows and produces no second audit record and no second outbox
event. The outbox `dedupeKey` is `evidence.scanned:<assetId>:<state>`.

The scheduler cannot overlap itself: the next timer is armed in `.finally()`,
so a pass slower than its interval delays the next one instead of running two.

### 6.4 ROLLOUT BLOCKER — no production deployment configuration exists

As of Sprint 09B.29 this repository contains **no committed production
deployment configuration**: no `vercel.json`, `render.yaml`, `fly.toml`,
Kubernetes manifests or Terraform, and `infra/docker/docker-compose.yml` is
`NODE_ENV=development` and sets none of the variables above.

There is therefore **nowhere that enables `EVIDENCE_SCAN_WORKER_ENABLED` with a
real scanner**, and no environment in which the provider journey completes.

Until a production configuration exists and sets §6.2, the provider onboarding
and verification journey is **verified but not deployable**. This is recorded
rather than worked around; see
`docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md` §3.12.5.

---

## 7. Public media retention — the sweep that deletes provider photos

_Sprint 09B.29 Phase 4._

`EvidenceCleanupService` has deleted **RESTRICTED** bytes since Sprint 9B.
Nothing did the same for **PUBLIC** ones. Five paths produced objects that
nothing would ever remove:

| id  | path                                     | what was left behind                             |
| --- | ---------------------------------------- | ------------------------------------------------ |
| O-1 | avatar uploaded, never finalized         | object, and no row at all                        |
| O-2 | avatar replaced                          | the previous object                              |
| O-3 | avatar removed                           | the object; only the pointer went                |
| O-4 | portfolio image uploaded, never attached | object, and no row at all                        |
| O-5 | portfolio item deleted                   | the object — **and a row that said it was gone** |

O-5 was the worst, and not because of the bytes: the delete path wrote
`MediaAsset.deletedAt` immediately, so the database asserted the object was
gone while it was still readable at its public URL.

### 7.1 The lifecycle contract

| column              | written by                                   | means                              |
| ------------------- | -------------------------------------------- | ---------------------------------- |
| `uploadExpiresAt`   | presign (`PublicMediaLedgerService.reserve`) | this key was authorised            |
| `uploadCompletedAt` | finalize / attach (`claim`)                  | a provider attached this object    |
| `retainUntil`       | replace / remove / delete (`retire`)         | **intent** — eligible for deletion |
| `deletedAt`         | `PublicMediaCleanupService` **only**         | **confirmed gone from storage**    |

`deletedAt` is never written by a request path. The sweep deletes the object
first and records only afterwards, so the failure mode is an object deleted
twice — harmless, `deleteObject` treats absence as success — rather than a row
that lies.

### 7.2 Settings

```bash
PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED=false          # DEFAULT OFF — see below
PUBLIC_MEDIA_CLEANUP_INTERVAL_MS=900000            # 15 minutes
PUBLIC_MEDIA_CLEANUP_BATCH_SIZE=50
PUBLIC_MEDIA_CLEANUP_RESERVATION_GRACE_MS=86400000 # 24h on top of the presign TTL
```

**Default off for a stronger reason than the other workers.** Every other
default-off worker in this repository is off because enabling it _grants_
something. This one is off because enabling it _destroys_ something. Off means
the leak persists; on with a misconfiguration means bytes disappear. The safe
direction is off.

Safe on every replica, for the same reason the evidence sweep is: selection is
not a claim, the object delete is idempotent, and the row write is conditional
on `deletedAt` still being null. Two replicas produce one deletion record and
one `raced` count. No leader election.

### 7.3 CDN and edge-cache deletion semantics — HONEST STATEMENT

Deleting the origin object does **not** evict a CDN or browser copy, and this
deployment implements **no cache invalidation**. What that means concretely:

- **Local-disk driver** (`STORAGE_DRIVER=local`) — objects are served by the
  API from `/v1/media/files/*`. There is no CDN. Deletion is effective
  immediately; a subsequent GET is a 404.
- **S3 driver without a CDN** — `publicUrlForKey` returns the bucket URL.
  Deletion is effective immediately at the origin. Browsers that already
  fetched the object may hold it for the lifetime of its `Cache-Control`
  header.
- **S3 driver behind a CDN** — an edge copy may continue to be served after the
  origin object is gone, for an **unbounded** period in the general case: it
  depends on the distribution's TTL, which is not configured in this repository
  because no production distribution is configured in this repository (§6.4).

**No invalidation call is issued, and none is stubbed.** Adding a
CloudFront/Fastly invalidation would require a distribution id, an IAM
permission and a rate budget, none of which exist here; a stub would be worse
than the gap because it would read as though the problem were handled.

Consequences that must be accepted before enabling the worker in an environment
with a CDN:

1. A provider who removes their photo may see it served from an edge for some
   time after the API reports success. The UI does not claim otherwise — it
   reports the removal, which did happen at the origin.
2. `deletedAt` means "gone from the origin store". It does not mean "no copy
   exists anywhere".
3. A privacy-driven deletion (a takedown, a data-subject request) is therefore
   **not complete** at the moment `deletedAt` is written when a CDN is in front
   of the bucket. Closing that requires an invalidation step, which is
   deliberately out of Phase 4's scope and is recorded as a residual risk in
   `docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md` §4.4.

Keys are never reused — every presign mints a fresh uuid — so a stale edge copy
can never be served in place of a _different_ provider's newer image. The
failure is a lingering copy of the same object, never a cross-owner mix-up.

### 7.4 What is deliberately NOT reserved

Request media (`purpose` omitted, key prefix `requests/`) is **not** given a
ledger reservation. It is attached as a bare URL in `ServiceRequest.mediaUrls[]`
and no code ever claims a `MediaAsset` row for it, so a reservation would age
past its grace period and the sweep would delete **live** request photos. Its
orphan lifecycle is separate work and is out of Phase 4's scope. This is
asserted by a test in `apps/api/test/e2e/media.e2e.spec.ts` so it cannot drift
silently.
