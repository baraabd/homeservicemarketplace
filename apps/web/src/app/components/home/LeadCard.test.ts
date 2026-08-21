import { describe, it, expect } from 'vitest';

import { pendingBidsLabel } from './LeadCard';

// Sprint 7.12 — dynamic Pending Bids label. Pinned in pure form so
// the label survives any future re-skin of LeadCard.

describe('pendingBidsLabel', () => {
  it('returns the static label when no bids yet', () => {
    expect(pendingBidsLabel(0, 'en')).toBe('Pending Bids');
    expect(pendingBidsLabel(0, 'ar')).toBe('بانتظار العروض');
    expect(pendingBidsLabel(undefined, 'en')).toBe('Pending Bids');
    expect(pendingBidsLabel(undefined, 'ar')).toBe('بانتظار العروض');
  });

  it('singular copy for exactly 1 bid', () => {
    expect(pendingBidsLabel(1, 'en')).toBe('1 Bid received');
    expect(pendingBidsLabel(1, 'ar')).toBe('لديك عرض واحد');
  });

  it('plural with count for 2+ bids', () => {
    expect(pendingBidsLabel(2, 'en')).toBe('2 Bids received');
    expect(pendingBidsLabel(5, 'en')).toBe('5 Bids received');
    expect(pendingBidsLabel(2, 'ar')).toBe('لديك 2 عروض');
    expect(pendingBidsLabel(7, 'ar')).toBe('لديك 7 عروض');
  });

  it('treats negative / null-like values as zero (defensive)', () => {
    expect(pendingBidsLabel(-1 as unknown as number, 'en')).toBe('Pending Bids');
  });
});
