import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';

/** One handler for one event type.
 *
 *  Contract, in full:
 *
 *  1. `handle` runs INSIDE a transaction that already contains this handler's
 *     idempotency marker. Every side effect that must not happen twice belongs
 *     in that transaction. Effects that leave the database — a realtime
 *     publish, an SMTP send — cannot be transactional; see `afterCommit`.
 *
 *  2. Throwing means "retry me". The transaction rolls back, the marker goes
 *     with it, and the event is rescheduled. A handler that swallows its own
 *     errors converts a retryable failure into silent data loss, which is the
 *     behaviour this whole subsystem replaced.
 *
 *  3. Handlers must tolerate being called for an event they have already
 *     partially processed. The marker prevents a *completed* run from
 *     repeating; it cannot prevent a run that died halfway from being retried.
 */
export interface OutboxHandler {
  /** Stable identity, persisted in OutboxHandlerRun. Renaming it re-runs every
   *  historical event through the "new" handler — treat it as a database
   *  value, not a label. */
  readonly name: string;

  /** Event types this handler consumes. */
  readonly eventTypes: readonly string[];

  /** Transactional work. See the contract above. */
  handle(event: OutboxEvent, tx: PrismaTx): Promise<OutboxHandlerResult | void>;
}

export interface OutboxHandlerResult {
  /** Non-transactional effects to run after the transaction commits.
   *
   *  Realtime publishes and emails belong here, not inside `handle`. Doing
   *  them inside the transaction means a commit failure has already sent the
   *  email — unrecallable — and a slow SMTP server holds a database
   *  transaction open for its whole timeout.
   *
   *  These run at-least-once and are NOT covered by the idempotency marker: a
   *  crash between commit and this callback loses them. That is the deliberate
   *  trade — a duplicate toast is cheap, a held transaction is not — and it is
   *  why anything that must not be lost is written to the database inside
   *  `handle` first, with the external push treated as an accelerator. */
  afterCommit?: () => Promise<void>;

  /** Free-form counters for the worker log line, e.g. `{ recipients: 42 }`. */
  stats?: Record<string, number>;
}
