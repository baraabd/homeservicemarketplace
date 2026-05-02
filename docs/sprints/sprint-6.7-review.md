# Sprint 6.7 Review Report — Admin Runtime Harness + Newman

## 1. Planning Summary

- **Scope:** Bundle the per-sprint Admin Postman scaffolding into
  a single end-to-end runnable; add a Newman runner script + a
  harness guide.
- **Existing:** `postman/hsm-admin.postman_collection.json` already
  has folders 00 → 70 from Sprints 6.0 → 6.6. Only the runner
  script + the runtime guide were missing.

## 2. Implementation Summary

- **Files added:**
  - `docs/testing/admin-runtime-harness.md` — runtime guide:
    prerequisites, env setup, what each folder covers, what's not
    covered, troubleshooting.
- **Files changed:**
  - `package.json` — added `pnpm postman:admin` script (Newman +
    `--bail` + htmlextra reporter writing to
    `postman/reports/admin.html`).
- **Migrations:** none.
- **Contracts:** none.
- **UI:** none.
- **API endpoints:** none — Sprint 6.7 is harness-only.

## 3. Automated Tests

| Check                                                 | Result                          |
| ----------------------------------------------------- | ------------------------------- |
| `pnpm --filter @homeservicemarketplace/api typecheck` | pass                            |
| `pnpm --filter @homeservicemarketplace/api test`      | unchanged from 6.6 — 637 passed |
| `pnpm --filter @homeservicemarketplace/web test`      | unchanged from 5.6 — 295 passed |

## 4. Postman Tests

- Cumulative admin story (8 folders; total 17+ requests).
- The `pnpm postman:admin` runner picks up the same
  `postman/local.postman_environment.json` (gitignored) the provider
  harness uses and writes its HTML report to
  `postman/reports/admin.html` (also gitignored — added in Sprint 5.7).

## 7. Remaining Issues

- See `docs/testing/admin-runtime-harness.md §4` for the explicit
  list of what's not covered.

## 8. Sprint Decision

**PASS** — Continue automatically. The admin chapter is closed.
