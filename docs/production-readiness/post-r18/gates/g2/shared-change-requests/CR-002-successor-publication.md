# CR-002 — G2 successor implementation and publication

Status: source implemented; exact-source remote acceptance and owner publication pending.

## Authority and paths

The owner's2026-10-22 instruction delegates G2 repairs and next-wave preparation. The sole coordinator branch is `coord/g2-wave3-start-gate`, based on owner-merged96e92825f9b65cf124317f43b55ce42fc97f5b49. Every exact source/CI/record path and writer is recorded in `../OWNERSHIP.md`; source writers returned their leases before final synchronization. No peer branch is imported.

## Minimal changes and reason

1. Replace excess relation hydration in three existing repositories with parameterized, bounded read projections; adapt existing summary types only. This resolves the four R27 statement-budget gaps while preserving guards, ownership, field values and cursor behavior.
2. Update `.github/workflows/r27-performance.yml` to compare immutable96e92825 against the exact repair head with one common harness, then enforce the unchanged comparator, complete browser evidence/source postconditions and unchanged candidate budgets. New `.github/scripts/r27-acceptance.mjs` and its test validate the missing postconditions. The diagnostic table-label parser is compatible with schema-relative SQL. Original G1 history/lock mismatch remains retained.
3. Restore complete original R29–R38 prompts with hash provenance. Update the single registry and Wave3/Wave4 plans with conditional exact ownership and isolated runtime identities. Add G3 readiness validation through the existing canonical wave authority. Preserve historical blocked fixtures and all existing negative controls; accepted G2 explicitly requires the new R27 acceptance check.
4. Refresh G2 evidence and all five lane merge identities from actual GitHub observations. Record tested source and separate publication identity without self-referential hashes.

## Verification and consequences

- No package manifest/lockfile, Prisma version, schema/migration, public money contract, environment flag, edge deployment or pricing/payout rule changes.
- Existing72 migrations deploy to a new task-only PostgreSQL16.14 database. The read equivalence suite passes27cases, including cursor/transaction/schema negatives; scoped units122cases. Full final API/governance/static/security checks are recorded in ACCEPTANCE.md.
- Real HTTP/Redis/browser and large-table plan/budget proof runs on the published candidate. New check failure is a real gate failure; no retries, skipped mandatory assertions or threshold increases are added.
- R28 remains configuration-only with hosted authority missing. R16/R18/live-money holds are retained.

## Publication and integration owner action

The coordinator prepares one English review PR and gathers its exact-head CI/officialCodeQL/source/artifact proof. Git HTTPS push has no local credential in this environment; if the connected GitHub Git Data API publishes the normal-hook local tree, both identities and a read-back tree comparison must be recorded.

Only after all applicable candidate evidence is complete may the technical G2 record say ACCEPTED. It remains `DRAFT_PENDING_OWNER_REVIEW` and Wave3 remains blocked until the owner explicitly approves/merges and the coordinator verifies publication/ancestry/postmerge checks. Release R29–R33 only. R34–R38 require later G3 acceptance and verified publication; R38 final certification waits for the Wave4 evidence join. This task does not merge or deploy.
