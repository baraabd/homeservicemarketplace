# R19 — Rollback

## CR-004 corrective rollback

Revert the corrective code commit if necessary. Only the canonical-input
validation changes; no database migration, configuration switch or data repair
is needed. Reverting restores the demonstrated ambiguity, so keep new/untrusted
consumers disabled until a safe replacement is reviewed. Never recompute
historical request digests or change posted ledger rows to force a replay.

## Original foundation rollback

- **Code.** Revert the R19 PR. The activation service has no caller, and no
  route or flag exists, so nothing in the product changes behavior.
- **Schema.** The migration is expand-only. Prefer the previous compatible
  application version while retaining the additive tables. Any forward repair
  that removes R19 objects requires inspection of current consumers/data and
  an explicit owner-approved retention decision first. The original migration
  created 11 tables and 9 enums; this is not authorization to drop them or their
  trigger functions now. Never edit or delete the applied migration file.
- **Data.** None is created by the migration. Rows written later by a live
  caller would need an owner-approved retention decision before any drop.
  Money rows are append-only by design.
- **R15.** Untouched, except the re-scoped test assertion (CR-001). Reverting
  it while another suite writes the ledger would make CI order-dependent
  again.
