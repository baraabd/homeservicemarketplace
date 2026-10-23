# R30 — manual subscription payments and protected receipt review

R30 implements an explicitly configured SANDBOX workflow for manual bank,
wallet and office payment instructions; immutable private receipt versions;
independent settlement review; transactional confirmation; and operator refund
observations. All live rails remain unavailable. Actual R31 activation, R32
refund policy/consequences and hosted financial-storage acceptance remain
integration or release dependencies described in `RISKS.md`.

## Source and ownership

| Identity                                           | Value                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Assigned branch                                    | `feat/r30-manual-payment-review`                                               |
| Accepted G2 runtime source                         | `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`                                     |
| Accepted G2 runtime tree                           | `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`                                     |
| Owner-merged publication and actual checkout start | `986b4707776711e80564f0642133ede90ba16f3c`                                     |
| Publication tree                                   | `7ab683ea8c5304929a2fa51f1dc824c7cb46f7d5`                                     |
| Session                                            | `hsm-r30-590834e66da5`                                                         |
| Final candidate commit/tree                        | Recorded externally in the English draft PR after normal hooks and publication |

The publication differs from the frozen runtime by thirteen coordinator
metadata files. PR #183 was owner-merged and independently verified before
R30 runtime work began. No unmerged peer source is imported. The finite
writer map in `RUNTIME_OWNERSHIP.json` and canonical shared-file leases
serialize schema, contracts, application composition and route changes.
Historical preparation is explicitly separated from current evidence.

## Configuration and immutable binding

`ManualRailConfiguration` resolves approved versioned instructions: method,
market, merchant/account identity, currency and minor-unit scale, bilingual
instructions, threshold, validity, upload policy and retention metadata.
Missing, disabled, expired or inconsistent configuration fails closed. Money
uses the existing integer minor-unit wire contract. Neither migrations nor
seeds enable a method, invent an account, or grant review permissions. LIVE
bindings are unconditionally rejected even if a LIVE configuration row exists.

An attempt binds the immutable instruction version through the existing R24
binding. Later operations resolve that same version, rather than silently
switching the payer to new details. The enabled flag can disable a version;
changed instructions require a new version. Test configurations use synthetic
XTS amounts and `SANDBOX_OPERATOR_SIMULATION` evidence only.

## Persistence and financial-evidence isolation

The migration adds financial receipt purpose, audit actions and nine models:

| Responsibility         | Main invariant                                                               |
| ---------------------- | ---------------------------------------------------------------------------- |
| Instruction version    | Approved content is immutable; only enabled state may change.                |
| Receipt version        | Exact owner, intent, asset and predecessor; immutable bytes and association. |
| Review cursor          | Current revision/version, bounded retry state and reconciliation status.     |
| Review decision        | Immutable inspected revision, reviewer, outcome and settlement candidate.    |
| Settlement observation | Exact account/reference, binding, amount and independent recorder.           |
| Settlement claim       | One scoped deposit can confirm only one obligation.                          |
| Receipt inspection     | Actual-byte read binds inspector to the precise revision/hash.               |
| Refund operation       | Stable provider key, immutable binding and monotonic transport state.        |
| Refund event           | Immutable attributed dispatch/result observations.                           |

PostgreSQL checks, unique keys, foreign keys and triggers enforce ownership,
sequential replacement, immutable evidence and independent-actor rules.
Deferred final-state checks require an approved review's settlement claim and
R24 confirmation in the same transaction. Financial assets cannot attach to
identity-verification, portfolio or identity-retention records. No second
ledger, entitlement authority or payment-confirmation model is introduced.

Approved same-provider byte reuse and duplicate scoped settlement references
are separate protections. A digest identifies bytes and flags reuse; it never
establishes that funds arrived. Broader duplicate policy remains a finance
decision rather than an inferred payment fact.

## Upload, scanning and private reads

The provider reserves an asset with purpose `FINANCIAL_RECEIPT` and a
server-bound owner/intent. Its opaque `financial-receipts/` namespace is never
publicly served. Upload accepts bounded binary data, validates actual length,
allowed signature/type and full content digest, and uses conditional
first-write storage. A retry can recover the same bytes after a
write-before-metadata interruption; different bytes cannot overwrite them.

Actual stored bytes pass through real ClamAV before a receipt becomes CLEAN
and can be submitted. A deterministic test scanner, unavailable scanner or
failed scan cannot establish clean financial evidence. Quarantined/rejected
evidence stays unusable. Scan recovery selects only the current eligible
revision, preventing stale failed uploads from starving it.

Reads are authenticated, private, `no-store` and `nosniff`, with fresh
authorization around the actual object read and checks of size/hash/state.
Successful reads record attributed inspections and allowlisted audit events.
Unauthorized and nonexistent private receipts share a not-found response.
The response exposes no object key or public URL. Audits exclude bytes,
hashes, merchant references and private notes. The browser requires rendered
preview plus acknowledgment and revokes blob URLs on close, expiry or session
change. A stale inspection cannot authorize a replacement revision.

Identity scan, cleanup and retention paths select/recheck only identity assets,
including before writes/deletion. The public-media route rejects financial
paths before storage access. Hosted finance IAM/KMS, legal holds and a financial
erasure worker remain pending; a retention date alone proves none of them.

## Review and atomic confirmation

The admin queue/detail rechecks current database permissions and active roles.
Permission definitions do not assign grants. Provider-visible reasons are
separate from internal notes. Decisions require an optimistic current version,
a submitted CLEAN revision, actual inspection and no self-review. Settlement
must be recorded by a distinct currently permitted operator and exactly match
the account, binding, currency and amount.

The decision first records an immutable pending candidate. Existing R24
commands accept/process its deterministic event. Manual events preserve R24's
required null external operation ID; immutable decision/settlement records
retain provenance. The R30 participant finalizes review, settlement claim and
notification work inside that authoritative transaction with R19 ledger,
subscription period and R31 activation participation. A failing participant
rolls back final financial state together.

Transient worker failures use bounded backoff and a budget of eight automatic
failures. Permanent authorization, validation and conflict failures halt with
reconciliation required. Only the original reviewer can retry the same
candidate after fresh authority/evidence checks. The admin projection exposes
safe reason/count/retry state, while the provider sees no internal operational
details. Reassignment and expired obligations need separately approved recovery.
The worker uses the existing shared outbox-worker setting; direct decision and
retry routes can also invoke processing.

## Manual refund transport

The adapter reuses the R24 refund reservation, provider idempotency key and
binding. Creating an operator task is PENDING; dispatch remains UNKNOWN.
Timeout or ledger reversal is not proof of returned money. A different
permitted operator must supply exact bound terminal evidence. Queries verify
the authoritative refund/confirmation, complete binding and amount instead of
trusting caller echoes. R32 retains eligibility and consequence ownership;
R30 does not perform a real transfer.

## Product and contract integration

Provider/admin routes lazily compose the new feature through existing auth,
localization and financial navigation. Arabic RTL and English display
server-owned amount/scale, instructions, availability, expiration, revision
history and status. Providers reserve/upload/submit and replace corrections.
Reviewers inspect private bytes, decide and inspect reconciliation; settlement
entry requires independent authority. Contracts publish reservation,
submission, decision, settlement and detail projections. Disabled, pending,
failed, expired and reconciliation states never become optimistic success.

## Verification design and limits

The real fixture boots the application over HTTP, OTP/cookies/CSRF, PostgreSQL,
Redis, private local storage and real ClamAV. Only R31 activation and R32
eligibility are explicitly labelled transaction contract components; production
R32 confirmation is not replaced. A per-fixture namespace isolates the real
Redis limiter while preserving Lua, quotas, TTL and failure behavior. A real
429 regression proves the 30-per-hour upload limit. No Redis flush is used.

The browser harness starts that real API and dedicated Vite server, using
independent authenticated contexts and a temporary private 0600 state manifest
removed on completion. It intercepts no API responses. Its two scenarios cover
receipt replacement/review and disabled/unknown states, bilingual widths,
keyboard operation, scoped Axe and content enlargement. Only authored
synthetic screenshots and safe reports are published; session traces, receipt
bytes and private environment files are excluded.

The required `R30 manual payments / real services and browser` CI job executes
sixteen service cases and both browser scenarios. Both aggregate gates require
it. Exact count/no-skip/no-retry assertions reject empty or partial evidence.
The general browser configuration excludes this separately required fixture.
A merge-integrity test now mutates named module sections and verifies the
negative fixture changed; production validators were not relaxed.

`ACCEPTANCE.md` records executed results; `VERIFICATION_PLAN.md` gives commands;
`RISKS.md` names unresolved owners; `ROLLBACK.md` describes evidence-preserving
containment. Sandbox success does not claim G3, deployment or live acceptance.
