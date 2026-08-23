# ADR 0007 — Legacy provider status: compatibility, mapping, and backfill

- **Status:** Accepted
- **Date:** 2026-08-23
- **Sprint:** 07
- **Related:** [0005](0005-provider-lifecycle-axes.md) (the axes), [0006](0006-provider-capability-service.md) (the reader)

## Context

[ADR 0005](0005-provider-lifecycle-axes.md) introduces six axes. Providers already exist under the old single enum, the Provider app renders `profile.status`, the admin queue filters on it, and `ProviderActiveGuard` gates on it. All of that must keep working while the axes are populated.

The hard part is not adding columns. It is that **the old enum does not carry the information the new axes need**, so the backfill has to be honest about what it cannot know.

## Decision

### 1. The legacy column stays, and stays written

`ProviderProfile.status` is **not** dropped, **not** renamed, and continues to be maintained by existing writers for the whole compatibility window. Existing reads keep working unchanged.

**Authority during the window:** the legacy column remains the marketplace gate. The new axes are written and readable but are **not yet the authorization source** — except account eligibility (rank 0), which was always authoritative and is merely made explicit. Flipping authority before Sprint 9 issues work-access grants would deny every provider on the platform, because no grant would exist.

### 2. Mapping

| Legacy `status`  | Onboarding  | Verification     | Standing    | `legacySource`        |
| ---------------- | ----------- | ---------------- | ----------- | --------------------- |
| `DRAFT`          | `DRAFT`     | `UNVERIFIED`     | `GOOD`      | `LEGACY_DRAFT`        |
| `PENDING_REVIEW` | `SUBMITTED` | `UNVERIFIED`     | `GOOD`      | `LEGACY_PENDING`      |
| `ACTIVE`         | `ACCEPTED`  | **`UNVERIFIED`** | `GOOD`      | **`LEGACY_APPROVED`** |
| `SUSPENDED`      | `ACCEPTED`  | `UNVERIFIED`     | `SUSPENDED` | `LEGACY_SUSPENDED`    |
| `REJECTED`       | `RETURNED`  | `UNVERIFIED`     | `GOOD`      | `LEGACY_REJECTED`     |

Three decisions in that table deserve stating outright:

**`ACTIVE` → `LEGACY_APPROVED`, verification `UNVERIFIED`.** An admin clicked approve; nobody ever saw a document. Recording these as `VERIFIED` would fabricate an audit trail for thousands of rows and quietly satisfy a future document check that never happened. `LEGACY_APPROVED` says exactly what is true: _approved under the old process, identity not verified._ It is a distinct source value, not a synonym for verified, so a later "require verification for work access" rule can find these rows and require it.

**`PENDING_REVIEW` → explicit `LEGACY_PENDING`.** Not folded into ordinary `SUBMITTED`. These applications were submitted under a policy version we do not have a snapshot of, so reviewers must be able to tell them apart from post-Sprint-7 submissions with full snapshots.

**`REJECTED` → onboarding `RETURNED`, standing `GOOD`.** Rejection was an _application_ decision, not a conduct decision. Mapping it to `SUSPENDED` standing would punish an applicant for a failed application and block a legitimate reapply.

### 3. Nothing is deleted or silently normalised

The backfill only ever fills a **NULL** new-axis column. It never overwrites a non-null value, never deletes a row, never "corrects" one.

Rows whose old and new state genuinely conflict — a `DRAFT` profile carrying `submittedForReviewAt`, an `ACTIVE` profile with no approval stamp, a `REJECTED` profile with no reason — are **left exactly as they are, flagged in the reconciliation report, and counted**. Silent normalisation is how the evidence of a bug gets destroyed by the migration that was supposed to surface it. An operator decides; the migration does not.

### 4. Dry-run first

The backfill runs in two modes against the same code path:

```
pnpm --filter @homeservicemarketplace/database backfill:provider-lifecycle -- --dry-run
pnpm --filter @homeservicemarketplace/database backfill:provider-lifecycle -- --apply
```

`--dry-run` is the default and writes nothing. Both emit the same reconciliation report: per-status counts in and out, rows that would change, rows skipped because already populated, and every conflict with its row id. A backfill whose effect cannot be read before it runs is a backfill nobody can approve.

### 5. Idempotent

Re-running changes nothing. `--apply` touches only NULL columns, so the second run reports zero writes. That is asserted by a test, because "idempotent" claimed in a comment is how a retry doubles a fan-out.

### 6. Forward-only and backward-compatible

Additive DDL only: new nullable columns, new tables, new indexes. No drops, no renames, no type changes, no NOT NULL on existing columns. An older API build keeps running against the new schema — it simply ignores the new columns — which is what makes the deploy rollback-safe.

### 7. Recognition and subscription columns are inert

`verified` and `topPro` keep their values and their meaning (display). `subscriptionTier` and the recognition flags are written with defaults and read by nothing that authorizes. [ADR 0006](0006-provider-capability-service.md)'s service never reads any of them; a test asserts that flipping every one of them changes no capability.

## Compatibility window and exit

| Phase          | Legacy column                                | New axes                                     |
| -------------- | -------------------------------------------- | -------------------------------------------- |
| Sprint 7 (now) | authoritative                                | written, read-only, inert                    |
| Sprint 8       | authoritative                                | verification flow populates axis 2           |
| Sprint 9       | mirror                                       | **authoritative** once grants are backfilled |
| Sprint 10+     | dropped, after one release with zero readers | authoritative                                |

The exit condition for dropping the column is _observed_, not scheduled: no code path reads it and no dashboard queries it. Deleting it on a date is how a reporting job breaks in a quarter-end.

## Consequences

**Good** — no existing read breaks; `ACTIVE` stops implying verification the moment the axes exist; conflicts surface as a report instead of being normalised away; the backfill is inspectable before it runs and safe to re-run; rollback is "stop reading the new columns".

**Costs / risks**

- **Two representations at once.** Genuinely dangerous: a writer that updates one and not the other creates drift. Mitigated by keeping the legacy column authoritative (so drift cannot cause a wrong authorization decision this sprint) and by a reconciliation report that can be re-run at any time to detect it.
- **`LEGACY_APPROVED` providers are unverified by definition.** When verification becomes required for work access, every one of them needs a grant or they lose access. That is a migration Sprint 9 must plan for deliberately — it is the single largest operational risk this ADR creates, and it is created knowingly, because the alternative is pretending they were verified.
- **The backfill is not transactional across the whole table.** It runs in bounded chunks so it cannot hold a long lock on a hot table; a crash mid-run leaves it partially applied, which is safe precisely because it is idempotent and only fills NULLs.
- Conflict rows stay conflicted until a human acts. They are counted in the report, not fixed by it.
