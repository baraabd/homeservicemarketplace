import { describe, it, expect } from 'vitest';

import { AVATAR_COPY, BASICS_COPY, type Lang } from './basics-copy';

// Sprint 9B.17 — copy parity for Task 1.
//
// A missing Arabic string does not crash anything; it silently renders English
// inside an RTL layout, which is the class of defect nobody notices until a
// user reports it.

const LANGS: Lang[] = ['en', 'ar'];

describe('BASICS_COPY', () => {
  it('has the same keys in both languages', () => {
    expect(Object.keys(BASICS_COPY.ar).sort()).toEqual(Object.keys(BASICS_COPY.en).sort());
  });

  it.each(LANGS)('has no empty string in %s', (lang) => {
    for (const [key, value] of Object.entries(BASICS_COPY[lang])) {
      expect(value.trim(), `${key} in ${lang}`).not.toBe('');
    }
  });

  it('actually differs between languages', () => {
    // Guards the copy-paste that leaves English in the Arabic bundle.
    expect(BASICS_COPY.ar.typeLegend).not.toBe(BASICS_COPY.en.typeLegend);
    expect(BASICS_COPY.ar.phone).not.toBe(BASICS_COPY.en.phone);
  });

  it.each(LANGS)('never promises the phone number is verified, in %s', (lang) => {
    // The sentence must say we will confirm it LATER and that continuing does
    // not require it. Claiming it is confirmed would be the falsely-passed
    // half of the phone problem.
    const note = BASICS_COPY[lang].phoneNotVerified;
    expect(note.length).toBeGreaterThan(10);
    expect(note.toLowerCase()).not.toMatch(/\bverified\b|\bconfirmed\b/);
  });

  it.each(LANGS)('tells the truth about a type change in %s', (lang) => {
    // Two claims a provider needs: requirements change, and nothing already
    // sent is deleted.
    expect(BASICS_COPY[lang].typeChangeBody.length).toBeGreaterThan(40);
  });

  it('asks for a name and a phone number, and nothing about an address', () => {
    for (const lang of LANGS) {
      const all = Object.values(BASICS_COPY[lang]).join(' ').toLowerCase();
      for (const word of ['street', 'postcode', 'zip code']) {
        expect(all, `${word} in ${lang}`).not.toContain(word);
      }
    }
  });
});

describe('AVATAR_COPY', () => {
  it('has the same top-level keys in both languages', () => {
    expect(Object.keys(AVATAR_COPY.ar).sort()).toEqual(Object.keys(AVATAR_COPY.en).sort());
  });

  it('explains every failure code the pipeline can produce, in both languages', () => {
    const codes = [
      'UNSUPPORTED_TYPE',
      'TOO_LARGE',
      'FILE_TOO_LARGE',
      'DECODE_FAILED',
      'ENCODE_FAILED',
      'CONTENT_MISMATCH',
      'NOT_AN_AVATAR_KEY',
      'FILE_MISSING',
      'DISALLOWED_FORMAT',
      'REMOVE_FAILED',
      'UPLOAD_FAILED',
    ];
    for (const lang of LANGS) {
      for (const code of codes) {
        expect(AVATAR_COPY[lang].failure[code], `${code} in ${lang}`).toBeTruthy();
      }
    }
  });

  it('distinguishes uploading from checking', () => {
    // They are different waits: one is the network, the other is the server
    // deciding whether the bytes are usable. One message for both would leave
    // the second wait unaccounted for.
    for (const lang of LANGS) {
      expect(AVATAR_COPY[lang].uploading).not.toBe(AVATAR_COPY[lang].checking);
    }
  });

  it('never renders a raw refusal code at the user', () => {
    for (const lang of LANGS) {
      for (const [code, message] of Object.entries(AVATAR_COPY[lang].failure)) {
        expect(message).not.toBe(code);
        expect(message).not.toMatch(/^[A-Z_]+$/);
      }
    }
  });
});
