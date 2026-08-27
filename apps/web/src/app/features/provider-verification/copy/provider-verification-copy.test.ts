import { describe, expect, it } from 'vitest';

import {
  AXIS_COPY,
  REASON_COPY,
  STATE_COPY,
  UI_COPY,
  reasonText,
  type Lang,
} from './provider-verification-copy';
import { deriveVerificationView } from '../verification-view-state';

// Sprint 9B.11 — the only way an untranslated string is caught before an Arabic
// reader sees an English label.
//
// Beyond key parity, two things this surface specifically needs: every state
// the derivation can produce must HAVE copy, and every reason code the server
// can send must resolve to a sentence a person can act on.

const LANGS: Lang[] = ['en', 'ar'];
const MAPS = { STATE_COPY, REASON_COPY, AXIS_COPY, UI_COPY } as const;

describe('both languages say the same things', () => {
  it.each(Object.entries(MAPS))('%s has identical key sets', (_name, map) => {
    const en = Object.keys(map.en).sort();
    const ar = Object.keys(map.ar).sort();
    expect(ar).toEqual(en);
  });

  it('every state copy has a title and a body in both languages', () => {
    for (const lang of LANGS) {
      for (const [state, copy] of Object.entries(STATE_COPY[lang])) {
        expect(copy.title.trim(), `${lang}.${state}.title`).not.toBe('');
        expect(copy.body.trim(), `${lang}.${state}.body`).not.toBe('');
      }
    }
  });

  it('never reuses the English sentence as the Arabic one', () => {
    // The failure a key-parity test alone misses: the key exists, parity
    // passes, and an Arabic reader sees English.
    for (const [state, en] of Object.entries(STATE_COPY.en)) {
      const ar = STATE_COPY.ar[state as keyof typeof STATE_COPY.ar];
      expect(ar.title, `${state}.title`).not.toBe(en.title);
      expect(ar.body, `${state}.body`).not.toBe(en.body);
    }
    for (const key of Object.keys(REASON_COPY.en)) {
      expect(REASON_COPY.ar[key], key).not.toBe(REASON_COPY.en[key]);
    }
  });

  it('writes the Arabic copy in Arabic script', () => {
    for (const [state, copy] of Object.entries(STATE_COPY.ar)) {
      expect(copy.title, `${state}.title`).toMatch(/[؀-ۿ]/);
      expect(copy.body, `${state}.body`).toMatch(/[؀-ۿ]/);
    }
    for (const [key, value] of Object.entries(REASON_COPY.ar)) {
      expect(value, key).toMatch(/[؀-ۿ]/);
    }
  });

  it('keeps VIP and Featured as separate labels, not one word', () => {
    // They are different facts about a provider, and a single "special" badge
    // would hide which one they actually have.
    for (const lang of LANGS) {
      expect(AXIS_COPY[lang].vip).not.toBe(AXIS_COPY[lang].featured);
    }
  });
});

describe('a state cannot exist without copy', () => {
  it('covers every state the derivation can produce', () => {
    // The derivation's own test proves all 14 are reachable. This proves each
    // reachable one has something to say — a screen that renders `undefined`
    // is worse than one that renders nothing.
    const reachable = [
      'ACCOUNT_LOCKED',
      'SUSPENDED',
      'ONBOARDING_INCOMPLETE',
      'NOT_REQUIRED',
      'NOT_STARTED',
      'EVIDENCE_REQUIRED',
      'SCANNING',
      'EVIDENCE_UNUSABLE',
      'READY_TO_SUBMIT',
      'PENDING_REVIEW',
      'CHANGES_REQUESTED',
      'REJECTED',
      'VERIFIED_ACTIVE',
      'VERIFIED_NO_ACCESS',
    ] as const;

    for (const lang of LANGS) {
      for (const state of reachable) {
        expect(STATE_COPY[lang][state], `${lang}.${state}`).toBeDefined();
      }
      expect(Object.keys(STATE_COPY[lang]).sort()).toEqual([...reachable].sort());
    }
  });

  it('offers no call to action in the states where nothing can be done', () => {
    // Offering a button that cannot help is worse than offering none: it
    // teaches people to tap and hope.
    for (const lang of LANGS) {
      for (const state of [
        'SCANNING',
        'PENDING_REVIEW',
        'VERIFIED_ACTIVE',
        'NOT_REQUIRED',
      ] as const) {
        expect(STATE_COPY[lang][state].cta, `${lang}.${state}`).toBeNull();
      }
    }
  });

  it('offers a way forward in every state where the provider CAN act', () => {
    for (const lang of LANGS) {
      for (const state of [
        'NOT_STARTED',
        'EVIDENCE_REQUIRED',
        'EVIDENCE_UNUSABLE',
        'READY_TO_SUBMIT',
        'CHANGES_REQUESTED',
        'REJECTED',
        'VERIFIED_NO_ACCESS',
      ] as const) {
        expect(STATE_COPY[lang][state].cta, `${lang}.${state}`).toBeTruthy();
      }
    }
  });
});

describe('reason codes reach the provider as instructions', () => {
  it.each([
    'DOCUMENT_MISSING',
    'DOCUMENT_ILLEGIBLE',
    'DOCUMENT_EXPIRED',
    'DOCUMENT_MISMATCH',
    'SUSPECTED_FORGERY',
    'DUPLICATE_IDENTITY',
    'BUSINESS_NOT_REGISTERED',
    'REPRESENTATIVE_NOT_AUTHORIZED',
    'LICENSE_MISSING_FOR_CATEGORY',
    'LICENSE_EXPIRED',
    'POLICY_PERIOD_ELAPSED',
    'TRUST_AND_SAFETY_ACTION',
    'PROVIDER_REQUESTED',
    'DOCUMENTS_COMPLETE_AND_LEGIBLE',
    'OTHER',
  ])('%s resolves in both languages', (code) => {
    for (const lang of LANGS) {
      expect(reasonText(lang, code)).toBeTruthy();
    }
  });

  it('never shows a raw code to the person who cannot fix it', () => {
    for (const lang of LANGS) {
      expect(reasonText(lang, 'SOMETHING_NEW_2027')).toBe(REASON_COPY[lang].OTHER);
      expect(reasonText(lang, null)).toBe(REASON_COPY[lang].OTHER);
      expect(reasonText(lang, 'SOMETHING_NEW_2027')).not.toContain('SOMETHING_NEW');
    }
  });

  it('does not accuse the provider of forgery in the copy they read', () => {
    // The reviewer code is SUSPECTED_FORGERY. Telling someone we think they
    // forged a document is an accusation the UI is not the place to make, and
    // it is sometimes wrong — a scanned copy of a real passport looks odd.
    for (const lang of LANGS) {
      const text = reasonText(lang, 'SUSPECTED_FORGERY').toLowerCase();
      expect(text).not.toContain('forg');
      expect(text).not.toContain('تزوير');
    }
  });
});

describe('the axes are described as separate facts', () => {
  it('names all five', () => {
    for (const lang of LANGS) {
      for (const axis of [
        'onboardingComplete',
        'identityVerified',
        'workAccessActive',
        'vip',
        'featured',
      ]) {
        expect(AXIS_COPY[lang][axis], `${lang}.${axis}`).toBeTruthy();
      }
    }
  });

  it('states plainly that VIP and Featured grant nothing', () => {
    // ADR 0005 axis 5. A provider who believed VIP unlocked work would be
    // paying for something it does not do.
    for (const lang of LANGS) {
      expect(AXIS_COPY[lang].badgeNote).toBeTruthy();
    }
    expect(AXIS_COPY.en.badgeNote.toLowerCase()).toContain('do not affect');
  });
});

describe('the derivation and the copy agree', () => {
  it('has copy for whatever the derivation returns from an empty input', () => {
    const view = deriveVerificationView({
      capabilities: null,
      verificationCase: null,
      profile: null,
    });
    expect(STATE_COPY.en[view.state]).toBeDefined();
    expect(STATE_COPY.ar[view.state]).toBeDefined();
  });
});
