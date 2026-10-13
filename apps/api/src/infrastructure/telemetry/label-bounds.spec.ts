import {
  CardinalityLimiter,
  EnumLabel,
  httpMethodLabel,
  httpRouteLabel,
  httpStatusLabel,
  nameToken,
} from './label-bounds';

describe('label bounds', () => {
  it('uses the matched route pattern, never the concrete path', () => {
    expect(httpRouteLabel({ route: { path: '/v1/bookings/:id' } })).toBe('/v1/bookings/:id');
    expect(httpRouteLabel({ baseUrl: '/v1', route: { path: '/x/:id' } })).toBe('/v1/x/:id');
  });

  it("maps no route and Nest's global-middleware wildcard to unmatched", () => {
    expect(httpRouteLabel({})).toBe('unmatched');
    // Observed at runtime: a 404 finishes with Nest's middleware wildcard as
    // its last matched route (Express 5 syntax).
    expect(httpRouteLabel({ route: { path: '/{*path}' } })).toBe('unmatched');
    expect(httpRouteLabel({ route: { path: '*' } })).toBe('unmatched');
  });

  it('keeps real controller wildcard routes as their own pattern', () => {
    expect(httpRouteLabel({ route: { path: '/v1/media/files/*path' } })).toBe(
      '/v1/media/files/*path',
    );
  });

  it('rejects non-string and oversized patterns', () => {
    expect(httpRouteLabel({ route: { path: /regex/ } })).toBe('unmatched');
    expect(httpRouteLabel({ route: { path: `/${'a'.repeat(200)}` } })).toBe('other');
  });

  it('bounds methods, statuses and names', () => {
    expect(httpMethodLabel('get')).toBe('GET');
    expect(httpMethodLabel('BREW')).toBe('other');
    expect(httpStatusLabel(503)).toBe('503');
    expect(httpStatusLabel(42)).toBe('other');
    expect(httpStatusLabel('200')).toBe('other');
    expect(nameToken('outbox.tick')).toBe('outbox.tick');
    expect(nameToken('Outbox Tick')).toBe('other');
    expect(nameToken('a'.repeat(49))).toBe('other');
  });

  it('EnumLabel admits only declared values', () => {
    const l = new EnumLabel(['a', 'b'] as const);
    expect(l.value('a')).toBe('a');
    expect(l.value('c')).toBe('other');
    expect(l.value(undefined)).toBe('other');
  });

  it('CardinalityLimiter keeps the first N values and counts the rest', () => {
    const lim = new CardinalityLimiter(2);
    expect(lim.admit('x')).toBe('x');
    expect(lim.admit('y')).toBe('y');
    expect(lim.admit('z')).toBe('other');
    expect(lim.admit('x')).toBe('x');
    expect(lim.size).toBe(2);
    expect(lim.overflows).toBe(1);
  });
});
