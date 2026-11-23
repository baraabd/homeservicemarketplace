import { CURRENT_LEGAL_DOCUMENTS } from '@homeservicemarketplace/contracts';

// K02 — every real signup names the exact Terms/Privacy versions it accepts.
// Read from the shared registry so a version bump cannot leave the harness
// registering against a stale version (the API would refuse it with 409).
export const LEGAL_ACCEPTANCE = Object.freeze({
  termsVersion: CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version,
  privacyVersion: CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version,
  locale: 'en' as const,
});
