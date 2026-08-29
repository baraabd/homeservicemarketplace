import { describe, expect, it } from 'vitest';
import {
  CURRENT_PUBLICATION_ACK_VERSION as CONTRACT_VERSION,
  PUBLICATION_ACK_WORDINGS as CONTRACT_WORDINGS,
} from '@homeservicemarketplace/contracts';

import {
  CURRENT_PUBLICATION_ACK_VERSION,
  PUBLICATION_ACK_WORDINGS,
  currentPublicationAck,
} from './publication-ack';

// Sprint 9B.22 — the drift test that makes the mirror safe.
//
// The browser cannot import runtime values from the contracts package (see the
// header of publication-ack.ts), so the wording is copied. A copy without this
// test is a second source of truth waiting to disagree — and disagreeing here
// means showing a provider one sentence while recording that they agreed to
// another, which is the exact failure the versioning was added to prevent.
//
// This file imports BOTH, which is possible under vitest even though it is not
// possible in the production bundle.

describe('the mirrored wording matches the contract exactly', () => {
  it('agrees on the current version', () => {
    expect(CURRENT_PUBLICATION_ACK_VERSION).toBe(CONTRACT_VERSION);
  });

  it('agrees on every version in the table', () => {
    expect(Object.keys(PUBLICATION_ACK_WORDINGS).sort()).toEqual(
      Object.keys(CONTRACT_WORDINGS).sort(),
    );
  });

  it('agrees on every word, in both languages', () => {
    // Character-for-character. A trimmed or re-wrapped copy is still a
    // different sentence from the one the server will say was agreed to.
    for (const version of Object.keys(CONTRACT_WORDINGS)) {
      expect({ version, wording: PUBLICATION_ACK_WORDINGS[version] }).toEqual({
        version,
        wording: CONTRACT_WORDINGS[version],
      });
    }
  });
});

describe('currentPublicationAck', () => {
  it('returns the text and the version together', () => {
    // Together on purpose: a caller cannot display one version's words and
    // submit another's without editing the function.
    const en = currentPublicationAck('en');
    expect(en.version).toBe(CURRENT_PUBLICATION_ACK_VERSION);
    expect(en.text).toBe(CONTRACT_WORDINGS[CONTRACT_VERSION]!.en);
  });

  it('returns Arabic when asked', () => {
    const ar = currentPublicationAck('ar');
    expect(ar.text).toBe(CONTRACT_WORDINGS[CONTRACT_VERSION]!.ar);
    expect(ar.text).toContain('إذن');
  });

  it('says plainly that a customer’s home needs their permission', () => {
    // The assertion the column exists for. Wording that only claims ownership
    // of the photo misses the case that matters.
    expect(currentPublicationAck('en').text.toLowerCase()).toContain('permission');
  });
});
