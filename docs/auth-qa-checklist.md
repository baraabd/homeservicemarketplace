# Auth Flow — Manual QA Checklist

This checklist validates the complete register → login → /me flow. It requires the API to be running locally with `AUTH_REQUIRE_EMAIL_VERIFICATION=false` in `.env` (the development default per `.env.example`).

## Prerequisites

- [ ] Docker containers running: `pnpm docker:up` → all three healthy.
- [ ] Migrations applied: `pnpm --filter @homeservicemarketplace/database migrate:deploy`
- [ ] Roles seeded: `pnpm --filter @homeservicemarketplace/database seed`
- [ ] `.env` populated from `.env.example` with a real `JWT_ACCESS_SECRET` and `AUTH_REQUIRE_EMAIL_VERIFICATION=false`.
- [ ] API built and started: `pnpm --filter @homeservicemarketplace/api build && npx dotenv -e .env -- node apps/api/dist/main.js`
- [ ] Boot log ends with `API listening on :4000 (env=development)`.

## Flow

### 1. Smoke

- [ ] `GET /health/live` → 200 `{"status":"ok", ...}`
- [ ] `GET /health/ready` → 200, all 3 deps up

### 2. Register

- [ ] `POST /v1/auth/register` with body `{"email":"test@example.com","password":"a-reasonable-passphrase","firstName":"Test","lastName":"User"}` + header `X-Client-Kind: mobile`
- [ ] Response: 202 `{"success":true}`
- [ ] Confirm DB: `SELECT status, "emailVerifiedAt" IS NOT NULL as verified FROM users WHERE email='test@example.com';` → `status=ACTIVE, verified=t`

### 3. Login (mobile)

- [ ] `POST /v1/auth/login` with body `{"email":"test@example.com","password":"a-reasonable-passphrase"}` + header `X-Client-Kind: mobile`
- [ ] Response: 200 with `{ userId, roles:["customer"], mfaRequired:false, tokens:{ accessToken, refreshToken, expiresIn } }`
- [ ] Save `accessToken` for step 4
- [ ] Save `refreshToken` for step 5

### 4. /me (authenticated)

- [ ] `GET /v1/auth/me` with header `Authorization: Bearer <accessToken>`
- [ ] Response: 200 `{ id, email, firstName, lastName, status:"ACTIVE", emailVerifiedAt:"<date>", mfaEnabled:false, roles:["customer"] }`
- [ ] Confirm response does NOT contain `passwordHash`, `mfaSecret`, or any internal field

### 5. Refresh

- [ ] `POST /v1/auth/refresh` with header `X-Refresh-Token: <refreshToken>` + header `X-Client-Kind: mobile`
- [ ] Response: 200 with new tokens
- [ ] Old `refreshToken` is now invalid; attempting it again returns 401

### 6. Logout

- [ ] `POST /v1/auth/logout` with header `Authorization: Bearer <new accessToken from step 5>`
- [ ] Response: 204

### 7. Negative tests

- [ ] `POST /v1/auth/login` with wrong password → 401 `AUTH_INVALID_CREDENTIALS`
- [ ] `POST /v1/auth/login` with nonexistent email → 401 `AUTH_INVALID_CREDENTIALS` (same error — no enumeration)
- [ ] `GET /v1/auth/me` without any token → 401 `AUTH_INVALID_CREDENTIALS`
- [ ] `POST /v1/auth/register` with password < 12 chars → 400 `VALIDATION_ERROR`
- [ ] `POST /v1/auth/forgot-password` with real email → 202 `{"success":true}`
- [ ] `POST /v1/auth/forgot-password` with fake email → 202 `{"success":true}` (identical — no enumeration)

## When `AUTH_REQUIRE_EMAIL_VERIFICATION=true`

In production (or when explicitly testing the verification flow):

1. Register creates a `PENDING_VERIFICATION` user.
2. Login returns 403 `AUTH_ACCOUNT_UNVERIFIED`.
3. The verification token is sent via the `MailPort` adapter — in dev, `InMemoryMailAdapter` captures it in process memory (accessible in integration tests via `mail.lastSentTo(email)`).
4. `POST /v1/auth/verify-email` with `{"token":"<raw token>"}` flips the user to `ACTIVE`.
5. Login then succeeds.

For manual QA without a real mail provider, use the SQL workaround:

```sql
UPDATE users SET status='ACTIVE', "emailVerifiedAt"=NOW() WHERE email='test@example.com';
```
