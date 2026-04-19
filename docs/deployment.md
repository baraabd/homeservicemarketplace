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
