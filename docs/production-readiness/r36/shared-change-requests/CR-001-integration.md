# CR-001 — Current G3 handoff and migration-free rollback instructions

Status: **REQUESTED; NOT APPLIED**. Requester: R36 preflight session
`r36-eb22d30bac36`, inspected source
`c9de08d07b12871db8801fb9662b14de83a2c391`.
All shared files below remain coordinator-owned. This follow-up changes no
runtime interface, schema, migration, dependency or launcher behavior.

## 1. Exact minimal shared runbook corrections

Reason: `infra/production/staging.cjs` runs the `migrations` phase
unconditionally inside `applyRelease`, before API/web replacement. The
current launcher cannot perform an application-only rollback.

Path: `docs/production-readiness/r18/ROLLBACK_RUNBOOK.md`.

```diff
@@
-1. Re-run the launcher with the previous release JSON (the recorded
-   rollback digests for API, migrator and web).
-2. Do not run the previous migrator: migrations are forward-only and each
-   release so far has been additive, so the previous application runs on the
-   newer schema.
+1. Stop: the current staging launcher always runs api-migrate. Do not use
+   an old release JSON with --apply as an application-only rollback.
+2. After separate authorization, use a reviewed migration-free rollback
+   path for the prior accepted API/web digests. Prove compatibility against
+   the actual forward schema before cutover; retain migration history and
+   the migrator digest as lineage without running the previous migrator.
```

Path: `docs/production-readiness/r28/ROLLBACK.md`.

```diff
@@
-there is no automatic stale-lock expiry. Use an explicitly reviewed rollback through
-the existing launcher and approved immutable artifacts. Do not restore a database
+there is no automatic stale-lock expiry. Use a separately reviewed migration-free
+application rollback procedure and approved immutable artifacts. The current staging
+launcher always invokes api-migrate; do not run an old release manifest with --apply
+as an application-only rollback. Do not restore a database
```

Verification: compare the actual launcher call graph and unchanged
`infra/production/staging.test.cjs`; check the corrected prose advertises no
unimplemented switch or successful rehearsal. Schema/dependency consequences:
**none**. No launcher edit is needed for these documentation corrections.

A later executable rollback must remain in R36's approved files and prove
zero migrator calls, no DB/volume reset, no automatic retry after partial
failure, immutable image/provenance validation and useful-service compatibility
against the real forward schema. The G3 migration replaces
`money_reconciliation_exception_guard`; test old executable behavior for
legacy exceptions and cases requiring matching decision provenance.
Any launcher integration requires a separate exact serialized patch and lease.

## 2. Correct stale central prose without changing the gate

These are exact coordinator-owned paths, not R36 edits:

- `docs/production-readiness/post-r18/waves/WAVE_04.md`: replace the paragraph
  saying R29 and effective refund wiring are missing with a current-source
  observation that #198 merged those components at the inspection SHA;
  independent policy/sandbox acceptance and verified publication remain absent.
- `docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json`: update only
  the stale `G3-INTEGRATION-CANDIDATE-REVIEW.reason` wording about a draft
  candidate after the merge. Preserve `decision: BLOCKED`, all null candidate
  and frozen identities, `NOT_RUN` mandatory evidence, publication state and
  restrictions until actual accepted evidence supports a separate gate update.

Tests: existing G3 record and wave validators; `--check` must remain consistent
and `--ready R36` must continue refusing execution. Do not copy green PR checks
into accepted G3 evidence or fill a frozen SHA merely to clear the refusal.

## 3. Gate and owner-input handoff

R29 Stripe runtime/purchase/webhook composition and approved refund participant
implementations are already merged. Verify them on the chosen combined source;
do not rebuild them in R36. Existing test fixtures are not approved commercial
or recovery policy.

| Required input/action                   | Responsible owner                              | Reviewable completion                                                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G3 exact-source acceptance              | G3 coordinator and authorized sandbox operator | All seven unchanged categories, genuine Stripe test execution/authentic forwarding, approved immutable plan/refund inputs and matching artifacts; retain failures/skips.                    |
| G3 publication and R36 assignment       | Owner and coordinator                          | Separately reviewed/merged/verified acceptance publication, full frozen source/tree and active exact R36 writer/files in `post-r18/waves/wave-04.plan.json`.                                |
| Source and independent restore topology | Infrastructure/network/database/storage owners | Reviewed R28 plan with exact physical DB/users, Redis, storage, queues, network, images, restricted evidence references and explicit isolated drill authority.                              |
| Recovery policy                         | Data/privacy owner                             | Schedule, encrypted retention, legal holds, deletion reconciliation, approved RPO/RTO, artifact/key retirement and incident/cutover ownership. Proposed numbers are not approval.           |
| Protected key recovery                  | Secret/KMS and mail operators                  | Object and mail-envelope key-version references, including JWT parent version if derivation was used; grant scope and expiry checked without copying secrets into Git.                      |
| External-effect isolation               | Money/mail/network operators                   | Outbox and mail schedulers disabled before boot, independent real-egress denial, isolated SMTP sink, no live credentials and separate webhook routing. Include direct/immediate mail paths. |
| Ambiguous external outcomes             | Money/mail operators                           | Original payment/refund/message identities and independent observations; explicit stop/repair policy before real-user replay or cutover.                                                    |

Names and approved secret-store references are sufficient for the handoff;
secret values must not be pasted into a public PR, source, logs or chat.

## 4. Bounded R36 implementation after gate release

Author only the exact scripts/tests and three conditionally leased infrastructure
files enumerated in the Wave 4 plan. Reuse R20 inventory and existing financial,
mail, private-media and authorization authority. Add complete version/deletion
verification, protected key lineage and current G3 policy/reconciliation data
coverage without changing shared v1 report semantics.

Implement and execute the fourteen groups in R36's [ACCEPTANCE.md](../ACCEPTANCE.md)
on the approved isolated target. Bind actual source/tree/image/config/schema
identities, exact counts and known-write recovery measurements. The coordinator
then integrates any separately approved shared changes and recertifies the
combined candidate. Production cutover, spending, live funds and deployment
remain separately authorized actions.
