import { describe, it, expect } from 'vitest';

import { resolveNotificationTarget, type NotificationTargetInput } from './notification-target';

// Sprint 7.12 — shared target resolver.
//
// Critical regression: the toast "View" action and the seeker
// NotificationDrawer tap MUST resolve to the same destination. This
// suite pins both the routing rules AND the bid-vs-request id
// invariant (the resourceId on a BID notification is the bidId,
// NEVER the requestId — using it as one was the Sprint 7.5 bug).

function input(over: Partial<NotificationTargetInput>): NotificationTargetInput {
  return {
    type: null,
    resourceType: null,
    resourceId: null,
    deepLink: null,
    metadata: null,
    ...over,
  };
}

describe('resolveNotificationTarget — BID', () => {
  it('seeker BID_RECEIVED uses metadata.requestId (NEVER resourceId aka bidId)', () => {
    const target = resolveNotificationTarget(
      input({
        type: 'BID_RECEIVED',
        resourceType: 'BID',
        resourceId: 'bid-XXX',
        metadata: { requestId: 'req-CORRECT' },
      }),
      'seeker',
    );
    expect(target).toEqual({
      kind: 'seeker-request-bids',
      requestId: 'req-CORRECT',
      deepLink: '/home/requests/req-CORRECT/bids',
    });
  });

  it('seeker BID_ACCEPTED routes to booking detail when metadata.bookingId is present', () => {
    const target = resolveNotificationTarget(
      input({
        type: 'BID_ACCEPTED',
        resourceType: 'BID',
        resourceId: 'bid-xxx',
        metadata: { requestId: 'req-1', bookingId: 'bk-99' },
      }),
      'seeker',
    );
    expect(target).toEqual({
      kind: 'seeker-booking-detail',
      bookingId: 'bk-99',
      deepLink: '/home/bookings/bk-99',
    });
  });

  it('provider BID notification → provider-booking-detail when metadata.bookingId is present', () => {
    const target = resolveNotificationTarget(
      input({
        type: 'BID_ACCEPTED',
        resourceType: 'BID',
        resourceId: 'bid-77',
        metadata: { requestId: 'req-1', bookingId: 'bk-77' },
      }),
      'provider',
    );
    expect(target).toEqual({
      kind: 'provider-booking-detail',
      bookingId: 'bk-77',
      deepLink: '/provider/bookings/bk-77',
    });
  });

  it('provider BID notification without bookingId → provider-bid-detail (My Bids)', () => {
    const target = resolveNotificationTarget(
      input({
        type: 'BID_ACCEPTED',
        resourceType: 'BID',
        resourceId: 'bid-77',
        metadata: { requestId: 'req-1' },
      }),
      'provider',
    );
    expect(target).toEqual({
      kind: 'provider-bid-detail',
      bidId: 'bid-77',
      deepLink: '/provider/bids/bid-77',
    });
  });

  it('BID with neither metadata.requestId nor metadata.bookingId → null (no wrong navigation)', () => {
    const target = resolveNotificationTarget(
      input({ type: 'BID_RECEIVED', resourceType: 'BID', resourceId: 'bid-x' }),
      'seeker',
    );
    expect(target).toBeNull();
  });
});

describe('resolveNotificationTarget — BOOKING', () => {
  it('seeker BOOKING_IN_PROGRESS → seeker booking detail', () => {
    const target = resolveNotificationTarget(
      input({
        type: 'BOOKING_IN_PROGRESS',
        resourceType: 'BOOKING',
        resourceId: 'bk-1',
        metadata: { to: 'IN_PROGRESS' },
      }),
      'seeker',
    );
    expect(target).toEqual({
      kind: 'seeker-booking-detail',
      bookingId: 'bk-1',
      deepLink: '/home/bookings/bk-1',
    });
  });

  it('provider BOOKING_CREATED → provider booking detail', () => {
    const target = resolveNotificationTarget(
      input({
        type: 'BOOKING_CREATED',
        resourceType: 'BOOKING',
        resourceId: 'bk-1',
      }),
      'provider',
    );
    expect(target?.kind).toBe('provider-booking-detail');
    expect(target?.deepLink).toBe('/provider/bookings/bk-1');
  });

  it('backend-supplied deepLink wins over derived path', () => {
    const target = resolveNotificationTarget(
      input({
        type: 'BOOKING_COMPLETED',
        resourceType: 'BOOKING',
        resourceId: 'bk-1',
        deepLink: '/custom/path/bk-1',
      }),
      'seeker',
    );
    expect(target?.deepLink).toBe('/custom/path/bk-1');
  });
});

describe('resolveNotificationTarget — REQUEST + CONVERSATION', () => {
  it('seeker REQUEST_AVAILABLE → seeker request detail', () => {
    const target = resolveNotificationTarget(
      input({
        type: 'REQUEST_AVAILABLE',
        resourceType: 'REQUEST',
        resourceId: 'req-1',
      }),
      'seeker',
    );
    expect(target?.kind).toBe('seeker-request-detail');
  });

  it('provider REQUEST_AVAILABLE → provider request detail', () => {
    const target = resolveNotificationTarget(
      input({
        type: 'REQUEST_AVAILABLE',
        resourceType: 'REQUEST',
        resourceId: 'req-1',
      }),
      'provider',
    );
    expect(target).toEqual({
      kind: 'provider-request-detail',
      requestId: 'req-1',
      deepLink: '/provider/requests/req-1',
    });
  });

  it('CONVERSATION → experience-specific conversation route', () => {
    const seeker = resolveNotificationTarget(
      input({
        type: 'MESSAGE_RECEIVED',
        resourceType: 'CONVERSATION',
        resourceId: 'conv-1',
      }),
      'seeker',
    );
    expect(seeker?.kind).toBe('seeker-conversation');
    const provider = resolveNotificationTarget(
      input({
        type: 'MESSAGE_RECEIVED',
        resourceType: 'CONVERSATION',
        resourceId: 'conv-1',
      }),
      'provider',
    );
    expect(provider?.kind).toBe('provider-conversation');
  });
});

describe('resolveNotificationTarget — unresolvable inputs', () => {
  it('SYSTEM / null resourceType / no identifiers → null (no fallback to home)', () => {
    expect(
      resolveNotificationTarget(input({ type: 'SYSTEM', resourceType: 'SYSTEM' }), 'seeker'),
    ).toBeNull();
    expect(
      resolveNotificationTarget(input({ type: null, resourceType: null }), 'seeker'),
    ).toBeNull();
    expect(resolveNotificationTarget(input({ resourceType: 'REQUEST' }), 'seeker')).toBeNull();
  });
});
