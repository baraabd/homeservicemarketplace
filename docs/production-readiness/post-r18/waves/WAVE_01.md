# Wave 1 — preparation (G0)

Prepared on 2026-10-13 by the coordination session for the repository
owner. G0 is not acceptance of any Wave 1 work.

## Frozen base

`059c018576a75837d4dfb262ee49168d9217d881` = `develop` after PR #155 (R18)
merged. All seven post-merge workflows on it succeeded:

| Workflow                             | Run         | Conclusion |
| ------------------------------------ | ----------- | ---------- |
| CI                                   | 38271429057 | success    |
| CodeQL                               | 38271428645 | success    |
| Production governance                | 38271428642 | success    |
| Real application startup performance | 38271428720 | success    |
| Web development startup              | 38271428656 | success    |
| Authentication lifecycle acceptance  | 38271428662 | success    |
| Staging release boundary             | 38271428582 | success    |

The base excludes PR #156, the unmerged native-development hotfix. Lanes on
Windows may need that hotfix's recovery steps until it merges. It is not
imported into any lane, and it keeps no sprint number.

Toolchain at the base: Node 24.21.0 and pnpm 10.32.1 (`package.json`
`engines` and `packageManager`). No lane changes a global toolchain.

## Integration

- Integration branch: `integration/wave-01`, created from the frozen base
  when the first lane PR is ready for the gate. No lane writes to it.
- Merge owner: the repository owner. Merges go through the approved PR
  process only, with no auto-merge.
- Gate G1 is a gate, not a sprint number.

## Contract freeze (input to Wave 1)

Wave 1 consumes the **current source** at the frozen base. No earlier wave
publishes ports. The money authority Wave 1 starts from:

- **R15 ledger.** `LedgerAccount`, `LedgerTransaction`, `LedgerEntry`;
  migration `20261004150000_r15_ledger_foundation`; `apps/api/src/modules/money/`.
- **Money contracts.** `packages/contracts/src/money/index.ts`.
- **R17 outbox and notifications.** Kept as they are.

The Wave 1 gate (G1) publishes R19's versioned contracts and its additive
persistence as the input frozen for Wave 2.

## Lanes

| Lane | ID      | State                    | Why                                               |
| ---- | ------- | ------------------------ | ------------------------------------------------- |
| 1    | R19     | READY_TO_START           | prompt provided; allowlist and schema lease below |
| 2–5  | R20–R23 | BLOCKED: package missing | `SPRINT_PLAN.json` and lane prompts not provided  |

Wave 1 is ready only for R19. Wave 1 cannot pass G1 until its other four
lanes are defined, or the owner reduces the wave to R19 in the registry.

## File ownership and leases (Wave 1)

| Path                                                                                           | Writer      | Basis                                                                               |
| ---------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| R19 `ownedPaths` in `SPRINT_REGISTRY.json`                                                     | R19         | registry                                                                            |
| `packages/database/prisma/schema.prisma`, a new `migrations/*_r19_*/` directory                | R19         | **exclusive schema lease**, until G1; additive only; no applied migration is edited |
| every other coordinator-owned path (`.github/scripts/sprint-registry.mjs` `COORDINATOR_OWNED`) | coordinator | change request in `docs/production-readiness/r19/shared-change-requests/`           |

## Runtime plan (R19)

| Resource   | Value                                                                           |
| ---------- | ------------------------------------------------------------------------------- |
| Worktree   | `../HSM-r19`, branch `feat/r19-money-authority-contracts`, from the frozen base |
| PostgreSQL | its own container `hsm-r19-pg`, `127.0.0.1:55110`, disposable databases only    |
| Redis      | its own container `hsm-r19-redis`, `127.0.0.1:55111`                            |
| Browser    | none (no UI in R19)                                                             |
| Secrets    | none copied; no `.env` from another checkout                                    |

Collision checks:

- Ports 55110 and 55111 are outside Windows' reserved range 55249–56148.
- Neither port is used by the user's containers (`hsm-postgres` 5432,
  `hsm-redis` 6379, `hsm-mailpit` 1025/8025, `hsm-mongo` 27017).
- The user's running API (4000) and web (5173) are not touched.
