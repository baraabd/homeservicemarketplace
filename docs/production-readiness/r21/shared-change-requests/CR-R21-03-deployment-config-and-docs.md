# CR-R21-03 — deployment configuration, documentation and ADR for R21 mail

| Field     | Value                                                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paths     | `apps/api/src/config/runtime-policy.ts` (+ spec), `.env.example`, `infra/production/STAGING.md`, `docs/local-mail-testing.md`, `docs/adr/0004-transactional-outbox.md`, `.github/workflows/ci.yml` |
| Requested | 2026-10-13, R21                                                                                                                                                                                    |
| Migration | none · Dependency: none                                                                                                                                                                            |

R21's lease on `env.schema.ts` added the keys; it did not cover the strict
deployment policy, examples, operator docs, ADR or CI. None of the requests
below is needed for R21's source to be correct; each closes an operational
gap.

## A. Deployment policy (owner decision P-4)

R21 seals queued mail with a key **derived** from `JWT_ACCESS_SECRET` when
`MAIL_INTENT_ENCRYPTION_KEY` is unset, so existing production-shaped boots
(CI "Boot the production image", prod-smoke compose, image preflight) keep
working. A dedicated key is better (independent rotation, smaller blast
radius). If the owner accepts that, add to `runtime-policy.ts` deployment
checks:

```ts
if (!env.MAIL_INTENT_ENCRYPTION_KEY)
  issues.push('MAIL_INTENT_ENCRYPTION_KEY: provide a dedicated 32-byte base64 key');
```

and supply a disposable key in every production-shaped CI boot
(`ci.yml` "Boot the production image", `infra/docker/docker-compose.prod-smoke.yml`,
`infra/production/image-preflight-smoke.cjs`) in the same change.

## B. `.env.example` (append under the SMTP block)

```env
# R21 — bounded SMTP waits (ms)
SMTP_CONNECTION_TIMEOUT_MS=15000
SMTP_GREETING_TIMEOUT_MS=30000
SMTP_SOCKET_TIMEOUT_MS=30000
# R21 — durable mail. 32 random bytes, base64. Unset in dev = process-local key.
# MAIL_INTENT_ENCRYPTION_KEY=
MAIL_DISPATCHER_ENABLED=true
MAIL_DISPATCH_POLL_INTERVAL_MS=5000
MAIL_DISPATCH_LEASE_MS=90000
# R21 — signed delivery feedback (unset = POST /v1/mail/feedback answers 404)
# MAIL_FEEDBACK_SIGNING_SECRET=
```

## C. `infra/production/STAGING.md` — add to the API file requirements

"For mail: `SMTP_*` for the verified sender (TLS), `MAIL_INTENT_ENCRYPTION_KEY`
from the secret manager, and `MAIL_FEEDBACK_SIGNING_SECRET` only once a
feedback adapter exists. See `infra/production/email/SENDER_DOMAIN.md`."

## D. `docs/local-mail-testing.md` — add a section

- Messages are now bilingual (English then Arabic), text + HTML.
- Every message has an `EmailDelivery` row; `status` shows QUEUED / ACCEPTED /
  FAILED / EXPIRED. Accepted by Mailpit ≠ delivered to a real inbox.
- Mailpit performs a reverse-DNS lookup per SMTP client by default; on Docker
  Desktop for Windows this delayed the greeting ~10 s, close to the 30 s
  `SMTP_GREETING_TIMEOUT_MS`. Run Mailpit with `MP_SMTP_DISABLE_RDNS=true`
  (add to `infra/docker/docker-compose*.yml` mailpit services).

## E. ADR 0004 addendum

Replace "OTP and password-reset mail deliberately stay synchronous" with:
"OTP, verification and reset mail record a sealed `EmailDelivery` intent in
the business transaction and make one synchronous attempt after commit (the
user is waiting); a failed attempt is retried by `MailDispatcher` until the
code expires. Mail uses its own claim loop over `EmailDelivery`, not
`OutboxEvent`, because an external send must stay outside the transaction
and mail has a validity window, provider acceptance vs delivery, and
suppression. Notification email enters through ordinary outbox handlers
(`ProviderStatusEmailHandler`)."

## F. CI — exercise the Mailpit cases of the R21 integration spec

In the `integration-e2e` job add a mailpit service with RDNS disabled and:

```yaml
      mailpit:
        image: axllent/mailpit:latest
        env: { MP_SMTP_DISABLE_RDNS: 'true' }
        ports: ['1025:1025', '8025:8025']
    env:
      R21_MAILPIT_SMTP_PORT: '1025'
      R21_MAILPIT_API_URL: http://127.0.0.1:8025
```

Without F the three Mailpit cases skip in CI (the other ten still run).
