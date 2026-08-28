import { describe, it, expect } from 'vitest';
import * as contracts from '@homeservicemarketplace/contracts';

import { isPlausibleE164, normalisePhoneNumber, PHONE_E164_PATTERN } from './phone-format';

// Sprint 9B.17 — the drift guard.
//
// The web mirrors the contracts phone rule instead of importing it, because a
// runtime value import from a CJS-emitting package breaks the production
// browser build (see phone-format.ts, and request-media/constants.ts before
// it). A mirror that nobody checks is a fork waiting to happen: the form would
// accept a number the API rejects, and the provider would be told to fix
// something that already looks right.
//
// So this file imports BOTH and asserts they agree. It runs under vitest,
// where the CJS interop is fine — only the rollup production build cannot do
// it, which is exactly why the mirror exists.

const CASES = [
  '+963912345678',
  '+46701234567',
  '+18005550199',
  '+441632960961',
  '+20 100 123 4567',
  '+963 912 345 678',
  '+46-70-123 45 67',
  '+1 (800) 555-0199',
  '+68512345',
  '963912345678',
  '+0912345678',
  '+123',
  '+1234567890123456',
  '+1800FLOWERS',
  '',
  '+',
  '  ',
  'call me on +963912345678 please',
];

describe('the web phone rule matches the contracts rule', () => {
  it.each(CASES)('agrees on isPlausibleE164(%j)', (value) => {
    expect(isPlausibleE164(value)).toBe(contracts.isPlausibleE164(value));
  });

  it.each(CASES)('agrees on normalisePhoneNumber(%j)', (value) => {
    expect(normalisePhoneNumber(value)).toBe(contracts.normalisePhoneNumber(value));
  });

  it('uses the identical pattern source', () => {
    expect(PHONE_E164_PATTERN.source).toBe(contracts.PHONE_E164_PATTERN.source);
    expect(PHONE_E164_PATTERN.flags).toBe(contracts.PHONE_E164_PATTERN.flags);
  });
});

describe('the rule itself', () => {
  it('accepts an international number typed with spaces', () => {
    expect(isPlausibleE164('+963 912 345 678')).toBe(true);
  });

  it('refuses a number with no country code', () => {
    expect(isPlausibleE164('0912345678')).toBe(false);
  });

  it('refuses a sentence containing a number', () => {
    expect(isPlausibleE164('call me on +963912345678 please')).toBe(false);
  });
});
