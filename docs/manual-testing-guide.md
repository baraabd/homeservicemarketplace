# Manual Backend Verification Guide

This guide walks through booting the stack from a clean state and exercising every currently-implemented endpoint against a running API. It reflects the code as of **2026-04-16** and will only drift if endpoints change without updating this file.

## 1. Prerequisites

- Node.js 20.x, pnpm 10.x (`corepack enable`), Docker Desktop with Compose v2.
- Clone + install: `pnpm install` at the repo root.
- The three infrastructure containers started with `pnpm docker:up` (Postgres, Mongo, Redis).

## 2. Environment file

The IAM module requires additional env variables that may not yet be in your local `.env`. If they're missing, the API fails to start with `Error: Invalid environment configuration: JWT_ACCESS_SECRET: Required`.

```bash
# 1. Copy the example if you don't have .env at all
cp .env.example .env

# 2. Generate a strong JWT secret (base64url, 48 random bytes)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# → paste the output as JWT_ACCESS_SECRET in .env

# 3. For local HTTP dev, make sure:
#    COOKIE_SECURE=false    (Secure cookies only work over HTTPS)
#    COOKIE_SAMESITE=lax
```

All IAM variables live at the bottom of `.env.example`. They are documented inline there.

## 3. Apply the schema

```bash
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database generate
```

This creates the IAM tables (`users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `sessions`, `verification_tokens`, `oauth_accounts`, `mfa_backup_codes`, `audit_events`).

## 4. Seed reference data

```bash
pnpm --filter @homeservicemarketplace/database seed
```

Seeds the three system roles (`customer`, `provider`, `admin`) and the baseline permission catalogue. Idempotent; safe to re-run.

## 5. Launch the API

### 5a. Dev mode (watch)

```bash
pnpm --filter @homeservicemarketplace/api dev
```

### 5b. Production-style (what we validate in Phase 2)

```bash
pnpm --filter @homeservicemarketplace/api build
npx dotenv -e .env -- node apps/api/dist/main.js
```

A successful boot logs, in order:

- `ConfigModule dependencies initialized`
- `Postgres connection established`
- `Mongo connection established`
- `Redis ready` / `Redis connection established`
- route mappings for `/health/*`, `/metrics`, `/auth/*`
- `Nest application successfully started`
- `API listening on :4000 (env=development)`

If any of those lines are missing, stop and read the error above — most failures are env-related (missing / malformed `JWT_ACCESS_SECRET`, wrong `DATABASE_URL`, Secure cookies over HTTP).

## 6. Smoke tests (under 10 seconds)

```bash
curl -s http://localhost:4000/health/live
# → {"status":"ok","uptimeSeconds":<n>,"timestamp":"..."}

curl -s http://localhost:4000/health/ready
# → {"ready":true,"dependencies":[{"name":"postgres","status":"up"},{"name":"mongo","status":"up"},{"name":"redis","status":"up"}]}

curl -s http://localhost:4000/metrics | head -3
# → Prometheus text output starting with '# HELP ...' lines
```

If `/health/ready` returns 503, one of the dependency containers is unreachable. Run `docker compose -f infra/docker/docker-compose.yml ps` and confirm all three show `(healthy)`.

## 7. Walk the IAM flow end-to-end

### 7a. Register

```bash
curl -s -o /tmp/r.json -w "%{http_code}\n" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:4000/v1/auth/register \
  -d '{"email":"ada@example.com","password":"a-reasonable-passphrase","firstName":"Ada","lastName":"Lovelace"}'
# → 202
cat /tmp/r.json
# → {"success":true}
```

Duplicate email returns the **same** 202 body — anti-enumeration.

### 7b. Retrieve the verification token

The mail adapter is in-memory, so production email delivery isn't wired. Grab the token directly from Postgres:

```bash
docker exec hsm-postgres psql -U postgres -d homeservicemarketplace -c \
  "SELECT \"tokenHash\", \"purpose\", \"usedAt\" FROM verification_tokens ORDER BY \"createdAt\" DESC LIMIT 1;"
```

⚠️ Only the **hash** is stored. To exercise the verify endpoint you need the raw token, which the test suite captures via `InMemoryMailAdapter.lastSentTo(email)`. For manual flows, skip the verify step and flip the user to `ACTIVE` directly:

```bash
docker exec hsm-postgres psql -U postgres -d homeservicemarketplace -c \
  "UPDATE users SET status='ACTIVE', \"emailVerifiedAt\"=NOW() WHERE email='ada@example.com';"
```

(Once a real mail adapter lands, this hack goes away and you use the link from the actual email.)

### 7c. Login (mobile — tokens in body)

```bash
curl -s -X POST http://localhost:4000/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Client-Kind: mobile" \
  -d '{"email":"ada@example.com","password":"a-reasonable-passphrase"}' \
  | tee /tmp/login.json
# → 200
# → { "userId":"...", "roles":["customer"], "mfaRequired":false,
#     "tokens":{ "accessToken":"<jwt>", "refreshToken":"<opaque>", "expiresIn":600 } }
```

### 7d. Login (web — cookies)

```bash
curl -s -X POST http://localhost:4000/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Client-Kind: web" \
  -c /tmp/cookies.txt \
  -d '{"email":"ada@example.com","password":"a-reasonable-passphrase"}'
# → Sets hsm_at (HttpOnly), hsm_rt (HttpOnly, Path=/v1/auth/refresh, SameSite=Strict),
#   hsm_csrf (readable, SameSite=Strict). Body has tokens=null.
cat /tmp/cookies.txt
```

### 7e. Authenticated call

```bash
ACCESS=$(jq -r .tokens.accessToken /tmp/login.json)
curl -s -H "Authorization: Bearer $ACCESS" http://localhost:4000/v1/auth/me
# → 200 with { id, email, firstName, lastName, status, emailVerifiedAt, mfaEnabled, roles }
# → NO passwordHash, NO mfaSecret, NO internal fields.
```

### 7f. Refresh + replay detection

```bash
REFRESH=$(jq -r .tokens.refreshToken /tmp/login.json)

# First rotate — succeeds
curl -s -X POST http://localhost:4000/v1/auth/refresh \
  -H "X-Client-Kind: mobile" -H "X-Refresh-Token: $REFRESH" \
  | jq '.tokens.refreshToken' > /tmp/refresh-new.txt

# Replay the OLD refresh — must 401 AUTH_REFRESH_INVALID and revoke the family
curl -s -o /tmp/replay.json -w "%{http_code}\n" \
  -X POST http://localhost:4000/v1/auth/refresh \
  -H "X-Client-Kind: mobile" -H "X-Refresh-Token: $REFRESH"
# → 401 {"success":false,"error":{"code":"AUTH_REFRESH_INVALID",...}}

# The NEW refresh is now also invalidated — family revoke
NEW=$(cat /tmp/refresh-new.txt | tr -d '"')
curl -s -o /tmp/after.json -w "%{http_code}\n" \
  -X POST http://localhost:4000/v1/auth/refresh \
  -H "X-Client-Kind: mobile" -H "X-Refresh-Token: $NEW"
# → 401 — the whole family was revoked by the replay
```

### 7g. Forgot-password + reset (generic anti-enum)

```bash
# Request reset — same 202 whether the email exists or not
curl -s -o /tmp/fp1.json -w "%{http_code}\n" \
  -X POST http://localhost:4000/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com"}'
# → 202

curl -s -o /tmp/fp2.json -w "%{http_code}\n" \
  -X POST http://localhost:4000/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"ghost@example.com"}'
# → 202 (identical response)

diff /tmp/fp1.json /tmp/fp2.json  # → empty diff confirms anti-enum
```

To complete the reset you need the raw token from the outbound mail. For automated testing, see `apps/api/test/integration/auth-flow.integration.spec.ts` which captures it via `InMemoryMailAdapter.lastSentTo()`.

### 7h. Logout

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:4000/v1/auth/logout \
  -H "Authorization: Bearer $ACCESS"
# → 204 No Content. The session row is marked revoked; the access token
#   itself remains valid until its 10-min exp (no at-flight blocklist yet).
```

## 8. Expected failure modes — how to recognize each

| Symptom                                                                         | Likely cause                                                                  | Fix                                                                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Error: Invalid environment configuration: JWT_ACCESS_SECRET: Required` on boot | Missing IAM block in `.env`                                                   | Append the block from `.env.example`, generate a random secret                                |
| `Cannot find module '../types/express'` on boot                                 | Someone re-added the forbidden runtime import of the `.d.ts` declaration file | Remove the `import '../types/express';` line; global augmentations don't need runtime imports |
| `/health/ready` → 503 with one dep `down`                                       | Docker container not running or unhealthy                                     | `pnpm docker:up`; if persistent, `docker logs hsm-<svc>`                                      |
| Login returns 401 `AUTH_ACCOUNT_UNVERIFIED`                                     | `users.status` still `PENDING_VERIFICATION`                                   | Consume the verification token OR manually UPDATE the row in dev                              |
| Login returns 401 `AUTH_ACCOUNT_LOCKED`                                         | 5 consecutive failed logins within 15 min                                     | Wait 15 min or `UPDATE users SET "failedLoginCount"=0, "lockedUntil"=NULL WHERE email=...`    |
| Web cookie set but refresh still fails                                          | Cookie `Path=/v1/auth/refresh` mismatch was re-introduced                     | Check `helpers/cookies.ts` `REFRESH_PATH` — must match the versioned URL                      |
| `/v1/auth/refresh` with cookie returns 403 `AUTH_CSRF_FAILED`                   | Missing `X-CSRF-Token` header on a cookie-authed refresh                      | Read `hsm_csrf` cookie value and echo it in `X-CSRF-Token`                                    |
| `/v1/auth/refresh` → 400 `AUTH_AMBIGUOUS_TRANSPORT`                             | Client sent BOTH cookie refresh and `X-Refresh-Token` header                  | Choose one transport; this is a deliberate rejection                                          |

## 9. Logs to inspect

- **Boot failures**: the initial `NestFactory` lines — errors happen before routes are mapped. Look for `Invalid environment configuration`, `Postgres connect attempt N/5 failed`, or `Mongo connect attempt N/5 failed`.
- **Auth failures**: pino logs carry `requestId`. Cross-reference the error response's `requestId` with the log line at the same timestamp.
- **Rate limiting**: `ThrottlerGuard` returns 429 with no body; check `X-RateLimit-Remaining` response headers.
- **Audit trail**: every auth-significant event writes a row to `audit_events` with `requestId`, `ipAddress`, `userAgent`. Query it with `SELECT type, "requestId", "createdAt" FROM audit_events ORDER BY "createdAt" DESC LIMIT 20;`.

## 10. What "healthy" looks like end-to-end

1. `docker ps` shows `hsm-postgres`, `hsm-mongo`, `hsm-redis` all `(healthy)`.
2. API boot ends with `API listening on :4000`.
3. `/health/ready` returns `{"ready":true, ...}` with all three deps `up`.
4. `/metrics` returns Prometheus text including `http_requests_total` and `process_resident_memory_bytes`.
5. Full IAM flow (register → mark active → login → refresh → logout) completes without 5xx.
6. Replaying an old refresh token returns 401 and breaks the family (subsequent refresh with the newest token also fails).
7. `audit_events` grows with `USER_REGISTERED`, `LOGIN_SUCCESS`, `REFRESH_ROTATED`, `REFRESH_REPLAY`, `LOGOUT` rows matching your activity.
