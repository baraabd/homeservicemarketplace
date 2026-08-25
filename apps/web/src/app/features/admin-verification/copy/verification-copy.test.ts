import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CASE_STATE_LABELS,
  DOCUMENT_KIND_LABELS,
  SCAN_STATE_LABELS,
  UI,
} from './verification-copy';

// Sprint 9B — EN/AR parity, following the Sprint 8 wizard-copy pattern.
//
// The only way an untranslated string is caught before an Arabic reader sees an
// English label. A missing key here is not a crash — it is a silently English
// UI for half the users — which is exactly the class of bug a test has to find.

const MAPS = {
  CASE_STATE_LABELS,
  DOCUMENT_KIND_LABELS,
  SCAN_STATE_LABELS,
  UI,
} as const;

describe('EN/AR copy parity', () => {
  it.each(Object.entries(MAPS))('%s has identical keys in both languages', (_name, map) => {
    const en = Object.keys(map.en).sort();
    const ar = Object.keys(map.ar).sort();
    expect(ar).toEqual(en);
  });

  it.each(Object.entries(MAPS))('%s has no empty string in either language', (_name, map) => {
    for (const lang of ['en', 'ar'] as const) {
      for (const [key, value] of Object.entries(map[lang])) {
        expect(typeof value, `${lang}.${key}`).toBe('string');
        expect(value.trim().length, `${lang}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it.each(Object.entries(MAPS))('%s Arabic is not a copy of the English', (_name, map) => {
    // Catches the placeholder-translation failure: keys present, values
    // duplicated from English so the parity test above passes vacuously.
    // Codes and version-like tokens are legitimately identical, so only
    // prose-length values are compared.
    const identical = Object.keys(map.en).filter((k) => {
      const en = (map.en as Record<string, string>)[k];
      const ar = (map.ar as Record<string, string>)[k];
      return en === ar && en.length > 6;
    });
    expect(identical).toEqual([]);
  });

  it('every Arabic value actually contains Arabic script', () => {
    for (const [name, map] of Object.entries(MAPS)) {
      for (const [key, value] of Object.entries(map.ar)) {
        expect(/[؀-ۿ]/.test(value), `${name}.ar.${key} has no Arabic script`).toBe(true);
      }
    }
  });
});

describe('the evidence feature does not import public-media helpers', () => {
  // docs/sprint-09b/UX-UI-COMPONENT-AUDIT.md — the guardrail.
  //
  // RequestMediaGallery / resolveMediaUrl / media-api resolve PERMANENT PUBLIC
  // URLs through a route that is @Public() and cached `public, immutable` for a
  // year. Correct for a photo of a leaking tap; catastrophic for a passport.
  //
  // Matches MODULE SPECIFIERS, not comments or filenames, so it cannot be
  // satisfied by renaming a variable and cannot fire on prose that merely
  // mentions the helper.
  const here = dirname(fileURLToPath(import.meta.url));
  const featureRoot = join(here, '..');

  const FORBIDDEN = [
    'RequestMediaGallery',
    'media-url',
    'media-api',
    'request-media',
    'resolveMediaUrl',
  ];

  function collect(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...collect(full));
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it('imports nothing from the public media modules', () => {
    const offenders: string[] = [];

    for (const file of collect(featureRoot)) {
      const src = readFileSync(file, 'utf8');
      // Only the specifier half of an import/require, so a mention inside a
      // comment explaining WHY we avoid it does not trip the rule.
      const specifiers = [...src.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)].map(
        (m) => m[1],
      );
      for (const spec of specifiers) {
        if (FORBIDDEN.some((f) => spec.includes(f))) offenders.push(`${file} -> ${spec}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
