import { EvidenceScannedHandler } from './evidence-scanned.handler';
import { OutboxEventType } from '../../../../infrastructure/outbox/outbox.tokens';

// Sprint 9B.4 — the consumer that keeps `evidence.scanned` from dead-lettering.
//
// The most important assertion in this file is the first one: the handler
// claims the exact event type the scan service emits. If those two strings
// drift apart, every scan becomes a dead outbox row and a logged error, and
// nothing else in the test suite would notice.

function harness() {
  const incs: Array<Record<string, string>> = [];
  const logged: unknown[] = [];
  const metrics = {
    evidenceScanOutcomesTotal: { inc: (labels: Record<string, string>) => incs.push(labels) },
  };
  const handler = new EvidenceScannedHandler(metrics as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (handler as any).log = {
    warn: (o: unknown) => logged.push(o),
    log: (o: unknown) => logged.push(o),
  };
  return { handler, incs, logged };
}

const event = (payload: Record<string, unknown>) =>
  ({ id: 'evt-1', eventType: 'evidence.scanned', payload }) as never;

describe('EvidenceScannedHandler', () => {
  it('claims exactly the event type the scan service emits', () => {
    const { handler } = harness();
    expect(handler.eventTypes).toEqual([OutboxEventType.EVIDENCE_SCANNED]);
    expect(OutboxEventType.EVIDENCE_SCANNED).toBe('evidence.scanned');
  });

  it('has a stable name, because it is persisted', () => {
    expect(harness().handler.name).toBe('evidence-scanned.metrics');
  });

  it.each(['CLEAN', 'QUARANTINED', 'REJECTED', 'SCAN_FAILED'])(
    'counts a %s outcome under its own label',
    async (scanState) => {
      const { handler, incs } = harness();
      await handler.handle(event({ assetId: 'a1', caseId: 'c1', scanState }), {} as never);
      expect(incs).toEqual([{ state: scanState }]);
    },
  );

  it('buckets an unrecognised state instead of using it as a label', async () => {
    // Labels taken straight from a payload are an unbounded-cardinality hole:
    // a producer bug becomes thousands of time series in the metrics store.
    const { handler, incs, logged } = harness();
    await handler.handle(event({ scanState: 'WHATEVER-I-LIKE' }), {} as never);

    expect(incs).toEqual([{ state: 'unknown' }]);
    expect(JSON.stringify(logged)).not.toContain('WHATEVER-I-LIKE');
  });

  it('tolerates a payload with no state at all', async () => {
    const { handler, incs } = harness();
    await expect(handler.handle(event({}), {} as never)).resolves.toBeUndefined();
    expect(incs).toEqual([{ state: 'unknown' }]);
  });

  it('does not throw on a malformed payload', async () => {
    // Throwing means "retry me". Retrying cannot make a payload valid, so it
    // would loop to the dead-letter table for no benefit.
    const { handler } = harness();
    await expect(
      handler.handle(
        { id: 'e', eventType: 'evidence.scanned', payload: null } as never,
        {} as never,
      ),
    ).resolves.toBeUndefined();
  });

  it('is safe to run twice, because the marker cannot prevent a half-finished retry', async () => {
    const { handler, incs } = harness();
    const e = event({ scanState: 'CLEAN' });
    await handler.handle(e, {} as never);
    await handler.handle(e, {} as never);
    // Counting twice is the correct failure mode for a counter: it is not a
    // ledger, and refusing to count would lose the real second scan of a
    // rescanned asset.
    expect(incs).toHaveLength(2);
  });

  it('records nothing identifying', async () => {
    const { handler, incs } = harness();
    await handler.handle(
      event({ assetId: 'asset-secret', caseId: 'case-secret', scanState: 'CLEAN' }),
      {} as never,
    );
    const text = JSON.stringify(incs);
    expect(text).not.toContain('asset-secret');
    expect(text).not.toContain('case-secret');
  });
});
