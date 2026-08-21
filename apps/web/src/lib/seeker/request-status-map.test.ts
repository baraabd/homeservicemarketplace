import { describe, it, expect } from 'vitest';
import {
  formatRelativeTime,
  mapLeadStatus,
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

// Sprint 7.x — pins the hard-refresh source-of-truth path.
//
// The user-reported bug: after the provider moves a booking to
// IN_PROGRESS / COMPLETED / CANCELLED, the Seeker's Active Leads card
// stayed visually stuck at "Pro Assigned" (BID_ACCEPTED) because the
// parent ServiceRequest.status intentionally does NOT auto-revert
// across booking lifecycle. `mapLeadStatus` overlays the new
// `activeBookingStatus` field (Sprint 7.x backend addition on
// ServiceRequestSummary) onto the request status so the card is
// correct even after F5 — no realtime, no cache patch, just the raw
// API response shaping the visual.
describe('mapLeadStatus — booking lifecycle overlay (hard-refresh)', () => {
  it('falls through to request mapping when no booking exists', () => {
    expect(mapLeadStatus('OPEN_FOR_BIDS', null)).toBe('pending');
    expect(mapLeadStatus('OPEN_FOR_BIDS', undefined)).toBe('pending');
    expect(mapLeadStatus('CANCELLED', null)).toBe('cancelled');
  });

  it('SCHEDULED booking + BID_ACCEPTED request → active', () => {
    expect(mapLeadStatus('BID_ACCEPTED', 'SCHEDULED')).toBe('active');
  });

  it('IN_PROGRESS booking + BID_ACCEPTED request → active (finer state in detail)', () => {
    expect(mapLeadStatus('BID_ACCEPTED', 'IN_PROGRESS')).toBe('active');
  });

  it('COMPLETED booking + BID_ACCEPTED request → completed (booking wins over stale request status)', () => {
    // The bug this prevents: request stays BID_ACCEPTED forever;
    // without the overlay the card would visibly stay "active" even
    // though the booking is done.
    expect(mapLeadStatus('BID_ACCEPTED', 'COMPLETED')).toBe('completed');
  });

  it('CANCELLED booking + BID_ACCEPTED request → cancelled (booking wins)', () => {
    expect(mapLeadStatus('BID_ACCEPTED', 'CANCELLED')).toBe('cancelled');
  });

  it('matches the legacy mapper when activeBookingStatus is null for every request status', () => {
    const requestStatuses = [
      'OPEN_FOR_BIDS',
      'BID_ACCEPTED',
      'BOOKED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
    ] as const;
    for (const status of requestStatuses) {
      expect(mapLeadStatus(status, null)).toBe(mapServiceRequestStatus(status));
    }
  });
});
