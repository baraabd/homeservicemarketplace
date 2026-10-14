# CR-R21-02 — register the provider-status email outbox handler

| Field     | Value                                                               |
| --------- | ------------------------------------------------------------------- |
| Path      | `apps/api/src/app.module.ts` (coordinator-owned; not leased to R21) |
| Requested | 2026-10-13, R21                                                     |
| Blocks    | email for provider verification correction / outcome                |
| Migration | none (uses R21's EmailDelivery tables) · Dependency: none           |

## Reason

`ProviderStatusEmailHandler` (`apps/api/src/infrastructure/mail/`) consumes
the existing `verification.case.action_required | rejected | approved`
outbox events and records a durable, generic email intent in the worker's
transaction. AppModule is the only place allowed to list outbox handlers.
Until registered, the handler is implemented and integration-tested but
**not wired**: providers receive the in-app notification only.

The handler name `provider-status.email.v1` is new, so already-processed
historical events are not replayed (markers are per handler and processed
events are never reclaimed).

## Minimal patch

```diff
+import { ProviderStatusEmailHandler } from './infrastructure/mail/provider-status-email.handler';
 …
       handlers: [
         …
         NotificationCreatedHandler,
+        // R21 — email channel for verification corrections and outcomes.
+        ProviderStatusEmailHandler,
       ],
```

No `imports` change: `MailModule` is `@Global` and provides `MAIL_PORT`,
which is the handler's only dependency.

## Tests

- `r21-mail-feedback.integration.spec.ts` › "a correction request becomes
  one generic, bilingual email …" and "a rolled-back worker transaction
  leaves no provider email intent" (real Postgres, handler invoked directly).
- After applying: run `provider-journey.integration.spec.ts` (it drives
  real case transitions through the worker) and confirm one
  `EmailDelivery` row per transition with template
  `provider.verification_*`.
