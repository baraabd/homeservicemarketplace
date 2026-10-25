# R34 — Remaining holds after merged G3 source integration

Inspection source: `c9de08d07b12871db8801fb9662b14de83a2c391`.
The Stripe runtime/purchase composition, refund implementations, reconciliation
schema and V2 action types are now present. The earlier claims that these
foundations were absent are superseded; their external acceptance is still open.

| Blocker                                       | Current evidence                                                                                                                                 | Owner and closing condition                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| G3 acceptance and publication                 | BLOCKED; seven categories NOT_RUN; candidate/frozen identities null; publication NOT_PREPARED                                                    | Coordinator gathers exact-source evidence; owner reviews/merges the separate acceptance record; coordinator verifies publication.   |
| R34 exact runtime assignment                  | Wave 4 BLOCKED; R34 not startable; no active session or runtime lease; readiness exits 1                                                         | Coordinator issues the named assignment and exact allowlist only after verified G3 publication.                                     |
| Commercial/refund inputs                      | Concrete fail-closed policy/participant code exists; valid approved plan/refund inputs were not supplied or exercised here                       | Product/policy owner supplies immutable rules, amount/currency/plan binding and explicit suspend-or-cancel entitlement consequence. |
| Independent sandbox evidence                  | No authorized provider account configuration, authentic forwarding or external statement execution supplied to this session                      | Authorized operator supplies time-bounded test configuration and runs the full G3 external/browser/failure matrix.                  |
| Reconciliation implementation and integration | Persistence/types exist, but worker/statement reader/operator service are absent; R33 still exposes unavailable status and no executable actions | R34 implements after release; coordinator serializes CR-001 SDK/reporting/contract/UI/mount/CI work.                                |
| Exact-source security and hosted evidence     | Observed merge has successful Actions analysis, no distinct official security-result check, and a queued Vercel suite                            | Preserve exact-source CI/CodeQL distinctions; hosting owner supplies in-scope hosted evidence separately.                           |

An independently inspected source path or a successful documentation check does
not establish an actual payment, settlement, refund, policy approval or workflow
acceptance. Null matched/unmatched and severity counts mean NOT_MEASURED.
Do not record a successful empty reconciliation when its provider is unavailable.

Preserve the R15 immutable balanced ledger and R16/R18 unresolved decisions.
Subscription revenue is not withdrawable provider earnings. No supported market,
price, currency scale, fee/tax, payout, verification or work-access policy is
selected. Live rails remain off. No ledger balancing write, automatic external
correction, database reset, shared Redis flush or historical-evidence rewrite
is introduced by this documentation update.
