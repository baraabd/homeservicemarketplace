import { describe, expect, it } from 'vitest';

import { AUTOSAVE_COPY } from './autosave-copy';
import { AVAILABILITY_COPY } from './availability-copy';
import { BASICS_COPY } from './basics-copy';
import { SCREEN_COPY, SHELL_COPY } from './onboarding-hub-copy';
import { PUBLIC_PROFILE_COPY } from './public-profile-copy';
import { REVIEW_COPY } from './review-copy';
import { SERVICE_AREA_COPY } from './service-area-copy';
import { SERVICES_COPY } from './services-copy';

// Sprint 9B.25 — EN/AR key parity for EVERY V2 copy module, in one place.
//
// docs/sprint-09b25/HARDENING.md
//
// Two of the seven modules had a parity test; five did not. A key present in
// English and missing in Arabic renders `undefined` to an Arabic-speaking
// provider — and it renders it silently, because nothing in the type system
// stops a Record literal from being lopsided once the two halves are written
// out separately.
//
// This walks the structure rather than the top level: several of these modules
// nest (per-state objects, per-code maps), and a top-level-only check passes
// while a nested Arabic branch is missing half its sentences.

type Any = Record<string, unknown>;

/** Every dotted key path in an object, ignoring array contents. */
function paths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Any)) {
    out.push(...paths(v, prefix ? `${prefix}.${k}` : k));
  }
  return out.sort();
}

/** Which leaves are functions, so a value-producing key cannot become a bare
 *  string in one language and stay a function in the other. */
function functionPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'function') return [prefix];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Any)) {
    out.push(...functionPaths(v, prefix ? `${prefix}.${k}` : k));
  }
  return out.sort();
}

const MODULES: Array<[string, { en: unknown; ar: unknown }]> = [
  ['autosave', AUTOSAVE_COPY],
  ['availability', AVAILABILITY_COPY],
  ['basics', BASICS_COPY],
  ['hub-screen', SCREEN_COPY],
  ['hub-shell', SHELL_COPY],
  ['public-profile', PUBLIC_PROFILE_COPY],
  ['review', REVIEW_COPY],
  ['service-area', SERVICE_AREA_COPY],
  ['services', SERVICES_COPY],
];

describe('every V2 copy module has the same shape in both languages', () => {
  it.each(MODULES)('%s: identical key paths', (name, mod) => {
    expect(paths(mod.ar), `${name}: ar is missing keys English has`).toEqual(paths(mod.en));
  });

  it.each(MODULES)('%s: the same keys are functions', (name, mod) => {
    // A key that interpolates in one language and not the other is how a
    // count or a version number silently disappears from Arabic.
    expect(functionPaths(mod.ar), `${name}: function keys differ`).toEqual(functionPaths(mod.en));
  });

  it.each(MODULES)('%s: Arabic is actually translated, not copied English', (name, mod) => {
    // A parity test alone passes when someone pastes English into the Arabic
    // branch to make the keys line up. At least most leaves must differ.
    const enLeaves = leaves(mod.en);
    const arLeaves = leaves(mod.ar);
    const identical = enLeaves.filter((v, i) => v === arLeaves[i]).length;
    expect(identical, `${name}: too many identical strings`).toBeLessThan(
      Math.ceil(enLeaves.length * 0.5),
    );
  });
});

/** String leaves only — functions and numbers are not translatable text. */
function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const out: string[] = [];
  for (const k of Object.keys(value as Any).sort()) {
    out.push(...leaves((value as Any)[k]));
  }
  return out;
}
