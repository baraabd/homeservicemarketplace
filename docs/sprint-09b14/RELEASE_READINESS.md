# Sprint 9B — release readiness

The operational record for the provider verification programme (9B.1 – 9B.14):
what shipped, how to turn it on, how to turn it off again, and what is still
deliberately unfinished.

---

## 1. What 9B.14 changed

Nothing new was built. This phase looked for ways a **development convenience
could reach production**, and found four. All four are now refused at the
boundary rather than documented as "don't do that".

| #   | Could activate in production                                                                                                                                                                                                                                                                                                                                                                | Now                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Dev users** — four accounts whose passwords are printed in this repository, two of them `admin`, created `ACTIVE` and email-verified. Reachable through `ALLOW_PROD_SEED=true`, which an operator legitimately sets to get roles and permissions in. Worse, re-running the seed **rotates the password back**, so an operator who noticed and changed it would have it silently restored. | `upsertDevUsers` refuses on `NODE_ENV=production` **regardless of the flag**, and says so loudly. Reference data still seeds. |
| 2   | **The development verification policy** — a global default whose own comment says it is _NOT LEGAL ADVICE AND NOT A COUNTRY REQUIREMENT_. Real providers would have been judged against a placeholder.                                                                                                                                                                                      | Same second gate. Publish a real policy through the admin API.                                                                |
| 3   | **The in-memory mail adapter** — bound whenever `SMTP_HOST` is unset, in any environment. In production every signup, verification and password reset answers `202` and logs `mail.sent` while **nothing is delivered**, behind a green health check.                                                                                                                                       | The process **refuses to boot** and names the consequence.                                                                    |
| 4   | **`AUTH_REQUIRE_EMAIL_VERIFICATION=false`** — registration sets `emailVerifiedAt` and `status: ACTIVE` itself and returns a challenge that never verifies. Any address becomes a usable account without proving mailbox control.                                                                                                                                                            | Production **refuses to boot** with it off, the same treatment the registration throttle already had.                         |

Two were named in the sprint brief (test policy, mock notification); two were
found alongside them. The scanner and the media routes were audited and were
**already** guarded — `resolveScannerSelection` throws at boot if a
production-tagged process asks for the deterministic test scanner, and the
public media route refuses restricted keys with its own e2e suite.

**A fifth fix, in CI itself.** `scripts/ci/compose-smoke.sh` reported
`outbox worker did not start` on cold stacks while printing, as evidence, the
very line it claimed was missing. The cause was
`printf '%s' "$LOG" | grep -q ...` under `set -o pipefail`: `grep -q` exits on
first match, `printf` dies of **SIGPIPE (141)**, and pipefail hands the
_pipeline_ that 141 — so a match found **early in a large log** reports as not
found. Bigger log, earlier match, more reliable lie; hence cold stacks failed and
warm re-runs passed. One of the three sites was inverted (`outbox.dead_letter`),
where the same trap produced a false **PASS**. All three now use herestrings.
Reproducible in four lines:

```bash
set -euo pipefail
BIG="MATCH$(head -c 400000 /dev/urandom | base64)"
if ! printf '%s' "$BIG" | grep -q "MATCH"; then echo "reported missing"; fi
```

---

## 2. Endpoints introduced by Sprint 9B

| Family                                                                          | Purpose                                                                           |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST/GET /v1/me/provider/verification/case*`                                   | open, resume, read and submit the provider's own case                             |
| `POST /v1/me/provider/verification/evidence/{prepare,:id/content,:id/finalize}` | the three-step restricted upload                                                  |
| `GET /v1/verification/documents/:id/content`                                    | **the only** route that serves restricted evidence: audited, streamed, `no-store` |
| `GET /v1/me/provider/marketplace-preview`                                       | policy-gated redacted preview                                                     |
| `GET/POST /v1/me/provider/portfolio*`                                           | public portfolio media, strictly separate from evidence                           |
| `GET /v1/me/provider/capabilities`                                              | the server's own answer to "what may I do"                                        |
| `GET/POST /v1/admin/verification/cases*`                                        | reviewer queue, case detail, audit, six commands                                  |
| `GET/POST /v1/admin/verification/policies*`                                     | append-only policy versions                                                       |
| `POST /v1/admin/providers/:id/{approve,reject,suspend,reactivate}`              | the **account** axis                                                              |

**Contract change worth calling out (9B.13):** `ProviderVerificationCase` now
really is what the API sends. `requirements` is an array and
`verificationRequired` a top-level boolean; `ProviderCaseView` is a type alias of
the published contract, so drift is a build failure rather than a crash in a
browser.

---

## 3. Migrations

Eleven, all forward-only and additive:

```
20260825060000_sprint09b2_verification_policy_and_case_constraints
20260825120000_sprint09b3_prepared_evidence_case_link
20260825123000_sprint09b3_evidence_preparation_slot
20260825130000_sprint09b3_evidence_audit_events
20260825140000_sprint09b4_evidence_rejected_scan_state
20260825150000_sprint09b4_evidence_scan_audit_events
20260826090000_sprint09b5_verification_notifications
20260826093000_sprint09b5_case_workflow_audit_events
20260826120000_sprint09b6_verification_rejected_notification
20260826120000_verification_expiry_enums
20260826123000_sprint09b6_case_rejected_audit_event
20260826153000_sprint09b7_decision_audit_and_notification
```

**Forward:** `prisma migrate deploy` (the Compose `api-migrate` job runs it
before the API starts, and is idempotent on a second run — the smoke test
asserts both).

**Rollback:** these add tables, columns, enum values and partial indexes. Several
add enum values with `ALTER TYPE ... ADD VALUE`, which **PostgreSQL cannot
reverse**. Therefore:

- **Do not roll the schema back.** Roll the _application_ back instead — the
  previous release ignores every column and enum value added here.
- The flags below are the real rollback lever, and they are instant.
- If a table genuinely must go, drop it in a new forward migration after the
  application no longer reads it, never by reverting.

---

## 4. Feature-flag rollout

All four ship **off**, which is why 9B could merge continuously without changing
behaviour for anyone.

| Flag                                 | Default | Turning it on means                           |
| ------------------------------------ | ------- | --------------------------------------------- |
| `VERIFICATION_ENFORCED`              | `false` | the verification axis can deny                |
| `WORK_ACCESS_ENFORCED`               | `false` | only a **live grant** opens the marketplace   |
| `VERIFICATION_EXPIRY_WORKER_ENABLED` | `false` | the sweep marks lapsed grants EXPIRED         |
| `EVIDENCE_SCANNER_DRIVER`            | `none`  | `clamav` lets evidence become readable at all |

**Order matters.** Suggested sequence:

1. `EVIDENCE_SCANNER_DRIVER=clamav` — with `none`, evidence never clears and no
   reviewer can open anything. Nothing else works until this does.
2. Publish a **real policy** per country through the admin API, and confirm
   `GET /v1/me/provider/verification/case` resolves to it rather than to a
   fallback.
3. `VERIFICATION_ENFORCED=true` — providers can be verified; nothing is blocked
   yet.
4. Work the backlog until the queue is short. **This is the window that matters**
   (§6).
5. `WORK_ACCESS_ENFORCED=true` — the marketplace closes to anyone without a
   grant.
6. `VERIFICATION_EXPIRY_WORKER_ENABLED=true` — lapsed grants get tidied. Access
   is a **read-time predicate**, so it is already denied at the expiry instant
   with the worker off; the worker only writes the state down.

**Incident rollback:** set `WORK_ACCESS_ENFORCED=false` and restart. Every
provider can work again immediately; no data is touched, no migration is
reversed, and the grants that exist stay valid for when it is turned back on.

---

## 5. Scanner and retention configuration

| Setting                                    | Meaning                                                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EVIDENCE_SCANNER_DRIVER=none`             | default. Evidence stays PENDING and **unreadable**. Degraded, never unsafe — the process boots and says so loudly.                                                                                                             |
| `EVIDENCE_SCANNER_DRIVER=clamav`           | the real scanner; requires the clamd connection settings.                                                                                                                                                                      |
| `EVIDENCE_SCANNER_DRIVER=test`             | **refuses to boot in production.** It is the one adapter that can write `CLEAN` without scanning.                                                                                                                              |
| `verification_evidence_max_bytes`          | per-document ceiling, enforced against bytes **received**, not declared (64 KiB – 25 MiB, default 10 MiB).                                                                                                                     |
| `verification_evidence_upload_ttl_seconds` | how long a prepared upload stays open before the cleanup sweep deletes the object.                                                                                                                                             |
| Retention                                  | deletion removes the **bytes** and stamps the row. Metadata survives so the audit trail still shows a document existed; reads afterwards are refused **identically to an unknown document**, and the refusal is still audited. |

---

## 6. The work-access blocking window

Turning on `WORK_ACCESS_ENFORCED` denies the marketplace to every provider
without a live grant — including providers who have worked for months.

- **Before:** run the queue down. `GET /v1/admin/verification/cases` with no
  state filter shows everything live.
- **Measure it:** count providers with `standingState = ACTIVE` and no live
  grant. That is exactly the population that stops working the moment the flag
  flips.
- **Soften it:** `MANUAL_OVERRIDE` grants exist for this — an operator can open
  access for a known-good provider while their documents are reviewed.
- **What they see meanwhile:** the redacted preview, off by default, and copy
  that says the locations are approximate _on purpose_ and does not blame them.

---

## 7. State and action matrix

Two axes. They are not the same lifecycle and never collapse into one list.

**Verification case** — `DRAFT → SUBMITTED → IN_REVIEW → {VERIFIED, REJECTED, ACTION_REQUIRED} → EXPIRED`

| From               | Legal actions                            |
| ------------------ | ---------------------------------------- |
| DRAFT              | submit                                   |
| SUBMITTED          | assign, approve, reject, request changes |
| IN_REVIEW          | approve, reject, request changes         |
| ACTION_REQUIRED    | resubmit (provider), reject              |
| VERIFIED           | revoke, reverify                         |
| REJECTED / EXPIRED | nothing                                  |

`approve` on a VERIFIED case **replays** (idempotent — a dropped response must be
retryable). `revoke` on a case that was never approved is `ILLEGAL_TRANSITION`.

**Provider account** — `DRAFT → PENDING_REVIEW → ACTIVE ⇄ SUSPENDED`, plus
`REJECTED`. `suspend` is legal only from ACTIVE.

A provider can be **VERIFIED and SUSPENDED at once**: the documents are good and
the account is not. Rank 3 of the capability resolver puts SUSPENDED above
verification, so suspension wins — a defect fixed in 9B.7 and pinned since.

---

## 8. Write sites, before and after

| Fact                        | Before 9B                                                | After                                                                                           |
| --------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| "is this provider verified" | `ProviderProfile.verified`, writable from several places | `verificationState` + a decision row, written **only** inside the case workflow transaction     |
| "may they work"             | inferred from `status = ACTIVE`                          | a `ProviderWorkAccessGrant` with an expiry, evaluated as a **read-time predicate**              |
| "what must they prove"      | nothing                                                  | `requirementsSnapshot`, stamped once at case creation                                           |
| identity documents          | none                                                     | `MediaAsset(visibility: RESTRICTED)` under a separate root, reachable through one audited route |
| "who looked at a passport"  | unanswerable                                             | `VerificationAccessLog`, written for allowed **and denied** reads                               |

Approval writes case, decision, grant, audit, notification and outbox in **one
transaction**, and the rollback path is tested by inducing a failure at the last
write.

---

## 9. Threat model, before and after

| Threat                             | Before                                    | After                                                                                 |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Any admin opens any passport       | possible; audit says "anyone on the team" | `verification:evidence:view`, separate from `verification:decide`                     |
| Evidence served from a CDN         | plausible under a shared root             | separate root/bucket, `isRestrictedKey` on the public route, `no-store`, e2e-asserted |
| Malware in evidence                | unscanned                                 | scanned; `CLEAN` is the only readable state; quarantine is never released             |
| MIME spoofing                      | declared type trusted                     | type **detected** from content; PDF/JPEG/PNG allowlist; SVG refused outright          |
| Oversized upload                   | declared size trusted                     | counted **mid-stream**; no object left behind                                         |
| IDOR on evidence                   | —                                         | services take a **user id**; unknown and forbidden answer identically                 |
| Enumerating providers via preview  | —                                         | coarse cells, HMAC per-viewer refs, bounded reach, no mutation verb                   |
| Buying access with a paid tier     | —                                         | axis 5 grants nothing; asserted at the HTTP boundary with flags armed                 |
| Signup without mailbox control     | possible via a flag                       | **refuses to boot** in production                                                     |
| Known-password admin in production | possible via `ALLOW_PROD_SEED`            | **refused** on NODE_ENV alone                                                         |
| Mail silently dropped              | possible whenever SMTP was unset          | **refuses to boot** in production                                                     |

---

## 10. UI: reused versus new

Sprint 9B added no UI framework and no second design system. Reused throughout:
the admin shell, sidebar, table, drawer, dialogs, badges and tokens; the
provider app shell and its `Button`/`IconButton`; `LanguageContext` for direction;
TanStack Query; the shared `api` client with its CSRF echo.

New only where nothing equivalent existed: the verification queue, case-action,
work-access and policy panels (9B.12); the provider verification screen and axis
badges (9B.11); the portfolio section (9B.10); the evidence panel (9B.7).

**EN/AR/RTL evidence.** Every string lives in a copy module with a key-parity
test, so a missing translation fails CI rather than reaching a reader. Direction
is asserted in a real browser, not a DOM shim: `dir="rtl"` on the document _and_
the panel, no horizontal overflow at 360 px, Arabic text legible rather than
clipped, and the admin console asserted in both directions. Keyboard paths carry
visible focus rings; dialogs are `aria-modal`, take focus, return it to the
opener, and close on Escape; a file input that cannot do anything is **absent**
from the tab order rather than disabled.

---

## 11. Manual verification checklist

Before enabling the flags in an environment:

1. `GET /health/ready` reports postgres and redis up.
2. Boot log names **`NodemailerMailAdapter`**, not the in-memory one.
3. Boot log names a real scanner driver.
4. `SELECT count(*) FROM "User" WHERE email LIKE '%@admin.com'` → **0**.
5. `SELECT count(*) FROM "VerificationRequirementPolicy" WHERE version LIKE '%dev-default%'` → **0**.
6. A real policy is live for each country you serve.
7. Register a throwaway account: an OTP actually arrives.
8. Upload a document; confirm it is unreadable until scanned.
9. Open it as a reviewer; confirm a row appears in `VerificationAccessLog`.
10. Approve; confirm case, decision, grant, notification and outbox row all exist.
11. Confirm the provider can reach the feed, and that the preview capability is gone.
12. Revoke; confirm the feed is denied on the **next** request.
13. Count providers who would lose access before flipping `WORK_ACCESS_ENFORCED` (§6).

---

## 12. Residual risks and deliberate deferrals

- **Phone verification does not exist.** The policy rule is parked as "not
  asked" with its reactivation condition recorded (9B.13 §2). Providers onboard
  with an unverified number.
- **VIP / Featured have no schema.** Deliberate, by instruction. The flags that
  do exist (`verified`, `topPro`) are asserted to grant nothing.
- **`verification:evidence:view` and `verification:decide` are both seeded onto
  `admin`** because there is one admin role. Splitting them onto a dedicated
  reviewer role is a Product/Security decision, recorded rather than guessed.
- **The admin console is desktop-only** by declaration; it scrolls sideways below
  1440 px. Making it responsive is a redesign this programme was told not to do.
- **The development database has no `_prisma_migrations` ledger** (created with
  `db push`). The schema matches; only the bookkeeping is absent. Not repaired,
  because repairing it rewrites the developer's database. Migration correctness
  is verified against a clean database in CI.
- **Six pre-existing CodeQL alerts on `develop`**, none in files this programme
  touched, none introduced by it.
