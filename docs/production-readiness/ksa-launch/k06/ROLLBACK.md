# K06 rollback and forward repair

## Database

One migration: `20261103090000_k06_support_ticket_experience`.

- **Forward**: `CREATE TYPE "SupportTicketExperience"` and `ALTER TABLE "SupportTicket" ADD COLUMN "experience"`, nullable, no default, no backfill. It is metadata-only on PostgreSQL 16, takes no table rewrite, and is safe online.
- **Rollback of code without the schema**: safe. Pre-K06 code never reads the column, so an older API runs against the migrated database unchanged.
- **Schema rollback** (only if required): `ALTER TABLE "SupportTicket" DROP COLUMN "experience"; DROP TYPE "SupportTicketExperience";`. This loses only the routing hint, and every ticket then links into the customer app. Do not edit or delete the applied migration; add a new forward migration instead.
- No seed, data rewrite or money value is touched.

## Application

| Change                                                                           | Rollback effect                                                                                                                  | Forward repair if a problem appears                                                                                                                         |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CurrentAdminGuard` + fresh `admin:access:grant` + settings in-transaction check | Reverting **reopens the stale-token hole** (a removed admin can mint an admin). Revert only with an alternative control in place | A legitimate admin refused with 403: confirm a live `UserRole` on the `admin` role, account `ACTIVE`/`isActive`, not deleted. That is the intended standard |
| Legacy provider self-decision refusal                                            | Reverting reopens self-approval while enforcement flags are off                                                                  | None expected; non-self decisions are unchanged (phase3/provider-journey suites green)                                                                      |
| Support notifications                                                            | Revert removes notifications; tickets keep working                                                                               | Notification rows are ordinary inbox rows; a wrong row can be soft-deleted by the user                                                                      |
| `/home/support`, `/provider/support`, "Contact support"                          | Revert hides the routes; Profile → Help still works for customers                                                                | Routes have no flag. They are additive and grant nothing                                                                                                    |

No feature flag was added. Every change is on by default once deployed, which is
the intended state for authorization fixes.

## Verification after deploy

1. `GET /health/live` is ok and `/v1/admin/settings` is 200 for a current admin.
2. Remove a test admin's membership out of band: their next `GET /v1/admin/settings` and `POST /v1/admin/access-requests/:id/approve` return 403.
3. An admin with their own provider profile gets 403 `SELF_REVIEW` on `/v1/admin/providers/<own>/approve`.
4. A support reply produces one inbox notification for the requester, linking to `/home/support?ticket=…` or `/provider/support?ticket=…`.
