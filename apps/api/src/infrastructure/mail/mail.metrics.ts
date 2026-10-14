import { Injectable } from '@nestjs/common';
import { Counter, Gauge } from 'prom-client';

import { MetricsService } from '../telemetry/metrics.service';

// R21 — delivery telemetry, registered on the existing MetricsService registry
// so it is served by the same guarded /metrics endpoint. Labels are fixed,
// low-cardinality vocabularies: never an address, template variable, message
// id or driver message.
@Injectable()
export class MailMetrics {
  /** outcome: accepted | transient | config (retry scheduled) | permanent |
   *  exhausted | suppressed | expired | undecryptable | throttled */
  readonly attemptsTotal: Counter<'category' | 'outcome'>;
  /** kind: delivered | bounce_permanent | bounce_transient | complaint;
   *  result: applied | duplicate | unmatched */
  readonly feedbackTotal: Counter<'kind' | 'result'>;
  /** reason: signature | stale | malformed | disabled */
  readonly feedbackRejectedTotal: Counter<'reason'>;
  readonly queueDepth: Gauge<'status'>;

  constructor(metrics: MetricsService) {
    const registers = [metrics.registry];
    this.attemptsTotal = new Counter({
      name: 'mail_delivery_attempts_total',
      help: 'Outbound mail delivery attempts by category and outcome',
      labelNames: ['category', 'outcome'],
      registers,
    });
    this.feedbackTotal = new Counter({
      name: 'mail_feedback_events_total',
      help: 'Verified provider delivery feedback events by kind and result',
      labelNames: ['kind', 'result'],
      registers,
    });
    this.feedbackRejectedTotal = new Counter({
      name: 'mail_feedback_rejected_total',
      help: 'Delivery feedback requests rejected before processing',
      labelNames: ['reason'],
      registers,
    });
    this.queueDepth = new Gauge({
      name: 'mail_delivery_queue_depth',
      help: 'EmailDelivery rows by status',
      labelNames: ['status'],
      registers,
    });
  }
}
