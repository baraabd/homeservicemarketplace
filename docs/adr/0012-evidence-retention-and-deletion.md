# ADR 0012 — Evidence is deleted; the decision it supported is kept

- **Status:** Accepted
- **Date:** 2026-08-24
- **Sprint:** 09
- **Related:** [0009](0009-restricted-identity-media.md) (what is stored), [0010](0010-policy-versioned-verification.md) (what was required), [0013](0013-evidence-to-work-access-capability-transition.md) (what it unlocked)

## Context

Identity evidence is the most sensitive data the platform holds. A scan of a
passport is not like a photo of a leaking tap: its value to an attacker does not
decay, it cannot be reissued cheaply by its owner, and holding it after it has
served its purpose is pure liability.

Two obligations pull in opposite directions:

- **Delete it.** A document that has done its job is a breach waiting to have a
  larger blast radius. Data-protection regimes generally require that personal
  data not be kept longer than necessary for the purpose it was collected for.
- **Keep the decision.** "This provider was verified on this date, under this
  policy version, by this reviewer, on the strength of these document kinds" is
  an audit record. If a verified provider is later accused of fraud, deleting the
  record of _why_ they were trusted destroys the platform's ability to answer for
  it — and the provider's ability to prove they complied.

The repository has exactly one retention decision today (`OUTBOX_RETENTION_HOURS`,
72h for processed events). There is no precedent for personal data.

## Decision

**Separate the evidence from the finding.** They have different lifetimes because
they answer different questions, and the schema models them as different rows so
one can be destroyed while the other survives.

| Row                    | Holds                                                          | Lifetime                                |
| ---------------------- | -------------------------------------------------------------- | --------------------------------------- |
| `MediaAsset` (bytes)   | The actual document in object storage                          | **Shortest.** Deleted on schedule.      |
| `VerificationDocument` | Kind, `sha256`, size, detected MIME, scan state, timestamps    | Outlives the bytes. Carries no content. |
| `VerificationDecision` | Outcome, reason code, reviewer, policy version, decided-at     | **Permanent.** Never deleted.           |
| `VerificationCase`     | Which policy version, which kinds were required, current state | Permanent.                              |

### 1. Deletion targets bytes, not history

`deleteEvidence(caseId)` deletes the object from storage and nulls the asset's
storage key, then stamps `deletedAt` and `deletionReason`. The
`VerificationDocument` row **remains**, now describing a document that no longer
exists: kind, hash, size, when it was seen, that it was `CLEAN`, and when it was
destroyed.

The hash is the load-bearing survivor. It lets the platform answer "was the
document you are showing me now the one we verified?" without keeping the
document — and it preserves the fraud signal of the same file appearing under two
identities.

### 2. Retention windows, configured not hardcoded

| Trigger                   | Window                                          | Why                                                                                                           |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Case reaches `VERIFIED`   | `EVIDENCE_RETAIN_VERIFIED_DAYS` (default 90)    | The decision is made. The bytes have no further purpose; the appeal window is the only reason to wait at all. |
| Case reaches `REJECTED`   | `EVIDENCE_RETAIN_REJECTED_DAYS` (default 30)    | Shorter. A rejected applicant has the strongest claim to erasure and we have the least reason to hold it.     |
| Case abandoned in `DRAFT` | `EVIDENCE_RETAIN_ABANDONED_DAYS` (default 30)   | Never submitted, never reviewed, no legitimate basis to keep.                                                 |
| Asset `QUARANTINED`       | `EVIDENCE_RETAIN_QUARANTINE_DAYS` (default 180) | **Longer, deliberately.** Malware is evidence of an attack; destroying it destroys the incident record.       |
| Provider account deleted  | Immediate, on erasure request                   | Erasure outranks the schedule. The decision record survives, pseudonymised.                                   |

Defaults, not law. Every window is an env var with a documented default so legal
can change it without a code change, and the defaults are conservative-short
rather than convenient-long.

### 3. Deletion is a swept job, and it is idempotent

A scheduled sweep selects assets past `retainUntil` and deletes them in bounded
batches. It is idempotent (already-deleted rows are skipped), it logs counts and
ids but never content, and a storage failure leaves `deletedAt` unset so the next
run retries. A row is only marked deleted after the object is gone — the opposite
order produces records claiming a deletion that did not happen.

### 4. Erasure requests outrank everything except the decision

An account erasure destroys bytes immediately and pseudonymises the personal
fields on the surviving rows. `VerificationDecision` keeps: the outcome, the
reason code, the policy version, the reviewer, the timestamp, and a
pseudonymous subject reference. It loses: names, document numbers, and any free
text a reviewer typed that could carry personal data.

This is the line: **we keep that a decision was made and on what basis; we do not
keep who they are.**

### 5. Reviewer notes are treated as personal data

Free text written by a reviewer while looking at a passport will contain personal
data, however much a policy says it should not. Notes are therefore stored on the
case (deleted with the evidence), while the **reason code** — a stable enum — is
stored on the decision and survives. Structured codes are what the permanent
record is built from; prose is not.

## Alternatives rejected

**Keep everything forever.** Simplest, maximal liability, and indefensible under
any data-protection review.

**Delete everything including the decision.** Clean erasure, and it destroys the
audit trail. A platform that cannot say why it trusted someone cannot be trusted
to have made the judgement.

**Encrypt and keep, deleting only the key (crypto-shredding).** Defensible, and it
depends on key management the platform does not have yet, plus a claim that a
copy of the ciphertext is harmless forever. Revisit when a KMS exists.

**Retain on a single global window.** Ignores that a rejected applicant and a
quarantined malware sample warrant opposite treatment.

## Consequences

**Good** — the highest-risk data has the shortest life; the audit trail is
permanent and content-free; erasure is implementable without destroying history;
windows move without a deploy.

**Costs / risks**

- **Deleted evidence cannot be re-reviewed.** A dispute after the window closes
  is decided on the record, not the document. Accepted: that is what the record
  is for, and re-verification asks for fresh evidence anyway.
- **Object-store deletion is not always immediate** (versioning, replicas,
  backups). Storage must be configured without object versioning for the
  restricted namespace, and backup expiry must be shorter than the longest
  window or the guarantee is fiction. Recorded as an infrastructure action item.
- **`no-store` on reads does not bind an already-issued CDN copy** — which is
  exactly why [0009](0009-restricted-identity-media.md) keeps restricted objects
  off any cacheable path in the first place.
- **The sweep is a scheduled job that can silently stop.** It emits a metric and
  a last-run timestamp; a sweep that has not run is an alert, because a failed
  deletion job is indistinguishable from a deletion policy nobody implemented.

## Revisit

- Crypto-shredding, once a KMS exists.
- Legal review of every default in the table above. These are engineering
  defaults chosen to be safe, not legal advice, and the sprint report records
  them as an outstanding legal decision.
