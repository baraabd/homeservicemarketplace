import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authRequestScope, invalidateAuthRequests, recordVerifiedLogin } from './auth-session-boundary';
import { AUTH_COOKIE_LOCK, withAuthCookieLock } from './auth-cookie-lock';

beforeEach(() => { recordVerifiedLogin(); });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('R04 cooperative cookie-write serialization', () => {
  it('serializes this tab when Web Locks is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const first = deferred();
    const order: string[] = [];
    const one = withAuthCookieLock(authRequestScope(), async () => {
      order.push('first-start'); await first.promise; order.push('first-end');
    });
    const two = withAuthCookieLock(authRequestScope(), async () => { order.push('second'); });
    await vi.waitFor(() => expect(order).toEqual(['first-start']));
    first.resolve();
    await Promise.all([one, two]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('does not send a queued old-scope request using a new account cookie', async () => {
    vi.stubGlobal('navigator', {});
    const active = deferred();
    const one = withAuthCookieLock(authRequestScope(), () => active.promise);
    const request = vi.fn(async () => {});
    const two = withAuthCookieLock(authRequestScope(), request).catch((error: unknown) => error);
    await Promise.resolve();
    invalidateAuthRequests();
    active.resolve();
    await one;
    expect(await two).toMatchObject({ code: 'ERR_CANCELED' });
    expect(request).not.toHaveBeenCalled();
  });

  it('requests an exclusive shared-origin lock without stealing an active lock', async () => {
    const request = vi.fn(async (_name: string, _options: unknown, callback: () => Promise<number>) => callback());
    vi.stubGlobal('navigator', { locks: { request } });
    await expect(withAuthCookieLock(authRequestScope(), async () => 7)).resolves.toBe(7);
    expect(request).toHaveBeenCalledWith(AUTH_COOKIE_LOCK,
      expect.objectContaining({ mode: 'exclusive', signal: expect.any(AbortSignal) }), expect.any(Function));
  });

  it('a rejected native lock never falls back to an unlocked cookie request', async () => {
    vi.stubGlobal('navigator', { locks: { request: vi.fn().mockRejectedValue(new Error('Lock unavailable')) } });
    const request = vi.fn(async () => {});
    await expect(withAuthCookieLock(authRequestScope(), request)).rejects.toThrow('Lock unavailable');
    expect(request).not.toHaveBeenCalled();
  });
});
