# R19 — Rollback

- **Code.** Revert the R19 PR. The activation service has no caller, and no
  route or flag exists, so nothing in the product changes behavior.
- **Schema.** The migration is expand-only. Once it is applied, roll back by
  a forward repair migration that drops the 11 tables, their trigger functions
  (`money_*`, `subscription_*`, `provider_subscription_guard`) and the 9
  enums. No pre-existing table, column or row depends on them. Never edit or
  delete the applied migration file.
- **Data.** None is created by the migration. Rows written later by a live
  caller would need an owner-approved retention decision before any drop.
  Money rows are append-only by design.
- **R15.** Untouched, except the re-scoped test assertion (CR-001). Reverting
  it while another suite writes the ledger would make CI order-dependent
  again.
