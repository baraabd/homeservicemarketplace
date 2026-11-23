# R37 CR-001 — G3 publication, exact ownership and hosted inputs

Status: **REQUEST ONLY / NOT APPLIED**. No shared-file implementation lease is
granted by this request. G3 and R37 remain blocked.

## 1. Correct stale integration wording without releasing the gate

PR #198 was actually merged at
`c9de08d07b12871db8801fb9662b14de83a2c391`. The coordinator should reconcile its
current-source wording in these exact shared paths:

- `docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/waves/WAVE_04.md`

Minimal proposed replacement for the first file's
`blockers[id=G3-INTEGRATION-CANDIDATE-REVIEW].reason`:

> Stripe runtime/purchase integration, approved refund policy composition and
> reconciliation foundation were merged in PR #198 at
> c9de08d07b12871db8801fb9662b14de83a2c391. Independent exact-source combined
> sandbox acceptance, actual policy inputs and separately verified G3
> publication remain required. This merge issues no frozen G3 SHA or Wave 4
> authoring authority.

In `WAVE_04.md`, replace the stale assertion that R29/refund wiring are missing
with the same merged-source distinction. Retain BLOCKED, every mandatory
evidence requirement, null frozen identities and all policy/external holds.
This is a record correction only; it cannot manufacture acceptance or turn
historical tests into evidence on the merged source.

Validation for that correction: the existing governance tests and
`g3-record.mjs --check` pass; `g3-record.mjs --ready R37` must continue to return
exit 1 until the genuine gate conditions are met. No dependency, migration,
schema, application contract or test-budget change is required.

## 2. Close G3 and publish the actual execution source

Use the existing `post-r18/gates/g3/REQUIREMENTS.md` and `SANDBOX_RUNBOOK.md`,
including real Stripe test operations with authentic webhooks, authorized
manual review, approved refund/subscription consequences, atomic activation,
immutable ledger and post-commit outbox. Record all seven mandatory categories
against one complete source/tree, independent artifacts and final CI/CodeQL.
The implementation of a runner and its contract doubles cannot satisfy this.

Only the coordinator, after evidence acceptance and the separate owner-reviewed
publication merge, updates these exact central records:

- `docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/waves/wave-04.plan.json`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`

The resulting gate/publication/source identities must agree. The coordinator
then records the actual single writer and activates the existing R37 exact
allowlist and three infrastructure files. This preflight does not propose
unconditional READY_TO_START values or use the inspection parent as a frozen
base. No unmerged peer is a source dependency.

## 3. Supply separate hosted authority and effective configuration

Approve the concrete target record specified in IMPLEMENTATION.md, including
account/resources/origins, source/tree and API/web/migrator digests, named
operator, window, exact rate/connection/volume limits, fault bounds, abort
thresholds and independent synthetic resources. Explicitly authorize two API
replicas, slow clients, duplicate authentic sandbox deliveries and reconnect
bursts without extending tests to third-party platforms or shared production.

Supply actual applied TLS/CSP/CORS/cookie evidence, database grants, Redis ACLs,
private storage boundaries, service identities, real scanner and mail
behavior, resource/pool/queue telemetry, and the real on-call test destination
with a named responder. Confirm supported browser engines and approved
capacity/SLO numbers. Do not populate the R28 plan with invented hostnames,
approvals, account IDs or synthetic secrets.

Supply complete current repository-wide findings and exact final-image scans,
including unfixed High/Critical advisories excluded by the existing CI scan.
Legitimate external findings need explicit owner disposition; no blanket
severity/rule exclusion or suppression is proposed.

## 4. Preserve the source/hosted distinction in later integration

After G3 and assignment, implement the existing planned hosted harness rather
than retargeting R26/R25's isolated runners. Reuse R27's workload semantics but
add approved rate/connection bounds, independent resource telemetry and a
safety stop. Persist sanitized evidence with expected/actual sample sizes,
before/during/after fault observations, real incident receipt and immutable
source/image/config matching. No sensitive documents, tokens, raw sessions or
`.env` enter artifacts.

No executable CI patch is justified before those interfaces and authority
exist. If CI registration is needed, the coordinator owns
`.github/workflows/ci.yml`: serialize a dedicated authorized job with explicit
inputs and a source-bound evidence verifier, preserving every existing check,
assertion and budget. Submit the exact runnable patch after the lane is released;
this document neither edits CI nor invents commands for an absent harness.

R37 reports runtime defects to the relevant money/storage/release owner with
minimal reproductions and does not edit their code simultaneously. The final
release gate reruns affected probes on the integrated final SHA. No merge,
deployment, live activation, spend or account grant is requested here.
