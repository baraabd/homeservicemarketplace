import type { Request, Response } from 'express';
import { DisputePrivacyMiddleware } from './dispute-privacy.middleware';
it.each(['/v1/me/disputes', '/v1/me/disputes/foreign', '/v1/me/disputes?limit=20'])('sets no-store before a guard can reject %s', (url) => {
  const response = { setHeader: jest.fn() }; const next = jest.fn();
  new DisputePrivacyMiddleware().use({ originalUrl: url } as Request, response as unknown as Response, next);
  expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store'); expect(next).toHaveBeenCalledTimes(1);
});
it('does not change unrelated API caching', () => {
  const response = { setHeader: jest.fn() };
  new DisputePrivacyMiddleware().use({ originalUrl: '/v1/media/public' } as Request, response as unknown as Response, jest.fn());
  expect(response.setHeader).not.toHaveBeenCalled();
});
