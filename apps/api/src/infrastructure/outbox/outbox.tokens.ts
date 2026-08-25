/** DI token for the handler list.
 *
 *  A token rather than a direct array import so domain modules can contribute
 *  handlers without the worker importing every domain module — which would
 *  make infrastructure depend on the modules that depend on it.
 */
export const OUTBOX_HANDLERS = Symbol('OUTBOX_HANDLERS');

/** Event type names. Persisted in the OutboxEvent.eventType column, so these
 *  are DATABASE VALUES: renaming one strands every unprocessed row of the old
 *  name with no handler, and the worker will dead-letter them. Add new names;
 *  do not repurpose old ones. */
export const OutboxEventType = {
  /** A request was created and should be fanned out to matching providers.
   *  Consumed by the dispatcher, which resolves recipients and emits slices. */
  REQUEST_AVAILABLE: 'request.available',
  /** One bounded slice of fan-out recipients. Emitted by the dispatcher. */
  REQUEST_AVAILABLE_BATCH: 'request.available.batch',
  /** Sprint 9B.4 — a restricted evidence scan reached a terminal answer.
   *  Emitted in the SAME transaction as the state change, so a crash cannot
   *  leave a document quarantined with nothing announcing it. */
  EVIDENCE_SCANNED: 'evidence.scanned',
} as const;

export type OutboxEventTypeName = (typeof OutboxEventType)[keyof typeof OutboxEventType];
