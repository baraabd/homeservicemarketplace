# K02 — Rollout, rollback and forward repair

## Deploy order

1. Apply migrations (`migrate:deploy`): both K02 migrations are additive and
   touch no existing row. Verified on an upgraded database: pre-K02 rows are
   unchanged (`1000 USD`), receive `amountScale NULL`, the `USD` default is
   gone, 0 acceptance rows are created (`EVIDENCE.md` §Upgrade).
2. Deploy API and web **together**. The bid body and summary shapes changed:
   an old web bundle against a new API gets 400 on bid submission (by design:
   the unit is no longer guessable); a new web bundle against an old API would
   show amounts as "unverified legacy amount" (missing scale is treated as
   unverified) and has no legal-documents endpoint, so signup stays disabled.
3. Production: leave `LEGAL_DRAFT_ACCEPTANCE_ALLOWED` unset → signup closed
   until the owner approves the policy text. Then run
   `market:init:ksa --dry-run`, review, run without `--dry-run` with
   `ALLOW_PROD_MARKET_INIT=true`.

## Rollback

- **Application rollback** to the previous build needs no schema change. The
  pre-K02 application always writes `currency` explicitly (repository
  fallback `'USD'`; bookings copy the bid's), never `amountScale`, so its rows
  land with `amountScale NULL`. They satisfy every K02 CHECK and are correctly
  classified LEGACY_UNVERIFIED when K02 is re-deployed. Its registration
  ignores `legalAcceptance`, so accounts created during a rollback window have
  no acceptance row (honestly "none recorded"; never backfilled).
- Only **raw inserts that omit `currency`** (old test fixtures, ad-hoc SQL)
  relied on the dropped default. If an operator tool needs it during a
  rollback window, restoring it is data-neutral:

  ```sql
  ALTER TABLE "Bid" ALTER COLUMN "currency" SET DEFAULT 'USD';
  ALTER TABLE "Booking" ALTER COLUMN "currency" SET DEFAULT 'USD';
  ```

  Drop the defaults again before re-deploying K02.

- `UserLegalAcceptance` and the new columns can stay in place under the old
  code (it does not read them). Do **not** drop the table: it is consent
  evidence.
- Market registry: revert with `PUT /v1/admin/settings/platform_supported_markets`
  using the previous value recorded in `PlatformSettingHistory`.

## Forward repair for legacy amounts (not executed)

Legacy rows are quarantined, not converted. A reviewed reconciliation would,
per row with provenance, set `currency`/`amountScale` and (only if proven)
convert the integer; it must be a separate, audited, owner-approved script.
No such script is part of K02.
