import { PublicMediaCleanupJob } from './public-media-cleanup.job';

// Sprint 09B.29 Phase 4 — the worker that drives the public-media sweep.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §4.4
//
// The sweep's own correctness lives in `public-media-cleanup.service.spec.ts`.
// What is tested HERE is the lifecycle around it, because every one of these
// properties is a way a destructive worker goes wrong in production:
//
//   DEFAULT OFF   a job that deletes bytes must not start because someone
//                 forgot a variable
//   NO OVERLAP    a pass slower than its interval must delay the next one,
//                 never run two
//   RESILIENCE    a failed pass must not unschedule the chain, which would
//                 silently stop the sweep for the process's lifetime
//   SHUTDOWN      no timer survives destroy, and nothing is armed after it
//   CONFIG        the batch and grace the operator set are the ones used

jest.useFakeTimers();

const INTERVAL = 900_000;

function harness(over: Record<string, unknown> = {}) {
  const env: Record<string, unknown> = {
    PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED: true,
    PUBLIC_MEDIA_CLEANUP_INTERVAL_MS: INTERVAL,
    PUBLIC_MEDIA_CLEANUP_BATCH_SIZE: 50,
    PUBLIC_MEDIA_CLEANUP_RESERVATION_GRACE_MS: 86_400_000,
    ...over,
  };
  const sweep = jest.fn().mockResolvedValue({ examined: 0, deleted: 0, raced: 0, failed: 0 });
  const config = { get: (k: string) => env[k] };
  const job = new PublicMediaCleanupJob({ sweep } as never, config as never);
  return { job, sweep };
}

afterEach(() => {
  jest.clearAllTimers();
});

describe('PublicMediaCleanupJob — activation', () => {
  it('does NOTHING when the worker is disabled', async () => {
    const h = harness({ PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED: false });
    h.job.onModuleInit();

    await jest.advanceTimersByTimeAsync(INTERVAL * 5);
    // Failing safe for a destructive sweep means the leak persists, not that
    // bytes disappear. An unset variable must land on that side.
    expect(h.sweep).not.toHaveBeenCalled();
  });

  it('is disabled by an absent flag, not only by an explicit false', async () => {
    const h = harness({ PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED: undefined });
    h.job.onModuleInit();

    await jest.advanceTimersByTimeAsync(INTERVAL * 5);
    expect(h.sweep).not.toHaveBeenCalled();
  });

  it('does not sweep synchronously at boot', async () => {
    const h = harness();
    h.job.onModuleInit();

    // The first pass is scheduled, not immediate: a sweep racing application
    // startup would compete with migrations and warm-up for the pool.
    expect(h.sweep).not.toHaveBeenCalled();
  });

  it('sweeps once per interval when enabled', async () => {
    const h = harness();
    h.job.onModuleInit();

    await jest.advanceTimersByTimeAsync(INTERVAL);
    expect(h.sweep).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(INTERVAL);
    expect(h.sweep).toHaveBeenCalledTimes(2);
  });

  it('passes the operator-configured batch and grace through unchanged', async () => {
    const h = harness({
      PUBLIC_MEDIA_CLEANUP_BATCH_SIZE: 7,
      PUBLIC_MEDIA_CLEANUP_RESERVATION_GRACE_MS: 3_600_000,
    });
    await h.job.runOnce();

    expect(h.sweep).toHaveBeenCalledWith({ limit: 7, reservationGraceMs: 3_600_000 });
  });
});

describe('PublicMediaCleanupJob — overlap and failure', () => {
  it('never runs two passes at once', async () => {
    const h = harness();
    let release!: () => void;
    h.sweep.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ examined: 0, deleted: 0, raced: 0, failed: 0 });
        }),
    );
    h.job.onModuleInit();

    await jest.advanceTimersByTimeAsync(INTERVAL);
    expect(h.sweep).toHaveBeenCalledTimes(1);

    // Several intervals pass while the first is still in flight. A second
    // concurrent pass would double the delete rate against storage and make
    // the `raced` counter meaningless within one process.
    await jest.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(h.sweep).toHaveBeenCalledTimes(1);

    release();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(INTERVAL);
    expect(h.sweep).toHaveBeenCalledTimes(2);
  });

  it('a manual runOnce during an in-flight pass is a no-op, not a second pass', async () => {
    const h = harness();
    let release!: () => void;
    h.sweep.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ examined: 0, deleted: 0, raced: 0, failed: 0 });
        }),
    );

    const first = h.job.runOnce();
    await h.job.runOnce();
    expect(h.sweep).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it('a failing pass does not unschedule the chain', async () => {
    const h = harness();
    h.sweep
      .mockRejectedValueOnce(new Error('storage unreachable'))
      .mockResolvedValue({ examined: 0, deleted: 0, raced: 0, failed: 0 });
    h.job.onModuleInit();

    await jest.advanceTimersByTimeAsync(INTERVAL);
    expect(h.sweep).toHaveBeenCalledTimes(1);

    // The regression that matters: a rejection escaping into the timer leaves
    // nothing armed, and the sweep stops for the lifetime of the process while
    // objects keep accumulating.
    await jest.advanceTimersByTimeAsync(INTERVAL);
    expect(h.sweep).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(INTERVAL);
    expect(h.sweep).toHaveBeenCalledTimes(3);
  });

  it('a failing pass releases the overlap guard', async () => {
    const h = harness();
    h.sweep.mockRejectedValueOnce(new Error('boom'));

    await expect(h.job.runOnce()).rejects.toThrow('boom');
    h.sweep.mockResolvedValue({ examined: 0, deleted: 0, raced: 0, failed: 0 });
    await h.job.runOnce();

    expect(h.sweep).toHaveBeenCalledTimes(2);
  });
});

describe('PublicMediaCleanupJob — shutdown', () => {
  it('stops sweeping after destroy', async () => {
    const h = harness();
    h.job.onModuleInit();

    await jest.advanceTimersByTimeAsync(INTERVAL);
    expect(h.sweep).toHaveBeenCalledTimes(1);

    await h.job.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(INTERVAL * 5);
    expect(h.sweep).toHaveBeenCalledTimes(1);
  });

  it('leaves no pending timer behind', async () => {
    const h = harness();
    h.job.onModuleInit();
    expect(jest.getTimerCount()).toBe(1);

    await h.job.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not re-arm when a pass completes after destroy', async () => {
    const h = harness();
    let release!: () => void;
    h.sweep.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ examined: 0, deleted: 0, raced: 0, failed: 0 });
        }),
    );
    h.job.onModuleInit();
    await jest.advanceTimersByTimeAsync(INTERVAL);

    // Shutdown arrives mid-pass — the ordinary case, since the pass is what
    // holds shutdown up. The `.finally()` re-arm must respect the stop flag,
    // or a drained process keeps a timer alive after destroy returned.
    await h.job.onModuleDestroy();
    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(h.sweep).toHaveBeenCalledTimes(1);
  });

  it('destroy is safe when the worker never started', async () => {
    const h = harness({ PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED: false });
    h.job.onModuleInit();

    await expect(h.job.onModuleDestroy()).resolves.toBeUndefined();
  });
});
