# G2 — Wave 2 acceptance repair and future-wave preparation

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

The workflow retains both full measurement artifacts and comparison/budget findings. Missing artifacts, a failed prerequisite, mismatched identities, incomplete browser cells or an exceeded candidate ceiling fail the acceptance job. Host timing remains qualified by sample sizes and hardware contention. GitHub's artifact flow is composed using the repository's current action versions: <https://docs.github.com/en/actions/tutorials/store-and-share-data>.

## Toolchain and runtime isolation

Task-local Node 24.21.0 and pnpm 10.32.1 were checked against the official Node checksum and the repository package-manager integrity pin. `pnpm install --frozen-lockfile` completed without modifying the lockfile; normal lifecycle scripts and hooks remain enabled. Prisma generation completed through the existing guarded package script. Initial sandbox network restrictions were recorded before the successful scoped retry.

The local correctness fixture is PostgreSQL 16.14 on loopback port 45119, database `hsm_g2_r27_read_projections`, with a task-only non-superuser role, SCRAM, UTC and a four-connection application pool. Its configuration fingerprint is `71e921ce6fe83018d4fee735e1cdb0441c3e7f604dc12d30bacf92b00c08ddf2`. All 72 existing migrations were applied to that new empty database. No seed, database reset, shared Redis mutation or user data is involved. Private credentials and raw environment files are outside Git.

## Evidence and handoff

Local command outcomes and failures are in `ACCEPTANCE.md`; machine identities and final remote evidence belong in `SOURCE_MANIFEST.json` and `ACCEPTANCE_EVIDENCE.json`. Local repository equivalence tests do not substitute for the full HTTP/Redis/browser performance experiment or the exact-source R25/R26/R28 acceptance runs.

A successful technical G2 candidate can be recorded while publication remains `DRAFT_PENDING_OWNER_REVIEW`. That does not authorize Wave 3 execution. The owner must approve and merge the publication, and the coordinator must verify the resulting source before setting the next wave ready. R34–R38 remain behind G3. No merge, deployment, live activation, price/currency/payout policy or account grant is performed here.
