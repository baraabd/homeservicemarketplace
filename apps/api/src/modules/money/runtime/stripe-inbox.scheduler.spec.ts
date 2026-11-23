import { StripeInboxScheduler } from './stripe-inbox.scheduler';
type Args = ConstructorParameters<typeof StripeInboxScheduler>;
describe('G3 bounded inbox scheduling', () => {
  afterEach(() => jest.useRealTimers());
  it.each([
    [false, true],
    [true, false],
  ])('does not schedule when worker=%s stripe=%s', async (worker, stripe) => {
    jest.useFakeTimers();
    const job = { runBatch: jest.fn() };
    const scheduler = new StripeInboxScheduler(
      job as unknown as Args[0],
      { get: () => worker } as unknown as Args[1],
      { isEnabled: () => stripe } as unknown as Args[2],
    );
    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(60000);
    expect(job.runBatch).not.toHaveBeenCalled();
    await scheduler.onModuleDestroy();
  });
  it('serializes ticks and waits for an active batch during shutdown', async () => {
    jest.useFakeTimers();
    let release!: () => void;
    const job = {
      runBatch: jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    };
    const scheduler = new StripeInboxScheduler(
      job as unknown as Args[0],
      { get: () => true } as unknown as Args[1],
      { isEnabled: () => true } as unknown as Args[2],
    );
    scheduler.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(90000);
    expect(job.runBatch).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stop = scheduler.onModuleDestroy().then(() => {
      stopped = true;
    });
    expect(stopped).toBe(false);
    release();
    await stop;
    await jest.advanceTimersByTimeAsync(90000);
    expect(job.runBatch).toHaveBeenCalledTimes(1);
  });
});
