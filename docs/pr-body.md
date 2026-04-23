## Infrastructure & IAM baseline

### What's included

**Infrastructure foundation**

- Zod-validated env config, NestJS modules for Postgres (Prisma), Mongo (Mongoose), Redis (ioredis)
- Bounded connect retries with jittered backoff, per-driver ping/readiness, graceful shutdown
- Pino structured logging with PII redaction and x-request-id correlation
- Prometheus `/metrics`, `/health/live`, `/health/ready` endpoints
- Global exception filter with normalized error envelope
- Helmet, CORS, rate limiting (ThrottlerGuard)

**IAM module**

- 10 auth endpoints: register, verify-email, resend-verification, login, refresh, logout, logout-all, forgot-password, reset-password, me
- Argon2id password hashing with constant-time anti-enumeration
- Hybrid transport: HttpOnly cookies for web, Bearer tokens for mobile
- Refresh token family rotation with atomic replay detection
- CSRF double-submit protection on cookie-auth mutations
- Account lockout (5 failures -> 15-min lock)
- Email verification + password reset with hashed single-use tokens
- Anti-enumeration timing floor (200ms) on public endpoints
- RBAC (roles + permissions guards, Redis-cached permission resolution)
- Audit trail with metadata allowlist
- Prisma schema: 10 models, 2 migrations

**Build/runtime fixes**

- Fixed runtime crash from `.d.ts` side-effect import
- Fixed silent empty build from `tsBuildInfoFile` location
- Fixed cold-cache typecheck failure (turbo dependency graph)
- Added `AUTH_REQUIRE_EMAIL_VERIFICATION` dev flag

### Test status

- `pnpm --filter api exec tsc --noEmit` ✅
- `pnpm --filter api lint` ✅
- `pnpm --filter api test` ✅ (260 passing, 6 gated with `RUN_DB_INTEGRATION=1`)

### New env variables

See `.env.example` — IAM block at the bottom. `JWT_ACCESS_SECRET` (>=32 chars) is required.

### What's NOT included (intentionally deferred)

- Real mail adapter (Nodemailer/Mailpit) — `InMemoryMailAdapter` remains the default
- Frontend auth integration (Axios, React Query, route guards)
- Access-token Redis blocklist for at-flight revocation
- MFA/OAuth endpoints (schema ready, code deferred)
- Partial-unique on `users.email WHERE deletedAt IS NULL`
