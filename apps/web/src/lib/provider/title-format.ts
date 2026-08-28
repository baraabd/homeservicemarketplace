// Web-safe professional-title rule.
//
// WHY THIS IS NOT IMPORTED FROM @homeservicemarketplace/contracts
//
// The contracts package emits CommonJS so the Nest API can `require()` it, and
// a runtime VALUE import from it fails the production web build. The repo has
// hit this twice now — see `src/lib/request-media/constants.ts` and
// `src/lib/provider/phone-format.ts` — so the pattern is settled: mirror the
// rule here, and prove the two agree with a test.
//
// SOURCE OF TRUTH: packages/contracts/src/provider/onboarding/professional-title.ts,
// which the API imports directly and which is the only opinion that can refuse
// a save. `title-format.test.ts` imports BOTH and asserts they agree on a
// table of inputs, so drift fails a test rather than letting the form accept
// what the API rejects.
//
// NOTE what is NOT mirrored: the trade-name table. The SUGGESTION is computed
// server-side and arrives in the draft view in both languages, so the client
// never needs it — only the refusal rules, which the form uses to say why
// before a round trip.

export const TITLE_MIN_LENGTH = 2;
export const TITLE_MAX_LENGTH = 60;

export type TitleRefusal =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'CONTAINS_URL'
  | 'CONTAINS_CONTACT'
  | 'PROHIBITED_CLAIM'
  | 'UNSUPPORTED_CREDENTIAL';

const CREDENTIAL_CLAIMS = [
  'certified',
  'licensed',
  'license',
  'insured',
  'accredited',
  'registered',
  'guaranteed',
  'مرخص',
  'مرخّص',
  'معتمد',
  'مؤمن',
  'مضمون',
];

const PROHIBITED_CLAIMS = [
  'best',
  'cheapest',
  'number one',
  'no.1',
  'no1',
  '#1',
  'official',
  'الأفضل',
  'الأرخص',
  'الأول',
  'رسمي',
];

const URL_PATTERN = /(https?:\/\/|www\.|\.(com|net|org|io|co|me|sy|ae|sa)\b)/i;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE_PATTERN = /(?:\+?\d[\s\-().]*){7,}/;
const ARABIC_DIGITS_PATTERN = /(?:[٠-٩][\s\-().]*){7,}/;

export type TitleVerdict = { ok: true } | { ok: false; code: TitleRefusal };

export function validateProfessionalTitle(raw: string): TitleVerdict {
  const value = raw.trim();

  if (value.length < TITLE_MIN_LENGTH) return { ok: false, code: 'TOO_SHORT' };
  if (value.length > TITLE_MAX_LENGTH) return { ok: false, code: 'TOO_LONG' };

  if (URL_PATTERN.test(value)) return { ok: false, code: 'CONTAINS_URL' };
  if (EMAIL_PATTERN.test(value) || PHONE_PATTERN.test(value) || ARABIC_DIGITS_PATTERN.test(value)) {
    return { ok: false, code: 'CONTAINS_CONTACT' };
  }

  const lowered = value.toLowerCase();
  if (CREDENTIAL_CLAIMS.some((term) => containsTerm(lowered, term))) {
    return { ok: false, code: 'UNSUPPORTED_CREDENTIAL' };
  }
  if (PROHIBITED_CLAIMS.some((term) => containsTerm(lowered, term))) {
    return { ok: false, code: 'PROHIBITED_CLAIM' };
  }

  return { ok: true };
}

function containsTerm(loweredValue: string, term: string): boolean {
  if (!/^[a-z0-9.#\s]+$/.test(term)) return loweredValue.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(loweredValue);
}
