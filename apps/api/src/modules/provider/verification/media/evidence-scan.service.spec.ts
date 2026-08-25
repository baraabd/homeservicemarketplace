import { Readable } from 'node:stream';

import { EvidenceScanService } from './evidence-scan.service';
import {
  DeterministicTestScanner,
  UnconfiguredMalwareScanner,
  EICAR_TEST_SIGNATURE,
  MalwareScannerPort,
  type ScanVerdict,
} from './malware-scanner.port';

// Sprint 9B.4 — the processor that turns stored bytes into a scan state.
//
// The pure modules already decide what a file IS (evidence-validation) and
// whether a verdict may overwrite what is recorded (scan-decision). This is the
// part that talks to storage, a scanner and the database, so what it is tested
// for is the wiring between them:
//
//   - validation happens BEFORE the scanner is asked anything
//   - a scanner that cannot answer never produces CLEAN
//   - two workers racing the same asset write once
//   - a batch is bounded, and one bad asset does not abandon the rest
//   - nothing identifying reaches a log line
//
// Doubles rather than a database, because every assertion here is about
// control flow. The real database behaviour is covered by the integration
// suite.

const PDF = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.from('evidence body'),
  Buffer.from('\ntrailer\n%%EOF\n'),
]);
const EICAR_PDF = Buffer.concat([
  Buffer.from('%PDF-1.4\n'),
  Buffer.from(EICAR_TEST_SIGNATURE),
  Buffer.from('\ntrailer\n%%EOF\n'),
]);
const TRUNCATED_PDF = Buffer.from('%PDF-1.4\nno end marker');

type Row = {
  id: string;
  storageKey: string;
  scanState: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  originalFilename: string | null;
  sizeBytes: number;
  ownerUserId: string | null;
  verificationCaseId: string | null;
};

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'asset-1',
    storageKey: 'verification/case-1/asset-1.pdf',
    scanState: 'PENDING',
    declaredMimeType: 'application/pdf',
    detectedMimeType: 'application/pdf',
    originalFilename: 'passport.pdf',
    sizeBytes: PDF.length,
    ownerUserId: 'user-1',
    verificationCaseId: 'case-1',
    ...over,
  };
}

/** A scanner that answers however the test wants. */
class ScriptedScanner extends MalwareScannerPort {
  readonly scannerId = 'scripted';
  calls: string[] = [];
  constructor(
    readonly isRealScanner: boolean,
    private readonly verdict: ScanVerdict | (() => Promise<ScanVerdict>),
  ) {
    super();
  }
  async scan({ assetId }: { bytes: Uint8Array; assetId: string }): Promise<ScanVerdict> {
    this.calls.push(assetId);
    return typeof this.verdict === 'function' ? this.verdict() : this.verdict;
  }
}

function harness(options: {
  rows?: Row[];
  bytes?: Buffer | (() => Readable);
  scanner?: MalwareScannerPort;
  /** updateMany returns this many affected rows; 0 models losing a race. */
  updateCount?: number;
  maxBytes?: number;
}) {
  const rows = options.rows ?? [row()];
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const audits: Array<{ type: string; metadata: Record<string, unknown> }> = [];
  const outbox: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const logged: unknown[] = [];

  const client = {
    mediaAsset: {
      findMany: jest.fn(async () => rows),
      updateMany: jest.fn(
        async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          updates.push(args);
          return { count: options.updateCount ?? 1 };
        },
      ),
    },
  };

  const storage = {
    openReadStream: jest.fn(async () => {
      if (typeof options.bytes === 'function') return options.bytes();
      return Readable.from([options.bytes ?? PDF]);
    }),
    putObjectFromFile: jest.fn(),
    head: jest.fn(),
    deleteObject: jest.fn(),
  };

  const audit = {
    record: jest.fn(async (input: { type: string; metadata?: Record<string, unknown> }) => {
      audits.push({ type: input.type, metadata: input.metadata ?? {} });
    }),
  };

  const outboxRepo = {
    enqueue: jest.fn(async (input: { eventType: string; payload: Record<string, unknown> }) => {
      outbox.push({ eventType: input.eventType, payload: input.payload });
      return { id: 'evt' };
    }),
  };

  const tx = { run: async <T>(fn: (trx: unknown) => Promise<T>): Promise<T> => fn(client) };

  const settings = {
    evidenceLimits: jest.fn(async () => ({ maxBytes: options.maxBytes ?? 10 * 1024 * 1024 })),
  };

  const service = new EvidenceScanService(
    { client } as never,
    storage as never,
    options.scanner ?? new DeterministicTestScanner(),
    audit as never,
    tx as never,
    settings as never,
    outboxRepo as never,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (service as any).log = {
    log: (o: unknown) => logged.push(o),
    warn: (o: unknown) => logged.push(o),
    error: (o: unknown) => logged.push(o),
  };

  return { service, client, storage, audit, updates, audits, outbox, logged };
}

const stateWritten = (updates: Array<{ data: Record<string, unknown> }>) =>
  updates.map((u) => u.data.scanState);

describe('a file a real scanner clears', () => {
  it('is written CLEAN, with the scanner recorded', async () => {
    const h = harness({});
    const out = await h.service.scanPending();

    expect(out.cleared).toBe(1);
    expect(stateWritten(h.updates)).toEqual(['CLEAN']);
    expect(h.updates[0].data.scannedAt).toBeInstanceOf(Date);
  });

  it('claims the row conditionally, so a racing worker cannot double-write', async () => {
    // The where clause must pin the state we OBSERVED. Updating by id alone
    // lets two workers both write, and the second silently overwrites a
    // decision made on a different reading of the file.
    const h = harness({});
    await h.service.scanPending();
    expect(h.updates[0].where).toMatchObject({ id: 'asset-1', scanState: 'PENDING' });
  });

  it('counts a lost race as skipped rather than cleared', async () => {
    const h = harness({ updateCount: 0 });
    const out = await h.service.scanPending();
    expect(out.cleared).toBe(0);
    expect(out.skipped).toBe(1);
  });

  it('records an audit event naming the case, not the file', async () => {
    const h = harness({});
    await h.service.scanPending();

    expect(h.audits.map((a) => a.type)).toEqual(['VERIFICATION_EVIDENCE_SCAN_CLEARED']);
    const meta = JSON.stringify(h.audits[0].metadata);
    expect(meta).toContain('case-1');
    expect(meta).not.toContain('passport.pdf');
    expect(meta).not.toContain('verification/case-1/asset-1.pdf');
  });

  it('emits an outbox event so the rest of the system can react', async () => {
    const h = harness({});
    await h.service.scanPending();
    expect(h.outbox).toHaveLength(1);
    expect(h.outbox[0].eventType).toBe('evidence.scanned');
    expect(h.outbox[0].payload).toMatchObject({ assetId: 'asset-1', scanState: 'CLEAN' });
  });
});

describe('a file a scanner flags', () => {
  it('is QUARANTINED, with the signature but not the bytes', async () => {
    const h = harness({ bytes: EICAR_PDF });
    const out = await h.service.scanPending();

    expect(out.quarantined).toBe(1);
    expect(stateWritten(h.updates)).toEqual(['QUARANTINED']);
    expect(h.updates[0].data.scanSignature).toBe('EICAR-Test-File');
  });

  it('audits it under its own event type', async () => {
    const h = harness({ bytes: EICAR_PDF });
    await h.service.scanPending();
    expect(h.audits.map((a) => a.type)).toEqual(['VERIFICATION_EVIDENCE_SCAN_QUARANTINED']);
  });
});

describe('a file we refuse before any scanner sees it', () => {
  it('is REJECTED, and the scanner is never called', async () => {
    // Validation first is not an optimisation. Handing a malformed file to a
    // scanner asks a question about bytes we have already decided not to
    // accept, and the answer would be recorded as though it meant something.
    const scanner = new ScriptedScanner(true, { state: 'CLEAN', scannerId: 'scripted' });
    const h = harness({ bytes: TRUNCATED_PDF, scanner });

    const out = await h.service.scanPending();

    expect(out.rejected).toBe(1);
    expect(stateWritten(h.updates)).toEqual(['REJECTED']);
    expect(scanner.calls).toEqual([]);
  });

  it('records WHY, as a code rather than a filename', async () => {
    const h = harness({ bytes: TRUNCATED_PDF });
    await h.service.scanPending();

    expect(h.audits[0].type).toBe('VERIFICATION_EVIDENCE_REJECTED');
    expect(h.audits[0].metadata).toMatchObject({ reason: 'TRUNCATED' });
    expect(JSON.stringify(h.audits[0].metadata)).not.toContain('passport.pdf');
  });

  it('refuses an object whose bytes no longer match what was recorded', async () => {
    // Storage corruption, or an object replaced underneath us. The recorded
    // detected type is the server's own earlier finding, so a disagreement now
    // means the object changed.
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
    ]);
    const h = harness({ bytes: png });
    const out = await h.service.scanPending();
    expect(out.rejected).toBe(1);
  });
});

describe('a scanner that cannot answer', () => {
  it('never produces CLEAN when the adapter is not a real scanner', async () => {
    // The headline rule. An unconfigured deployment uploads evidence and
    // simply cannot read it back.
    const h = harness({ scanner: new UnconfiguredMalwareScanner() });
    const out = await h.service.scanPending();

    expect(out.cleared).toBe(0);
    expect(h.updates).toHaveLength(0);
    expect(out.skipped).toBe(1);
  });

  it('records SCAN_FAILED when the scanner errored, and never CLEAN', async () => {
    const scanner = new ScriptedScanner(true, {
      state: 'FAILED',
      scannerId: 'scripted',
      reason: 'timeout',
    });
    const h = harness({ scanner });
    const out = await h.service.scanPending();

    expect(out.failed).toBe(1);
    expect(stateWritten(h.updates)).toEqual(['SCAN_FAILED']);
  });

  it('treats a scanner that THROWS as a failure, not a clean file', async () => {
    // The port says adapters resolve rather than throw. This asserts the
    // service does not depend on that promise being kept.
    const scanner = new ScriptedScanner(true, async () => {
      throw new Error('boom');
    });
    const h = harness({ scanner });
    const out = await h.service.scanPending();

    expect(stateWritten(h.updates)).toEqual(['SCAN_FAILED']);
    expect(out.cleared).toBe(0);
  });

  it('treats unreadable storage as a scan failure, and asks no scanner', async () => {
    const scanner = new ScriptedScanner(true, { state: 'CLEAN', scannerId: 'scripted' });
    const h = harness({
      scanner,
      bytes: () => {
        const s = new Readable({ read() {} });
        process.nextTick(() => s.destroy(new Error('gone')));
        return s;
      },
    });

    const out = await h.service.scanPending();

    expect(out.failed).toBe(1);
    expect(stateWritten(h.updates)).toEqual(['SCAN_FAILED']);
    expect(scanner.calls).toEqual([]);
  });
});

describe('a verdict already recorded', () => {
  it('does not re-clear a CLEAN asset', async () => {
    const h = harness({ rows: [row({ scanState: 'CLEAN' })] });
    const out = await h.service.scanPending();
    expect(h.updates).toHaveLength(0);
    expect(out.skipped).toBe(1);
  });

  it('never releases a QUARANTINED asset, even when the scanner says CLEAN', async () => {
    const scanner = new ScriptedScanner(true, { state: 'CLEAN', scannerId: 'scripted' });
    const h = harness({ rows: [row({ scanState: 'QUARANTINED' })], scanner });
    const out = await h.service.scanPending();

    expect(h.updates).toHaveLength(0);
    expect(out.cleared).toBe(0);
  });
});

describe('the batch', () => {
  it('is bounded, and asks the database for no more than the bound', async () => {
    const h = harness({ rows: [] });
    await h.service.scanPending({ limit: 5 });
    expect(h.client.mediaAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
  });

  it('clamps an absurd limit rather than trusting it', async () => {
    const h = harness({ rows: [] });
    await h.service.scanPending({ limit: 10_000 });
    const call = (h.client.mediaAsset.findMany.mock.calls[0] as unknown[])[0] as {
      take: number;
    };
    expect(call.take).toBeLessThanOrEqual(200);
  });

  it('only ever selects assets that are complete, undeleted and restricted', async () => {
    const h = harness({ rows: [] });
    await h.service.scanPending();
    const call = (h.client.mediaAsset.findMany.mock.calls[0] as unknown[])[0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toMatchObject({
      visibility: 'RESTRICTED',
      deletedAt: null,
    });
    expect(call.where.uploadCompletedAt).not.toBeNull();
  });

  it('finishes the batch when one asset fails', async () => {
    // One unreadable object must not abandon everything queued behind it.
    let n = 0;
    const h = harness({
      rows: [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })],
      bytes: () => {
        n += 1;
        if (n === 2) {
          const s = new Readable({ read() {} });
          process.nextTick(() => s.destroy(new Error('gone')));
          return s;
        }
        return Readable.from([PDF]);
      },
    });

    const out = await h.service.scanPending();

    expect(out.examined).toBe(3);
    expect(out.cleared).toBe(2);
    expect(out.failed).toBe(1);
  });
});

describe('what it writes down', () => {
  it('logs counts only — no key, filename, owner or signature', async () => {
    const h = harness({ rows: [row(), row({ id: 'asset-2' })] });
    await h.service.scanPending();

    const text = JSON.stringify(h.logged);
    expect(text).not.toContain('verification/case-1/asset-1.pdf');
    expect(text).not.toContain('passport.pdf');
    expect(text).not.toContain('user-1');
    expect(text).toContain('evidence.scan');
  });

  it('logs nothing at all when there was nothing to do', async () => {
    const h = harness({ rows: [] });
    await h.service.scanPending();
    expect(h.logged).toEqual([]);
  });
});
