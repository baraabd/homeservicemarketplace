import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../api';
import { cancelBooking, getBookingDetail, getBookingTimeline, listBookings } from './bookings-api';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

const ROW = {
  id: 'bk-1',
  requestId: 'req-1',
  bidId: 'bid-1',
  status: 'SCHEDULED' as const,
  scheduledAt: null,
  priceAmount: 35,
  currency: 'USD',
  pricingType: 'HOURLY' as const,
  createdAt: '2026-04-28T02:00:00.000Z',
  service: {
    categorySlug: 'plumbing',
    categoryLabelEn: 'Plumbing',
    categoryLabelAr: 'سباكة',
    customServiceText: null,
  },
  provider: {
    id: 'pp-1',
    displayName: 'Omar Al-Khalid',
    initials: 'OK',
    avatarUrl: null,
    ratingAvg: 4.9,
    reviewCount: 312,
    completedJobs: 540,
    verified: true,
    topPro: true,
  },
  addressSnapshot: {
    label: 'Home',
    line1: '123 Main',
    city: 'Riyadh',
    country: 'SA',
    lat: null,
    lng: null,
  },
};

describe('bookings-api — listBookings', () => {
  it('GETs /v1/me/bookings and unwraps the envelope (no params when empty filter)', async () => {
    let captured: Record<string, unknown> = {};
    mock.onGet('/v1/me/bookings').reply((config) => {
      captured = (config.params ?? {}) as Record<string, unknown>;
      return [200, { items: [ROW], nextCursor: null }];
    });
    const out = await listBookings();
    expect(out.items).toHaveLength(1);
    expect(out.nextCursor).toBeNull();
    // No status / limit / cursor sent when not asked.
    expect(captured).toEqual({});
  });

  it('forwards status filter on the wire', async () => {
    let captured: Record<string, unknown> = {};
    mock.onGet('/v1/me/bookings').reply((config) => {
      captured = (config.params ?? {}) as Record<string, unknown>;
      return [200, { items: [], nextCursor: null }];
    });
    await listBookings({ status: 'COMPLETED' });
    expect(captured).toEqual({ status: 'COMPLETED' });
  });

  it('does NOT send seekerUserId on the wire', async () => {
    let captured: Record<string, unknown> = {};
    mock.onGet('/v1/me/bookings').reply((config) => {
      captured = (config.params ?? {}) as Record<string, unknown>;
      return [200, { items: [], nextCursor: null }];
    });
    await listBookings({ status: 'SCHEDULED' });
    expect(captured).not.toHaveProperty('seekerUserId');
    expect(captured).not.toHaveProperty('userId');
  });

  it('rejects on 5xx so React Query can surface an error state', async () => {
    mock.onGet('/v1/me/bookings').reply(503, { error: { code: 'DEPENDENCY_UNAVAILABLE' } });
    await expect(listBookings()).rejects.toBeDefined();
  });
});

describe('bookings-api — getBookingDetail', () => {
  it('hits /v1/me/bookings/:id', async () => {
    mock
      .onGet('/v1/me/bookings/bk-1')
      .reply(200, {
        ...ROW,
        updatedAt: '2026-04-28T02:00:00.000Z',
        description: null,
        bidNote: null,
      });
    const out = await getBookingDetail('bk-1');
    expect(out.id).toBe('bk-1');
    expect(out.provider.displayName).toBe('Omar Al-Khalid');
  });
});

describe('bookings-api — getBookingTimeline', () => {
  it('hits /v1/me/bookings/:id/timeline', async () => {
    mock.onGet('/v1/me/bookings/bk-1/timeline').reply(200, {
      items: [
        {
          id: 'bevt-1',
          type: 'BOOKING_CREATED',
          metadata: { requestId: 'req-1' },
          createdAt: '2026-04-28T02:00:00.000Z',
        },
      ],
    });
    const out = await getBookingTimeline('bk-1');
    expect(out.items).toHaveLength(1);
    expect(out.items[0].type).toBe('BOOKING_CREATED');
  });
});

describe('bookings-api — cancelBooking', () => {
  it('POSTs /v1/me/bookings/:id/cancel and returns the updated detail', async () => {
    let postedUrl: string | null = null;
    let bodyLen: number | undefined;
    mock.onPost(/\/v1\/me\/bookings\/.+\/cancel/).reply((config) => {
      postedUrl = config.url ?? null;
      bodyLen = (config.data as string | undefined)?.length;
      return [
        200,
        {
          ...ROW,
          status: 'CANCELLED',
          updatedAt: '2026-04-28T02:30:00.000Z',
          description: null,
          bidNote: null,
        },
      ];
    });
    const out = await cancelBooking('bk-1');
    expect(postedUrl).toBe('/v1/me/bookings/bk-1/cancel');
    expect(out.status).toBe('CANCELLED');
    // cancel-booking is path-param only — no body should ship.
    expect(bodyLen === undefined || bodyLen === 0).toBe(true);
  });

  it('propagates a 409 (already-cancelled) so the UI can surface a CONFLICT message', async () => {
    mock.onPost('/v1/me/bookings/bk-1/cancel').reply(409, {
      error: { code: 'CONFLICT', message: 'Booking is already cancelled.' },
    });
    await expect(cancelBooking('bk-1')).rejects.toMatchObject({
      response: { status: 409 },
    });
  });
});
