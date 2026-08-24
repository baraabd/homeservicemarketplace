# Sprint 9 — threat model: restricted identity media and work access

Scope: provider identity evidence, the reviewer surface that reads it, the
pre-verification preview, and the capability transition that turns a decision
into work access.

Method: STRIDE per trust boundary, with each threat carrying the control that
addresses it and the test that proves the control. Threats with no test are
listed as residual rather than quietly dropped.

Related: [ADR 0009](../adr/0009-restricted-identity-media.md) ·
[0010](../adr/0010-policy-versioned-verification.md) ·
[0011](../adr/0011-redacted-pre-verification-preview.md) ·
[0012](../adr/0012-evidence-retention-and-deletion.md) ·
[0013](../adr/0013-evidence-to-work-access-capability-transition.md)

## Assets, by what their loss costs

| Asset                                     | Loss means                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Identity document bytes                   | Irreversible PII disclosure. Cannot be reissued cheaply by its owner. **Highest.** |
| Customer home address / exact coordinates | Physical safety of a person who is not party to the verification. **Highest.**     |
| Verification decision record              | The platform cannot answer for who it trusted.                                     |
| Work-access grant                         | Unauthorised strangers admitted to homes.                                          |
| Reviewer credentials                      | All of the above at once.                                                          |

## Trust boundaries

1. Unauthenticated internet → API
2. Authenticated provider (unverified) → API
3. Authenticated provider (verified) → API
4. Reviewer / admin → restricted evidence
5. API → object storage
6. API → scanner adapter

---

## Before this sprint

The state the branch inherits, from `docs/sprint-09/INSPECTION.md`.

| #   | Threat                                           | STRIDE | Status before                                                                                                                                                                                                                    |
| --- | ------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Identity documents readable by anyone with a URL | I      | **Would be open.** `GET /v1/media/files/*` is `@Public()`, no ownership check, `Cache-Control: public, immutable`. Any evidence stored there is world-readable and CDN-retained.                                                 |
| T2  | Malicious file uploaded as evidence              | T/E    | **Open.** No magic-byte check; declared content-type is trusted. No scanner, no quarantine.                                                                                                                                      |
| T3  | Unverified provider reads customer addresses     | I      | **Open by construction.** The only marketplace read is the active feed, which serializes exact `lat`/`lng`, `description`, `media` and a seeker projection. There is no redacted surface, so any preview would be that response. |
| T4  | Provider works without any identity check        | E      | **Open.** Approval sets legacy `status = ACTIVE`, which is the entire marketplace gate. Ranks 6 and 7 inert. Proven by the committed regression test.                                                                            |
| T5  | Reviewer approves their own application          | E      | **Open.** `transition()` never compares `adminUserId` to the target's `userId`.                                                                                                                                                  |
| T6  | Two reviewers produce two decisions              | T      | **Partly closed.** `decideIfInStatus` is already a conditional write scoped to legal source states. No verification case exists to race on yet.                                                                                  |
| T7  | Decision lost on partial failure                 | R      | **Open for the new work.** Audit + notification are in-transaction today, but no outbox event is enqueued — no durable downstream record.                                                                                        |
| T8  | Evidence retained indefinitely                   | I      | **Open.** No retention policy for personal data exists; the only window in the repo is `OUTBOX_RETENTION_HOURS`.                                                                                                                 |
| T9  | PII written to logs                              | I      | **Unproven.** No test asserts logs are free of document content or signed URLs.                                                                                                                                                  |
| T10 | Preview scraped at scale                         | I      | **N/A** — no preview exists. Becomes live the moment one does.                                                                                                                                                                   |

---

## After this sprint (target state)

| #   | Control                                                                                                                                                                                                                               | Where         | Proven by                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Private namespace `verification/{caseId}/{assetId}`, unreachable from the public route; reviewer-permission or owner only; short-lived single-use reads; `Cache-Control: private, no-store`                                           | ADR 0009 §3   | IDOR suite: another provider, an unauthenticated caller, and an admin without reviewer permission each get 404/403; public-route-cannot-resolve-restricted-key test |
| T2  | Magic-byte match against declared type; narrowed allowlist (PDF/JPEG/PNG, no SVG, no video); hard cap on received bytes; double-extension and traversal rejection; scanner port; `PENDING` unreadable; `QUARANTINED` held not deleted | ADR 0009 §4–5 | Malformed/malicious upload suite: MIME mismatch, `MZ`-as-PNG, double extension, oversized, quarantined-file read                                                    |
| T3  | Separate query, separate DTO, separate route. Sensitive columns never `select`ed. `distanceKm` excluded to defeat trilateration                                                                                                       | ADR 0011 §1–2 | Privacy snapshot + recursive forbidden-key scan at any depth                                                                                                        |
| T4  | Ranks 6 and 7 armed behind `WORK_ACCESS_ENFORCED`, after a `LEGACY_BACKFILL` grant for every currently-working provider                                                                                                               | ADR 0013 §4–5 | The committed regression, plus the capability cross-product in both flag positions                                                                                  |
| T5  | Reviewer's `userId` compared to the case subject's; self-review refused                                                                                                                                                               | ADR 0013 §2   | Self-review test                                                                                                                                                    |
| T6  | Case decision is a conditional state write scoped to legal source states                                                                                                                                                              | ADR 0013 §2   | Concurrent-decision test: two reviewers, exactly one wins, one decision row                                                                                         |
| T7  | Case, decision, profile state, grant, audit, notification and outbox commit in one transaction; outbox deduped on decision id                                                                                                         | ADR 0013 §2   | Forced-failure rollback at each step; outbox idempotency test                                                                                                       |
| T8  | Per-outcome retention windows; bytes deleted, decision kept; erasure pseudonymises and preserves the finding                                                                                                                          | ADR 0012 §1–4 | Retention sweep test; erasure test asserting decision survives and PII does not                                                                                     |
| T9  | Logs carry ids and outcomes only — never content, identity numbers, filenames, signed URLs, tokens or storage credentials                                                                                                             | ADR 0009 §7   | Log-scanning test over emitted lines for fixture secret material                                                                                                    |
| T10 | Dedicated tighter throttle; page-depth cap; non-correlatable ordering; event-count-only telemetry                                                                                                                                     | ADR 0011 §5   | Preview rate-limit test                                                                                                                                             |

---

## Attacker scenarios walked end to end

**A rented unverified provider account.** Signs up, submits plausible evidence,
gains `SUBMITTED`. Reaches the preview only — coarse area, category, bands. No
coordinates, no descriptions, no photos, no seeker identity, no `distanceKm` to
trilaterate with. Cannot bid, message, accept, or read a wallet: each is denied
server-side, not hidden. Deep pagination is capped. **Residual:** many coarse
observations over time still carry aggregate signal.

**A malicious upload.** A polyglot PDF/JS is declared `application/pdf`. Magic
bytes match, so signature checking alone does not stop it — the scanner gate does,
and until it reports the asset is `PENDING` and unreadable. If flagged it is
`QUARANTINED`: held, unreadable, reported. **Residual:** the production scanner
is not yet chosen; the no-op adapter reports `PENDING`, so the failure is closed.

**A curious reviewer.** Holds the reviewer permission, opens a case they are not
assigned, and reads a document. Permitted by design — assignment is workflow, not
authorization — but every read writes an access-audit row naming reviewer, asset,
case and time. Detection, not prevention. **Residual:** a reviewer can still
photograph their own screen. Out of scope for software.

**An insider approving their own application.** Blocked by the self-review check
and, independently, by the conditional write plus audit trail.

**A stolen grant.** An attacker with a hijacked verified session works until the
session dies. Rank 0 (account eligibility) is evaluated before the provider row
is loaded on every request, so suspending the account removes capabilities at the
next request rather than at token expiry.

---

## Residual risks accepted

| Risk                                                     | Why accepted                                    | Mitigation                                                 |
| -------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Aggregate correlation from repeated coarse preview reads | Eliminating it means no preview                 | Rate limit, page-depth cap, coarse bands                   |
| Reviewer exfiltration by screen capture                  | Not solvable in software                        | Access audit; least-privilege reviewer permission          |
| Object-store backups outliving the retention window      | Depends on infrastructure config, not code      | Named as an infrastructure action item in ADR 0012         |
| Production malware scanner not selected                  | Fails closed — unscanned evidence is unreadable | Port shaped for async; recorded as an outstanding decision |
| Legacy-backfilled providers work while `UNVERIFIED`      | Deliberate and truthful                         | Findable by that exact query for a later campaign          |

## Decisions this model does not make

Country-specific document requirements, retention windows as a matter of law, and
the resolution of `approximateArea` are **product and legal decisions**. The code
reads them from published policy rows and configuration. Engineering defaults are
chosen to be conservative, and are listed as outstanding in the sprint report.
