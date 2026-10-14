import { randomBytes } from 'node:crypto';

import {
  childTraceContext,
  currentTraceContext,
  formatTraceparent,
  isSafeCorrelationId,
  isSampledByRatio,
  parseTraceparent,
  runWithTraceContext,
  startTraceContext,
} from './trace-context';

const VALID = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomBytes: jest.fn(jest.requireActual('node:crypto').randomBytes),
}));

describe('W3C traceparent', () => {
  it('parses a valid version-00 header', () => {
    expect(parseTraceparent(VALID)).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentSpanId: '00f067aa0ba902b7',
      sampled: true,
    });
  });

  it.each([
    ['upper-case hex', VALID.toUpperCase()],
    ['all-zero trace id', `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`],
    ['all-zero span id', `00-4bf92f3577b34da6a3ce929d0e0e4736-${'0'.repeat(16)}-01`],
    ['unknown version', VALID.replace(/^00/, 'ff')],
    ['trailing data', `${VALID}-extra`],
    ['oversized', 'a'.repeat(8_192)],
    ['repeated header (array)', [VALID, VALID]],
    ['non-string', 42],
    ['log injection', `${VALID.slice(0, 54)}\n`],
  ])('rejects %s', (_label, value) => {
    expect(parseTraceparent(value)).toBeNull();
  });

  it('round-trips through format', () => {
    const ctx = startTraceContext({ kind: 'server', traceparent: VALID, sampleRatio: 0 });
    const parsed = parseTraceparent(formatTraceparent(ctx));
    expect(parsed?.traceId).toBe(ctx.traceId);
    expect(parsed?.parentSpanId).toBe(ctx.spanId);
  });
});

describe('startTraceContext', () => {
  it.each([
    ['0'.repeat(31) + '1', 'ffffffffffffffff', false],
    ['f'.repeat(32), '0000000000000001', true],
  ])('samples untrusted trace %s using server entropy', (traceId, spanId, sampled) => {
    // A chosen low/high inbound id must neither force nor suppress sampling.
    // Only one server span id is minted when a valid parent is continued.
    jest.mocked(randomBytes).mockImplementationOnce(() => Buffer.from(spanId, 'hex'));
    const ctx = startTraceContext({
      kind: 'server',
      traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
      sampleRatio: 0.5,
    });
    expect(ctx.traceId).toBe(traceId);
    expect(ctx.spanId).toBe(spanId);
    expect(ctx.sampled).toBe(sampled);
    expect(childTraceContext(ctx, 'client').sampled).toBe(sampled);
  });

  it('continues an inbound trace id but mints its own span id', () => {
    const ctx = startTraceContext({ kind: 'server', traceparent: VALID, sampleRatio: 0 });
    expect(ctx.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(ctx.parentSpanId).toBe('00f067aa0ba902b7');
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(ctx.spanId).not.toBe('00f067aa0ba902b7');
  });

  it('ignores an untrusted inbound sampled flag', () => {
    const ctx = startTraceContext({ kind: 'server', traceparent: VALID, sampleRatio: 0 });
    expect(ctx.sampled).toBe(false);
    const trusted = startTraceContext({
      kind: 'server',
      traceparent: VALID,
      sampleRatio: 0,
      trustInboundSampling: true,
    });
    expect(trusted.sampled).toBe(true);
  });

  it('mints a fresh trace for an invalid header', () => {
    const ctx = startTraceContext({ kind: 'server', traceparent: 'garbage', sampleRatio: 1 });
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.parentSpanId).toBeNull();
    expect(ctx.sampled).toBe(true);
  });
});

describe('ratio sampling', () => {
  it('is deterministic per trace id and close to the ratio', () => {
    let sampled = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const id = startTraceContext({ kind: 'job', sampleRatio: 0 }).traceId;
      expect(isSampledByRatio(id, 0.1)).toBe(isSampledByRatio(id, 0.1));
      if (isSampledByRatio(id, 0.1)) sampled += 1;
    }
    expect(sampled / 20_000).toBeGreaterThan(0.08);
    expect(sampled / 20_000).toBeLessThan(0.12);
  });

  it('treats non-positive and NaN ratios as off', () => {
    expect(isSampledByRatio('f'.repeat(32), 0)).toBe(false);
    expect(isSampledByRatio('f'.repeat(32), Number.NaN)).toBe(false);
    expect(isSampledByRatio('0'.repeat(31) + '1', 1)).toBe(true);
  });
});

describe('async context', () => {
  it('propagates across awaits and isolates concurrent units of work', async () => {
    const a = startTraceContext({ kind: 'job', sampleRatio: 0 });
    const b = startTraceContext({ kind: 'job', sampleRatio: 0 });
    const seen = await Promise.all([
      runWithTraceContext(a, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return currentTraceContext()?.traceId;
      }),
      runWithTraceContext(b, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return currentTraceContext()?.traceId;
      }),
    ]);
    expect(seen).toEqual([a.traceId, b.traceId]);
    expect(currentTraceContext()).toBeUndefined();
  });

  it('child contexts share the trace and point at the parent', () => {
    const parent = startTraceContext({ kind: 'server', sampleRatio: 1 });
    const child = childTraceContext(parent, 'client');
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.sampled).toBe(true);
  });
});

describe('isSafeCorrelationId', () => {
  it('accepts the same set as RequestIdMiddleware', () => {
    expect(isSafeCorrelationId('abc-123_DEF.9')).toBe(true);
    expect(isSafeCorrelationId('a'.repeat(128))).toBe(true);
    expect(isSafeCorrelationId('a'.repeat(129))).toBe(false);
    expect(isSafeCorrelationId('has space')).toBe(false);
    expect(isSafeCorrelationId('line\nbreak')).toBe(false);
    expect(isSafeCorrelationId('')).toBe(false);
    expect(isSafeCorrelationId(['a'])).toBe(false);
  });
});
