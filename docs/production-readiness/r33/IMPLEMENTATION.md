# R33 — Financial read models and operations UI

R33 adds a read-only financial operations surface for platform subscriptions, separate from the existing booking reports. It reuses the accepted R24 ledger/query authority and adds bounded projections of actual payment intents, attempts, refund requests, refunds and subscription periods. Settlement reporting and the R30/R31/R32/R34 integrations remain explicitly unavailable until their accepted integration.

Implementation and source verification are distinct from combined-wave, vendor-sandbox, hosted and release acceptance. Executed checks and remaining evidence are recorded in [ACCEPTANCE.md](ACCEPTANCE.md). No approval to merge, deploy, move live funds, grant real accounts permissions, change verification decisions or choose a money policy is inferred.

## Source and ownership

- Sprint / branch: `R33` / `feat/r33-financial-operations-ui`.
- Frozen G2 execution source: `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`.
- Frozen tree: `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`.
- Verified owner-merged publication: `986b4707776711e80564f0642133ede90ba16f3c`, PR #183, tree `7ab683ea8c5304929a2fa51f1dc824c7cb46f7d5`.
- G2's frozen source is unchanged. Its owner-merged publication contains only the 13 reviewed documentation/evidence changes relative to the frozen source. R33 records the actual completed merge and assigns this lane after canonical readiness; other lanes remain unassigned/held.
- [OWNERSHIP.md](OWNERSHIP.md) records the exact exclusive writer assignments and serialized coordinator leases before edits. [CR-001](shared-change-requests/CR-001-integration.md) describes every shared patch.
- [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) binds the implementation bytes, test artifacts and non-secret environment. The final containing commit/tree and current final-head workflow/artifact IDs are recorded in the PR body after publication, avoiding a self-referential commit hash inside its own tree.

No schema, migration, dependency, lockfile, environment schema, permission seed, pricing, payout or peer-lane implementation changes are part of this sprint.

## Existing financial surfaces inspected

| Existing authority / surface                                        | Finding                                                                                                                                                                                                 | R33 treatment                                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/admin/financials/admin-financials.service.ts` | Historical fields such as `totalRevenue`, `totalProviderEarnings` and constant-zero `totalRefunds` derive from booking aggregation and configured fee math. They are not collection or refund evidence. | Do not consume these fields for the new reports.                                                                                                          |
| `apps/web/src/app/components/admin/FinancialsSection.tsx`           | R18 labels these as completed/unfinished booking values, discloses untracked refunds and removes implied approved fees or a measured balance.                                                           | Preserve its wording and behavior; add one separate operations link in the coordinator-owned route content.                                               |
| `apps/web/src/app/components/provider/screens/WalletScreen.tsx`     | The actual extracted screen reads booking-based earnings/chart/transactions. R18 labels booking values and keeps withdrawals disabled.                                                                  | Preserve the screen and disabled withdrawal control; add a separate subscription history link. The old proposed root path is not the implementation path. |
| R24 `MoneyModule` / `MoneyQueryService`                             | Registered financial/ledger projection authority, current role/permission checks, versioned money wire values and reconciliation exception reads already exist.                                         | Import/reuse this module and its query service. Do not replace the `MONEY_FINANCE_READ` binding or create a second ledger authority.                      |
| R16 payout policy / R18 blockers / `docs/money/LIVE_MONEY_GATE.md`  | Marketplace funds, supported markets/currencies, display precision, fees and production activation remain separate decisions.                                                                           | Keep these holds; subscription receipts never imply provider withdrawable earnings, identity verification or work access.                                 |

## API and financial meaning

`FinancialReportingModule` is mounted additively after `MoneyModule`. Every route is GET-only, private/no-store and protected by the existing JWT, role and permission guards. The service additionally resolves fresh rights and current active, nondeleted base-role membership. Provider queries constrain the current provider profile and owner inside the same database transaction; foreign or missing details return the same not-found response.

| Route                                                | Scope / result                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/v1/money/operations/summary`                       | Admin `money:review:read`; R24 confirmed ledger totals, separate pending/unknown/requested totals, read provenance and reconciliation availability. |
| `/v1/money/operations/records`                       | Same admin scope; kind/currency filters and bounded stable pagination.                                                                              |
| `/v1/money/operations/records/:kind/:id`             | Same scope; redacted financial detail with actual confirmation/posting references.                                                                  |
| `/v1/money/operations/export`                        | Same fresh admin authorization; CSV for only the selected bounded page, with count/continuation headers.                                            |
| `/v1/money/operations/reconciliation`                | Same scope; existing R24 exception projection plus explicit run-status provenance.                                                                  |
| `/v1/money/operations/reconciliation/exceptions/:id` | Same scope; redacted exception detail, no available commands.                                                                                       |
| `/v1/money/history/records`                          | Provider `money:read:self`; owner-constrained records.                                                                                              |
| `/v1/money/history/records/:kind/:id`                | Same provider scope; owner-constrained detail.                                                                                                      |

The provider surface does not call an absent provider summary endpoint. It makes no platform-wide revenue claim.

### Evidence for each amount

- A payment intent's value is an intent total until a matching payment confirmation points to a posted, same-currency, non-booking ledger transaction. Confirmation intent, amount and currency must match. An inconsistent success status is shown as inconsistent, never promoted to confirmed collection.
- An attempt represents the amount attempted. Transport completion or unknown dispatch is not confirmation of collection, even if a later intent confirmation exists.
- Refund requests show the requested amount and a constrained public reason code. Private operator notes, account details, provider payloads and receipt evidence are not selected.
- Refunds remain reserved/unconfirmed unless successful with a posted compensating ledger transaction and a confirmed original collection. No dashboard operation writes compensation.
- A subscription amount comes only from its latest persisted period with payment-confirmation evidence. An entitlement or subscription status alone does not fabricate payment or work eligibility.
- Settlement requests return explicit `UNAVAILABLE` with no records. This is not an empty measured settlement report or a zero settlement total.

All amounts cross the API as canonical integer strings in `MoneyWire`. UI formatting uses `BigInt`, explicit Arabic/English grouping and the record's own currency. Values above the existing signed-64-bit money wire bound fail closed. No `Number` conversion, FX, dominant-currency choice, cents assumption or unapproved decimal scale is introduced. The UI explicitly labels exact stored minor units.

The summary keeps each currency separate. Confirmed collections/refunds retain R24's ledger cutoff; pending obligations have a separately named `pendingAsOf` snapshot. A parameterized latest-attempt lookup counts an intent once; unknown dispatch and pending attempts remain separate. Requested refunds are separately grouped and do not count as confirmed refunds. The two snapshots are not presented as one atomic net balance.

### Pagination, freshness and privacy

Lists default to 20 and allow 1–50 rows. A cursor binds the kind, audience, actor, currency and anchor identity; a foreign, changed-scope, noncanonical or missing anchor is rejected. Ordering is stable by creation time and ID. Pages and details use repeatable-read transactions, bounded selectors and no per-row service calls. Tests inspect actual SQL as well as statement counts; a constant statement count alone does not prove bounded child results.

The additive `hsm.finance-operations.v1` contract extends the unchanged `hsm.money.v1` meaning. Reports include actual read time, authoritative-persistence provenance and no-store policy. Query keys include actor, audience, filters and selected resource. Private client queries have zero retention after unmount, cancellation signals, explicit refresh, periodic revalidation and no blind retries. Permission failures hide previous private results; network errors may show the last successful read only with an explicit stale warning.

CSV selects a closed list of financial fields and omits receipt contents, private notes, emails, bank/account data and raw provider payloads. It removes control/format characters, quotes cells, neutralizes spreadsheet formulas and preserves long integer text. Export remains page-bounded; a continuation header tells the UI when more records remain. An in-flight download is cancelled on actor change or unmount and checked again before creating a file.

## UI, language and accessibility

The public feature exports provide dedicated guarded routes at `/admin/financial-operations` and `/provider/financial-history`. Existing Admin and Provider layouts receive only the two leased navigation links. Provider financial history does not grant onboarding, verification or work access.

Both surfaces use existing language/auth/query/UI primitives. They provide AR/EN text, explicit direction, responsive tables/cards, bounded details, labelled filters, keyboard focus, modal focus return, exact amount semantics, loading/empty/error/denied/stale states and an export confirmation that identifies the selected type, currency and page. No unavailable financial command is rendered as executable; exact-amount/target confirmation for a future refund is an R32 integration requirement, not a fabricated R33 command.

The server reports each integration capability. R30 receipt review, R31 My Plan and R32 refund destinations are unavailable with null URLs until coordinated routes/endpoints are accepted. The UI has the contract and link renderer ready but does not guess links to unmerged source.

Reconciliation distinguishes `NOT_RUN`, `UNAVAILABLE`, `FAILED` and `AVAILABLE`, carrying last-success time/run identity when supported. The default runtime status is unavailable because the accepted source has no R34 run-history authority. Existing exceptions can still be inspected, but an empty list never establishes zero differences. Future exception action request/result types are defined; no action endpoint, manual adjustment or automatic balancing write is registered.

## Verification tooling and CI

`scripts/production/financial-reports/verify-report.cjs` checks one bounded response JSON document offline. It validates versions, exact amount strings, currency segregation, confirmation references, redaction and reconciliation-state consistency. It accepts a direct response or exactly `{ "data": response }`, caps input size at 1 MiB and pages at 50 rows, and outputs only sanitized counts/status. Its label is `WIRE_CONSISTENCY_ONLY`: it cannot prove source authenticity, authorization, persistence or a completed reconciliation.

The dedicated browser spec is excluded only from the mocked suite and explicitly executed in the existing Admin disposable-service job. Existing tests, timeout and security budgets are preserved. A natural 61-second login-window expiry separates independent suites. Exactly three R33 tests must pass on their first attempt; missing, skipped, flaky or interrupted cases fail the count check. Only synthetic PNGs and sanitized counts are uploaded for R33; no browser trace, video, credentials, raw environment or report payload is added to the artifact.

See [ACCEPTANCE.md](ACCEPTANCE.md) for actual executions, corrective failures and evidence boundaries, and [RISKS.md](RISKS.md) for the remaining integration and policy responsibilities.
