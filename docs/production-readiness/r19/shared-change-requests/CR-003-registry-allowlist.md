# CR-003 — R19 allowlist corrections in the registry

- **Path:** `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`, R19
  `ownedPaths`. The file is coordinator-owned; it is on the G0 PR.
- **Status:** REQUESTED; the coordinator applies it on the G0 branch.
- **Patch.**
  - Add the prefix `apps/api/src/modules/money/domain/`. It is the ownership
    root the R19 prompt proposes; the directory did not exist at the base.
  - Add the prefix `apps/api/test/unit/r19-`: the contracts package has no
    test runner, so the contract tests run in the API's Jest.
  - Add the prefix
    `docs/production-readiness/r19/contract-fixtures/` (already covered by
    `docs/production-readiness/r19/`; listed for clarity).
  - Record a lease limited to the CR-001 case in
    `apps/api/test/integration/r15-ledger.integration.spec.ts`.
- **Why.** The prompt's proposed roots and the real tree differed. The
  validator refuses a write outside an owned path.
- **Owner:** coordinator.
