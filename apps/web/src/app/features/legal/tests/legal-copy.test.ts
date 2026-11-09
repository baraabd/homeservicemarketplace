import { describe, it, expect } from 'vitest';
import {
  CURRENT_LEGAL_DOCUMENTS,
  isApprovedLegalDocument,
  PUBLIC_INFO_PATHS,
} from '@homeservicemarketplace/contracts';

import {
  ACCEPTED_DOCUMENTS,
  LEGAL_CHROME,
  LEGAL_COPY_VERSIONS,
  LEGAL_PAGE_IDS,
  LEGAL_PAGES,
  legalPath,
} from '../copy/legal-documents.copy';

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

  it('binds both displayed translations to the registry and checks release metadata', () => {
    for (const id of ['terms', 'privacy'] as const) {
      const doc = CURRENT_LEGAL_DOCUMENTS[ACCEPTED_DOCUMENTS[id]];
      expect(LEGAL_COPY_VERSIONS[id]).toBe(doc.version);
      if (doc.status === 'APPROVED') {
        expect(isApprovedLegalDocument(doc)).toBe(true);
        expect(JSON.stringify(LEGAL_PAGES[id])).not.toMatch(
          /Pending owner approval|قيد اعتماد المشغّل/,
        );
      } else {
        expect(doc.approvalReference).toBeNull();
        expect(isApprovedLegalDocument(doc)).toBe(false);
      }
    }
  });

  it('requires a new release ID and a nonempty reference for each approval', () => {
    const fixture = {
      ...CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE,
      status: 'APPROVED' as const,
      version: 'fixture-terms-v1',
      approvalReference: 'TEST-ONLY',
    };
    expect(isApprovedLegalDocument(fixture)).toBe(true);
    expect(isApprovedLegalDocument({ ...fixture, approvalReference: ' ' })).toBe(false);
    expect(isApprovedLegalDocument({ ...fixture, approvalReference: null })).toBe(false);
    expect(isApprovedLegalDocument({ ...fixture, version: 'fixture.draft-1' })).toBe(false);
    expect(isApprovedLegalDocument({ ...fixture, status: 'DRAFT' })).toBe(false);
  });

  it('states the launch money scope: no booking funds collected, no booking fee', () => {
    const terms = JSON.stringify(LEGAL_PAGES.terms.en);
    expect(terms).toMatch(/does not collect, hold or pay out the price of a booking/);
    expect(terms).toMatch(/Saudi riyals \(SAR\)/);
    // Phone numbers are not claimed to be SMS-verified.
    expect(terms).toMatch(/not verified by text message/);
  });
});
