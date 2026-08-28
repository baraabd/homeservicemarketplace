import { describe, it, expect } from 'vitest';
import * as contracts from '@homeservicemarketplace/contracts';

import { TITLE_MAX_LENGTH, validateProfessionalTitle } from './title-format';

// Sprint 9B.18 — the drift guard for the title rule.
//
// The web mirrors the contracts rule instead of importing it, because a runtime
// value import from a CJS-emitting package breaks the production browser build
// (see title-format.ts, and phone-format.ts before it). A mirror nobody checks
// is a fork waiting to happen: the form would accept a title the API refuses,
// and the provider would be told to fix something that already looks right.
//
// So this imports BOTH and asserts they agree. It runs under vitest, where the
// CJS interop is fine — only the rollup production build cannot do it, which is
// exactly why the mirror exists.

const CASES = [
  'Plumber',
  'سبّاك',
  'AC Technician',
  'Carpenter & Joiner',
  'Bestway Plumbing',
  'Certified Plumber',
  'Licensed Electrician',
  'سبّاك مرخّص',
  'Best Plumber',
  '#1 Carpenter',
  'الأفضل سبّاك',
  'Plumber https://example.com',
  'Plumber www.example.com',
  'Plumber me@example.com',
  'Plumber 0912345678',
  'Plumber +963 912 345 678',
  'سبّاك ٠٩١٢٣٤٥٦٧٨',
  'a',
  '  ',
  '',
  'x'.repeat(TITLE_MAX_LENGTH),
  'x'.repeat(TITLE_MAX_LENGTH + 1),
];

describe('the web title rule matches the contracts rule', () => {
  it.each(CASES)('agrees on %j', (value) => {
    expect(validateProfessionalTitle(value)).toEqual(contracts.validateProfessionalTitle(value));
  });

  it('agrees on the length bounds', () => {
    expect(TITLE_MAX_LENGTH).toBe(contracts.TITLE_MAX_LENGTH);
  });

  it('accepts every title the server would SUGGEST', () => {
    // The server computes suggestions and the client renders them. A client
    // rule that refused one of them would tell a provider the platform's own
    // suggestion is invalid.
    for (const slug of contracts.knownTitleSlugs()) {
      for (const lang of ['en', 'ar'] as const) {
        const suggestion = contracts.suggestProfessionalTitle({
          slug,
          labelEn: 'Flooring',
          labelAr: 'أرضيات',
          lang,
        });
        expect({ slug, lang, verdict: validateProfessionalTitle(suggestion) }).toEqual({
          slug,
          lang,
          verdict: { ok: true },
        });
      }
    }
  });
});

describe('the rule itself', () => {
  it('refuses a credential the platform has not verified', () => {
    expect(validateProfessionalTitle('Certified Plumber')).toEqual({
      ok: false,
      code: 'UNSUPPORTED_CREDENTIAL',
    });
  });

  it('refuses a way to move the customer off-platform', () => {
    expect(validateProfessionalTitle('Plumber www.example.com').ok).toBe(false);
    expect(validateProfessionalTitle('Plumber 0912345678').ok).toBe(false);
  });

  it('does not refuse a name that merely contains a banned word', () => {
    expect(validateProfessionalTitle('Bestway Plumbing')).toEqual({ ok: true });
  });
});
