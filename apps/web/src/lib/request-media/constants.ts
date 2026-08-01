// Web-safe request-media constants.
//
// Why this is NOT imported from @homeservicemarketplace/contracts:
// the contracts package emits CommonJS (`dist/index.js`) so the Nest API
// can `require()` it. A runtime VALUE import from contracts in the web
// app makes Vite/esbuild serve that CJS file to the browser, which then
// throws `ReferenceError: exports is not defined`. Every other web
// import from contracts is type-only (erased at build time); this is the
// single runtime constant the UI needs, so it lives here instead.
//
// Single source of truth on the web side. The backend enforces the same
// cap independently via its own `MAX_REQUEST_MEDIA_ITEMS`
// (packages/contracts/src/media/constants.ts, consumed by the presign +
// create-request DTOs), so a client can never bypass it. Keep the two
// values in sync — they intentionally mirror each other across the
// CJS (API) / ESM (browser) boundary.

/** Max images/videos a seeker can attach to one service request. */
export const MAX_REQUEST_MEDIA_ITEMS = 6;
