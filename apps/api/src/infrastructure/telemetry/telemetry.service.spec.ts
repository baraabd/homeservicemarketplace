import { MetricsService } from './metrics.service';
import type { FinishedSpan, SpanExporter } from './span-pipeline';
import { TelemetryService } from './telemetry.service';
import { currentTraceContext, runWithTraceContext, startTraceContext } from './trace-context';

class MemoryExporter implements SpanExporter {
  readonly spans: FinishedSpan[] = [];
  async export(spans: readonly FinishedSpan[]) {
    this.spans.push(...spans);
  }
}

function setup() {
  const metrics = new MetricsService();
  const telemetry = new TelemetryService(metrics);
  return { metrics, telemetry };
}

async function value(metrics: MetricsService, name: string, labels: Record<string, string> = {}) {
  const m = await metrics.registry.getSingleMetric(name)!.get();
  const match = m.values.find((v) =>
    Object.entries(labels).every(([k, val]) => (v.labels as Record<string, unknown>)[k] === val),
  );
  return match?.value ?? 0;
}

describe('TelemetryService.recordHttp', () => {
  it('records count and duration by method, route pattern and status', async () => {
    const { metrics, telemetry } = setup();
    telemetry.recordHttp(
      { method: 'get', route: '/v1/x/:id', status: 200, durationSeconds: 0.02 },
      undefined,
      0,
    );
    expect(
      await value(metrics, 'http_requests_total', {
        method: 'GET',
        route: '/v1/x/:id',
        status: '200',
      }),
    ).toBe(1);
    const durations = (
      await metrics.registry.getSingleMetric('http_request_duration_seconds')!.get()
    ).values;
    const count = durations.find(
      (v) =>
        (v as { metricName?: string }).metricName === 'http_request_duration_seconds_count' &&
        v.labels.route === '/v1/x/:id',
    );
    expect(count?.value).toBe(1);
  });

  it('bounds high-cardinality input: 10 000 distinct routes produce at most 401 series', async () => {
    const { metrics, telemetry } = setup();
    for (let i = 0; i < 10_000; i += 1) {
      telemetry.recordHttp(
        { method: 'BREW', route: `/r/${i}`, status: 1234, durationSeconds: 0 },
        undefined,
        0,
      );
    }
    const series = (await metrics.registry.getSingleMetric('http_requests_total')!.get()).values;
    expect(series.length).toBeLessThanOrEqual(401);
    expect(series.every((s) => s.labels.method === 'other' && s.labels.status === 'other')).toBe(
      true,
    );
    expect(
      await value(metrics, 'telemetry_label_overflow_total', { metric: 'http_requests_total' }),
    ).toBe(9_600);
  });

  it('a throwing metric never reaches the caller and is counted', async () => {
    const { metrics, telemetry } = setup();
    jest.spyOn(metrics.httpRequestsTotal, 'inc').mockImplementation(() => {
      throw new Error('registry broken');
    });
    expect(() =>
      telemetry.recordHttp(
        { method: 'GET', route: '/x', status: 200, durationSeconds: 0 },
        undefined,
        0,
      ),
    ).not.toThrow();
    expect(await value(metrics, 'telemetry_instrumentation_errors_total')).toBe(1);
  });
});

describe('TelemetryService.runInstrumentedJob', () => {
  it('runs the job in its own trace and records success', async () => {
    const { metrics, telemetry } = setup();
    const traceId = await telemetry.runInstrumentedJob(
      'outbox.tick',
      async () => currentTraceContext()?.traceId,
    );
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(
      await value(metrics, 'background_job_runs_total', {
        job_name: 'outbox.tick',
        outcome: 'success',
      }),
    ).toBe(1);
    expect(
      await value(metrics, 'background_job_last_success_unixtime', { job_name: 'outbox.tick' }),
    ).toBeGreaterThan(0);
  });

  it('rethrows the job error unchanged and records failure without a last-success update', async () => {
    const { metrics, telemetry } = setup();
    const boom = new Error('job failed');
    await expect(
      telemetry.runInstrumentedJob('sweep', async () => Promise.reject(boom)),
    ).rejects.toBe(boom);
    expect(
      await value(metrics, 'background_job_runs_total', { job_name: 'sweep', outcome: 'failure' }),
    ).toBe(1);
    expect(
      await value(metrics, 'background_job_last_success_unixtime', { job_name: 'sweep' }),
    ).toBe(0);
  });

  it('collapses an invalid job name into "other"', async () => {
    const { metrics, telemetry } = setup();
    await telemetry.runInstrumentedJob('user 42 / a@b.co', async () => undefined);
    expect(await value(metrics, 'background_job_runs_total', { job_name: 'other' })).toBe(1);
  });

  it('job still runs when instrumentation itself is broken', async () => {
    const { metrics, telemetry } = setup();
    jest.spyOn(metrics.backgroundJobRunsTotal, 'inc').mockImplementation(() => {
      throw new Error('broken');
    });
    await expect(telemetry.runInstrumentedJob('j', async () => 'done')).resolves.toBe('done');
  });
});

describe('TelemetryService.callDependency', () => {
  it('records outcome and passes the result through', async () => {
    const { metrics, telemetry } = setup();
    await expect(telemetry.callDependency('smtp', 'send', async () => 'ok')).resolves.toBe('ok');
    expect(
      await value(metrics, 'dependency_call_duration_seconds', {
        dependency: 'smtp',
        operation: 'send',
        outcome: 'success',
      }),
    ).toBeGreaterThanOrEqual(0);
    const series = (
      await metrics.registry.getSingleMetric('dependency_call_duration_seconds')!.get()
    ).values;
    expect(
      series.some(
        (s) =>
          s.labels.outcome === 'success' &&
          (s as { metricName?: string }).metricName?.endsWith('_count') &&
          s.value === 1,
      ),
    ).toBe(true);
  });

  it('classifies timeouts and rethrows the original error', async () => {
    const { metrics, telemetry } = setup();
    const err = Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' });
    await expect(
      telemetry.callDependency('storage', 'put_object', async () => Promise.reject(err)),
    ).rejects.toBe(err);
    const series = (
      await metrics.registry.getSingleMetric('dependency_call_duration_seconds')!.get()
    ).values;
    expect(
      series.some(
        (s) =>
          s.labels.outcome === 'timeout' &&
          (s as { metricName?: string }).metricName?.endsWith('_count') &&
          s.value === 1,
      ),
    ).toBe(true);
  });

  it('never records a URL or id passed as an operation name', async () => {
    const { metrics, telemetry } = setup();
    await telemetry.callDependency(
      'storage',
      'https://bucket/u/123?X-Amz-Signature=abc',
      async () => undefined,
    );
    const text = await metrics.metrics();
    expect(text).not.toContain('X-Amz');
    expect(text).toContain('operation="other"');
  });

  it('emits a client span that is a child of the active trace, with error class only', async () => {
    const { telemetry } = setup();
    const exporter = new MemoryExporter();
    telemetry.enableSpanExport(exporter, { scheduleDelayMs: 1 });
    const parent = startTraceContext({ kind: 'server', sampleRatio: 1 });
    class SmtpAuthError extends Error {
      override name = 'SmtpAuthError';
    }
    await runWithTraceContext(parent, () =>
      telemetry
        .callDependency('smtp', 'send', async () => {
          throw new SmtpAuthError('535 auth failed for password=hunter2');
        })
        .catch(() => undefined),
    );
    await telemetry.spanPipeline!.flush();
    expect(exporter.spans).toHaveLength(1);
    const [s] = exporter.spans;
    expect(s.traceId).toBe(parent.traceId);
    expect(s.parentSpanId).toBe(parent.spanId);
    expect(s.kind).toBe('client');
    expect(s.status).toBe('error');
    expect(s.attributes['error.type']).toBe('SmtpAuthError');
    expect(JSON.stringify(s)).not.toContain('hunter2');
    await telemetry.onApplicationShutdown();
  });
});

describe('load overhead (recorded in evidence, generous bound to avoid flakes)', () => {
  it('instrumenting one request costs well under a millisecond on average', () => {
    const { telemetry } = setup();
    const n = 20_000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i += 1) {
      telemetry.recordHttp(
        { method: 'GET', route: `/v1/r/${i % 50}`, status: 200, durationSeconds: 0.01 },
        undefined,
        0,
      );
    }
    const perCallUs = Number(process.hrtime.bigint() - t0) / 1_000 / n;
    console.log(`R23_OVERHEAD recordHttp per call: ${perCallUs.toFixed(2)} µs over ${n} calls`);
    expect(perCallUs).toBeLessThan(1_000);
  });
});
