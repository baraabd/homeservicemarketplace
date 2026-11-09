import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { CURRENT_LEGAL_DOCUMENTS, PUBLIC_INFO_PATHS } from '@homeservicemarketplace/contracts';

import {
  LEGAL_CHROME,
  LEGAL_COPY_VERSIONS,
  LEGAL_PAGE_IDS,
  LEGAL_PAGES,
  legalPath,
} from '../copy/legal-documents.copy';

// K02 — Arabic/English parity and registry agreement for the public pages.
describe('K02 legal copy', () => {
  // Append an entry for a new version. Old fingerprints identify exactly what was shown.
  const fingerprints: Record<string, { ar: string; en: string }> = {
    'ksa-terms-2026-11-03.draft-1': {
      ar: '634b5a9c4ca0fe3ae0ed275e36f45c7c46f845cf6da42bfa52efee84c4a41760',
      en: 'cfbd6be659625f9a19e91f0fcf0196ab2943acd74b4620049205e55d51baaf04',
    },
    'ksa-privacy-2026-11-03.draft-1': {
      ar: '91b6710ed21ffbb4f199bfdf910d3efac3575b8527ed0698021943f441d09a08',
      en: 'c09ba2a45f642546720dd0c607f46168dfd2d56d4fabfd0037ed00acee5f788b',
    },
  };
  it.each(['terms', 'privacy'] as const)(
    'binds both translations to the published %s version',
    (id) => {
      for (const locale of ['en', 'ar'] as const) {
        const digest = createHash('sha256')
          .update(JSON.stringify(LEGAL_PAGES[id][locale]))
          .digest('hex');
        expect(digest).toBe(fingerprints[LEGAL_COPY_VERSIONS[id]]?.[locale]);
      }
    },
  );

  it('has the same structure in Arabic and English for every page', () => {
    for (const id of LEGAL_PAGE_IDS) {
      const en = LEGAL_PAGES[id].en;
      const ar = LEGAL_PAGES[id].ar;
      expect(ar.sections.length).toBe(en.sections.length);
      ar.sections.forEach((section, i) => {
        expect(section.paragraphs.length).toBe(en.sections[i]!.paragraphs.length);
        expect(section.heading.trim()).not.toBe('');
      });
      // Arabic copy is actually Arabic.
      expect(ar.title).toMatch(/[؀-ۿ]/);
    }
    expect(Object.keys(LEGAL_CHROME.ar).sort()).toEqual(Object.keys(LEGAL_CHROME.en).sort());
  });

  it('routes match the server registry paths', () => {
    expect(legalPath('terms')).toBe(CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.path);
    expect(legalPath('privacy')).toBe(CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.path);
    expect(legalPath('operator')).toBe(PUBLIC_INFO_PATHS.operator);
    expect(legalPath('contact')).toBe(PUBLIC_INFO_PATHS.contact);
    expect(legalPath('subscriptions')).toBe(PUBLIC_INFO_PATHS.subscriptions);
  });

  it('declares itself a draft while the registry says DRAFT, and invents no operator facts', () => {
    expect(CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.status).toBe('DRAFT');
    expect(LEGAL_CHROME.en.draftBanner).toMatch(/not yet approved/);
    const operator = JSON.stringify(LEGAL_PAGES.operator);
    // No registration number, VAT number or address was supplied; none may appear.
    expect(operator).not.toMatch(/\d{6,}/);
    expect(operator).toMatch(/Pending owner approval/);
  });

  it('states the launch money scope: no booking funds collected, no booking fee', () => {
    const terms = JSON.stringify(LEGAL_PAGES.terms.en);
    expect(terms).toMatch(/does not collect, hold or pay out the price of a booking/);
    expect(terms).toMatch(/Saudi riyals \(SAR\)/);
    // Phone numbers are not claimed to be SMS-verified.
    expect(terms).toMatch(/not verified by text message/);
  });
});
