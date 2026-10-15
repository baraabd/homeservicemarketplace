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
 *
 *  4. (R22) Classify failures. Throw `OutboxPermanentError` when retrying can
 *     never help — the event is dead-lettered at once instead of burning its
 *     budget. Anything else, including `OutboxTransientError` (which may carry
 *     a bounded retry-after hint), is retried with capped exponential backoff.
 *
 *  5. (R22) Stay inside the delivery deadline. Each delivery runs under a
 *     transaction timeout and a worker deadline (OUTBOX_DELIVERY_DEADLINE_MS in
 *     outbox.worker.ts). Work that cannot finish in that window belongs in a
 *     chunked follow-up event (see request-available.batch), not a longer
 *     transaction.
 *
 *  6. (R22) The worker commits PROCESSED in the SAME transaction as the
 *     handler's effects, fenced on its lease. A delivery whose lease was lost
 *     rolls back entirely; handlers never check ownership themselves.
 *
 *  The registration contract for money, webhook and subscription handlers is
 *  docs/production-readiness/r22/HANDLER_REGISTRATION_CONTRACT.md. In short:
 *  the domain's own idempotency key (ledger posting key, provider webhook
 *  event id, subscription period) is enforced by a unique constraint written
 *  in `handle`'s `tx`. The outbox marker is a second line of defence, never
 *  the only one, because a renamed handler or a replayed event re-runs it.
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
   *  These are best-effort accelerators, not durable delivery: a crash after
   *  commit or a publication deadline can lose them. All callbacks for one
   *  event share a separate OUTBOX_DELIVERY_DEADLINE_MS budget. A failure
   *  never retries committed effects. On expiry, later callbacks are not
   *  started, even if the stalled callback eventually settles.
   *
   *  A Promise timeout cannot cancel arbitrary I/O. Transports must bound
   *  their own requests and tolerate late completion. Anything that must not
   *  be lost belongs in durable state inside `handle`, with its own delivery
   *  protocol; the callback alone is not a notification or payment guarantee. */
  afterCommit?: () => Promise<void>;

  /** Free-form counters for the worker log line, e.g. `{ recipients: 42 }`. */
  stats?: Record<string, number>;
}

/** Handler names are persisted marker keys: `<domain>.<purpose>[.vN]`, lower
 *  case. Bounded so they stay low-cardinality metric/log values too. */
const HANDLER_NAME = /^[a-z0-9][a-z0-9._-]{2,79}$/;

/** R22 — reject a handler set that would silently lose work.
 *
 *  Run once when the worker is constructed, so a bad registration fails the
 *  boot instead of failing quietly in production:
 *
 *    * Two handlers with the SAME name share one idempotency marker, so for an
 *      event both consume, whichever runs second is skipped forever.
 *    * A handler with no event types never runs.
 *    * A name outside the pattern is either a typo or a value that would leak
 *      unbounded cardinality into logs and metrics.
 *
 *  Returns the problems rather than throwing, so tests can assert on them. */
export function validateHandlerRegistry(handlers: readonly OutboxHandler[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const handler of handlers) {
    if (!HANDLER_NAME.test(handler.name)) {
      problems.push(`handler name "${handler.name}" does not match ${HANDLER_NAME}`);
    }
    if (seen.has(handler.name)) problems.push(`duplicate handler name "${handler.name}"`);
    seen.add(handler.name);
    if (handler.eventTypes.length === 0) {
      problems.push(`handler "${handler.name}" consumes no event types`);
    }
    if (new Set(handler.eventTypes).size !== handler.eventTypes.length) {
      problems.push(`handler "${handler.name}" lists an event type twice`);
    }
  }
  return problems;
}
