import { describe, expect, it } from 'vitest';

import { PORTFOLIO_COPY, portfolioErrorText, type Lang } from './portfolio-copy';

// Sprint 9B.10 — the only way an untranslated string is caught before an Arabic
// reader sees an English label.
//
// Same guarantee wizard-copy.test.ts provides for onboarding: key parity, plus
// a check that the Arabic side is actually Arabic rather than a copy-paste of
// the English.

const LANGS: Lang[] = ['en', 'ar'];

describe('both languages say the same things', () => {
  it('has identical key sets', () => {
    const en = Object.keys(PORTFOLIO_COPY.en).sort();
    const ar = Object.keys(PORTFOLIO_COPY.ar).sort();
    expect(ar).toEqual(en);
  });

  it.each(LANGS)('has no empty string in %s', (lang) => {
    for (const [key, value] of Object.entries(PORTFOLIO_COPY[lang])) {
      expect(value.trim(), `${lang}.${key}`).not.toBe('');
    }
  });

  it('never reuses the English string as the Arabic one', () => {
    // The failure mode a key-parity test alone misses: the key exists, so
    // parity passes, and an Arabic reader sees English.
    for (const key of Object.keys(PORTFOLIO_COPY.en)) {
      expect(PORTFOLIO_COPY.ar[key], key).not.toBe(PORTFOLIO_COPY.en[key]);
    }
  });

  it('writes the Arabic copy in Arabic script', () => {
    for (const [key, value] of Object.entries(PORTFOLIO_COPY.ar)) {
      // Allow a few Latin characters (JPEG, PNG, WebP appear in a format
      // message) but require Arabic to be present.
      expect(value, key).toMatch(/[؀-ۿ]/);
    }
  });
});

describe('every server refusal code has copy', () => {
  it.each([
    'LIMIT_REACHED',
    'FILE_TOO_LARGE',
    'DISALLOWED_FORMAT',
    'NOT_A_PORTFOLIO_KEY',
    'PUBLICATION_RIGHT_NOT_ACKNOWLEDGED',
    'UPLOAD_FAILED',
  ])('%s resolves in both languages', (code) => {
    for (const lang of LANGS) {
      const text = portfolioErrorText(lang, code);
      expect(text).not.toBe('');
      expect(text).not.toBe(PORTFOLIO_COPY[lang].errUNKNOWN);
    }
  });

  it('falls back rather than rendering a raw code', () => {
    // A provider must never be shown `NEW_SERVER_CODE_2027`. An unrecognised
    // code is a bug on our side, and the person looking at the screen is not
    // the one who can fix it.
    for (const lang of LANGS) {
      expect(portfolioErrorText(lang, 'SOMETHING_NEW')).toBe(PORTFOLIO_COPY[lang].errUNKNOWN);
      expect(portfolioErrorText(lang, undefined)).toBe(PORTFOLIO_COPY[lang].errUNKNOWN);
    }
  });
});
