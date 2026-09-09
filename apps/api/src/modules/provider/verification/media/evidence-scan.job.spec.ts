import { EvidenceScanJob } from './evidence-scan.job';

// Sprint 09B.29 Phase 3, Section 4 — the scan sweep had no caller.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §3.12
//
// THE DEFECT THIS FILE EXISTS FOR
//
// `EvidenceScanService.scanPending` is the only thing that moves a
// `VerificationDocument` off `PENDING`. It was registered in
// `ProviderVerificationModule` and exported — and called by NOTHING in
// production. Its sole caller was its own unit spec.
//
// So in a running system: a provider uploads identity evidence, it is stored,
// and it is never judged. `scanState` stays PENDING forever, submission stays
// blocked on EVIDENCE_NOT_CLEAN, no verification case can be approved, no
// `ProviderWorkAccessGrant` is ever issued, and NO PROVIDER CAN EVER BE
// ACTIVATED. Phase 3's integration Journey C did not catch it because it calls
// `scanPending()` directly; only driving the real API through a browser did.
//
// Shaped exactly like `VerificationExpiryJob` and `OutboxCleanupJob` — this
// repository's existing convention for a recurring pass: an unref'd setTimeout
// chain, a public `runOnce` for deterministic tests, and a config flag that
// decides whether it runs at all. No new scheduling dependency.
//
// WHY DEFAULT OFF IS SAFE
//
// The read path serves CLEAN and nothing else, and `EvidenceScanService`
// refuses to write CLEAN unless a real scanner said so. Off means evidence
// stays unreadable and unverifiable — the same direction the feature already
// fails in. It never means something is trusted that nobody scanned.

interface Harness {
  job: EvidenceScanJob;
  scanned: Array<{ limit?: number }>;
  flags: Record<string, unknown>;
}

function makeHarness(over: Record<string, unknown> = {}): Harness {
  const scanned: Array<{ limit?: number }> = [];
  const flags: Record<string, unknown> = {
    EVIDENCE_SCAN_WORKER_ENABLED: false,
    EVIDENCE_SCAN_INTERVAL_MS: 60_000,
    EVIDENCE_SCAN_BATCH_SIZE: 25,
    ...over,
  };
  const service = {
    scanPending: async (options: { limit?: number } = {}) => {
      scanned.push(options);
      return { examined: 0, cleared: 0, quarantined: 0, rejected: 0, failed: 0, skipped: 0 };
    },
  };
  const config = { get: (k: string) => flags[k] };
  const job = new EvidenceScanJob(service as never, config as never);
  return { job, scanned, flags };
}

describe('EvidenceScanJob', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('exposes runOnce, so the sweep is reachable without a timer', async () => {
    const h = makeHarness();
    await h.job.runOnce();
    expect(h.scanned).toHaveLength(1);
  });

  it('passes the configured batch size', async () => {
    const h = makeHarness({ EVIDENCE_SCAN_BATCH_SIZE: 7 });
    await h.job.runOnce();
    expect(h.scanned[0]).toEqual({ limit: 7 });
  });

  it('does NOT schedule when the worker is disabled', () => {
    jest.useFakeTimers();
    const h = makeHarness({ EVIDENCE_SCAN_WORKER_ENABLED: false });
    h.job.onModuleInit();
    jest.advanceTimersByTime(10 * 60_000);
    expect(h.scanned).toHaveLength(0);
  });

  it('sweeps on the interval once armed', async () => {
    jest.useFakeTimers();
    const h = makeHarness({
      EVIDENCE_SCAN_WORKER_ENABLED: true,
      EVIDENCE_SCAN_INTERVAL_MS: 1_000,
    });
    h.job.onModuleInit();

    await jest.advanceTimersByTimeAsync(1_000);
    expect(h.scanned.length).toBeGreaterThanOrEqual(1);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(h.scanned.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps sweeping after a failed pass', async () => {
    // A pass that rejects must not leave the chain unscheduled — that would
    // stop the sweep for the lifetime of the process and put every later
    // upload back in the state this job exists to prevent.
    jest.useFakeTimers();
    const h = makeHarness({
      EVIDENCE_SCAN_WORKER_ENABLED: true,
      EVIDENCE_SCAN_INTERVAL_MS: 1_000,
    });
    let calls = 0;
    (h.job as unknown as { scans: { scanPending: () => Promise<unknown> } }).scans.scanPending =
      async () => {
        calls += 1;
        if (calls === 1) throw new Error('scanner unreachable');
        return { examined: 0, cleared: 0, quarantined: 0, rejected: 0, failed: 0, skipped: 0 };
      };

    h.job.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
  });

  // Sprint 09B.29 — the operational contract, asserted rather than assumed.

  it('never runs two passes at once, however slow a pass is', async () => {
    // The next timer is armed in `.finally()`, so a pass that outlives its own
    // interval delays the next one instead of overlapping it. Overlap would
    // put two sweeps on the same PENDING rows in ONE process, which is the
    // cheapest way to manufacture the double-decision the conditional write
    // exists to prevent — and it would do it without any second instance.
    jest.useFakeTimers();
    const h = makeHarness({
      EVIDENCE_SCAN_WORKER_ENABLED: true,
      EVIDENCE_SCAN_INTERVAL_MS: 1_000,
    });
    let inFlight = 0;
    let maxInFlight = 0;
    let release: (() => void) | null = null;
    (h.job as unknown as { scans: { scanPending: () => Promise<unknown> } }).scans.scanPending =
      async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => {
          release = () => {
            inFlight -= 1;
            resolve();
          };
        });
        return { examined: 0, cleared: 0, quarantined: 0, rejected: 0, failed: 0, skipped: 0 };
      };

    h.job.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(maxInFlight).toBe(1);

    // Five further intervals pass while the first sweep is still running.
    await jest.advanceTimersByTimeAsync(5_000);
    expect(maxInFlight).toBe(1);

    release!();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(maxInFlight).toBe(1);
  });

  it('holds no handle that could keep the process alive', async () => {
    // `unref` is what stops a pending sweep timer from keeping a Jest worker —
    // or a shutting-down API — alive. Asserted on the real timer object.
    jest.useFakeTimers();
    const h = makeHarness({
      EVIDENCE_SCAN_WORKER_ENABLED: true,
      EVIDENCE_SCAN_INTERVAL_MS: 1_000,
    });
    h.job.onModuleInit();
    const timer = (h.job as unknown as { timer: NodeJS.Timeout | null }).timer;
    expect(timer).not.toBeNull();
    expect(typeof timer!.hasRef).toBe('function');
    expect(timer!.hasRef()).toBe(false);
    await h.job.onModuleDestroy();
  });

  it('stops on shutdown', async () => {
    jest.useFakeTimers();
    const h = makeHarness({
      EVIDENCE_SCAN_WORKER_ENABLED: true,
      EVIDENCE_SCAN_INTERVAL_MS: 1_000,
    });
    h.job.onModuleInit();
    await h.job.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(h.scanned).toHaveLength(0);
  });
});
