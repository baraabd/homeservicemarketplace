# Release blockers — pinned S01 baseline

Base: `66e336cb4823802aabacc536584972aa43056d23`. The table distinguishes proven code gaps from absent release evidence. None is closed merely by opening a PR.

| ID | Kind / owner | Evidence and consequence | Smallest concrete closure |
| --- | --- | --- | --- |
| B01 | Enforcement / S02 | Branch API reports develop protected=false; protection read returned 403. Repository files cannot activate protection. | Authorized administrator configures required PR/checks/CodeQL/no-force/no-delete/resolved-conversation rules, then captures effective read-back evidence. |
| B02 | Runtime safety / S03 | Boolean parser maps unknown strings to false; isProduction consumers historically exclude staging. Runtime source lacks several safe configuration combinations. | Review isolated S03 hardening PR, validate strict preflight in actual deployment, exercise negative boot/security cases without weakening baseline CI. |
| B03 | Public media authority / S05 | media.controller reserves avatar/portfolio uploads but request presign returns without a MediaAsset reservation. RequestsService stores mediaUrls verbatim; URL shape alone does not prove ownership. | Add request-upload reservation, received-object verification, transaction-bound ownership/claim and orphan retirement, then real storage + browser + Provider visibility evidence. No restricted-evidence redesign. |
| B04 | Financial persistence / S10 | Baseline Money directory contains pure domain/application/policy files only; schema/migrations contain no ledger account/transaction/entry or payment-intent authority. AppModule mounts no Money execution controller. | Implement ADR-aligned additive persistence and DB invariants, real Postgres concurrency/idempotency/reversal/rollback tests and dark services. LIVE MONEY remains OFF. |
| B05 | Rollout evidence / S06–S08 | Real V2 baseline samples exist, but are one field group per step; flag metadata has a stale name. Effective hosted build flag and all-field lifecycle acceptance are not established. | Correct evidence metadata, execute all required field/save/reload/relogin and negative journeys, publish a scoped rollout decision; S07 owns map and S08 owns hours. |
| B06 | Policy/work-access / S09 | Real review CI exists. Separate persisted policy drafts and complete hosted correction/approval/evidence-access-loss journeys are not proven; current policy API exposes publish/list/options/retire. | Verify the accepted policy lifecycle without inventing a second workflow, publish real scoped policy, test correction/revision/approval and evidence denial through real routes. |
| B07 | Hosted operations / S03 and later | No real hosted secret-manager/SMTP/S3/TLS/rotation/backup-restore/load evidence was provided or obtained. CI services are disposable fixtures. | Configure reference topology, enforce preflight in deployment and retain independent service, browser, restore and observability acceptance. |
| B08 | Product certification / S04, S05 and later | Baseline auth cookie/DB and broad API/browser jobs pass, but full Seeker UI signup/recovery/request-to-Provider journeys are not individually established by this audit. | Extend and run real backend/database/browser journeys; report missing evidence instead of promoting generic CI success to full product certification. |

## Historical documentation correction

`docs/money/IMPLEMENTATION_STATUS.md` describes an additive SQL persistence foundation. Source inspection of the pinned schema and all 60 migration scripts does not support that statement for this baseline. Treat actual code/migrations as authoritative. S01 records the discrepancy rather than repairing Money in a documentation-only sprint. Similarly, old deferred Admin/Provider reports do not override newer real-route baseline evidence.

## Active work at audit time

PR #103 is an unrelated Draft Vite cold-start optimization and is not included. S02 PR #104 and S03 PR #105 were opened from the same baseline and remain independent; their existence does not change develop or close these blockers. The S01 PR body records its own final head and current run links. No PR is merged by this wave execution task.
