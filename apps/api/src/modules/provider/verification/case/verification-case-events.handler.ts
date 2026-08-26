import { Injectable, Logger } from '@nestjs/common';
import type { OutboxEvent, PrismaTx } from '@homeservicemarketplace/database';

import { OutboxEventType } from '../../../../infrastructure/outbox/outbox.tokens';
import type { OutboxHandler } from '../../../../infrastructure/outbox/outbox.handler';
import { MetricsService } from '../../../../infrastructure/telemetry/metrics.service';

// Sprint 9B.5 — the consumer for the case workflow events.
//
// It ships WITH the producer, for the reason the evidence-scanned handler
// documents: OutboxWorker DEAD-LETTERS any event type no handler claims, so
// emitting `verification.case.submitted` without a consumer would turn every
// submission into a dead row and a logged error — strictly worse than not
// emitting at all.
//
// What it does today is turn transitions into something an operator can alert
// on. The audit table records WHICH case moved; this records HOW MANY, which is
// the question that matters when the review queue stops draining and the one
// an audit table full of personal data should not be queried to answer.
//
// It is also the seam later sprints hang off. A reviewer-facing "new submission"
// alert, or an SLA timer on ACTION_REQUIRED, attaches here without the workflow
// service needing to know they exist.

const CASE_STATES = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'ACTION_REQUIRED',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
] as const;

interface CaseEventPayload {
  caseId?: unknown;
  toState?: unknown;
}

@Injectable()
export class VerificationCaseEventsHandler implements OutboxHandler {
  /** Persisted in OutboxHandlerRun. A database value, not a label. */
  readonly name = 'verification-case.metrics';
  readonly eventTypes = [
    OutboxEventType.VERIFICATION_CASE_SUBMITTED,
    OutboxEventType.VERIFICATION_CASE_ACTION_REQUIRED,
    OutboxEventType.VERIFICATION_CASE_REJECTED,
  ] as const;

  private readonly log = new Logger(VerificationCaseEventsHandler.name);

  constructor(private readonly metrics: MetricsService) {}

  async handle(event: OutboxEvent, _tx: PrismaTx): Promise<void> {
    const payload = (event.payload ?? {}) as CaseEventPayload;
    const to = payload.toState;

    // Bucketed rather than used directly. A label taken straight from a payload
    // is an unbounded-cardinality hole in the metrics store.
    const label =
      typeof to === 'string' && (CASE_STATES as readonly string[]).includes(to) ? to : 'unknown';

    if (label === 'unknown') {
      // Worth knowing — producer and consumer disagree — but not worth
      // throwing for: a retry cannot make the payload valid, and
      // dead-lettering a state announcement helps nobody.
      this.log.warn({ msg: 'verification.case.unknown_state_in_event' });
    }

    await Promise.resolve();
    this.metrics.verificationCaseTransitionsTotal.inc({ to_state: label });
  }
}
