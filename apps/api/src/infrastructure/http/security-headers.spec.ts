import {
  CSP_DIRECTIVES,
  PERMISSIONS_POLICY,
  buildHelmetOptions,
  type SecurityHeaderInput,
} from './security-headers';

// Sprint 3 — header policy regression tests.
//
// These exist because a missing security header breaks nothing. The app
// serves, the suite passes, and the only symptom is a finding in someone
// else's report months later. Every assertion below is therefore about a
// directive being PRESENT and RESTRICTIVE, not about the app working.

const base: SecurityHeaderInput = {
  cspMode: 'report-only',
  hstsMaxAgeSeconds: 300,
  hstsIncludeSubDomains: false,
  hstsPreload: false,
};

describe('security headers', () => {
  describe('CSP', () => {
    it('denies every fetch directive by default', () => {
      // The API serves JSON. There is no legitimate script, style, image, or
      // frame, so the correct policy is "nothing".
      expect(CSP_DIRECTIVES['default-src']).toEqual(["'none'"]);
      expect(CSP_DIRECTIVES['object-src']).toEqual(["'none'"]);
      expect(CSP_DIRECTIVES['base-uri']).toEqual(["'none'"]);
      expect(CSP_DIRECTIVES['form-action']).toEqual(["'none'"]);
    });

    it('blocks framing without relying on X-Frame-Options', () => {
      expect(CSP_DIRECTIVES['frame-ancestors']).toEqual(["'none'"]);
    });

    it("never contains 'unsafe-inline' or 'unsafe-eval'", () => {
      const flat = Object.values(CSP_DIRECTIVES).flat().join(' ');
      expect(flat).not.toContain('unsafe-inline');
      expect(flat).not.toContain('unsafe-eval');
    });

    it('report-only and enforce carry IDENTICAL directives', () => {
      // The whole staged rollout rests on this. If enforcing shipped
      // directives that report-only never evaluated, the "we watched the
      // reports first" argument would be worthless.
      const reporting = buildHelmetOptions({ ...base, cspMode: 'report-only' });
      const enforcing = buildHelmetOptions({ ...base, cspMode: 'enforce' });

      const csp = (o: ReturnType<typeof buildHelmetOptions>) =>
        o.contentSecurityPolicy as { directives: unknown; reportOnly: boolean };

      expect(csp(reporting).directives).toEqual(csp(enforcing).directives);
      expect(csp(reporting).reportOnly).toBe(true);
      expect(csp(enforcing).reportOnly).toBe(false);
    });

    it('can be switched off entirely without a redeploy', () => {
      // A policy that is actively breaking production must be disableable by
      // an env var. That escape hatch is what makes shipping it at all safe.
      expect(buildHelmetOptions({ ...base, cspMode: 'off' }).contentSecurityPolicy).toBe(false);
    });

    it('does not use helmet defaults', () => {
      // helmet's default policy permits 'self' for several directives. Ours is
      // stricter, and useDefaults:true would silently widen it.
      const csp = buildHelmetOptions(base).contentSecurityPolicy as { useDefaults: boolean };
      expect(csp.useDefaults).toBe(false);
    });
  });

  describe('HSTS', () => {
    it('ships the ramped max-age it was given', () => {
      const hsts = buildHelmetOptions({ ...base, hstsMaxAgeSeconds: 86_400 }).hsts as {
        maxAge: number;
      };
      expect(hsts.maxAge).toBe(86_400);
    });

    it('keeps includeSubDomains and preload OFF unless asked', () => {
      // Both are effectively irreversible on a human timescale — a subdomain
      // that does not serve TLS becomes unreachable for the full max-age, and
      // preload submission is not something you undo this quarter.
      const hsts = buildHelmetOptions(base).hsts as {
        includeSubDomains: boolean;
        preload: boolean;
      };
      expect(hsts.includeSubDomains).toBe(false);
      expect(hsts.preload).toBe(false);
    });

    it('honours the full ramp when asked', () => {
      const hsts = buildHelmetOptions({
        ...base,
        hstsMaxAgeSeconds: 31_536_000,
        hstsIncludeSubDomains: true,
        hstsPreload: true,
      }).hsts as { maxAge: number; includeSubDomains: boolean; preload: boolean };
      expect(hsts).toMatchObject({
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: true,
      });
    });

    it('is omitted entirely at max-age 0', () => {
      expect(buildHelmetOptions({ ...base, hstsMaxAgeSeconds: 0 }).hsts).toBe(false);
    });
  });

  describe('Permissions-Policy', () => {
    it.each([
      'camera',
      'microphone',
      'geolocation',
      'payment',
      'usb',
      'display-capture',
      'publickey-credentials-get',
    ])('denies %s outright', (feature) => {
      expect(PERMISSIONS_POLICY).toContain(`${feature}=()`);
    });

    it('grants nothing to anyone — every allowlist is empty', () => {
      // `feature=(self)` or `feature=*` would be a grant. The API needs none.
      expect(PERMISSIONS_POLICY).not.toMatch(/=\((?!\))/);
      expect(PERMISSIONS_POLICY).not.toContain('*');
    });
  });

  describe('cross-origin policies', () => {
    it('leaves COEP off and CORP at same-site so credentialed flows keep working', () => {
      // Tightening either breaks the web app's cross-origin cookie flow. That
      // is a topology decision, documented in ADR 0001 — not something to
      // change because a scanner suggested it.
      const options = buildHelmetOptions(base);
      expect(options.crossOriginEmbedderPolicy).toBe(false);
      expect(options.crossOriginResourcePolicy).toEqual({ policy: 'same-site' });
    });

    it('sends no referrer', () => {
      expect(buildHelmetOptions(base).referrerPolicy).toEqual({ policy: 'no-referrer' });
    });
  });
});
