# G2 — Wave 2 acceptance repair and future-wave preparation

## Verified owner publication and R31 start — 2026-10-23

Owner-merged PR #183 is published at
`986b4707776711e80564f0642133ede90ba16f3c` (merged
2026-10-23T04:11:34Z). Its reviewed head
`d2c0a9ab8862ffff886346a21377839f996152ca` and merge share tree
`7ab683ea8c5304929a2fa51f1dc824c7cb46f7d5`. Git ancestry and the complete
thirteen-file descendant difference were checked: all differences from the
accepted source are documentation, registry or evidence. Product code, schema,
contracts, workflows and dependencies are identical to the frozen source.

The GitHub check inventories were re-fetched at 2026-10-23T04:47:33Z. The reviewed head
has 38 latest distinct successful checks; two older governance checks are
superseded. The owner merge has 30 successful checks across eight workflow
families, including all 19 main CI jobs. Its real PostgreSQL/Redis job records
6,586 passing tests and 81 pre-existing gated tests; compiled workers pass 3/3.
The web suite passes 2,525 tests; the broad browser invocation records 836
passed and 349 pre-existing gated tests plus six setup passes. Skips are not
counted as successful assertions. These are G2 publication results, not proof
of an R31 implementation. The full compact check inventory and inspected job
identities are in `PUBLICATION_VERIFICATION.json`. The separate official CodeQL
result belongs to the reviewed head and has zero annotations; postmerge proof
separately identifies its successful CodeQL analysis workflow.

The continuing owner delegation and the supplied R31 request permit the
coordinator to assign only `r31-20261023-d799cbee` to the original exact 31-file
R31 package on `feat/r31-subscription-entitlements`. The branch starts from
frozen source `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`; root first applied the
thirteen already owner-merged record blobs and then reconciled publication.
The frozen source/tree, original acceptance artifacts and policy holds remain
unchanged. This imports no unmerged peer runtime. Root recorded the serialized
record lease in `../../../r31/OWNERSHIP.md` before these changes; the canonical
path is `docs/production-readiness/r31/OWNERSHIP.md`, with its approved CR-001.

R31 is `READY_TO_START`; R29/R30/R32/R33 remain held for their own assignments.
The session has named isolated resource identities but they are not provisioned
by this record. Wave 4 remains blocked by G3, and no commercial policy, live
rail, permission grant, hosting, spend, merge or deployment is authorized.

## Prior technical acceptance checkpoint — 2026-10-22T23:38:30.107Z

Candidate `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`, tree `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`, passed all 38 exact-source checks,
including the independent official CodeQL result with zero annotations.
The source ZIP and inner archive digests, all 2,666 tracked blobs and the
reconstructed tree were independently verified. The four `hsm.money.v1` port
digests remain unchanged. R25 real replica/recovery evidence, R26 real-cookie
security evidence and inspected synthetic gallery/PDF screenshots, R27 complete
comparable measurements with all original ceilings, and R28 Linux/Windows
configuration controls are linked in the machine evidence record.

The actual PostgreSQL/Redis API job passes 6,586 tests in
347 suites with zero failures. Its 81 pre-existing gated tests are
explicitly excluded from the pass count. Both projection suites execute all
64 cases without skips, including isolated schemas and generic plans.
The three separate compiled-worker recovery tests also pass.

At this earlier checkpoint G2 was **technically ACCEPTED** and PR #183 was
still awaiting owner merge. The verified publication and R31-only assignment
above supersede that publication hold; its original acceptance evidence is
preserved. Wave 4 additionally requires G3; R38 final certification requires
G4. R39 has no package in this registry. R28 hosted prerequisites and R16/R18
policy holds remain.

Evidence: `SOURCE_MANIFEST.json`, `ACCEPTANCE_EVIDENCE.json`, and `evidence/`.
No containing commit SHA, owner approval, hosted acceptance or lane execution
is inferred from these results.

## Historical PR183 candidate corrections — 2026-10-23

The following records retain failures and pending states from earlier candidate
checks. They are historical; the accepted source and verified publication above
control the current G2 decision.

The exact `c49bc75c07592135fc07538737fa9b652f309ab8` API job passes 6,585
tests, including all 36 G2 and 27 R27 projection cases without skips. However,
independently evaluating its R27 candidate artifact 12466300374 finds 51/52
budgets passing and the provider-booking count at nine instead of seven.
The report identifies seven application reads plus two `SELECT (no table)`
calls whose plan reads `pg_type`. The earlier successful `7843ed58` measurement
also has these two reads in its base phase, but its amplified phase has a warm
decoder and records seven. This was cold pooled-connection enum decoding,
not permission to relax a ceiling or relabel a failed measurement.

The provider raw projection now enumerates only consumed scalar fields and
returns its two enum labels (`status` and `pricingType`) as built-in PostgreSQL
text. Stored enums, indexed predicates and application-visible values remain
unchanged. A new actual-PostgreSQL regression wraps the emitted parameterized
query with `pg_typeof` and requires text wire types while comparing every
projected value with the original Prisma selector. Counters, query filters,
warm-up, pool settings, budgets and comparator remain unchanged. The new real
database regression and complete R27 measurement require fresh exact-head CI.

Real-service job 120132134430 on `99703ddf7def463b935d48bd53f6422bced546d2`
passed 6,584 tests and the financial generic-plan regression; the remaining
isolated-schema case then reached the seeker's bid count and exposed the same
unnecessary fixed-literal enum lookup for `WITHDRAWN`. That literal now also
takes its type from its column. All fixed enum literals across the three G2
projection repositories were audited together; only the existing bound dynamic
provider-status casts remain. Withdrawn/deleted exclusions and all integration
assertions are unchanged. This earlier failed run is not acceptance evidence.

Review comment 4353973365 exposed the corresponding G3 source-artifact identity
gap. Twelve synthetic negative cases reproduced acceptance of wrong or missing
source/tree, absent/invalid artifact/run IDs and absent/invalid inner digest.
The G3 validator now requires all of those identities in addition to the
existing recomputed-tree, tracked-blob and ZIP-digest checks. Every future lane
R34–R38 rejects the malformed proof. The complete governance suite passes
480/480 with no failures, skips or cancellations after the repair. This only
strengthens future acceptance; it does not accept G3 or release Wave 4.

The same head's real-service job 120122846017 passed 6,583 tests but failed two
existing G2 isolated-schema cases (`BookingStatus` was not visible on the
temporary schema's search path). The financial query's constant `COMPLETED`
literal now takes its enum type directly from the compared column, retaining
the enum comparison and index eligibility without hard-coding another schema.
No fixture, integration assertion, budget or predicate was relaxed. The bounded
projection unit suite passes 9/9; an initial command also named a nonexistent
second spec, then the corrected command passed. Final-source real PostgreSQL
equivalence and generic-plan results remain required from CI.

Remote follow-up at `7843ed58f638b7db925b3541e922fc30d0887947` passed the
R27 baseline, candidate, repair-baseline and unchanged-budget/comparison jobs,
as well as the API build checks, authentication lifecycle, R26 security and
governance. The security scanner then identified one ordinary-prose match in
the restored R36 prompt. The separately documented review in
`docs/security/gitleaks-historical-baseline.md` section 14 adds only its exact
historical fingerprint and a whitespace-only prompt continuation. Normalized
instructions are unchanged, and two fresh scanner canaries still fail as
required. This follow-up requires its own exact-head CI before acceptance;
the prior measurements are not relabelled as final-source evidence.

The review head `172776d24bed770440bfb2f4ef702bbff9510b89` merged PR182 with
the earlier G2 work but retained overlapping implementations. CI reported nine
API build diagnostics, an unused test fixture, and a stale PR Final SHA.
The repair-baseline matrix also checked out the candidate instead of its
independently validated base, so its identity assertion correctly failed.

This correction shares one provider-profile query and one provider-booking
query across their existing entry points. It removes duplicate types/imports,
retains the category identifier and permitted seeker identifier in the internal
projection, and aligns both independent Prisma reference suites with that
projection. Existing response serializers, authorization, money values, cursor
ordering, nullable relations and transaction forwarding remain authoritative.
Both provider and financial lists use the bounded lateral request lookup, so
the generic planner cannot expand request hydration into a large-table scan.
The existing PostgreSQL plan regressions remain enabled.

The R27 matrix now selects the actual immutable repair baseline. Four new
workflow regressions exercise all three checkout selections and retain the
ancestry, lockfile and unchanged-budget requirements. Neither numeric budgets
nor the comparison implementation was edited.

Local verification on Node 24.21.0 / pnpm 10.32.1:

- `pnpm install --frozen-lockfile --offline --store-dir /tmp/hsm-g2-pnpm-store`
  and guarded database `generate`: exit 0; dependency lock unchanged.
- `pnpm --filter @homeservicemarketplace/api lint`, `typecheck`, and `build`:
  exit 0. The original typecheck failure is retained in the task's scratch log.
- `pnpm --filter @homeservicemarketplace/api exec jest --maxWorkers=4`:
  267 suites passed; 4,887 tests passed; 93 service-gated suites / 1,779 tests
  skipped by their pre-existing environment gates. No skip was added.
- `node --test .github/scripts/*.test.mjs scripts/perf/post-r18/lib/*.test.mjs`:
  575 passed, zero failed/skipped/cancelled.
- Repository governance, release-baseline and R28 plan validators: exit 0;
  the R28 result remains configuration-only with hosted prerequisites held.

The first local Jest run lacked the CI configuration fixtures and exposed one
stale merged mock assertion. After adding the same ignored synthetic environment
used by CI and correcting the assertion to the actual narrow-profile method,
the complete hermetic suite passed. A new disposable local PostgreSQL attempt
was blocked by the executor's UID mapping before server initialization; no
existing cluster was modified and no local database pass is claimed. Exact-head
remote database, browser, performance and security evidence is still required.

This publication repairs the review candidate; the active G2 acceptance record
remains blocked until that evidence is verified. Owner-reviewed merged
publication and lane assignments are separate start requirements. The current
registry contains R29–R38 packages; R39 has no supplied package or acceptance
criteria in this source and is not silently invented by this repair.

## Scope and authority

The owner requested removal of the G2 blockers on 2026-10-22 so the next phase can begin. This is coordinator implementation, tests and review preparation on `coord/g2-wave3-start-gate`; it is not a new product sprint. The isolated checkout began at owner-merged `develop@96e92825f9b65cf124317f43b55ce42fc97f5b49`, tree `68f4e926eabeb37bb70382c62b75272cf67bd02c`. Mode A applies. Exact file leases were recorded in `OWNERSHIP.md` before every implementation slice. No branch of another session, stash, live database or unmerged peer source was consumed.

The original G1 frozen source `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` and its owner-merged acceptance remain unchanged. The pre-successor G2 records are preserved as original bytes and Git blob identities in `history/pre-gate-96e92825/BUNDLE.json`. Earlier narratives are available at the execution-base commit; none is reused as proof for new runtime source.

## Findings and repairs

The actual merged execution base has completed CI; the retained G2 failure narrative referred to an older source. R25 recovery, R26 boundary tests and R28 configuration controls have newer passing evidence. However, R27 still exceeded four original proposed statement ceilings, and its workflow did not enforce either the budget evaluator or the comparison. The old G1/candidate comparison also fails the unchanged dependency-lock comparability guard after the accepted dependency patches. Those are real gaps, not reasons to relabel results.

| Repair                       | Behavior and boundary                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seeker request list          | Combine category hydration and page-bounded bid counts into one parameterized read, after the original owned Prisma page and latest-booking selection. Preserve withdrawn/deleted bid semantics and captured category IDs.        |
| Provider marketplace profile | Read only the existing category IDs and geographic matching fields in one statement. Authentication, fresh capability checks and profile deletion semantics remain server-owned.                                                  |
| Provider booking lists       | Read a bounded ordered page and required summary relations in one parameterized statement. Preserve original nullable/tied ordering and cursor eligibility. Wallet/earnings consumers only change their mapper type annotation.   |
| Admin completed bookings     | Bound the existing updatedAt/id page before relation joins. Preserve exact Booking monetary values, fee behavior, nullable provider-user relation and existing mutable-cursor limitations. No ledger or payment behavior changes. |
| Evidence gate                | Keep original budgets and comparator unchanged; add a mandatory comparison/budget job and reject wrong source/harness identities or incomplete AR/EN/mobile/desktop browser matrices.                                             |
| Query labels                 | Recognize schema-relative and qualified table names without mislabeling enum casts. Counts, plans and scan thresholds are unchanged.                                                                                              |
| Future packages              | Recover complete R29–R38 instructions from the original hash-verified package, expand conditional exact ownership and isolated runtime identities, and preserve the Wave 3/G2 then Wave 4/G3 sequence.                            |
| Governance                   | Keep the historical blocked fixture, exercise both blocked and accepted-but-unpublished records, and require independent G3 acceptance/publication before Wave 4.                                                                 |

Raw SQL is limited to measured read projections and uses `Prisma.sql` bound parameters. Unqualified table/type names preserve the configured schema search path. These reads are tested against the previous Prisma projection on real PostgreSQL, including nulls, ties, deletions, foreign/invented cursors, transaction visibility and rollback. Prisma remains 6.12.0; there is no preview feature, schema migration, workspace contract change or package upgrade. Official v6 guidance: <https://www.prisma.io/docs/orm/v6/prisma-client/using-raw-sql/raw-queries>.

## Comparable successor measurement

The successor experiment uses **96e92825f9b65cf124317f43b55ce42fc97f5b49** as its immutable baseline and the published repair head as its candidate. Both receive exactly the candidate measurement harness and retain the same patched lockfile. This measures the repair against the owner-merged current implementation; it does not redefine G1 or rehabilitate the historical incomparable run. Four candidate ceilings remain 5, 10, 7 and 3 statements. The proposed 6/13/12/9 relaxation is not applied.

The original budget JSON retains its historical proposal status and thresholds. This successor workflow now enforces its host-independent statement, plan and bundle limits as a G2 regression condition; its old non-enforcement note is historical. Hosted-only time/SLO proposals still require separate measured owner approval.

The workflow retains both full measurement artifacts and comparison/budget findings. Missing artifacts, a failed prerequisite, mismatched identities, incomplete browser cells or an exceeded candidate ceiling fail the acceptance job. Host timing remains qualified by sample sizes and hardware contention. GitHub's artifact flow is composed using the repository's current action versions: <https://docs.github.com/en/actions/tutorials/store-and-share-data>.

## Toolchain and runtime isolation

Task-local Node 24.21.0 and pnpm 10.32.1 were checked against the official Node checksum and the repository package-manager integrity pin. `pnpm install --frozen-lockfile` completed without modifying the lockfile; normal lifecycle scripts and hooks remain enabled. Prisma generation completed through the existing guarded package script. Initial sandbox network restrictions were recorded before the successful scoped retry.

The local correctness fixture is PostgreSQL 16.14 on loopback port 45119, database `hsm_g2_r27_read_projections`, with a task-only non-superuser role, SCRAM, UTC and a four-connection application pool. Its configuration fingerprint is `71e921ce6fe83018d4fee735e1cdb0441c3e7f604dc12d30bacf92b00c08ddf2`. All 72 existing migrations were applied to that new empty database. No seed, database reset, shared Redis mutation or user data is involved. After the 27 passing local database cases, the exact task-owned PostgreSQL instance was stopped with `pg_ctl -D /tmp/hsm-g2-postgres/data -m fast -w stop` (exit 0); no unrelated process or data was changed. Private credentials and raw environment files are outside Git.

## Evidence and handoff

Local command outcomes and failures are in `ACCEPTANCE.md`; machine identities and final remote evidence belong in `SOURCE_MANIFEST.json` and `ACCEPTANCE_EVIDENCE.json`. Local repository equivalence tests do not substitute for the full HTTP/Redis/browser performance experiment or the exact-source R25/R26/R28 acceptance runs.

A successful technical G2 candidate can be recorded while publication remains `DRAFT_PENDING_OWNER_REVIEW`. That does not authorize Wave 3 execution. The owner must approve and merge the publication, and the coordinator must verify the resulting source before setting the next wave ready. R34–R38 remain behind G3. No merge, deployment, live activation, price/currency/payout policy or account grant is performed here.

## Corrective publication review

The first locally hooked commit `0c587b71ef466412b86581fee18ff2eb46a37f9f` was published through the connected GitHub API as `6c7aac2ea68ee4943d60b0db3be33012d572ac8d`, tree `cc91989350df563dfda19b211904437c33fb1fb1`, on Draft PR #183. A normal read-back fetch proved the trees identical. The API path was necessary because the local Git shell has no configured remote credential; no hooks or branch protections were bypassed.

Independent review then identified that the G2 validator checked source-archive proof shape without requiring its source/tree to equal the candidate. The same review branch strengthens this binding and its negative fixtures. First-head results remain explicitly superseded and cannot establish acceptance of the corrective head. This correction changes no application projection, budget or contract.
