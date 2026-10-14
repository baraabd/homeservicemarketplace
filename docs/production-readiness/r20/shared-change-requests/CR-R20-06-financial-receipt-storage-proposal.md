# CR-R20-06 — PROPOSAL: financial receipt storage on the existing restricted port

**Status: POLICY_BLOCKED.** No receipt feature exists in code or schema, and
R16 payout policy plus R18 finance decisions are owner-blocked. Nothing here
is implemented beyond proving the transport can carry it.

**Proposal.**

| Aspect        | Proposal                                                                                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport     | `RESTRICTED_OBJECT_STORAGE` (same port, same adapters). No second transport, no URL-producing method.                                                                                                                                               |
| Key           | `finance/receipts/<hmac-owner-ref>/<uuid>.<ext>` — server-minted; never `verification/`.                                                                                                                                                            |
| Bucket        | The restricted bucket initially; a dedicated finance bucket is an owner decision (separate KMS key, retention).                                                                                                                                     |
| Authorization | A new permission (e.g. `finance:receipt:view`) resolved fresh per request. **Not** `verification:evidence:view`, not attached to a verification case, and not granted to all finance users by default.                                              |
| Read          | API-mediated, `private, no-store`, `nosniff`, attachment, audited (own audit type), size-checked via `openReadStream(key, { sizeBytes })`.                                                                                                          |
| Retention     | A finance hold owned by the finance domain. Identity erasure **cannot** touch it: `eraseObject` refuses any key outside `verification/` (proven against real storage). No lifecycle rule expires it (validator-enforced for the restricted bucket). |
| IAM           | Add `finance/receipts/*` Put/Get to the API role only when the feature is approved; a finance-retention worker statement only with an approved retention policy. Today both roles are **denied** (proven).                                          |

**Evidence today (emulator).** `r20-s3-storage.integration.spec.ts`: a
receipt-shaped object round-trips through the restricted adapter with an
integrity-checked read, `eraseObject` refuses it, anonymous GET is 403, and
the plan's API/worker roles cannot read it.

**Owner decisions required.** Whether receipts are stored at all; bucket and
key separation; retention period and holds; who may view.
