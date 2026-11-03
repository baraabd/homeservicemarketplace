import { describe, it, expect } from 'vitest';
import { CURRENT_LEGAL_DOCUMENTS, PUBLIC_INFO_PATHS } from '@homeservicemarketplace/contracts';

import { LEGAL_CHROME, LEGAL_PAGE_IDS, LEGAL_PAGES, legalPath } from '../copy/legal-documents.copy';

// K02 — Arabic/English parity and registry agreement for the public pages.
describe('K02 legal copy', () => {
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
