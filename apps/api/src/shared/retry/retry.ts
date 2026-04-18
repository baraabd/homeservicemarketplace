export interface RetryOptions {
  attempts: number;
  baseMs: number;
  capMs: number;
  onAttempt?: (attempt: number, err: unknown) => void;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      opts.onAttempt?.(attempt, err);
      if (attempt === opts.attempts) break;
      const expo = Math.min(opts.capMs, opts.baseMs * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * (expo / 2));
      await new Promise((r) => setTimeout(r, expo / 2 + jitter));
    }
  }
  throw lastErr;
}
