## Local email delivery via Nodemailer + Mailpit

### What's included

**Nodemailer adapter**

- `NodemailerMailAdapter` implementing the existing `MailPort` abstraction — drop-in replacement for `InMemoryMailAdapter`
- Reads SMTP config from env (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)
- Logs masked envelope metadata only — never the email body (which contains one-time verification/reset tokens)

**Conditional module binding**

- `MailModule` factory: if `SMTP_HOST` is set → `NodemailerMailAdapter`; otherwise → `InMemoryMailAdapter`
- Boot log identifies the active adapter
- InMemoryMailAdapter remains the default for `pnpm test` and CI (no SMTP required)

**Mailpit Docker service**

- Added to `infra/docker/docker-compose.yml`
- SMTP on port **1025**, Web UI on port **8025**
- `pnpm docker:up` now starts Mailpit alongside Postgres, Mongo, and Redis
- Open `http://localhost:8025` to inspect captured emails

**Env vars (all optional)**
| Variable | Default | Purpose |
|---|---|---|
| `SMTP_HOST` | (unset) | Activates Nodemailer when set |
| `SMTP_PORT` | `1025` | Mailpit default |
| `SMTP_SECURE` | `false` | TLS flag |
| `SMTP_USER` | (unset) | SMTP auth (Mailpit needs none) |
| `SMTP_PASS` | (unset) | SMTP auth |
| `SMTP_FROM` | `noreply@homeservicemarketplace.local` | Sender address |

### Test status

- `tsc --noEmit` ✅
- `eslint` ✅
- `jest` ✅ — 264 passed, 6 gated (`RUN_DB_INTEGRATION=1`), 4 new adapter tests

### What's NOT included

- No auth endpoint changes
- No frontend changes
- No HTML email templates (plain text only for now)
- No production SMTP provider wiring (SES/SendGrid deferred)

### Manual QA

See `docs/local-mail-testing.md` for the full register → Mailpit → verify → login flow.
