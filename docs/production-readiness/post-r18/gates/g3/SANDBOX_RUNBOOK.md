# G3 independent sandbox evidence and publication handoff

Status: **BLOCKED pending supplied authority and actual execution**. This runbook
does not grant G3 acceptance or an R34 implementation lease. The canonical
requirements are [REQUIREMENTS.md](REQUIREMENTS.md); the decision is
[SOURCE_MANIFEST.json](SOURCE_MANIFEST.json).

## 1. Supply the bounded test-account inputs

Use an already authorized Stripe test account and a dedicated local test
environment. The runner creates a new isolated PostgreSQL database and synthetic
actors; it does not import existing customers or alter an application database.
Do not paste credentials into the PR, evidence, shell history or chat. Supply
them through the authorized secret environment.

| Input                                                   | Required meaning                                                                                                                                                                                                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONEY_STRIPE_SANDBOX_JSON`                             | The strict existing R29 configuration: enabled test secret, authentic listener signing secret, exact account reference, expiry within 24 hours, signature tolerance and one explicit immutable plan/account/currency binding. |
| `MONEY_STRIPE_PUBLISHABLE_KEY`                          | Test publishable key from the same authorized account.                                                                                                                                                                        |
| `MONEY_REFUND_AUTHORIZATION_ENABLED=true`               | Explicitly permits new reservations in this disposable test environment.                                                                                                                                                      |
| `NODE_ENV=test`, `APP_ENV=test`, `RUN_DB_INTEGRATION=1` | Explicit test-only execution scope.                                                                                                                                                                                           |
| `DATABASE_URL`                                          | Dedicated loopback PostgreSQL bootstrap connection; the fixture creates and migrates its own database. Use the existing non-superuser fixture-owner pattern.                                                                  |
| `REDIS_URL` or `REDIS_HOST` plus `REDIS_PORT`           | Dedicated loopback Redis connection. The fixture uses database 12 and unique limiter namespaces; it never flushes Redis.                                                                                                      |
| Approved input JSON outside the repository              | Scope, expiry, maximum test amount, approved immutable plan, actual refund rules/consequence and bounded webhook forwarding settings described below.                                                                         |

The exported `G3ExternalInput` in
`apps/api/test/support/g3-stripe-external.fixture.ts` is the exact input contract.
The runner rejects missing and extra top-level fields. It requires:

- `schemaVersion: 1`, a real `approvalReference`, an expiry within 24 hours,
  `authorizeSandboxOperations: true` and `authorizeDisposableFixtures: true`.
- A positive exact integer `maxSandboxAmountMinor` as a decimal string, an
  explicit `webhookForwardPort` between 1024 and 65535, a
  `webhookTimeoutSeconds` between 10 and 180, and
  `testPaymentMethod: "pm_card_visa"`.
- `plan`: exact `id`, `planKey`, positive `version`, `billingInterval`,
  `priceMinor`, `currency`, nonempty approved `entitlements`, `publishedAt` and
  `approvalReference`. The approved amount cannot exceed the supplied bound.
- `refundPolicy`: `rules`, `approvedAt`, `validFrom`, `validUntil` and an
  explicit `entitlementEffect` of `SUSPEND_SUBSCRIPTION` or
  `CANCEL_SUBSCRIPTION`. The runner must not choose that commercial consequence.
- The existing strict R32 `rules` fields: `version`, `approvalReference`,
  `mode: "SANDBOX"`, `planVersionId`, `method: "STRIPE"`, `currency`,
  `reasonCodes`, `refundWindowSeconds`, `allowPartial`,
  `requireRequesterReviewerSeparation`, `requireOriginalReviewerSeparation`,
  `feeTreatment: "NO_DEDUCTION"`, `taxTreatment: "NO_ADJUSTMENT"`,
  `proRataTreatment: "NONE"` and `entitlementPolicyVersion`.

The plan, policy and single Stripe binding must match exactly. Binding fields
include `planVersionId`, `method`, `currency`, `adapterId: "hsm.stripe.v1"`,
`mode: "SANDBOX"`, `accountReference`, distinct `debitAccountId` and
`creditAccountId`, `configVersion` and `quoteTtlSeconds`. Policy timestamps must
establish current approved authority. The synthetic structural example in
`verify-external.test.cjs` tests validation only; copying it does not establish
approval, a supported market, an external account or a successful run.

## 2. Verify source, tools and authentic webhook forwarding

Use the exact committed candidate with a clean worktree and no `.env` files in
the root, API, web or database package. Use the repository pins, Node 24.21.0 and
pnpm 10.32.1. Install the frozen dependencies, generate Prisma and build the
database/contracts packages with normal scripts. Keep raw input and output
outside the repository.

The authorized operator starts Stripe's real listener before running the
evidence command. Replace the port with the supplied input's exact port:

```bash
stripe listen \
  --events=payment_intent.succeeded \
  --forward-to http://127.0.0.1:<webhookForwardPort>/v1/money/webhooks/stripe
```

Use that listener's signing secret in the approved environment. The snapshot
event version must match this repository's pinned `2026-09-30.endive`. Stripe's
CLI normally uses the account's default version; `--latest` is a moving target,
and an arbitrary `listen --api-version` flag is not documented. An incompatible
account/listener stays blocked until the authorized operator establishes the
matching version. Do not silently change account settings or register a new
dashboard endpoint. The CLI does not require a dashboard endpoint to receive
events. References: [official listen options](https://docs.stripe.com/cli/listen),
[webhook versioning](https://docs.stripe.com/webhooks/versioning) and
[raw-body signature verification](https://docs.stripe.com/webhooks).

The local bridge forwards untouched bytes and the provider's signature to the
actual application route. No generated test signature, `stripe trigger`
fixture or fabricated internal success event may replace this delivery.

## 3. Execute the external HTTP/database lifecycle

With the approved input and secret environment already supplied:

```bash
node scripts/production/stripe-sandbox/verify-external.cjs \
  --input /absolute/approved-g3-input.json \
  --output /absolute/evidence/g3-external-new.json
```

The output path must be new and outside the repository. Exit 0 means the 14
named `G3_EXTERNAL_STRIPE_HTTP_DATABASE_LIFECYCLE` checkpoints passed. Exit 2
means BLOCKED or FAILED. Read the actual status and counts; an output file's
existence is not evidence of success.

The checkpoints verify the real account, registered money implementations,
server price/ownership/current permission, stable collection retries, real
payment, authentic durable inbox ingestion, raw-body tampering and concurrent
replay, activation transaction rollback/recovery, fresh-login entitlement,
approved refund/outbox reservation, actual remote refund with a local
consequence failure, query recovery without a second provider refund, and the
final entitlement/outbox consequence. Independent SDK account/payment/refund
queries verify the external observations. Injected PostgreSQL trigger failures
are confined to the newly created disposable database and are labeled
transaction-failure evidence.

The report records exact source/tree, input/configuration hashes, ordered
scenario counts and hashed provider identities. It never records credentials,
client secrets, session cookies or raw provider responses. Even a successful
report retains `sandboxAccepted: false` and `g3Accepted: false`: the remaining
evidence and coordinator review are separate requirements.

If a remote operation may exist when execution fails, the runner retains the
isolated database and emits its generated `retainedDatabase` name with
`recoveryRequiredBeforeCleanup: true`. Preserve that database and its original
dispatch identities. Retention preserves durable evidence; this runner does not
implement a `--resume` mode or recreate its process-local synthetic login secrets.
An authorized operator must reconcile the actual external outcome and recover
the original request before deciding on cleanup. Do not
rerun under new operation keys to hide an unknown result. Do not treat a local
ledger reversal as proof that the provider returned funds.

## 4. Complete the other required evidence on the same source

| Evidence                        | Existing execution path and remaining work                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Combined checks                 | Run all required final-source workflows, preserve their complete inventories and artifacts, inspect official CodeQL's security-result check with zero annotations, and verify the source archive/tree. A green job from a different SHA cannot be reused.                                                                                                                                                           |
| Actual manual rail              | Existing R30 CI runs its original 16 real-service cases and bilingual browser scenarios. The additional G3 report must contain exactly 6 passed and zero skipped/failed cases, including actual ClamAV and real activation/refund/outbox participants. Operator settlement data remains labeled simulation unless supported by separately approved evidence.                                                        |
| Subscription and finance routes | Existing R31/R33 real API/browser workflows cover plan, entitlement and finance behavior. Inspect their screenshots and reports for English/Arabic, RTL, required widths, zoom, keyboard and permission/relogin behavior. They do not establish a real Payment Element payment.                                                                                                                                     |
| Actual Payment Element          | On this same approved sandbox configuration, run the purchase through My Plan with `VITE_STRIPE_SANDBOX_ENABLED=true`, verify the enforced CSP, complete the real test payment in the official element and observe server-confirmed activation. Capture redacted UI evidence at the required languages/viewports. The new external runner confirms through the SDK and explicitly excludes this browser claim.      |
| R29 external failure cases      | Complete the original R29 cases for authentication/action-required, cancellation, decline, async pending, distinct events/out-of-order delivery, failure before durable inbox commit, actual process interruption after durable commit and timeout after remote success. Preserve genuine external event/operation identities and original outbound keys. A transaction trigger failure is not a process-kill test. |
| R32 ambiguity and concurrency   | Combine the real transport evidence with reservation/permission/currency/concurrency and query-before-retry evidence; inspect compensation, subscription effect and outbox atomicity. The new runner's remote-refund/local-failure case covers one concrete recovery boundary, not every R32 requirement.                                                                                                           |
| R34-specific reconciliation     | Its missing-webhook external reconciliation, settlement windows/workers and resolve/reopen UI behavior belong to R34 after the start gate. The current additive schema and action contract do not claim those execution routes are implemented.                                                                                                                                                                     |

Use the complete seven-category matrix in REQUIREMENTS.md when deciding
acceptance. Do not collapse browser, provider, process-crash, manual and
infrastructure observations into one unqualified pass. Hosted acceptance is a
separate in-scope release requirement; a local sandbox report does not claim a
hosted deployment and generic hosting credentials do not replace Stripe proof.

## 5. Publish verified G3 before releasing R34

After all required observations pass on one exact source/tree, the coordinator
records the seven PASS categories with artifact references, SHA-256 digests,
positive artifact/run IDs, actual R29-R33 source/merge identities, complete
checks and registered participant evidence in the canonical manifest. Any
source change requires repeating affected evidence and final-source checks.

Prepare the separate acceptance publication with the tested frozen SHA. Obtain
the required owner approval, merge that publication through its normal gate and
independently verify its distinct commit. Only then record
`publication.state: "MERGED"` and `verifiedMerge: true`, align the Wave 4
plan/registry to the frozen source, and issue the named session assignments and
exact nonoverlapping path leases.

Run both checks without altering their validators:

```bash
node .github/scripts/g3-record.mjs --check
node .github/scripts/g3-record.mjs --ready R34
```

R34 may start only when the second command succeeds on the actual published
record. Until then, retain BLOCKED, null frozen source and conditional leases.
Live money, deployment, payout, account grants and existing R16/R18 policy
holds remain under their separate authorities.
