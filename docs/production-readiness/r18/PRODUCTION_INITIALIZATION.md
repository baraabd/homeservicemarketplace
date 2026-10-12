# R18 — Production initialization and first administrator

Rehearsed on 2026-10-11 on a disposable local PostgreSQL 16 container
(empty database `prodinit`), source
`release/r18-closure-rc1@711fd921052a33b77102a613ccef141a0c899f75`. This is a
local rehearsal, not a hosted one. It used no shared or production database.

## What production needs before the first user

| Item                          | Supported path                                                                                                     | Rehearsed                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Schema                        | migrator image, `prisma migrate deploy` (forward-only)                                                             | yes: 67 migrations applied                                |
| Roles, permissions, catalogue | `pnpm --filter @homeservicemarketplace/database seed` with `NODE_ENV=production ALLOW_PROD_SEED=true`              | yes: 3 roles, 33 permissions, 6 categories                |
| No demo data                  | the seed skips dev users, the provider pool (fixed on this branch), the placeholder policy and the market registry | yes: 0 users, 0 provider profiles, 0 policies, 0 settings |
| First administrator           | `grant:admin <email> --create-if-missing` with `NODE_ENV=production ALLOW_PROD_GRANT=true`                         | yes: see below                                            |
| Supported markets             | `PUT /v1/admin/settings/platform_supported_markets` (validated, history, audit)                                    | no (needs the running API and an admin session)           |
| Verification policy           | `POST /v1/admin/verification/policies` (restricted permission, audited)                                            | no (needs the owner's real requirements)                  |
| Dispute policy (D-3)          | `PUT /v1/admin/settings/disputes.*`                                                                                | no (owner decision pending)                               |
| Work-access readiness (D-19)  | `work-access:readiness` (read-only)                                                                                | yes: 0 working providers, ready                           |

Before this branch, the production seed also upserted five invented ACTIVE
provider profiles, some flagged verified and Top Pro. The seed is the only
path that creates roles and permissions, so initializing production would
have published fake providers. Commit `eb3431b` skips the pool in production,
and a unit test pins it.

## First-administrator bootstrap (rehearsed)

| Step                                                                                           | Observed                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Run `grant:admin first-admin@example.test --create-if-missing` with `NODE_ENV=production` only | refused: "Refusing to run an access-grant routine in production without ALLOW_PROD_GRANT=true" (exit 1)                               |
| Same with `ALLOW_PROD_GRANT=true`                                                              | creates one ACTIVE, email-verified, **passwordless** user with the `customer` and `admin` roles                                       |
| Audit                                                                                          | exactly one `ROLE_ASSIGNED` row `{roleName: admin, actorSystem: operator-cli:grant-admin, userCreated: true}` (added on this branch)  |
| Re-run                                                                                         | nothing attached, nothing audited (idempotent)                                                                                        |
| Fresh sign-in                                                                                  | **not rehearsed**: the account has no password, so the first sign-in is a password reset by email, which needs the hosted SMTP sender |

Procedure proposed for the owner (`OWNER_DECISIONS.md`, D-8):

1. Choose the exact account email (a role mailbox the owner controls).
2. Run the grant once from the operator host. Keep `ALLOW_PROD_GRANT` only
   in that shell session, never in a deployed environment.
3. Sign in through "forgot password", then enable the second factor if the
   owner requires it.
4. Read the audit row back (`GET /v1/admin/audit`).
5. Grant the second administrator through the reviewed AdminAccessRequest
   flow, not the CLI.
6. Close the temporary access: record the ticket and confirm that no further
   CLI grant was made.

## Gaps that remain

- **No least-privilege admin role.** The `admin` role holds every seeded
  permission, and no API grants the `dispute:*` permissions. Today they can
  only be granted by direct SQL, which is an owner decision (D-4/D-5).
- **Roles come from the seed, not from a reviewed reference-data
  migration.** It is idempotent, upsert-only and production-guarded, but a
  migration would make it part of the release artifact. This is a P2
  follow-up.
- **Stale operator docs.** `docs/architecture/identity-role-app-context.md`
  §137-170 names a `grant:admin-provider` script that no longer exists.
