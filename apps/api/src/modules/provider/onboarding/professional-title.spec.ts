import {
  TITLE_MAX_LENGTH,
  knownTitleSlugs,
  suggestProfessionalTitle,
  validateProfessionalTitle,
} from '@homeservicemarketplace/contracts';

// Sprint 9B.18 — the professional title.
//
// Two separate jobs, tested separately: SUGGESTING one from the primary
// specialty, and REFUSING one that should not be published. Nothing here
// writes anything — a suggestion is a suggestion until the provider accepts it,
// and the tests that matter most are the ones asserting what gets refused.

const catalogue = { labelEn: 'Flooring', labelAr: 'أرضيات' };

describe('suggestProfessionalTitle', () => {
  it('names the TRADE, not the category', () => {
    // The category is "Plumbing"; the person is a "Plumber". Offering someone
    // the category name as their title is the lazy version of this feature.
    expect(suggestProfessionalTitle({ slug: 'plumbing', ...catalogue, lang: 'en' })).toBe(
      'Plumber',
    );
  });

  it('gives the Arabic trade name, not a translation of the English', () => {
    expect(suggestProfessionalTitle({ slug: 'plumbing', ...catalogue, lang: 'ar' })).toBe('سبّاك');
    expect(suggestProfessionalTitle({ slug: 'electrical', ...catalogue, lang: 'ar' })).toBe(
      'كهربائي',
    );
  });

  it('differs per language for every trade it knows', () => {
    for (const slug of knownTitleSlugs()) {
      const en = suggestProfessionalTitle({ slug, ...catalogue, lang: 'en' });
      const ar = suggestProfessionalTitle({ slug, ...catalogue, lang: 'ar' });
      // The slug is folded into the compared value so a failure names which
      // trade broke — jest's expect takes no message argument.
      expect({ slug, same: en === ar }).toEqual({ slug, same: false });
      expect({ slug, ok: en.trim().length > 1 && ar.trim().length > 1 }).toEqual({
        slug,
        ok: true,
      });
    }
  });

  it('falls back to the CATALOGUE label for a slug it has never heard of', () => {
    // A category added tomorrow must suggest something readable rather than
    // nothing — and never an English word handed to an Arabic reader.
    expect(suggestProfessionalTitle({ slug: 'brand-new', ...catalogue, lang: 'en' })).toBe(
      'Flooring',
    );
    expect(suggestProfessionalTitle({ slug: 'brand-new', ...catalogue, lang: 'ar' })).toBe(
      'أرضيات',
    );
  });

  it('is total: every input produces something a human can read', () => {
    const out = suggestProfessionalTitle({
      slug: '',
      labelEn: '  Odd  ',
      labelAr: ' غريب ',
      lang: 'en',
    });
    expect(out).toBe('Odd');
  });

  it('is deterministic', () => {
    const once = suggestProfessionalTitle({ slug: 'carpentry', ...catalogue, lang: 'ar' });
    const twice = suggestProfessionalTitle({ slug: 'carpentry', ...catalogue, lang: 'ar' });
    expect(once).toBe(twice);
  });
});

describe('validateProfessionalTitle — what it accepts', () => {
  it.each(['Plumber', 'سبّاك', 'AC Technician', 'Carpenter & Joiner', 'فنّي تكييف'])(
    'accepts %j',
    (value) => {
      expect(validateProfessionalTitle(value)).toEqual({ ok: true });
    },
  );
});

describe('validateProfessionalTitle — length', () => {
  it('refuses something too short to be a trade', () => {
    expect(validateProfessionalTitle('a')).toEqual({ ok: false, code: 'TOO_SHORT' });
    expect(validateProfessionalTitle('   ')).toEqual({ ok: false, code: 'TOO_SHORT' });
  });

  it('refuses a title longer than the cap', () => {
    expect(validateProfessionalTitle('x'.repeat(TITLE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      code: 'TOO_LONG',
    });
  });

  it('measures the TRIMMED value, so padding cannot smuggle length', () => {
    expect(validateProfessionalTitle(`  ${'x'.repeat(TITLE_MAX_LENGTH)}  `)).toEqual({ ok: true });
  });
});

describe('validateProfessionalTitle — moving the customer off-platform', () => {
  it.each([
    'Plumber https://example.com',
    'Plumber www.example.com',
    'Best plumber example.com',
    'سبّاك www.example.sy',
  ])('refuses the URL in %j', (value) => {
    const verdict = validateProfessionalTitle(value);
    expect(verdict.ok).toBe(false);
  });

  it.each([
    'Plumber me@example.com',
    'Plumber 0912345678',
    'Plumber +963 912 345 678',
    'سبّاك ٠٩١٢٣٤٥٦٧٨',
  ])('refuses the contact detail in %j', (value) => {
    // A title has no legitimate reason to carry one, and every instance is an
    // attempt to take the transaction somewhere neither party is protected.
    const verdict = validateProfessionalTitle(value);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(['CONTAINS_CONTACT', 'CONTAINS_URL']).toContain(verdict.code);
  });
});

describe('validateProfessionalTitle — claims the platform cannot stand behind', () => {
  it.each(['Certified Plumber', 'Licensed Electrician', 'Insured Carpenter', 'سبّاك مرخّص'])(
    'refuses the unsupported credential in %j',
    (value) => {
      // A customer reads these as facts the marketplace checked. Until
      // verification can evidence them, typing one is a claim made on our
      // behalf that nobody verified.
      expect(validateProfessionalTitle(value)).toEqual({
        ok: false,
        code: 'UNSUPPORTED_CREDENTIAL',
      });
    },
  );

  it.each(['Best Plumber', 'Cheapest Electrician', '#1 Carpenter', 'الأفضل سبّاك'])(
    'refuses the unsubstantiable claim in %j',
    (value) => {
      expect(validateProfessionalTitle(value)).toEqual({ ok: false, code: 'PROHIBITED_CLAIM' });
    },
  );

  it('does not refuse a word that merely CONTAINS a banned term', () => {
    // "Bestway" is a name, not a boast. Matching on substrings would refuse
    // legitimate titles and teach providers the field is broken.
    expect(validateProfessionalTitle('Bestway Plumbing')).toEqual({ ok: true });
  });

  it('is case-insensitive', () => {
    expect(validateProfessionalTitle('CERTIFIED Plumber').ok).toBe(false);
    expect(validateProfessionalTitle('bEsT Plumber').ok).toBe(false);
  });
});

describe('the suggestion and the rule agree', () => {
  it('every suggested title would itself be publishable', () => {
    // A feature that suggests something the validator then refuses is worse
    // than one that suggests nothing at all.
    for (const slug of knownTitleSlugs()) {
      for (const lang of ['en', 'ar'] as const) {
        const suggestion = suggestProfessionalTitle({ slug, ...catalogue, lang });
        expect({ slug, lang, suggestion, verdict: validateProfessionalTitle(suggestion) }).toEqual({
          slug,
          lang,
          suggestion,
          verdict: { ok: true },
        });
      }
    }
  });
});
