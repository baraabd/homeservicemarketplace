# R21 — Production email delivery and durable feedback: implementation

Sprint R21 (legacy P46) · wave 1, lane 3 · branch `feat/r21-email-production`
Base `059c018576a75837d4dfb262ee49168d9217d881` (see `OWNERSHIP.md` for the
base approval and leases). Delivery mode: **A (integration)**: backend only,
no UI surface changed.

Source commit `9dba54f539c558c18ea8fa418a2e891504576021` (tree
`231ca790f73fe2363f05dc2f367ed9819f90723c`); the evidence is committed on top
of it.

Status vocabulary used in this directory: IMPLEMENTED, SOURCE_VERIFIED,
INTEGRATION_PENDING, POLICY_BLOCKED, EXTERNAL_BLOCKED / HOSTED_ENVIRONMENT_BLOCKED.
Nothing here is HOSTED_ACCEPTED or RELEASE_ACCEPTED.

## 1. Inventory (before)

| Item                   | Found at base                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Transport              | `MailPort.send()`; Nodemailer when `SMTP_HOST` set, in-memory otherwise; production refuses to boot without `SMTP_HOST` (9B.14)         |
| TLS                    | production: `requireTLS` unless implicit TLS, `rejectUnauthorized: true`                                                                |
| Timeouts               | none configured (Nodemailer defaults: 2 min connect, 30 s greeting, 10 min socket)                                                      |
| Mounted mail flows     | `AuthenticationService`: register (REGISTRATION_OTP), login (LOGIN_OTP), resend-otp, resend-verification (link), forgot-password (link) |
| Delivery semantics     | post-commit, synchronous, best effort: a failed send was logged and **lost**; no retry, no record                                       |
| Templates              | English plain text built inline in the auth service; no HTML; no Arabic                                                                 |
| Anti-enumeration       | neutral responses + `padAntiEnum` timing floor on register / resend-verification / forgot-password; preserved unchanged                 |
| Throttling             | route-level per-client `@Throttle` (5/h on resend-verification, resend-otp, forgot-password); OTP resends capped per challenge          |
| Notifications          | in-app rows + realtime push only; no email channel. Verification outcomes emit `verification.case.*` outbox events in the transition tx |
| Payment-status notices | **no producer exists** at base (no NotificationType, no event)                                                                          |
| Bounce/complaint input | none                                                                                                                                    |
| Metrics                | none for mail (MetricsService registry exists)                                                                                          |

## 2. Design

```
business tx ──► MailPort.enqueue(intent, tx)   validate vars (strict zod), throttle, seal envelope, INSERT EmailDelivery (ON CONFLICT DO NOTHING on messageKey)
commit
request    ──► MailPort.dispatch(ticket)        claim row (lease) → render → SMTP → ACCEPTED | QUEUED(retry) | FAILED | EXPIRED
MailDispatcher (every replica, 5 s)           claims due QUEUED rows and expired leases (FOR UPDATE SKIP LOCKED) → same process()
provider ──► POST /v1/mail/feedback (HMAC)     DELIVERED | BOUNCED | COMPLAINED (+ EmailSuppression)
```

- **Durable intent.** `EmailDelivery` is written in the producer's own
  transaction, so a rollback leaves no row and no message. The stable
  `messageKey` (producer idempotency) and the Message-ID
  `<EmailDelivery.id@sender-domain>` are identical for every retry.
- **First attempt stays synchronous** (ADR 0004: the user is waiting); a
  failure no longer loses the message, it stays `QUEUED`.
- **Retry.** `nextAttemptAt` from the existing pure `outbox.retry` policy
  (5 s base, ×2, 5 min cap, ±20 % jitter), 6 attempts for AUTH and 8 for
  NOTIFICATION, never past the message's `expiresAt` (the OTP/link lifetime).
  Classification: 4xx / network / TLS → transient; 5xx / bad envelope →
  permanent (no retry); 530/535/EAUTH → config (retried, logged at error).
- **Crash safety.** Claims set a lease (`MAIL_DISPATCH_LEASE_MS`, 90 s,
  greater than the SMTP timeout sum). All outcome writes are fenced on
  `(id, leasedBy, status=SENDING)`, so a late write from a worker whose lease
  lapsed cannot overwrite its successor. A crash after the relay accepted
  but before ACCEPTED was recorded re-sends with the same Message-ID:
  at-least-once, never silently lost.
- **Why not `OutboxEvent`.** The outbox contract keeps external effects in
  `afterCommit`, which is explicitly lossy on crash; mail also needs a
  validity window, acceptance vs. delivery and suppression. Mail therefore
  has its own claim loop over its own table, reusing the outbox's retry
  policy and claim pattern; the outbox worker is unchanged (no R22 code is
  imported). Notification email _enters_ through an ordinary outbox handler.
- **Secrets at rest.** The envelope (`{to, vars}`) is AES-256-GCM sealed with
  the row's `messageKey` as AAD and cleared on every terminal transition and
  by retention. Key: `MAIL_INTENT_ENCRYPTION_KEY` (32 bytes, base64); in
  production without it, an HKDF-SHA256 subkey of `JWT_ACCESS_SECRET` (label
  `hsm.mail-envelope`), so restarts keep queued mail; elsewhere a
  process-local key. Rows carry only a SHA-256 recipient hash.
- **Acceptance ≠ delivery.** `ACCEPTED` means the SMTP relay returned 2xx.
  `DELIVERED`, `BOUNCED`, `COMPLAINED` come only from verified feedback.
- **Feedback.** `POST /v1/mail/feedback`, provider-neutral `generic-hmac-v1`
  (HMAC-SHA256 over `"<ts>.<raw body>"`, 300 s window, constant-time,
  rotation-friendly). Strict body schema (≤ 100 events). Applies only to a
  Message-ID we minted for a message the relay accepted; the suppressed
  address comes from our row, never the payload; replays dedupe on
  `(source, externalId)`; transitions are forward-only under a row lock.
  Disabled (404) without `MAIL_FEEDBACK_SIGNING_SECRET`.
- **Suppression policy (proposed, P-2).** Hard bounce and complaint
  suppress **NOTIFICATION** mail to that address. AUTH mail is never
  suppressed: it is requested by the recipient and is their recovery path.
  Suppression never touches `User`, sessions, roles or standing.
- **Throttle.** ≤ 6 per address per 15 min for the two templates an
  anonymous caller can trigger for someone else (`auth.password_reset`,
  `auth.email_verification`). Over the limit nothing is recorded or sent
  and the public response is unchanged. OTP mail is not throttled here.
- **Templates.** 7 templates, English then Arabic (`lang`/`dir` per block),
  text + HTML, strict per-template variable schemas, HTML escaping, URLs
  built only from `FRONTEND_URL` + fixed path. Subjects never contain codes.
  No document, image, reviewer note, document number or amount in any
  template. Notification mail links to `/provider/verification` or
  `/provider`, which are authenticated and owner-checked server-side.
- **Metrics** (existing registry, `/metrics`): `mail_delivery_attempts_total{category,outcome}`,
  `mail_feedback_events_total{kind,result}`, `mail_feedback_rejected_total{reason}`,
  `mail_delivery_queue_depth{status}`. Labels are fixed vocabularies.
- **Retention.** Hourly: expire overdue QUEUED rows, clear any terminal
  envelope, delete feedback after 30 days and closed deliveries after 90.

## 3. Changed paths

Sprint-owned (`apps/api/src/infrastructure/mail/`):

| File                                | Change                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mail.port.ts`                      | intent API (`enqueue`/`dispatch`), `html`, `messageId`, `MAIL_TRANSPORT` token                                                                            |
| `mail.module.ts`                    | `MAIL_PORT` → `DurableMailService`; transport behind `MAIL_TRANSPORT`; envelope key factory; dispatcher, feedback, handler providers; feedback controller |
| `nodemailer-mail.adapter.ts`        | bounded timeouts, HTML, Message-ID, SMTP reply code                                                                                                       |
| `durable-mail.service.ts`           | new: enqueue / dispatch / process state machine                                                                                                           |
| `email-delivery.repository.ts`      | new: claim, fenced transitions, retention                                                                                                                 |
| `mail.dispatcher.ts`                | new: retry loop, retention, gauges                                                                                                                        |
| `mail-envelope.cipher.ts`           | new: AES-256-GCM envelope sealing, recipient hash                                                                                                         |
| `mail-errors.ts`                    | new: failure classification                                                                                                                               |
| `mail.metrics.ts`, `mail.tokens.ts` | new                                                                                                                                                       |
| `templates/*`                       | new: bilingual templates, escaping, URL builder                                                                                                           |
| `feedback/*`                        | new: signature, controller, service                                                                                                                       |
| `provider-status-email.handler.ts`  | new: outbox handler (registration = CR-R21-02)                                                                                                            |
| `*.spec.ts` (7 files)               | new/updated unit specs                                                                                                                                    |

Leased (see `OWNERSHIP.md`):

| File                                                                                  | Change                                                                                               |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`                                              | +4 enums, +3 models (additive, appended)                                                             |
| `packages/database/prisma/migrations/20261013120000_r21_email_delivery/migration.sql` | new forward migration (generated by `prisma migrate diff`)                                           |
| `apps/api/src/config/env.schema.ts`                                                   | +8 mail keys                                                                                         |
| `apps/api/src/modules/iam/authentication/services/authentication.service.ts`          | 5 flows: `enqueue` inside the tx, `dispatch` after commit; inline templates removed                  |
| `apps/api/src/modules/iam/authentication/services/authentication.service.spec.ts`     | harness: transport-only `MailPort` subclass; realistic token length. All 48 original assertions kept |

The two leased IAM files were not prettier-clean at the base; the
repository's pre-commit hook (`lint-staged` → `prettier --write`) formats a
staged file in full, so their diffs include whitespace-only reformatting.

Other new paths: `apps/api/test/integration/r21-durable-mail.integration.spec.ts`,
`apps/api/test/integration/r21-mail-feedback.integration.spec.ts`,
`infra/production/email/SENDER_DOMAIN.md`,
`scripts/production/email/{check-sender-dns,send-acceptance-probe}.cjs` + test,
this directory.

## 4. Contracts and schema

- Schema: additive only. `EmailDeliveryStatus`, `EmailCategory`,
  `EmailSuppressionReason`, `EmailFeedbackKind`; `EmailDelivery`,
  `EmailSuppression`, `EmailFeedbackEvent` (FK → EmailDelivery, cascade).
  No change to any existing table, enum or contract package.
- HTTP: one new route `POST /v1/mail/feedback` (public, signature-authenticated).
  No change to any existing route or response; auth responses and
  anti-enumeration timing are unchanged.
- Shared contracts barrel: untouched.

## 5. Coordinator integration requests

| CR        | Path                                                                     | Needed for                                                      |
| --------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| CR-R21-01 | `apps/api/src/main.ts`                                                   | raw body on `/v1/mail/feedback` (route fails closed until then) |
| CR-R21-02 | `apps/api/src/app.module.ts`                                             | register `ProviderStatusEmailHandler`                           |
| CR-R21-03 | runtime policy, `.env.example`, STAGING.md, local-mail doc, ADR 0004, CI | dedicated key policy, docs, Mailpit cases in CI                 |
| CR-R21-04 | `schema.prisma`, `migrations/`                                           | G1 merge of the R19/R21 schema leases and migration order       |
