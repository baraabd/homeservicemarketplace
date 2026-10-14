# R21 — ownership allowlist and leases

Sprint: R21 Production email delivery and durable feedback (legacy P46)
Branch: `feat/r21-email-production` · worktree `../HSM-r21`
Base: `059c018576a75837d4dfb262ee49168d9217d881` (origin/develop, 2026-10-13)

## Base and start barrier

No G0 gate artifact, frozen wave manifest or pre-created R21 branch existed in
the repository or on `origin` when this sprint started (`git branch -r`,
`git log --all --grep=G0`, `docs/production-readiness/` inspected 2026-10-13).
The owner, acting as coordinator, approved `origin/develop@059c018` as the
frozen base in-session on 2026-10-13. This file records that approval; it is
not a G0 acceptance certificate.

## Exclusive allowlist (sprint-owned)

| Path                                      | Kind                                    |
| ----------------------------------------- | --------------------------------------- |
| `apps/api/src/infrastructure/mail/**`     | existing module, extended               |
| `apps/api/test/integration/r21-*.spec.ts` | new sprint-dedicated integration specs  |
| `infra/production/email/**`               | new: sender-domain and acceptance guide |
| `scripts/production/email/**`             | new: operator acceptance tooling        |
| `docs/production-readiness/r21/**`        | evidence                                |

## Leases (coordinator-owned paths, granted in-session 2026-10-13, owner-confirmed 2026-10-14)

Each lease is single-writer for this wave, minimal in scope and listed in
`IMPLEMENTATION.md` with its exact diff.

| Path                                                                              | Scope of lease                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`                                          | add EmailDelivery / EmailSuppression / EmailFeedbackEvent models and enums only |
| `packages/database/prisma/migrations/20261013120000_r21_email_delivery/`          | one new forward migration                                                       |
| `apps/api/src/config/env.schema.ts`                                               | mail keys only (`SMTP_*` timeouts, `MAIL_*`)                                    |
| `apps/api/src/modules/iam/authentication/services/authentication.service.ts`      | record a durable mail intent instead of sending inline                          |
| `apps/api/src/modules/iam/authentication/services/authentication.service.spec.ts` | follow the above                                                                |

Not leased, therefore requested through `shared-change-requests/`:
`apps/api/src/main.ts` (raw body for the signed feedback route) and
`apps/api/src/app.module.ts` (register the provider-status email outbox handler).

## Lease conflict with R19 (recorded 2026-10-14)

The coordinator's `WAVE_01.md` gives R19 an exclusive `schema.prisma` lease,
and the coordinator registry records no R21 lease. On 2026-10-14 the owner
confirmed the R21 leases above. The owner also chose to keep them on this
branch and to treat the overlap as a G1 merge item, not to withdraw them.
The overlap is additive and disjoint; see
`shared-change-requests/CR-R21-04-g1-schema-overlap-with-r19.md`. R21 does
not import or depend on R19's branch.
