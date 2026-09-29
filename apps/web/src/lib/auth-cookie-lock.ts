import { CanceledError } from 'axios';
import { authRequestScope } from './auth-session-boundary';

// HTTP-only cookies are applied by the browser before response interceptors.
// Serialize cookie-writing requests, not merely their React state callbacks.
// Web Locks coordinate cooperative tabs of the same web origin. The fallback
// coordinates this tab only; server-side single-use/revocation still applies.
export const AUTH_COOKIE_LOCK = 'hsm.auth.cookie-write.v1';
let tail: Promise<unknown> = Promise.resolve();

export async function withAuthCookieLock<T>(scope: string, operation: () => Promise<T>): Promise<T> {
  const guarded = () => {
    if (scope !== authRequestScope()) throw new CanceledError('Authentication changed before the operation started');
    return operation();
  };
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    // A denied or timed-out lock must not fall through to an unlocked request.
    // Await the native callback result; the DOM declaration may infer a nested
    // Promise for an async generic callback although the browser adopts it.
    return await navigator.locks.request(AUTH_COOKIE_LOCK, {
      mode: 'exclusive', signal: AbortSignal.timeout(15_000),
    }, guarded);
  }
  const current = tail.then(guarded, guarded);
  tail = current.catch(() => undefined);
  return current;
}
