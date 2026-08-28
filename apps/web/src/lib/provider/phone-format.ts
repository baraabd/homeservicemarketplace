// Web-safe phone-format rule.
//
// WHY THIS IS NOT IMPORTED FROM @homeservicemarketplace/contracts
//
// The contracts package emits CommonJS so the Nest API can `require()` it. A
// runtime VALUE import from contracts in the web app makes the production
// build fail — Rollup cannot see named members through the nested
// `__exportStar` barrels, and even when it can, serving that CJS file to a
// browser throws `ReferenceError: exports is not defined`. Every other web
// import from contracts is type-only and therefore erased at build time.
//
// This is the same boundary, and the same answer, as
// `src/lib/request-media/constants.ts`. See that file for the original
// statement of the problem.
//
// SOURCE OF TRUTH: packages/contracts/src/provider/onboarding/phone.ts, which
// the API imports directly. The two are kept honest by
// `phone-format.test.ts`, which imports BOTH and asserts they agree on a table
// of inputs — so drift fails a test rather than silently letting the form
// accept what the API will reject.
//
// WHAT THIS IS NOT: proof anyone holds the number. That is `phoneVerifiedAt`,
// it needs an SMS challenge that does not exist yet, and onboarding does not
// demand it.

/** E.164 shape: a leading `+`, a non-zero country digit, then 7 to 14 more. */
export const PHONE_E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** Strip the punctuation people type, keeping the leading `+`. Letters are
 *  deliberately NOT stripped: `+1 800 FLOWERS` is not diallable, and deleting
 *  them would store a number that looks valid and rings nobody. */
export function normalisePhoneNumber(value: string): string {
  return value.replace(/[\s\-().]/g, '');
}

/** True when `value` is shaped like an international phone number. */
export function isPlausibleE164(value: string): boolean {
  return PHONE_E164_PATTERN.test(normalisePhoneNumber(value));
}
