# R29 risks and precise blockers

| Risk / blocker                                                                     | State                    | Owner and required closure                                                                                                      |
| ---------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Application does not mount R29 or route ports to Stripe                            | INTEGRATION_PENDING      | Coordinator applies CR-001/002/003 under serialized ownership, then tests the actual AppModule                                  |
| SDK manifest/lockfile concurrently owned by PR #192                                | INTEGRATION_PENDING      | Dependency owner hands off exact files; coordinator pins Stripe without importing an unmerged peer                              |
| Zod advisory GHSA-mrhx-c7xc-m3w5 in two existing full-tree paths                   | SECURITY_BLOCKED         | Dependency owner supplies a reviewed compatible fix; zero-finding audit remains mandatory                                       |
| Hosted Checkout versus Elements purchase surface is not selected                   | POLICY_BLOCKED           | Owner/coordinator records approach and approves any additive URL/client-secret UI contract                                      |
| No assigned real Stripe test account/credentials/endpoint                          | EXTERNAL_BLOCKED         | Authorized owner supplies time-bounded test credentials and exact account/endpoint; no account creation/eligibility bypass      |
| Real sandbox collections/refunds, missed webhooks and external statements untested | EXTERNAL_BLOCKED         | Execute authentic provider flows and source-bound integrated evidence; doubles and synthetic signatures cannot close this       |
| R32 commercial policy and confirmed-refund consequence remain unavailable          | POLICY_BLOCKED           | Policy owner and coordinator provide approved policy and entitlement consequence                                                |
| Local executor has root-only UID mapping, no PostgreSQL/Redis/Docker binaries      | EXTERNAL_BLOCKED locally | Isolated CI or approved disposable service environment runs the six new real-persistence cases                                  |
| Source is not hosted or release-accepted                                           | INTEGRATION_PENDING      | Coordinator repeats changed workflows on the combined candidate, final CI/official CodeQL, then separate owner release decision |

R16 and R18 unresolved decisions remain unchanged. Subscription revenue is not
provider withdrawable earnings. No payout, escrow, fee/tax model, production
currency/market, verification decision or work-access change is included.

The 23-hour replay stop deliberately favors manual reconciliation over a duplicate
charge if the provider prunes idempotency keys. Unknown refund lookup scans at
most 1,000 objects; an incomplete scan is UNKNOWN, never failed/absent. Expiring
credentials can pause receipt/recovery until the authorized same account and
immutable configuration are renewed. Unsupported event versions/types fail
closed and require explicit integration review. No cross-mode fallback exists.

Worker success counts represent local processing attempts, not independent
settlement reconciliation. Financial matched/unmatched counts and exception
severity are NOT_MEASURED for real sandbox/hosted operation. No screenshot was
produced or inspected; no UI change is claimed.
