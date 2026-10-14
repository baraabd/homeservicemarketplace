# R21 — rollback

R21 adds tables and changes how mail is sent; it changes no existing table
and no public response.

## Application rollback (previous image)

1. Deploy the previous API image. The previous code ignores the three new
   tables, and its environment schema (a non-strict `z.object`) drops the
   new keys without error.
2. Effect: auth mail returns to synchronous best-effort send with English
   text; queued R21 intents are not retried by anyone. AUTH intents expire
   on their own lifetime; nothing user-visible depends on them.
3. Remove `MAIL_FEEDBACK_SIGNING_SECRET` from the provider's callback
   configuration (or point it elsewhere) so the provider does not retry
   against a 404.

## Database

- Forward-only. The migration is additive; **do not drop** the tables
  during an application rollback: rows are harmless to the old code, and
  `EmailFeedbackEvent` / `EmailSuppression` are the only record of
  bounces and complaints.
- If the tables must be removed after a permanent revert, do it in a new,
  reviewed forward migration (drop `EmailFeedbackEvent`, `EmailSuppression`,
  `EmailDelivery`, then the four enums), after exporting suppressions.

## Partial switches (no redeploy of code)

| Goal                             | Action                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Stop background retries          | `MAIL_DISPATCHER_ENABLED=false` (first attempt still runs)                                                                  |
| Stop accepting feedback          | unset `MAIL_FEEDBACK_SIGNING_SECRET` (route → 404)                                                                          |
| Lift a wrong suppression         | set `EmailSuppression.liftedAt = now()` for that `recipientHash` (audited operator action; a new verified event re-arms it) |
| Purge queued secrets immediately | `UPDATE "EmailDelivery" SET "status"='EXPIRED', "envelope"=NULL, "outcomeAt"=now() WHERE "status" IN ('QUEUED','SENDING')`  |

## Key rotation

Rotating `MAIL_INTENT_ENCRYPTION_KEY` (or `JWT_ACCESS_SECRET` when no
dedicated key is set) makes queued envelopes undecryptable; they close as
FAILED/undecryptable and users re-request. Rotate during low traffic, or
drain first with `MAIL_DISPATCHER_ENABLED=true` and wait for the QUEUED gauge
to reach zero.
