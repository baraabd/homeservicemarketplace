# Local Email Testing with Mailpit

Mailpit is a local SMTP server that captures all outgoing emails in a web UI. It replaces the `InMemoryMailAdapter` during local development so you can visually inspect verification and password-reset emails.

## 1. Start Mailpit

```bash
pnpm docker:up
```

This starts Mailpit alongside Postgres, Mongo, and Redis.

| Port | Purpose                                |
| ---- | -------------------------------------- |
| 1025 | SMTP (API sends mail here)             |
| 8025 | Web UI (you view captured emails here) |

Open **http://localhost:8025** in your browser.

## 2. Configure the API

Ensure your `.env` contains:

```env
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_FROM=noreply@homeservicemarketplace.local

# Enable verification gating so the email flow actually fires:
AUTH_REQUIRE_EMAIL_VERIFICATION=true
```

When `SMTP_HOST` is set the API automatically uses `NodemailerMailAdapter` instead of `InMemoryMailAdapter`. The boot log will print `Using NodemailerMailAdapter (SMTP)`.

## 3. Test the email verification flow

```bash
# 1. Register a new user
curl -s -X POST http://localhost:4000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"a-reasonable-passphrase","firstName":"Test","lastName":"User"}'
# → 202 {"success":true}

# 2. Open http://localhost:8025 → you should see the verification email
#    Copy the token from the email body (the ?token=... query parameter)

# 3. Verify the email
curl -s -X POST http://localhost:4000/v1/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"token":"<paste-token-here>"}'
# → 200 {"success":true}

# 4. Login should now succeed
curl -s -X POST http://localhost:4000/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Client-Kind: mobile" \
  -d '{"email":"test@example.com","password":"a-reasonable-passphrase"}'
# → 200 with tokens
```

## 4. Test the password-reset flow

```bash
# 1. Request a password reset
curl -s -X POST http://localhost:4000/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
# → 202 {"success":true}

# 2. Open http://localhost:8025 → see the reset email → copy the token

# 3. Reset the password
curl -s -X POST http://localhost:4000/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"<paste-token-here>","newPassword":"a-brand-new-passphrase"}'
# → 200 {"success":true}

# 4. Login with the new password
curl -s -X POST http://localhost:4000/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Client-Kind: mobile" \
  -d '{"email":"test@example.com","password":"a-brand-new-passphrase"}'
# → 200 with tokens
```

## 5. Without Mailpit (CI / test fallback)

If `SMTP_HOST` is **not set** in `.env`, the API falls back to `InMemoryMailAdapter` — emails are captured in process memory only. This is the default for `pnpm test` and CI pipelines. The adapter exposes `.outbox` and `.lastSentTo(email)` for programmatic assertions in integration tests.
