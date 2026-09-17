import { describe, expect, it } from 'vitest';
import { DISPUTE_ISSUE_CODES, DISPUTE_REQUESTED_OUTCOMES } from '@homeservicemarketplace/contracts';
import { DISPUTE_COPY } from '../copy';
describe('Dispute intake copy and runtime contracts', () => {
  it('exports the runtime choices through the real contracts barrel', () => {
    expect(DISPUTE_ISSUE_CODES).toHaveLength(6); expect(DISPUTE_REQUESTED_OUTCOMES).toHaveLength(6);
  });
  it('has complete bilingual top-level and state parity', () => {
    expect(Object.keys(DISPUTE_COPY.ar).sort()).toEqual(Object.keys(DISPUTE_COPY.en).sort());
    for (const group of ['blocked', 'issues', 'outcomes', 'states'] as const)
      expect(Object.keys(DISPUTE_COPY.ar[group]).sort()).toEqual(Object.keys(DISPUTE_COPY.en[group]).sort());
  });
  it.each(['en', 'ar'] as const)('names every server-supported issue/outcome in %s', (lang) => {
    for (const code of DISPUTE_ISSUE_CODES) expect(DISPUTE_COPY[lang].issues[code].length).toBeGreaterThan(0);
    for (const code of DISPUTE_REQUESTED_OUTCOMES) expect(DISPUTE_COPY[lang].outcomes[code].length).toBeGreaterThan(0);
    expect(DISPUTE_COPY[lang].steps).toHaveLength(3);
  });
});
