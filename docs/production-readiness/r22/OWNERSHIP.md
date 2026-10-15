# R22 corrective follow-up ownership

The owner requested execution/review of R22 on 2026-10-15. PR #158 is already
merged; the existing coordinator approval, G0 base and owned roots are recorded
in IMPLEMENTATION.md section 1. This follow-up keeps the same sprint and branch.
It does not reopen G0 or import another lane. The exact correction scope is:

- `apps/api/src/infrastructure/outbox/outbox.worker.ts`
- `apps/api/src/infrastructure/outbox/outbox.worker.spec.ts` (new, within the
  already approved colocated unit-test root)
- `apps/api/src/infrastructure/outbox/outbox.handler.ts`
- `apps/api/test/integration/r22-outbox-reliability.integration.spec.ts`
- `docs/production-readiness/r22/OWNERSHIP.md`
- `docs/production-readiness/r22/IMPLEMENTATION.md`
- `docs/production-readiness/r22/ACCEPTANCE.md`
- `docs/production-readiness/r22/RISKS.md`
- `docs/production-readiness/r22/ROLLBACK.md`
- `docs/production-readiness/r22/HANDLER_REGISTRATION_CONTRACT.md`

No shared file lease is used. CR-01 through CR-05 remain requests to the
coordinator; this task does not grant operational replay permissions or edit
schema, migrations, configuration, CI, Docker, telemetry or domain modules.

Inspection HEAD: `79617ff051efa69e49a4c7b8f4c446e9b04f3510`.
G0 base: `059c018576a75837d4dfb262ee49168d9217d881`.
The owned implementation matches current develop at
`af662586a640e41d8438d0cb2dd69e8cbb0e172a` before this follow-up.

Because GitHub cannot reopen a merged PR, any corrective publication needs a
single follow-up Draft PR using the same R22 branch and referencing #158.
It is not a new sprint, and neither PR is merged by this task.
