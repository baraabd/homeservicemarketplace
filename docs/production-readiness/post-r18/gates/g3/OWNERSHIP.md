# G3 integration ownership

Status: coordinator-approved implementation lease; G3 acceptance remains BLOCKED.

The user explicitly commissioned the coordinator to complete the G3 blockers on 2026-10-24. This dedicated worktree uses `coord/g3-wave4-start-gate` at `73a4a64a77844db7815466f47d8afdefb0b35c2f`. All R29–R33 changes consumed here are already merged ancestors of that base. No peer branch is imported.

The exact single-writer allowlist is [evidence/ALLOWLIST.json](evidence/ALLOWLIST.json). The coordinator approves these paths before implementation; additions require a recorded extension before editing. Previous sprint evidence remains historical. R34/R35 application implementation leases remain conditional on a genuinely accepted, published G3 source.

The lease covers composition, additive schema/contracts and their tests. It does not authorize a commercial refund policy, permission grants, production configuration, external spend, merge, deployment or live money activation.

## Dependency comparison controls

The coordinator also authorizes one detached disposable control worktree at the registered prior R27 baseline `462418888be76ec642664ea77971da9239ffb02a`. Its exact write set is `apps/api/package.json`, `apps/web/package.json`, `package.json`, and `pnpm-lock.yaml`. It receives the candidate dependency blobs only, keeps an independent installation, and runs normal commit hooks. No runtime source or peer branch is imported. The companion repair control is a dependency-only ancestor of this integration branch. Both controls are published as Git objects for CI verification; neither is a product sprint or merge request.

## Payment Element document policy extension

Before editing, the coordinator extends the single-writer lease to `scripts/production/security-app/web-csp.cjs` and its existing `verify-boundaries.test.cjs`. The explicit sandbox build option must preserve the default restrictive policy and cannot enable live payments or arbitrary host configuration. Vite already consumes this builder, so no parallel policy or edge entrypoint is introduced.

## 2026-10-24 CI repair and independent sandbox runner extension

Before these edits, the owner-delegated G3 coordinator extends the exact lease
to `scripts/production/stripe-sandbox/verify-external.cjs`, its
`verify-external.test.cjs`, and
`apps/api/test/support/g3-stripe-external.fixture.ts`. The runner must retain the
actual AppModule and money implementations, use explicitly authorized test-only
Stripe configuration and an authentic signed webhook forwarder, and import only
explicitly approved policy data into a newly created disposable database. Missing
inputs remain BLOCKED. No external signature, approval, grant in an existing
database, or passing sandbox result may be fabricated.

The coordinator also leases this gate's `REQUIREMENTS.md`,
`SANDBOX_RUNBOOK.md`, and `evidence/PR_REPAIR_2026-10-24.json` to correct the
historical-state description, document a runnable operator handoff, and retain
actual CI repair results. Existing frozen-base, publication and lane-readiness
requirements remain unchanged. The checkout contrast repair stays within the
existing StripePlanPurchase component lease.

The coordinator additionally leases `.github/workflows/ci.yml` before adding the
G3 concrete manual integration spec to the existing R30 real-services job. That
job already owns disposable PostgreSQL/Redis, private storage and actual ClamAV.
The existing required jobs, scenario counts and zero-failure/zero-skip assertions
remain enforced. No gate, timeout or security default is relaxed.

## Concrete refund transaction ordering repair

Before the repair, the coordinator leases
`apps/api/src/modules/money/application/money-command.service.ts` and its
`money-command.service.spec.ts`. The concrete R31 refund participant validates
the successful refund row and its compensating posting inside the caller's
transaction; the existing orchestrator called it before assigning those fields.
The fix must preserve one transaction and roll back the refund state, ledger,
entitlement consequence, audit and outbox together on any participant failure.
No transport, eligibility, authorization, policy or financial finality check may
be bypassed. The assembled real-infrastructure regression owns the integration
proof.
