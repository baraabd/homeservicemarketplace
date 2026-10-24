# G3 rollback

No deployment or merge occurred in this execution. The draft integration branch can be closed without changing develop.

For a later authorized sandbox rollout, first stop new purchase entry and set MONEY_REFUND_AUTHORIZATION_ENABLED=false. Preserve the configuration/credentials needed to resolve already dispatched or UNKNOWN operations until their outcomes are known. Only after draining/reconciling in-flight work may the operator remove MONEY_STRIPE_SANDBOX_JSON to disable Stripe completely. Do not rotate provider idempotency identities to force success.

Roll back application code only after checking new inbox/refund/subscription obligations against the previous composition. The prior module cannot process the new Stripe work: blindly reverting while work is pending is unsafe. Preserve all attempts, approvals, original exception evidence, cursors, decisions, ledger and outbox rows.

The additive migration is forward-only. Do not drop tables, rewrite policy/history, edit confirmed ledger entries, reset databases, flush Redis or delete shared volumes. Correct schema defects with a reviewed additive migration. R34 may resolve/reopen only through its future approved workflow; the dashboard must never insert balancing entries.

Re-run final candidate checks and both sandbox rail journeys after any rollback or corrective change. Restore BLOCKED status and revoke start authorization if accepted source/configuration changes invalidate evidence.
