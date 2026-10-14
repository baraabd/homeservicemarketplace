# CR-002 — Register the subscription activation outbox event

- **Path:** `apps/api/src/infrastructure/outbox/outbox.tokens.ts`
  (`OutboxEventType`), plus a handler module chosen by the subscription and
  notification lane.
- **Status:** REQUESTED, not applied. R19 uses the literal
  `money.subscription.activated.v1` in `SUBSCRIPTION_ACTIVATED_EVENT`.
- **Minimal patch.**
  `MONEY_SUBSCRIPTION_ACTIVATED: 'money.subscription.activated.v1'` in
  `OutboxEventType`. The activation service then imports it instead of the
  literal.
- **Contract.** The payload is identifiers only:
  `{ contractVersion, paymentConfirmationId, subscriptionId, subscriptionPeriodId }`.
  The dedupe key is `money.subscription.activated.v1:<confirmationId>`.
- **Why it is needed.** The outbox worker dead-letters an event type with no
  handler. That is harmless while nothing calls the activation unit, but
  required before the first live caller.
- **Compatibility.** The value is a database value; it must never be renamed
  once rows exist.
- **Tests.** A handler test in its lane; R19's suite already asserts one
  event per confirmation.
- **Owner:** coordinator, with the notification lane.
