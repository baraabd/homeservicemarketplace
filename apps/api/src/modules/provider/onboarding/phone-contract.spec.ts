import {
  PHONE_E164_PATTERN,
  isPlausibleE164,
  normalisePhoneNumber,
} from '@homeservicemarketplace/contracts';

// Sprint 9B.17 — the phone format rule, shared by the form and the API.
//
// The bias these tests encode: refusing a REAL number is worse than accepting
// an implausible one, because only one of those has a person on the other end
// who cannot finish their application.

describe('normalisePhoneNumber', () => {
  it.each([
    ['+963 912 345 678', '+963912345678'],
    ['+46-70-123 45 67', '+46701234567'],
    ['+1 (800) 555-0199', '+18005550199'],
    ['+49.170.1234567', '+491701234567'],
  ])('strips the punctuation people type: %j', (input, expected) => {
    expect(normalisePhoneNumber(input)).toBe(expected);
  });

  it('does NOT strip letters', () => {
    // Deleting them would turn an undiallable vanity number into one that
    // looks valid and rings nobody.
    expect(normalisePhoneNumber('+1800FLOWERS')).toBe('+1800FLOWERS');
  });
});

describe('isPlausibleE164', () => {
  it.each([
    '+963912345678',
    '+46701234567',
    '+18005550199',
    '+441632960961',
    '+20 100 123 4567',
    '+9611234567',
  ])('accepts %j', (value) => {
    expect(isPlausibleE164(value)).toBe(true);
  });

  it.each([
    ['no plus', '963912345678'],
    ['a zero country code', '+0912345678'],
    ['far too short', '+123'],
    ['longer than E.164 allows', '+1234567890123456'],
    ['letters', '+1800FLOWERS'],
    ['empty', ''],
    ['just a plus', '+'],
    ['an injection attempt', "+1234567890'; DROP TABLE--"],
  ])('refuses %s', (_label, value) => {
    expect(isPlausibleE164(value)).toBe(false);
  });

  it('accepts the shortest real numbering plans', () => {
    // The lower bound is deliberately permissive; some national numbers really
    // are this short.
    expect(isPlausibleE164('+68512345')).toBe(true);
  });

  it('exports a pattern anchored at both ends', () => {
    // An unanchored pattern would accept "hello +963912345678 world", which is
    // how a validated field ends up holding a sentence.
    expect(PHONE_E164_PATTERN.source.startsWith('^')).toBe(true);
    expect(PHONE_E164_PATTERN.source.endsWith('$')).toBe(true);
    expect(PHONE_E164_PATTERN.test('call me on +963912345678 please')).toBe(false);
  });
});
