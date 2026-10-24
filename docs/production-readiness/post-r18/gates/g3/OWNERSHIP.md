# G3 integration ownership

Status: coordinator-approved implementation lease; G3 acceptance remains BLOCKED.

The user explicitly commissioned the coordinator to complete the G3 blockers on 2026-10-24. This dedicated worktree uses `coord/g3-wave4-start-gate` at `73a4a64a77844db7815466f47d8afdefb0b35c2f`. All R29–R33 changes consumed here are already merged ancestors of that base. No peer branch is imported.

The exact single-writer allowlist is [evidence/ALLOWLIST.json](evidence/ALLOWLIST.json). The coordinator approves these paths before implementation; additions require a recorded extension before editing. Previous sprint evidence remains historical. R34/R35 application implementation leases remain conditional on a genuinely accepted, published G3 source.

The lease covers composition, additive schema/contracts and their tests. It does not authorize a commercial refund policy, permission grants, production configuration, external spend, merge, deployment or live money activation.

## Dependency comparison controls

The coordinator also authorizes one detached disposable control worktree at the registered prior R27 baseline `462418888be76ec642664ea77971da9239ffb02a`. Its exact write set is `apps/api/package.json`, `apps/web/package.json`, `package.json`, and `pnpm-lock.yaml`. It receives the candidate dependency blobs only, keeps an independent installation, and runs normal commit hooks. No runtime source or peer branch is imported. The companion repair control is a dependency-only ancestor of this integration branch. Both controls are published as Git objects for CI verification; neither is a product sprint or merge request.
