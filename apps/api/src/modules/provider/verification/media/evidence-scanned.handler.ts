import { Injectable, Logger } from '@nestjs/common';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';

import { OutboxEventType } from '../../../../infrastructure/outbox/outbox.tokens';
import type { OutboxHandler } from '../../../../infrastructure/outbox/outbox.handler';
import { MetricsService } from '../../../../infrastructure/telemetry/metrics.service';
import { TERMINAL_SCAN_STATES, type PersistedScanState } from './scan-decision';

// Sprint 9B.4 — the consumer for `evidence.scanned`.
//
// This handler exists for two reasons, and it is worth being explicit about
// both rather than letting it look like an empty shell.
//
// FIRST, it makes the event safe to emit. OutboxWorker DEAD-LETTERS any event
// type no handler claims. Emitting `evidence.scanned` without a consumer would
// therefore turn every scan into a dead row and a logged error — strictly worse
// than not emitting at all. A producer and a consumer ship together or neither
// ships.
//
// SECOND, it turns scan outcomes into something an operator can alert on. The
// audit table records WHICH document; this records HOW MANY, which is the
// question that matters at 3am ("are we quarantining everything since the
// signature update?") and the one an audit table full of personal data should
// not be queried to answer.
//
// It is deliberately the extension seam for later sprints. Notifying a provider
// that their document was rejected, or moving a case to ACTION_REQUIRED, are
// workflow decisions Sprint 9B.5 owns; they hang off this event without the
// scan service needing to know they exist.

/** What the scan service puts on the event. Ids and a state — never a storage
 *  key, a filename, a hash or a signature. */
interface EvidenceScannedPayload {
  assetId?: unknown;
  caseId?: unknown;
  scanState?: unknown;
}

@Injectable()
export class EvidenceScannedHandler implements OutboxHandler {
  /** Persisted in OutboxHandlerRun. A database value, not a label: renaming it
   *  re-runs every historical event through the "new" handler. */
  readonly name = 'evidence-scanned.metrics';
  readonly eventTypes = [OutboxEventType.EVIDENCE_SCANNED] as const;

  private readonly log = new Logger(EvidenceScannedHandler.name);

  constructor(private readonly metrics: MetricsService) {}

  async handle(event: OutboxEvent, _tx: PrismaTx): Promise<void> {
    const payload = (event.payload ?? {}) as EvidenceScannedPayload;
    const state = payload.scanState;

    // An unrecognised state is counted under a fixed bucket rather than used
    // as a label. Labels come from a payload, and a payload that could invent
    // label values is an unbounded-cardinality hole in the metrics store.
    const label = typeof state === 'string' && isTerminal(state) ? state : ('unknown' as const);

    if (label === 'unknown') {
      // Worth knowing about — it means a producer and this consumer disagree —
      // but not worth throwing for: retrying cannot make the payload valid,
      // and dead-lettering a scan announcement helps nobody.
      this.log.warn({ msg: 'evidence.scan.unknown_state_in_event' });
    }

    this.metrics.evidenceScanOutcomesTotal.inc({ state: label });
  }
}

function isTerminal(value: string): value is PersistedScanState {
  // SCAN_FAILED is not terminal in the state model, but it IS a terminal answer
  // for one attempt, and it is the outcome an operator most wants to alert on.
  return (TERMINAL_SCAN_STATES as readonly string[]).includes(value) || value === 'SCAN_FAILED';
}
