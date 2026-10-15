// R22 — typed outbox handler failures. See docs/adr/0004-transactional-outbox.md
// and docs/production-readiness/r22/IMPLEMENTATION.md.
//
// A handler communicates exactly one thing by throwing: whether retrying can
// ever help. Everything else (backoff, budget, dead-lettering) is the worker's
// job, so the vocabulary is deliberately two words, not a status code.
//
// Untyped errors stay TRANSIENT. That is the pre-R22 behaviour and the safe
// default: a handler that forgets to classify a failure gets its retry budget,
// not an instant dead letter.

/** Retrying cannot succeed: malformed payload, a referenced row that will never
 *  exist, a policy that rejects the event outright. The worker dead-letters the
 *  event on the first occurrence instead of burning its budget, which also
 *  stops a poison event occupying worker time for minutes of backoff. */
export class OutboxPermanentError extends Error {
  readonly outboxFailure = 'permanent' as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OutboxPermanentError';
  }
}

/** Retrying may succeed: a dependency is down, a lock timed out. Identical to an
 *  untyped throw, except a handler can ask for a longer minimum delay than the
 *  exponential schedule would give (e.g. a vendor's Retry-After). The hint can
 *  only LENGTHEN the wait and is still capped by the retry policy. */
export class OutboxTransientError extends Error {
  readonly outboxFailure = 'transient' as const;

  constructor(
    message: string,
    readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'OutboxTransientError';
  }
}

/** The worker no longer holds the event's lease (it was reclaimed after a
 *  timeout, or released at shutdown). Thrown INSIDE the delivery transaction so
 *  the handler's effects roll back rather than racing the new owner's result.
 *  Never retried by this worker — the new owner is responsible for the event. */
export class OutboxLeaseLostError extends Error {
  constructor(readonly eventId: string) {
    super(`Outbox lease lost for event ${eventId}; the result was discarded`);
    this.name = 'OutboxLeaseLostError';
  }
}

/** A delivery exceeded the worker's per-event deadline. Transient: the
 *  transaction is abandoned and rolled back, and the event is retried with
 *  backoff, so a hung dependency cannot pin one worker forever. */
export class OutboxDeadlineExceededError extends Error {
  constructor(readonly deadlineMs: number) {
    super(`Outbox handler exceeded its ${deadlineMs} ms deadline`);
    this.name = 'OutboxDeadlineExceededError';
  }
}

export type OutboxFailureKind = 'permanent' | 'transient' | 'lease-lost';

/** Classify a thrown value. Duck-typed on `outboxFailure` as well as
 *  `instanceof`, so a domain module bundled with a different copy of this file
 *  (jest module isolation, a future package split) is still classified. */
export function classifyOutboxFailure(err: unknown): OutboxFailureKind {
  if (err instanceof OutboxLeaseLostError) return 'lease-lost';
  if (err instanceof OutboxPermanentError) return 'permanent';
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { outboxFailure?: unknown }).outboxFailure === 'permanent'
  ) {
    return 'permanent';
  }
  return 'transient';
}

/** A handler's minimum retry delay hint, if it supplied a valid one. */
export function retryAfterHintMs(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const hint = (err as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof hint === 'number' && Number.isFinite(hint) && hint > 0 ? hint : undefined;
}
