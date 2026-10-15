import type { NextFunction, Request, Response } from 'express';

import { REQUEST_ID_HEADER, RequestIdMiddleware } from './request-id.middleware';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function invoke(existing: unknown, incoming: unknown) {
  const req = { id: existing, header: jest.fn(() => incoming) };
  const res = { setHeader: jest.fn() };
  const next = jest.fn();
  new RequestIdMiddleware().use(
    req as unknown as Request,
    res as unknown as Response,
    next as NextFunction,
  );
  expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.id);
  expect(next).toHaveBeenCalledTimes(1);
  return req.id;
}

describe('RequestIdMiddleware correlation agreement', () => {
  it.each(
    [
      undefined,
      'bad id with spaces',
      'x'.repeat(129),
      ['first', 'second'],
      'different-safe-id',
    ].map((incoming) => [incoming]),
  )('preserves the validated logger id despite inbound value %#', (incoming) => {
    expect(invoke('logger-request_123', incoming)).toBe('logger-request_123');
  });

  it.each(
    [undefined, null, 42, 'bad existing id', 'x'.repeat(129), ['one-id']].map((existing) => [
      existing,
    ]),
  )('rejects invalid pre-existing id %# and uses a safe header', (existing) => {
    expect(invoke(existing, 'safe-header_123')).toBe('safe-header_123');
  });

  it.each(
    [undefined, '', 'unsafe id', 'x'.repeat(129), ['one-id'], ['first', 'second']].map(
      (incoming) => [incoming],
    ),
  )('generates a UUID for missing, unsafe or repeated inbound value %#', (incoming) => {
    expect(invoke(undefined, incoming)).toMatch(UUID);
  });

  it('preserves the exact accepted 128-character boundary', () => {
    const id = 'a'.repeat(128);
    expect(invoke(undefined, id)).toBe(id);
  });
});
