// R27 — cookie-jar HTTP client for the lane API.
//
// The same contract as apps/web/e2e/real-api.ts (cookies in a jar, the CSRF
// cookie echoed on writes), re-stated here because this harness is plain Node
// and must not import the Playwright suite. Response bodies are returned to
// the caller for fixture ids only; they are never written to a report.

import { LANE } from './lane-env.mjs';

export const newJar = () => new Map();

function absorb(jar, res) {
  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    const [pair] = cookie.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

/** One request; returns status, parsed body, selected headers and duration. */
export async function api(jar, path, { method = 'GET', body } = {}) {
  const headers = { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = jar.get('hsm_csrf');
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  const t0 = performance.now();
  const res = await fetch(`${LANE.api}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  absorb(jar, res);
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return {
    status: res.status,
    body: parsed,
    ms,
    bytes: Buffer.byteLength(text),
    headers: {
      cacheControl: res.headers.get('cache-control'),
      etag: res.headers.get('etag') ? 'present' : null,
      vary: res.headers.get('vary'),
      pragma: res.headers.get('pragma'),
    },
  };
}

/** Throw with the status (never the body, which may hold personal data). */
export function expectStatus(result, allowed, what) {
  const ok = Array.isArray(allowed) ? allowed.includes(result.status) : result.status === allowed;
  if (!ok) {
    const code = result.body && typeof result.body === 'object' ? (result.body.code ?? '') : '';
    throw new Error(`${what}: unexpected HTTP ${result.status} ${code}`.trim());
  }
  return result;
}

/** Read and consume a one-time code from the lane's mail catcher. */
export async function otpFor(email) {
  const wanted = email.toLowerCase();
  for (let attempt = 0; attempt < 75; attempt += 1) {
    const list = await (await fetch(`${LANE.mailpit}/api/v1/messages?limit=50`)).json();
    const hit = (list.messages ?? []).find((m) =>
      (m.To ?? []).some((t) => t.Address?.toLowerCase() === wanted),
    );
    if (hit) {
      const full = await (await fetch(`${LANE.mailpit}/api/v1/message/${hit.ID}`)).json();
      const code = (full.Text ?? '').match(/code is (\d{6})/)?.[1];
      if (code) {
        await fetch(`${LANE.mailpit}/api/v1/messages`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ IDs: [hit.ID] }),
        });
        return code;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('no OTP mail arrived');
}
