import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import {
  BOOKING_REVIEW_COMMENT_MAX_LENGTH,
  BOOKING_REVIEW_MAX_RATING,
  BOOKING_REVIEW_MIN_RATING,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';
import {
  REVIEW_COMMENT_MAX_LENGTH,
  REVIEW_MAX_RATING,
  REVIEW_MIN_RATING,
  getBookingReview,
  submitBookingReview,
} from './reviews-api';

// R11 — the web mirrors three numbers from the contracts package because it
// cannot import runtime values from it in a production build. This test can
// (it runs in Node), and fails when the mirror and the contract disagree.

describe('reviews-api — mirrored limits', () => {
  it('match the contracts', () => {
    expect(REVIEW_MIN_RATING).toBe(BOOKING_REVIEW_MIN_RATING);
    expect(REVIEW_MAX_RATING).toBe(BOOKING_REVIEW_MAX_RATING);
    expect(REVIEW_COMMENT_MAX_LENGTH).toBe(BOOKING_REVIEW_COMMENT_MAX_LENGTH);
  });
});

describe('reviews-api — requests', () => {
  let mock: MockAdapter;
  beforeEach(() => {
    mock = new MockAdapter(api);
  });
  afterEach(() => {
    mock.restore();
  });

  it('reads the review of one booking', async () => {
    const answer = { bookingId: 'bk-1', eligibility: 'ELIGIBLE', review: null };
    mock.onGet('/v1/me/bookings/bk-1/review').reply(200, answer);
    await expect(getBookingReview('bk-1')).resolves.toEqual(answer);
  });

  it('sends the rating and the comment, and nothing that names a person', async () => {
    mock.onPost('/v1/me/bookings/bk-1/review').reply(201, {
      review: {
        id: 'rv-1',
        bookingId: 'bk-1',
        rating: 4,
        comment: 'Good',
        state: 'PUBLISHED',
        createdAt: '2026-10-03T10:00:00.000Z',
      },
      replayed: false,
    });
    await submitBookingReview('bk-1', { rating: 4, comment: 'Good' });
    expect(mock.history.post).toHaveLength(1);
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({ rating: 4, comment: 'Good' });
  });
});
