// Sprint 9B.17 — what counts as a phone number, decided once.
//
// Shared rather than duplicated because the form and the API must agree. A
// format rule that lives only in the client is a rule every other caller —
// the next client, an integration, a script — does not have; a rule that lives
// only in the API is one the provider discovers by being rejected after
// typing. Both need it, so it is defined here and imported by both.
//
// WHAT THIS IS NOT
//
// It is not proof that anyone holds the number. That is `phoneVerifiedAt`, it
// requires an SMS challenge that does not exist yet, and onboarding therefore
// does not demand it. Treating a well-formed number as a verified one is the
// single most valuable thing to get wrong here: the number is the channel a
// seeker uses when a provider is late.
//
// It is also not a carrier-accurate validator. Real numbering plans need a
// library and a data file that ages; the goal here is to refuse what is
// obviously not a phone number while never refusing a real one.

/**
 * E.164 shape: a leading `+`, a non-zero country digit, then 7 to 14 more
 * digits.
 *
 * The bounds come from E.164 itself — at most 15 digits including the country
 * code — and the lower bound is deliberately permissive: some national numbers
 * really are that short, and rejecting a real number is worse than accepting
 * an implausible one, because only one of those has a person on the other end
 * of it who cannot complete their application.
 */
export const PHONE_E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/**
 * True when `value` is shaped like an international phone number.
 *
 * Spaces, hyphens and brackets are stripped first: people type
 * `+963 912 345 678`, and refusing that teaches them the form is broken
 * rather than that it wants a different format. Callers should store the
 * NORMALISED form — see `normalisePhoneNumber`.
 */
export function isPlausibleE164(value: string): boolean {
  return PHONE_E164_PATTERN.test(normalisePhoneNumber(value));
}

/** Strip the punctuation people type, keeping the leading `+`.
 *
 *  Note what is NOT stripped: letters. `+1 800 FLOWERS` is not a number this
 *  system can dial, and silently deleting the letters would store a number
 *  that looks valid and rings nobody. */
export function normalisePhoneNumber(value: string): string {
  return value.replace(/[\s\-().]/g, '');
}
