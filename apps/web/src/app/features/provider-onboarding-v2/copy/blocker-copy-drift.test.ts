import { describe, it, expect } from 'vitest';

import { REVIEW_COPY, blockerLine } from './review-copy';

// Every blocker the SERVER can raise must have copy on BOTH languages.
//
// This test exists because of a defect the Mode B baseline caught on screen:
// a provider with a finished application saw
//
//     "Something here still needs attention."
//
// on the review screen — for a real, specific requirement, on the very screen
// that collects it. The cause was a name mismatch rather than a missing
// string: the copy was keyed `acceptedConsentVersion:REQUIRED`, which is the
// DRAFT COLUMN the wizard writes, while `evaluateOnboarding` raises the issue
// as `consent:REQUIRED`. Four other codes had no copy at all.
//
// A fallback is the right behaviour for a code this client has never heard of
// — better a vague sentence than a crash. It is the wrong behaviour for a code
// the server ships today, and nothing but a test can tell those two apart.
//
// KEEP THIS LIST IN STEP WITH:
//   apps/api/src/modules/provider/onboarding/provider-onboarding.policy.ts
//
// If the policy gains an issue, this test fails until someone writes the
// sentence a provider will read.

const SERVER_ISSUES: ReadonlyArray<[field: string, code: string]> = [
  ['availability', 'REQUIRED'],
  ['bio', 'REQUIRED'],
  ['bio', 'TOO_SHORT'],
  ['consent', 'REQUIRED'],
  ['displayName', 'REQUIRED'],
  ['displayName', 'TOO_SHORT'],
  ['emailVerified', 'UNVERIFIED'],
  ['headline', 'REQUIRED'],
  ['headline', 'TOO_SHORT'],
  ['legalBusinessName', 'REQUIRED'],
  ['phoneNumber', 'NOT_VERIFIED'],
  ['phoneNumber', 'REQUIRED'],
  ['providerType', 'REQUIRED'],
  ['serviceAreaCity', 'REQUIRED'],
  ['serviceAreaCountry', 'REQUIRED'],
  ['serviceAreaRadiusKm', 'REQUIRED'],
  ['serviceCategories', 'AWAITING_REVIEW'],
  ['serviceCategories', 'REQUIRED'],
  ['specialties', 'AWAITING_REVIEW'],
  ['specialties', 'REQUIRED'],
  ['yearsOfExperience', 'OUT_OF_RANGE'],
  ['yearsOfExperience', 'REQUIRED'],
];

describe.each(['en', 'ar'] as const)('review blocker copy — %s', (lang) => {
  const copy = REVIEW_COPY[lang];

  it.each(SERVER_ISSUES)('%s:%s has real copy, not the fallback', (field, code) => {
    const line = blockerLine(copy, field, code);
    expect(line).not.toBe(copy.blockerFallback);
    expect(line.trim().length).toBeGreaterThan(0);
  });

  it('still falls back for a code this client has never seen', () => {
    // The fallback is correct HERE: a server ahead of this client should
    // degrade to a vague sentence rather than render nothing.
    expect(blockerLine(copy, 'somethingNobodyOwns', 'REQUIRED')).toBe(copy.blockerFallback);
  });

  it('distinguishes "you have not chosen" from "nobody has looked yet"', () => {
    // AWAITING_REVIEW means the provider has done their part. Telling them a
    // field is required says they have not, and sends them to re-enter data
    // that is already sitting in a queue.
    expect(blockerLine(copy, 'specialties', 'AWAITING_REVIEW')).not.toBe(
      blockerLine(copy, 'specialties', 'REQUIRED'),
    );
  });
});
