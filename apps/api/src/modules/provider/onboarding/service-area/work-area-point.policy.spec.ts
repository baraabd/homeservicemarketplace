import { marketContainsPoint, parseSupportedMarkets } from '../market/supported-market';
import { resolveWorkAreaPoint, WORK_AREA_POINT_MESSAGE } from './work-area-point.policy';

// R09 — the one rule for a provider's starting point, without a database.

const BOUNDS = { south: 32.3, west: 35.6, north: 37.4, east: 42.4 };
const MARKET = { bounds: BOUNDS };
const UNDESCRIBED = {};
const INSIDE = { lat: 36.2, lng: 37.16 };
const OUTSIDE = { lat: 16.02, lng: 7.03 };
const NONE = { lat: null, lng: null };

describe('marketContainsPoint', () => {
  it('includes the edges and the corners', () => {
    expect(marketContainsPoint(MARKET, { lat: BOUNDS.south, lng: BOUNDS.west })).toBe(true);
    expect(marketContainsPoint(MARKET, { lat: BOUNDS.north, lng: BOUNDS.east })).toBe(true);
    expect(marketContainsPoint(MARKET, INSIDE)).toBe(true);
  });

  it.each([
    ['south', { lat: BOUNDS.south - 1e-6, lng: 37 }],
    ['north', { lat: BOUNDS.north + 1e-6, lng: 37 }],
    ['west', { lat: 35, lng: BOUNDS.west - 1e-6 }],
    ['east', { lat: 35, lng: BOUNDS.east + 1e-6 }],
  ])('excludes a point just %s of the envelope', (_side, point) => {
    expect(marketContainsPoint(MARKET, point)).toBe(false);
  });

  it('answers null, not true or false, for a market nobody has described', () => {
    expect(marketContainsPoint(UNDESCRIBED, OUTSIDE)).toBeNull();
  });
});

describe('the market registry describes where a market is', () => {
  const market = (bounds: unknown) => [
    { countryCode: 'SY', enabled: true, displayNameKey: 'market.SY', bounds },
  ];

  it('keeps a valid envelope and freezes it', () => {
    const [parsed] = parseSupportedMarkets(market(BOUNDS));
    expect(parsed.bounds).toEqual(BOUNDS);
    expect(Object.isFrozen(parsed.bounds)).toBe(true);
  });

  it('leaves a market without an envelope undescribed', () => {
    const [parsed] = parseSupportedMarkets(market(undefined));
    expect(parsed).not.toHaveProperty('bounds');
  });

  it.each([
    ['a string', 'syria'],
    ['an array', [32, 35, 37, 42]],
    ['a missing edge', { south: 32, west: 35, north: 37 }],
    ['a non-finite edge', { ...BOUNDS, north: Number.POSITIVE_INFINITY }],
    ['a textual edge', { ...BOUNDS, east: '42.4' }],
    ['south above north', { ...BOUNDS, south: 40 }],
    ['west past east', { ...BOUNDS, west: 50 }],
    ['a latitude beyond the pole', { ...BOUNDS, north: 90.1 }],
    ['a longitude beyond the antimeridian', { ...BOUNDS, east: 180.1 }],
    ['null', null],
  ])('REFUSES %s as an envelope', (_label, bounds) => {
    expect(() => parseSupportedMarkets(market(bounds))).toThrow(
      expect.objectContaining({ code: 'INVALID_BOUNDS' }),
    );
  });
});

describe('resolveWorkAreaPoint', () => {
  const base = { stored: NONE, market: MARKET, marketChanged: false };

  it('writes nothing when the request does not mention the point', () => {
    expect(resolveWorkAreaPoint({ ...base, stored: INSIDE, requested: {} })).toEqual({
      ok: true,
      write: false,
      ...INSIDE,
      invalidated: false,
    });
  });

  it('accepts a whole point inside the market', () => {
    expect(resolveWorkAreaPoint({ ...base, requested: INSIDE })).toEqual({
      ok: true,
      write: true,
      ...INSIDE,
      invalidated: false,
    });
  });

  it.each([
    ['a latitude alone', NONE, { lat: 36.2 }],
    ['a longitude alone', NONE, { lng: 37.16 }],
    ['clearing only the latitude', INSIDE, { lat: null }],
    ['clearing only the longitude', INSIDE, { lng: null }],
  ])('refuses %s', (_label, stored, requested) => {
    expect(resolveWorkAreaPoint({ ...base, stored, requested })).toEqual({
      ok: false,
      code: 'COORDINATES_INCOMPLETE',
    });
  });

  it('completes a point from the half that is already stored', () => {
    expect(resolveWorkAreaPoint({ ...base, stored: INSIDE, requested: { lat: 36.5 } })).toEqual({
      ok: true,
      write: true,
      lat: 36.5,
      lng: INSIDE.lng,
      invalidated: false,
    });
  });

  it('clears a point as a pair', () => {
    expect(resolveWorkAreaPoint({ ...base, stored: INSIDE, requested: NONE })).toMatchObject({
      ok: true,
      write: true,
      ...NONE,
    });
  });

  it('refuses a point outside the market', () => {
    expect(resolveWorkAreaPoint({ ...base, requested: OUTSIDE })).toEqual({
      ok: false,
      code: 'POINT_OUTSIDE_MARKET',
    });
  });

  it('refuses a move that would carry a stored half out of the market', () => {
    expect(
      resolveWorkAreaPoint({ ...base, stored: INSIDE, requested: { lat: OUTSIDE.lat } }),
    ).toEqual({ ok: false, code: 'POINT_OUTSIDE_MARKET' });
  });

  it.each([
    ['an undescribed market', UNDESCRIBED],
    ['no market at all', null],
  ])('cannot judge a point against %s, and accepts it', (_label, market) => {
    expect(resolveWorkAreaPoint({ ...base, market, requested: OUTSIDE })).toMatchObject({
      ok: true,
      write: true,
      ...OUTSIDE,
    });
  });

  describe('when the provider moves to another market', () => {
    const moving = { ...base, marketChanged: true, requested: {} };

    it('clears a stored point the new market does not contain', () => {
      expect(resolveWorkAreaPoint({ ...moving, stored: OUTSIDE })).toEqual({
        ok: true,
        write: true,
        ...NONE,
        invalidated: true,
      });
    });

    it('keeps a stored point the new market contains', () => {
      expect(resolveWorkAreaPoint({ ...moving, stored: INSIDE })).toMatchObject({
        write: false,
        invalidated: false,
      });
    });

    it('keeps a stored point the new market cannot judge', () => {
      expect(
        resolveWorkAreaPoint({ ...moving, market: UNDESCRIBED, stored: OUTSIDE }),
      ).toMatchObject({ write: false, invalidated: false });
    });

    it('does not clear anything when the market did not change', () => {
      expect(
        resolveWorkAreaPoint({ ...moving, marketChanged: false, stored: OUTSIDE }),
      ).toMatchObject({ write: false, invalidated: false });
    });

    it('judges a point sent in the same request instead of clearing', () => {
      expect(resolveWorkAreaPoint({ ...moving, stored: OUTSIDE, requested: INSIDE })).toMatchObject(
        { ok: true, write: true, ...INSIDE, invalidated: false },
      );
    });
  });

  it('has a sentence for every refusal', () => {
    expect(Object.keys(WORK_AREA_POINT_MESSAGE).sort()).toEqual([
      'COORDINATES_INCOMPLETE',
      'POINT_OUTSIDE_MARKET',
    ]);
  });
});
