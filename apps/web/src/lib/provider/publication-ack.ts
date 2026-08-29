// Sprint 9B.22 — the publication-right wording, mirrored for the browser.
//
// WHY THIS IS A COPY AND NOT AN IMPORT
//
// `@homeservicemarketplace/contracts` emits CommonJS for Nest, and its nested
// `export *` becomes `__exportStar`. Importing a runtime VALUE from it fails
// the production Rollup build ("not exported by dist/index.js") — types are
// fine, values are not. Sprint 9B.17 established the fix, and the same one is
// used by `title-format.ts` and `phone-format.ts` beside this file: mirror the
// values here, and pin the copy with a drift test that imports BOTH and
// asserts they are identical.
//
// The drift test is what makes this safe. Without it a copy is just a second
// source of truth waiting to disagree — and disagreeing here would mean showing
// a provider one sentence and recording that they agreed to another.
//
// KEEP IN SYNC WITH
// packages/contracts/src/provider/portfolio/publication-ack.ts

export interface PublicationAckWording {
  en: string;
  ar: string;
}

/** APPEND-ONLY, exactly as in the contracts package. Editing an entry rewrites
 *  what past providers are recorded as having agreed to. */
export const PUBLICATION_ACK_WORDINGS: Readonly<Record<string, PublicationAckWording>> =
  Object.freeze({
    '2026.09-portfolio-ack-v1': {
      en:
        'I have the right to publish this photo. If it shows a customer’s home or property, ' +
        'I have their permission to show it publicly.',
      ar:
        'أملك الحق في نشر هذه الصورة. وإذا كانت تُظهر منزل عميل أو ممتلكاته، ' +
        'فقد حصلت على إذنه لعرضها للعموم.',
    },
  });

export const CURRENT_PUBLICATION_ACK_VERSION = '2026.09-portfolio-ack-v1';

/** The wording to DISPLAY, and the version to send with it. Returning them
 *  together is deliberate: a caller cannot show one version's text and submit
 *  another's without editing this function. */
export function currentPublicationAck(lang: 'en' | 'ar'): {
  version: string;
  text: string;
} {
  const wording = PUBLICATION_ACK_WORDINGS[CURRENT_PUBLICATION_ACK_VERSION]!;
  return { version: CURRENT_PUBLICATION_ACK_VERSION, text: wording[lang] };
}
