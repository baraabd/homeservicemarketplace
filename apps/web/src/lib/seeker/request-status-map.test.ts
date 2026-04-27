import { describe, it, expect } from 'vitest';
import {
  formatRelativeTime,
  mapServiceCategorySlug,
  mapServiceRequestStatus,
} from './request-status-map';

describe('mapServiceRequestStatus', () => {
  it('maps every documented backend status to the existing UI status set', () => {
    // Per slice-3 spec:
    //   OPEN_FOR_BIDS                                → pending
    //   BID_ACCEPTED / BOOKED / IN_PROGRESS          → active
    //   COMPLETED                                    → completed
    //   CANCELLED                                    → cancelled
    expect(mapServiceRequestStatus('OPEN_FOR_BIDS')).toBe('pending');
    expect(mapServiceRequestStatus('BID_ACCEPTED')).toBe('active');
    expect(mapServiceRequestStatus('BOOKED')).toBe('active');
    expect(mapServiceRequestStatus('IN_PROGRESS')).toBe('active');
    expect(mapServiceRequestStatus('COMPLETED')).toBe('completed');
    expect(mapServiceRequestStatus('CANCELLED')).toBe('cancelled');
  });
});

describe('mapServiceCategorySlug', () => {
  it('maps known slugs to their existing UI service keys', () => {
    expect(mapServiceCategorySlug('plumbing')).toBe('Plumbing');
    expect(mapServiceCategorySlug('electrical')).toBe('Electrical');
    expect(mapServiceCategorySlug('ac-repair')).toBe('AC Repair');
    expect(mapServiceCategorySlug('cleaning')).toBe('Cleaning');
    expect(mapServiceCategorySlug('carpentry')).toBe('Carpentry');
    expect(mapServiceCategorySlug('painting')).toBe('Painting');
  });

  it('falls back to General for unknown / null / undefined', () => {
    expect(mapServiceCategorySlug('')).toBe('General');
    expect(mapServiceCategorySlug(null)).toBe('General');
    expect(mapServiceCategorySlug(undefined)).toBe('General');
    expect(mapServiceCategorySlug('made-up-slug')).toBe('General');
  });
});

describe('formatRelativeTime', () => {
  it('produces stable English / Arabic relative strings', () => {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(oneHourAgo, 'en')).toMatch(/^1h ago$/);
    expect(formatRelativeTime(oneHourAgo, 'ar')).toMatch(/قبل 1 س/);
  });

  it('returns an empty string for an unparseable input', () => {
    expect(formatRelativeTime('not-a-date')).toBe('');
  });
});
