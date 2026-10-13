import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  OtlpHttpJsonExporter,
  SpanPipeline,
  sanitizeSpanAttributes,
  startSpan,
  type DropReason,
  type FinishedSpan,
  type SpanExporter,
} from './span-pipeline';
import { startTraceContext } from './trace-context';

jest.setTimeout(20_000);

interface OtlpBody {
  resourceSpans: {
    resource: { attributes: unknown[] };
    scopeSpans: {
      spans: {
        traceId: string;
        kind: number;
        startTimeUnixNano: string;
        endTimeUnixNano: string;
      }[];
    }[];
  }[];
}

function span(i = 0): FinishedSpan {
  return {
    traceId: 'a'.repeat(32),
    spanId: i.toString(16).padStart(16, '0').replace(/^0/, '1'),
    parentSpanId: null,
    name: 'GET /x',
    kind: 'server',
    startTimeMs: 1_700_000_000_000,
    durationMs: 12.5,
    status: 'ok',
    attributes: { 'http.route': '/x' },
  };
}

function counters() {
  const dropped: Record<string, number> = {};
  const failures: Record<string, number> = {};
  let exported = 0;
  return {
    dropped,
    failures,
    get exported() {
      return exported;
    },
    hooks: {
      onDropped: (r: DropReason, n: number) => (dropped[r] = (dropped[r] ?? 0) + n),
      onExportFailure: (r: string) => (failures[r] = (failures[r] ?? 0) + 1),
      onExported: (n: number) => (exported += n),
    },
  };
}

/** A local OTLP collector double with switchable behaviour. */
async function collector(behaviour: { mode: 'ok' | 'fail' | 'slow' }) {
  const received: unknown[] = [];
  const headers: IncomingMessage['headers'][] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      headers.push(req.headers);
      if (behaviour.mode === 'fail') {
        res.writeHead(503, { 'content-type': 'text/plain' }).end('collector down, echo: ' + body);
        return;
      }
      if (behaviour.mode === 'slow') {
        setTimeout(() => res.writeHead(200).end('{}'), 2_000);
        return;
      }
      received.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    received,
    headers,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

describe('SpanPipeline bounds', () => {
  it('drops (and counts) spans beyond the queue limit instead of growing', async () => {
    const c = counters();
    const never: SpanExporter = { export: () => new Promise(() => undefined) };
    const p = new SpanPipeline({
      exporter: never,
      maxQueueSize: 10,
      maxBatchSize: 10_000,
      exportTimeoutMs: 50,
      scheduleDelayMs: 60_000,
      hooks: c.hooks,
    });
    for (let i = 0; i < 1_000; i += 1) p.onEnd(span(i));
    // One batch of 10 is in flight, at most 10 wait; the other 980 are dropped.
    expect(p.queued).toBeLessThanOrEqual(10);
    expect(c.dropped.queue_full).toBeGreaterThanOrEqual(980);
    await p.flush();
  });

  it('a slow exporter is cut off at the timeout and the batch is dropped', async () => {
    const c = counters();
    const slow: SpanExporter = { export: () => new Promise((r) => setTimeout(r, 5_000)) };
    const p = new SpanPipeline({
      exporter: slow,
      exportTimeoutMs: 50,
      failureBackoffMs: 0,
      hooks: c.hooks,
    });
    p.onEnd(span(1));
    const t0 = Date.now();
    await p.flush();
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(c.failures.timeout).toBe(1);
    expect(c.dropped.export_failed).toBe(1);
    expect(p.queued).toBe(0);
  });

  it('an exporter that ignores the abort signal still cannot hold the drain loop', async () => {
    const c = counters();
    const deaf: SpanExporter = { export: () => new Promise(() => undefined) };
    const p = new SpanPipeline({ exporter: deaf, exportTimeoutMs: 30, hooks: c.hooks });
    p.onEnd(span(1));
    await p.flush();
    expect(c.failures.timeout).toBe(1);
  });

  it('backs off after a failure, then recovers', async () => {
    let now = 0;
    let fail = true;
    const c = counters();
    const flaky: SpanExporter = {
      export: async () => {
        if (fail) throw new Error('down');
      },
    };
    const p = new SpanPipeline({
      exporter: flaky,
      failureBackoffMs: 1_000,
      scheduleDelayMs: 60_000,
      hooks: c.hooks,
      now: () => now,
    });
    p.onEnd(span(1));
    await p.flush();
    expect(c.failures.error).toBe(1);

    now = 500; // inside the back-off window: dropped without an export attempt
    p.onEnd(span(2));
    expect(c.dropped.backoff).toBe(1);

    now = 1_500;
    fail = false;
    p.onEnd(span(3));
    await p.flush();
    expect(c.exported).toBe(1);
  });

  it('onEnd never throws, even when every hook throws', () => {
    const p = new SpanPipeline({
      exporter: { export: async () => undefined },
      maxQueueSize: 1,
      hooks: {
        onDropped: () => {
          throw new Error('hook');
        },
      },
    });
    expect(() => {
      for (let i = 0; i < 10; i += 1) p.onEnd(span(i));
    }).not.toThrow();
  });

  it('shutdown flushes what it can and drops the rest, then refuses new spans', async () => {
    const c = counters();
    const p = new SpanPipeline({
      exporter: { export: async () => undefined },
      scheduleDelayMs: 60_000,
      hooks: c.hooks,
    });
    p.onEnd(span(1));
    await p.shutdown();
    expect(c.exported).toBe(1);
    p.onEnd(span(2));
    expect(c.dropped.shutdown).toBe(1);
  });
});

describe('span attributes', () => {
  it('keeps only allowlisted keys and scrubs values', () => {
    expect(
      sanitizeSpanAttributes({
        'http.route': '/v1/x/:id',
        'http.request.header.authorization': 'Bearer abc',
        'user.email': 'a@b.co',
        'error.type': 'Bearer secretvalue1234',
        'http.response.status_code': 500,
      }),
    ).toEqual({
      'http.route': '/v1/x/:id',
      'error.type': 'Bearer [REDACTED]',
      'http.response.status_code': 500,
    });
  });

  it('unsampled spans never reach the pipeline', () => {
    const onEnd = jest.fn();
    const ctx = startTraceContext({ kind: 'server', sampleRatio: 0 });
    startSpan({ onEnd } as unknown as SpanPipeline, ctx, 'x').end('ok');
    expect(onEnd).not.toHaveBeenCalled();
  });
});

describe('OtlpHttpJsonExporter against a real local HTTP collector', () => {
  it('delivers OTLP JSON and sends configured headers', async () => {
    const col = await collector({ mode: 'ok' });
    try {
      const exp = new OtlpHttpJsonExporter({
        endpoint: col.endpoint,
        serviceName: 'hsm-api',
        serviceVersion: 'b'.repeat(40),
        headers: { 'x-collector-auth': 'test-only' },
      });
      await exp.export([span(1)], new AbortController().signal);
      const body = col.received[0] as OtlpBody;
      const s = body.resourceSpans[0].scopeSpans[0].spans[0];
      expect(s.traceId).toBe('a'.repeat(32));
      expect(s.kind).toBe(2);
      expect(s.startTimeUnixNano).toBe('1700000000000000000');
      expect(s.endTimeUnixNano).toBe('1700000000012500000');
      expect(body.resourceSpans[0].resource.attributes).toContainEqual({
        key: 'service.version',
        value: { stringValue: 'b'.repeat(40) },
      });
      expect(col.headers[0]['x-collector-auth']).toBe('test-only');
    } finally {
      await col.close();
    }
  });

  it('collector outage: errors carry the status only, never the response body', async () => {
    const col = await collector({ mode: 'fail' });
    try {
      const exp = new OtlpHttpJsonExporter({
        endpoint: col.endpoint,
        serviceName: 'hsm-api',
        serviceVersion: null,
      });
      await expect(exp.export([span(1)], new AbortController().signal)).rejects.toThrow(
        /^collector responded 503$/,
      );
    } finally {
      await col.close();
    }
  });

  it('collector unreachable: the pipeline counts a failure and the caller is unaffected', async () => {
    const col = await collector({ mode: 'ok' });
    const endpoint = col.endpoint;
    await col.close(); // port now refuses connections
    const c = counters();
    const p = new SpanPipeline({
      exporter: new OtlpHttpJsonExporter({
        endpoint,
        serviceName: 'hsm-api',
        serviceVersion: null,
      }),
      exportTimeoutMs: 2_000,
      hooks: c.hooks,
    });
    expect(() => p.onEnd(span(1))).not.toThrow();
    await p.flush();
    expect(c.failures.error).toBe(1);
  });

  it('slow collector: the export is aborted at the pipeline timeout', async () => {
    const col = await collector({ mode: 'slow' });
    try {
      const c = counters();
      const p = new SpanPipeline({
        exporter: new OtlpHttpJsonExporter({
          endpoint: col.endpoint,
          serviceName: 'hsm-api',
          serviceVersion: null,
        }),
        exportTimeoutMs: 100,
        hooks: c.hooks,
      });
      p.onEnd(span(1));
      const t0 = Date.now();
      await p.flush();
      expect(Date.now() - t0).toBeLessThan(1_500);
      expect(c.failures.timeout).toBe(1);
    } finally {
      await col.close();
    }
  });

  it('refuses an endpoint with embedded credentials', () => {
    expect(
      () =>
        new OtlpHttpJsonExporter({
          endpoint: 'https://u:p@collector.test',
          serviceName: 's',
          serviceVersion: null,
        }),
    ).toThrow(/must not embed credentials/);
  });
});
