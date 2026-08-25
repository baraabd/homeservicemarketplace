# Sprint 9B.4 — Evidence validation, scanning and quarantine

How a stored identity document gets judged, what happens when the judgement is
"no", and why nothing in this design can accidentally decide "yes".

Sprint 9B.3 built the upload lifecycle and left every asset `PENDING` on
purpose. This is the half that moves it off `PENDING` — and the half that makes
sure only a real scan can.

Related: `docs/sprint-09b3/RESTRICTED_EVIDENCE_UPLOAD.md`,
`docs/adr/0009-restricted-identity-media.md` §5, `docs/adr/0012` (retention).

---

## 1. The one rule

> **An asset is never marked `CLEAN` unless a real, configured scan said so.**

Everything below is machinery for keeping that true when things go wrong: when
the scanner times out, when it is not configured, when an event is replayed,
when two workers race, when someone points a production process at the test
adapter.

Three independent things must all hold before `CLEAN` is written:

1. the file passed **validation** (allowed format, intact, honestly named);
2. a scanner returned a **CLEAN verdict**;
3. that scanner **claims to be real** (`isRealScanner`).

Two of those are about the file. The third is about the adapter, and it exists
because the interesting failure is not a scanner that breaks — it is an adapter
that returns `CLEAN` without scanning anything.

---

## 2. Validation, before any scanner

`evidence-validation.ts`. Pure, and run **before** the scanner is asked
anything.

A malware scanner answers exactly one question. It will happily clear a
truncated PDF, and it has no opinion about a genuine PDF called `passport.png`.
Neither is malware; both are problems.

| Check                                              | Refusal                  |
| -------------------------------------------------- | ------------------------ |
| zero bytes                                         | `EMPTY`                  |
| over the configured ceiling                        | `TOO_LARGE`              |
| type outside the evidence allowlist (PDF/PNG/JPEG) | `DISALLOWED_FORMAT`      |
| leading bytes match nothing known                  | `UNRECOGNISED_FORMAT`    |
| bytes disagree with the declared type              | `DECLARED_TYPE_MISMATCH` |
| final extension disagrees with the bytes           | `EXTENSION_MISMATCH`     |
| does not end where the format must end             | `TRUNCATED`              |

**Order is deliberate**, because a caller acts on the reason they are given.
Size first, so an oversized blob is refused without being inspected. Format
before integrity, because telling someone their SVG is truncated invites them to
send a longer SVG.

**Truncation** is the subtle one: a cut-off PDF is byte-identical to a valid one
for its first five bytes, so only the tail distinguishes them. The search window
is bounded to 2 KiB — a marker in the middle of a file is not an end marker, and
an unbounded search would both accept truncated files that happen to contain the
bytes earlier and make validation O(file) on every upload.

**Extensions** are judged on the LAST one. `passport.pdf.exe` is an executable
wearing a pdf in the middle; judging the first would be exactly the wrong
answer. A missing extension is not a lie and is accepted.

---

## 3. States

| State         | Meaning                                     | Readable | Terminal |
| ------------- | ------------------------------------------- | -------- | -------- |
| `PENDING`     | not yet judged                              | no       | no       |
| `CLEAN`       | a real scanner cleared it                   | **yes**  | yes      |
| `QUARANTINED` | a scanner positively identified malware     | no       | yes      |
| `SCAN_FAILED` | the scanner errored; nobody judged the file | no       | **no**   |
| `REJECTED`    | _we_ refused the file (9B.4)                | no       | yes      |

`SCAN_FAILED` is deliberately **not** terminal — the infrastructure failed, not
the file, and that is exactly the case worth retrying.

`REJECTED` is new, and separate from `QUARANTINED` on purpose. `QUARANTINED`
means malware and carries the **longest** retention window in ADR 0012, because
destroying malware destroys the evidence of the attack. A provider whose PDF
arrived truncated has not attacked anyone; filing their document under that
state fabricates a finding against them and holds an innocent person's identity
document far longer than any policy intends.

The read gate is `state === 'CLEAN'` — compared against CLEAN, never against a
denylist, so a state invented later is unreadable until someone deliberately
makes it readable.

---

## 4. Which verdicts may overwrite what

`scan-decision.ts`. The scanner decides what a file IS; this decides whether
that answer may overwrite what is already recorded — a different question, and
the one that carries the weight, because the scan path is retried, replayed and
eventually re-run against newer signatures.

```
PENDING      + CLEAN(real)   -> CLEAN
PENDING      + INFECTED      -> QUARANTINED
PENDING      + FAILED        -> SCAN_FAILED
PENDING      + UNAVAILABLE   -> no write
PENDING      + CLEAN(fake)   -> no write          <- the laundering guard
SCAN_FAILED  + CLEAN(real)   -> CLEAN             <- retry is progress
CLEAN        + INFECTED      -> QUARANTINED       <- the only allowed loosening-in-reverse
CLEAN        + FAILED        -> refused           <- an outage is not evidence
QUARANTINED  + CLEAN         -> refused           <- never released
REJECTED     + anything      -> refused
```

`CLEAN -> QUARANTINED` is the single overwrite of a terminal state that is
allowed, because it is the only one that makes the system **more** restrictive:
signature databases improve, and a file cleared last month can be recognised
today.

Two distinct refusals, because they mean different things to an operator:
`NO_CHANGE` is "the row already says this"; `ALREADY_TERMINAL` is "we are
refusing to loosen a decision that has been made".

---

## 5. The processor

`EvidenceScanService.scanPending()`. Not exposed over HTTP — a route that scans
on demand is a route that can be aimed.

```
select   PENDING, or SCAN_FAILED older than the 5-minute retry delay
         (bounded: default 25, max 200)
read     openReadStream, capped at maxBytes+1 — the extra byte is what makes
         "too large" detectable at all
validate before the scanner is asked anything, against the type the SERVER
         detected at upload; a disagreement now means the object changed
scan     the port promises adapters resolve rather than throw; this does not
         depend on that promise being kept
claim    updateMany WHERE id AND scanState = <the state we observed>
```

The conditional claim is the concurrency control. Updating by id alone lets two
workers both write, with the second silently overwriting a decision made from a
different reading of the file. A lost race counts as `skipped`, not as a
success.

The state write, the audit row and the outbox event share **one transaction**,
so a crash cannot leave a document quarantined with nothing announcing it.

One asset's failure never abandons the batch. The 5-minute retry delay exists so
a permanently broken scanner does not turn the sweep into a hot loop over the
same rows.

---

## 6. Adapters, and the boot refusal

| Driver           | Adapter                      | Behaviour                                               |
| ---------------- | ---------------------------- | ------------------------------------------------------- |
| `none` (default) | `UnconfiguredMalwareScanner` | never returns CLEAN; evidence uploads and is unreadable |
| `test`           | `DeterministicTestScanner`   | recognises EICAR, clears everything else                |
| `clamav`         | `ClamAvMalwareScanner`       | clamd INSTREAM over TCP                                 |

`resolveScannerSelection` **throws at boot** if a process that believes it is
production asks for `test`. That adapter reports `isRealScanner = true` — it has
to, since inside a test it IS the authority and the quarantine path must be
reachable — which makes it the one adapter in the codebase able to write CLEAN
without scanning. A boot failure is the correct outcome; the alternative is an
API that looks healthy while trusting every file it is given.

An unrecognised driver is an error, not a fallback: falling back to `none` on a
typo would mean `EVIDENCE_SCANNER_DRIVER=clamv` silently disables scanning, with
nothing downstream able to tell "configured off" from "misspelled".

`none` boots with a loud warning instead of refusing, because it never returns
CLEAN and so cannot launder anything — refusing would take the whole API down
for a feature that is merely degraded.

### The clamd adapter, and why there is no new dependency

clamd's INSTREAM protocol is a null-terminated command, length-prefixed chunks,
and one line of reply. An antivirus client library would be a meaningful amount
of third-party code sitting directly in front of untrusted bytes, on the one
path that handles files chosen by strangers. That is cheaper to write against
`node:net` than to audit.

Everything that is not a positive `OK` or a positive `FOUND` is a **failure**,
never a clean file: timeouts, refused connections, mid-conversation hang-ups,
clamd `ERROR` replies, and anything unrecognised all become `SCAN_FAILED`, which
is retryable and unreadable. The adapter resolves rather than throws, so one
refused socket cannot abandon the rest of a batch.

Failure reasons **classify** rather than describe: no host, no port, no path,
nothing derived from the file. The body is sent in 64 KiB frames, so a large
upload does not become one enormous frame after being streamed this far.

---

## 7. Only CLEAN satisfies a requirement

`missingRequirements` previously matched on kind and category alone, so a
document whose evidence was `PENDING` or `QUARANTINED` satisfied a requirement
exactly as well as a scanned one. A provider could have been verified on the
strength of a file nobody had cleared — and in the quarantined case, on the
strength of one a scanner had flagged.

`scanState` is now **required** on the held-document shape, not optional: an
optional field would let a caller satisfy a requirement by simply not mentioning
it. Compared against CLEAN rather than a denylist.

---

## 8. Audit, events and logs

Four audit event types rather than one with a verdict field, because "a document
was cleared" and "a document was quarantined" are the two facts an auditor
searches for **by name**:

`VERIFICATION_EVIDENCE_SCAN_CLEARED` · `_SCAN_QUARANTINED` · `_SCAN_FAILED` ·
`VERIFICATION_EVIDENCE_REJECTED`

Audit metadata carries ids and a reason code. Never a storage key, a filename, a
hash, or file content.

`evidence.scanned` is emitted through `OutboxRepository` with an
`(asset, state)` dedupe key, so a replay announces once while a genuine rescan
that CHANGES the state is announced properly. `EvidenceScannedHandler` ships
**with** it: `OutboxWorker` dead-letters any event type no handler claims, so a
producer without a consumer would turn every scan into a dead row and a logged
error — strictly worse than not emitting at all.

The handler counts outcomes by state, labelled by state **and nothing else**. A
per-asset or per-owner label would turn the metrics endpoint into a list of
whose identity documents were quarantined, retained far longer than the
documents are.

The sweep logs counts only. This loop sees every identity document in the
system; it is the last place that should be describing one.

---

## 9. Rate limiting

The global backstop is 100 requests / 60s. The three evidence upload routes
carry 30/hour each: prepare reserves a slot, content moves a whole file, and a
scanner then reads that file again. A legitimate provider's document count is
bounded by `maxDocumentsPerCase`, so 30/hour is generous for retries while
stopping a loop from consuming storage and scanner time.

The same budget on all three deliberately — they are called in sequence for one
document, so differing budgets would mean the smallest silently governs the flow.

---

## 10. Threat model — what 9B.4 adds

| #   | Threat                                  | Control                                                |
| --- | --------------------------------------- | ------------------------------------------------------ |
| S1  | Malware served to a reviewer            | only `CLEAN` is readable; enforced at the real route   |
| S2  | Unscanned file treated as safe          | `PENDING` unreadable; `UNAVAILABLE` never writes CLEAN |
| S3  | Fake scanner in production              | boot refusal, proven at runtime (container exits 1)    |
| S4  | Scanner outage read as "clean"          | every non-OK answer becomes `SCAN_FAILED`              |
| S5  | Replayed verdict releasing a file       | terminal states never loosened                         |
| S6  | Two workers disagreeing                 | conditional claim on the observed state                |
| S7  | Malformed file reaching a reviewer      | validation before scanning; `REJECTED`                 |
| S8  | Innocent file under malware retention   | `REJECTED` separate from `QUARANTINED`                 |
| S9  | Verification on unscanned evidence      | requirements need `scanState === 'CLEAN'`              |
| S10 | Upload/scan resource exhaustion         | bounded batches + route rate limits                    |
| S11 | PII in logs, metrics or audit           | counts and ids only; label cardinality bounded         |
| S12 | Scanner infrastructure leaked in errors | reasons classify, never describe                       |

### Residual risks

- **The clamd adapter is exercised against a fake server, not a live clamd.** The
  protocol is implemented from its specification and tested over a real socket,
  but a soak against a real ClamAV daemon remains a manual check before enabling
  `EVIDENCE_SCANNER_DRIVER=clamav` in production.
- **No scheduler is wired.** `scanPending()` is invoked by an operator process;
  choosing and configuring the scheduler is deployment work.
- **Rescan is not automated.** `CLEAN -> QUARANTINED` is supported by the state
  model, but nothing re-scans previously cleared assets after a signature
  update. That is a policy decision with a cost, and it is left explicit.

---

## 11. Rollback

1. Set `EVIDENCE_SCANNER_DRIVER=none` (or unset). Nothing is cleared from that
   point; already-`CLEAN` documents stay readable.
2. Stop invoking `scanPending()`. It has no HTTP surface.
3. Leave the data. Every state is meaningful to the pre-9B.4 read rule, which
   admits `CLEAN` and nothing else.
4. **Do not roll back the migrations.** Both are additive enum values, and
   PostgreSQL cannot remove an enum value. Reverting the code needs no schema
   change: rows written as `REJECTED` remain unreadable under the older rule
   too.

The one irreversible thing in the feature is a `QUARANTINED` verdict, which is
why the state model refuses every path that would release one.
