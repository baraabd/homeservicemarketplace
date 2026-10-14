import { DomainMetricSpecError } from './domain-metrics';
import { MetricsService } from './metrics.service';

describe('domain metric extension interface', () => {
  it('registers a counter whose labels are bounded to the declared values', async () => {
    const metrics = new MetricsService();
    const sent = metrics.domainCounter({
      domain: 'notification',
      name: 'notification_dispatch_total',
      help: 'Notifications dispatched',
      labels: { channel: ['email', 'push', 'in_app'], outcome: ['sent', 'failed'] },
    });
    sent.inc({ channel: 'email', outcome: 'sent' });
    sent.inc({ channel: 'user-42@example.test', outcome: 'sent' });
    const text = await metrics.metrics();
    expect(text).toContain('notification_dispatch_total{channel="email",outcome="sent"} 1');
    expect(text).toContain('notification_dispatch_total{channel="other",outcome="sent"} 1');
    expect(text).not.toContain('example.test');
    expect(text).toContain(
      'telemetry_label_overflow_total{metric="notification_dispatch_total"} 1',
    );
  });

  it('gauges and histograms follow the same bounds and never throw', async () => {
    const metrics = new MetricsService();
    const lag = metrics.domainGauge({
      domain: 'scan',
      name: 'scan_oldest_pending_age_seconds',
      help: 'Age of the oldest pending scan',
    });
    const delay = metrics.domainHistogram({
      domain: 'notification',
      name: 'notification_delivery_delay_seconds',
      help: 'Delay from event to delivery',
      labels: { channel: ['email', 'push'] },
      buckets: [1, 5, 30, 120],
    });
    expect(() => lag.set({}, Number.NaN)).not.toThrow();
    lag.set({}, 42);
    delay.observe({ channel: 'push' }, 3);
    const text = await metrics.metrics();
    expect(text).toContain('scan_oldest_pending_age_seconds 42');
    expect(text).toContain('notification_delivery_delay_seconds_bucket{le="5",channel="push"} 1');
  });

  it.each([
    [{ domain: 'Bad Domain', name: 'x_total', help: 'h' }, /invalid domain/],
    [
      { domain: 'booking', name: 'payment_x_total', help: 'h' },
      /must be snake_case and start with "booking_"/,
    ],
    [{ domain: 'http', name: 'http_custom_total', help: 'h' }, /reserved prefix/],
    [{ domain: 'booking', name: 'booking_created', help: 'h' }, /must end with _total/],
    [{ domain: 'booking', name: 'booking_created_total', help: ' ' }, /needs help text/],
    [
      { domain: 'booking', name: 'booking_created_total', help: 'h', labels: { user_id: [] } },
      /must declare 1–64 values/,
    ],
    [
      { domain: 'booking', name: 'booking_created_total', help: 'h', labels: { kind: ['other'] } },
      /reserved value "other"/,
    ],
    [
      {
        domain: 'booking',
        name: 'booking_created_total',
        help: 'h',
        labels: { a: ['1'], b: ['1'], c: ['1'], d: ['1'], e: ['1'] },
      },
      /more than 4 labels/,
    ],
  ])('rejects an invalid counter spec %#', (spec, message) => {
    const metrics = new MetricsService();
    expect(() => metrics.domainCounter(spec as never)).toThrow(DomainMetricSpecError);
    expect(() => new MetricsService().domainCounter(spec as never)).toThrow(message);
  });

  it('rejects _total on a gauge and duplicate registration', () => {
    const metrics = new MetricsService();
    expect(() =>
      metrics.domainGauge({ domain: 'booking', name: 'booking_open_total', help: 'h' }),
    ).toThrow(/only counters/);
    metrics.domainGauge({ domain: 'booking', name: 'booking_open', help: 'h' });
    expect(() =>
      metrics.domainGauge({ domain: 'booking', name: 'booking_open', help: 'h' }),
    ).toThrow(/already registered/);
  });
});
