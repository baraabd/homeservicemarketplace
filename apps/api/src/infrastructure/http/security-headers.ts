import type { HelmetOptions } from 'helmet';

// Sprint 3 — the API's response-header policy, in one testable place.
//
// This lives here rather than inline in main.ts for a specific reason: header
// policy is security configuration that is invisible in ordinary use. Nothing
// in the app breaks when a directive quietly disappears, no test fails, and
// the loss shows up only in a pen-test report months later. Exported as data,
// it can be asserted on directly.

export type CspMode = 'off' | 'report-only' | 'enforce';

export interface SecurityHeaderInput {
  cspMode: CspMode;
  hstsMaxAgeSeconds: number;
  hstsIncludeSubDomains: boolean;
  hstsPreload: boolean;
}

// The API serves JSON and nothing else — no HTML, no inline scripts, no
// styles, no images, no frames. That makes its CSP the easy case: deny
// everything. A response that somehow renders in a browser (a reflected error
// page, a mistyped Content-Type) can then load no scripts and phone nothing
// home. `frame-ancestors 'none'` blocks framing without relying on the older
// X-Frame-Options.
//
// There is deliberately no `report-uri`/`report-to`: a directive pointing at
// an endpoint that 404s produces noise in every browser console and collects
// nothing. It goes in when a collector exists (see E-3 in
// docs/sprint-03/EXCEPTIONS.md).
export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
  'upgrade-insecure-requests': [],
};

// Permissions-Policy is not shipped by helmet, so it is set as a plain header.
// The API has no use for ANY of these capabilities, and an empty allowlist
// `()` denies each outright — including to anything framed, since the denial
// is inherited.
export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'fullscreen=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'publickey-credentials-get=()',
  'screen-wake-lock=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ');

export function buildHelmetOptions(input: SecurityHeaderInput): HelmetOptions {
  return {
    // 'report-only' and 'enforce' carry the SAME directives. That is the point
    // of the staged rollout: enforcing later cannot introduce a rule that was
    // not already being evaluated and reported on.
    contentSecurityPolicy:
      input.cspMode === 'off'
        ? false
        : {
            useDefaults: false,
            directives: CSP_DIRECTIVES,
            reportOnly: input.cspMode === 'report-only',
          },
    // helmet emits HSTS only over TLS, so a plaintext local run is unaffected.
    // max-age is small by default — this is the one header whose mistakes
    // cannot be withdrawn, so it gets a ramp rather than a value.
    hsts:
      input.hstsMaxAgeSeconds > 0
        ? {
            maxAge: input.hstsMaxAgeSeconds,
            includeSubDomains: input.hstsIncludeSubDomains,
            preload: input.hstsPreload,
          }
        : false,
    // The API is not a document origin; a referrer should never carry a path
    // off it.
    referrerPolicy: { policy: 'no-referrer' },
    // COEP would break the credentialed cross-origin flows the web app relies
    // on, and CORP stays at same-site rather than same-origin for the same
    // reason. Tightening either is a topology decision — see
    // docs/adr/0001-web-api-deployment-topology.md.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  };
}
