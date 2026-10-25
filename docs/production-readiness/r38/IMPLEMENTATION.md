# R38 — Release certification preflight; implementation blocked

## State and identity

**PREFLIGHT_ONLY; IMPLEMENTATION_NOT_STARTED.** Phase A has not started;
`PHASE_A_READY`, functional `SOURCE_VERIFIED`, `SANDBOX_ACCEPTED`,
`HOSTED_ACCEPTED`, `RELEASE_ACCEPTED` and `DEPLOYED` are not asserted.
Acceptance remains **INTEGRATION_PENDING / POLICY_BLOCKED / EXTERNAL_BLOCKED**.

- Observed documentation parent: `c9de08d07b12871db8801fb9662b14de83a2c391`.
- Observed source tree: `67136183b8a81de9773c2c6a3831441c320729c0`.
- Approved G3 frozen source/tree: **absent**, not replaced with the observed tip.
- Branch: `release/r38-release-certification`; exact scope: [OWNERSHIP.md](OWNERSHIP.md).
- Final documentation commit/tree: recorded in PR metadata after publication,
  avoiding a document that purports to contain its own commit hash.
- Machine-readable observation: [preflight.json](evidence/preflight.json).

## Reproduced start barrier

GitHub confirms [PR #198](https://github.com/baraabd/homeservicemarketplace/pull/198)
was merged on 2026-10-25 at 00:26:28 UTC, producing the observed parent above.
Its reviewed head was `07dec92cb62f591234542ae1dff909c2c9f3763a`.
That implementation merge is separate from G3 acceptance publication.

At the observed source, the canonical
[G3 manifest](../post-r18/gates/g3/SOURCE_MANIFEST.json) still records
`decision: BLOCKED`, null candidate/frozen identities, seven mandatory evidence
categories at `NOT_RUN`, and `publication.state: NOT_PREPARED` with
`verifiedMerge: false`. The [Wave 4 plan](../post-r18/waves/wave-04.plan.json)
has no startable lanes and gives R38 a conditional, unassigned writer.

The existing readiness command was executed without modifying the validator:

```text
node .github/scripts/g3-record.mjs --ready R38
FAIL R38 is not authorized to start
```

Exit code: **1**, an expected refusal. Record consistency separately exits 0;
a consistent blocked record is not an implementation authorization. The user
prompt itself requires accepted G3 and coordinator-approved exact ownership
before implementation. No R38 runtime module is authored around this barrier.

## Current implementation findings

The latest G3 acceptance record describes implemented Stripe runtime/purchase
wiring, approved-policy composition and additive reconciliation persistence.
This preflight does not repeat older claims that those capabilities are absent.
However, its independent external Stripe runner remains unexecuted in the
record, and the seven combined acceptance categories have not been promoted.
See [G3 acceptance](../post-r18/gates/g3/ACCEPTANCE.md) and the
[sandbox handoff](../post-r18/gates/g3/SANDBOX_RUNBOOK.md).

This task environment has no supplied Stripe sandbox configuration, test
publishable key, refund authorization flag, database URL or Redis URL. Presence
was checked without printing values. This is an observation about this task,
not a claim that the owner has no external accounts or infrastructure.

The source contains contracts package version `0.1.0`, the `hsm.money.v1`
money boundary, and 74 migration directories through
`20261024120000_g3_financial_integration`. These are source inventory facts,
not evidence that a target database has applied them. No contract/schema is
changed and no application or database is started.

## Existing authorities for the eventual implementation

| Authority                                       | Reuse and boundary                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/scripts/g3-record.mjs`                 | Active prerequisite/registry validation and R38 readiness. It does not authenticate remote artifacts.                                                                                                                                                      |
| `.github/scripts/pr-acceptance.mjs`             | Existing required workflow/job/artifact inventory, complete pagination, newest attempt selection, head/base rechecks, freshness and official CodeQL provenance. Preserve its Draft-PR restriction; a passing preflight PR is not final release acceptance. |
| `infra/production/staging.cjs`                  | Exact release manifest, API/migrator/web digests, independent destination approval and runtime identity. Reuse validation; do not introduce a second deployment launcher.                                                                                  |
| `scripts/production/platform/validate-plan.cjs` | Checked R28 topology/configuration and fingerprinting; configuration validity is distinct from hosted acceptance.                                                                                                                                          |
| R16, R18 and `docs/money/LIVE_MONEY_GATE.md`    | Separate payout/funding, product, verification and live-money decisions. Preserve unresolved items even when an owner-approved scope excludes them.                                                                                                        |

## Phase A handoff after G3 publication and assignment

The exact future files are already in the Wave 4 plan. The four paired modules
must collect evidence, validate the candidate, validate the final join and
prepare rollout respectively. Their implementation must:

1. Bind exact source/tree, API/migrator/web digests, schema lineage, contract
   version, effective configuration, approved scope, target and rollback set.
   Verify artifact bytes and configured signed provenance against an
   independently trusted authority, not a supplied `verified: true` value.
2. Retain a required evidence inventory independently of submitted results.
   Reject missing/dropped/duplicate jobs, wrong source or digest, stale or
   future-dated evidence, cancelled/failed/skipped work and incomplete pages.
   Distinguish retries/flaky results and verify the agreed browser matrix.
3. Preserve all R16/R18 holds. Reject in-scope unresolved blockers. An excluded
   capability requires explicit scope approval and proof that it is disabled;
   `CONDITIONAL-GO` cannot conceal an in-scope blocker.
4. Read only authorized evidence locations, reject path/symlink escapes and
   untrusted destinations, never execute manifest-provided commands, and write
   sanitized outputs atomically with meaningful concurrency tests.
5. Prepare a topology-specific controlled rollout with approved abort
   thresholds, operator responsibilities and explicit schema compatibility.
   The reference single-replica launcher does not promise percentage traffic
   shifting or zero downtime. No threshold is approved by this preflight.

Required negative tests include forged PASS, wrong SHA/tree/digest, missing
required job, stale configuration, latest-attempt failure hidden by an older
pass, retries/flakes, missing approval, unsafe flags, unresolved R16/R18,
missing peer join, incompatible rollback, path escape and concurrent output.
These are **requirements, not newly implemented tests or acceptance evidence**.

## Phase B and coordinator handoff

Phase B waits for completed R34/R35/R36/R37, a frozen integrated candidate and
fresh required CI, journeys, reconciliation, hosted security/load/recovery and
alert evidence on that same identity. Actual owner scope approval remains
mandatory. A GO decision does not imply deployment or live-money authorization.

The concrete [shared change request](shared-change-requests/CR-001-integration.md)
identifies G3 publication, exact assignment, minimal later CI integration and
the existing R36 rollback correction. No shared patch is applied here.
