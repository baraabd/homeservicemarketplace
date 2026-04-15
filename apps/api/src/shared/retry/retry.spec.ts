import { retry } from './retry';

describe('retry', () => {
  it('returns the result when the first attempt succeeds', async () => {
    const fn = jest.fn().mockResolvedValueOnce('ok');
    const result = await retry(fn, { attempts: 3, baseMs: 1, capMs: 2 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success within the attempt budget', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValueOnce('ok');
    const result = await retry(fn, { attempts: 5, baseMs: 1, capMs: 2 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error when the attempt budget is exhausted', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(new Error('third'));
    await expect(retry(fn, { attempts: 3, baseMs: 1, capMs: 2 })).rejects.toThrow('third');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls onAttempt once per failure with the attempt index and the error', async () => {
    const onAttempt = jest.fn();
    const fn = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('done');
    await retry(fn, { attempts: 3, baseMs: 1, capMs: 2, onAttempt });
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(onAttempt.mock.calls[0][0]).toBe(1);
    expect((onAttempt.mock.calls[0][1] as Error).message).toBe('x');
  });

  it('respects the cap when computing backoff (no unbounded growth)', async () => {
    // Using capMs = 2ms guarantees the test completes well under the jest default timeout
    // even if the exponential branch would have selected a far larger delay.
    const start = Date.now();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockRejectedValueOnce(new Error('c'))
      .mockResolvedValueOnce('ok');
    await retry(fn, { attempts: 4, baseMs: 1000, capMs: 2 });
    expect(Date.now() - start).toBeLessThan(500);
  });
});
