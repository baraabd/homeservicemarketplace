// This marker is not an identity or a credential. It only prevents automatic
// restoration after local logout and tells other tabs to revalidate cookies.
export const AUTH_BOUNDARY_KEY = 'hsm.auth.boundary.v1';
interface Boundary { revision: string; state: 'signed-out' | 'changed' }
let fallback: Boundary | null = null;
let epoch = 0;
let memoryOnly = false;

function readBoundary(): Boundary | null {
  if (memoryOnly) return fallback;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(AUTH_BOUNDARY_KEY) ?? 'null');
    if (value && typeof value === 'object' && 'revision' in value && 'state' in value &&
        typeof value.revision === 'string' && value.revision.length <= 100 &&
        (value.state === 'signed-out' || value.state === 'changed')) return value as Boundary;
    return null;
  } catch { return fallback; }
}

export function isLocallySignedOut(): boolean { return readBoundary()?.state === 'signed-out'; }
export function authRequestScope(): string { return `${epoch}:${readBoundary()?.revision ?? ''}`; }
export function invalidateAuthRequests(): void { epoch += 1; }

function publish(state: Boundary['state']): void {
  fallback = { revision: crypto.randomUUID(), state };
  invalidateAuthRequests();
  try {
    window.localStorage.setItem(AUTH_BOUNDARY_KEY, JSON.stringify(fallback));
    memoryOnly = false;
  } catch {
    // Quota denial can reject writes while reads still succeed. Do not let a
    // stale readable value override the local logout in that case.
    memoryOnly = true;
  }
}
export function recordLocalLogout(): void { publish('signed-out'); }
export function recordVerifiedLogin(): void { publish('changed'); }
