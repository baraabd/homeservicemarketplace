import {
  boundingBox,
  clampRadiusKm,
  haversineKm,
  isValidCoordinate,
  isValidRadiusKm,
  matchServiceArea,
  normaliseCityKey,
  usesRadiusMatching,
  MAX_SERVICE_AREA_RADIUS_KM,
  type RequestLocation,
  type ServiceArea,
} from './service-area';
import { filterByExactRadius, serviceAreaWhere } from './service-area.sql';

// Real coordinates, so the distances below are checkable against any mapping
// tool rather than being self-referential.
const ALEPPO = { lat: 36.2021, lng: 37.1343 };
const DAMASCUS = { lat: 33.5138, lng: 36.2765 };
const ALEPPO_SUBURB = { lat: 36.2521, lng: 37.1343 }; // ~5.6 km due north

function area(overrides: Partial<ServiceArea> = {}): ServiceArea {
  return { lat: ALEPPO.lat, lng: ALEPPO.lng, radiusKm: 25, cityKey: 'aleppo', ...overrides };
}
function location(overrides: Partial<RequestLocation> = {}): RequestLocation {
  return { lat: ALEPPO.lat, lng: ALEPPO.lng, cityKey: 'aleppo', ...overrides };
}

describe('haversineKm', () => {
  it('measures a known separation', () => {
    // Aleppo to Damascus is ~305 km great-circle. Loose bound: the assertion
    // is that the formula is right, not that the cities have not moved.
    const d = haversineKm(ALEPPO, DAMASCUS)!;
    expect(d).toBeGreaterThan(300);
    expect(d).toBeLessThan(315);
  });

  it('is zero for identical points and symmetric between two', () => {
    expect(haversineKm(ALEPPO, ALEPPO)).toBe(0);
    expect(haversineKm(ALEPPO, DAMASCUS)).toBe(haversineKm(DAMASCUS, ALEPPO));
  });

  it('returns null — not zero — when either end is unknown', () => {
    // The wire must distinguish "we do not know" from "it is here".
    expect(haversineKm({ lat: null, lng: null }, ALEPPO)).toBeNull();
    expect(haversineKm(ALEPPO, { lat: 36.2, lng: null })).toBeNull();
  });

  it('rejects out-of-range and non-finite coordinates', () => {
    expect(haversineKm({ lat: 91, lng: 0 }, ALEPPO)).toBeNull();
    expect(haversineKm({ lat: 0, lng: 181 }, ALEPPO)).toBeNull();
    expect(haversineKm({ lat: Number.NaN, lng: 0 }, ALEPPO)).toBeNull();
    expect(haversineKm({ lat: Number.POSITIVE_INFINITY, lng: 0 }, ALEPPO)).toBeNull();
  });

  it('handles an antimeridian pair as a short hop, not a trip round the world', () => {
    // 179.9E to 179.9W is ~22 km apart, not ~40,000 km. Getting this wrong is
    // invisible until someone operates near the date line.
    const d = haversineKm({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 })!;
    expect(d).toBeLessThan(30);
  });
});

describe('validation helpers', () => {
  it('treats NaN as invalid rather than letting it poison comparisons', () => {
    // Every comparison with NaN is false, so an unchecked NaN would silently
    // make a row unmatchable instead of loudly wrong.
    expect(isValidCoordinate(Number.NaN, 0)).toBe(false);
    expect(isValidRadiusKm(Number.NaN)).toBe(false);
  });

  it('treats a zero or negative radius as unset', () => {
    // 0 km is what an unfinished onboarding looks like; taking it literally
    // would match nothing at all.
    expect(isValidRadiusKm(0)).toBe(false);
    expect(isValidRadiusKm(-5)).toBe(false);
    expect(isValidRadiusKm(0.5)).toBe(true);
  });

  it('clamps a hostile radius to the blast-radius cap', () => {
    expect(clampRadiusKm(10_000)).toBe(MAX_SERVICE_AREA_RADIUS_KM);
    expect(clampRadiusKm(-1)).toBe(0);
  });

  it('normalises city keys identically to the SQL backfill (btrim + lower)', () => {
    expect(normaliseCityKey('  Aleppo ')).toBe('aleppo');
    expect(normaliseCityKey('ALEPPO')).toBe('aleppo');
    expect(normaliseCityKey('   ')).toBeNull();
    expect(normaliseCityKey(null)).toBeNull();
  });
});

describe('boundingBox', () => {
  it('contains the circle it approximates', () => {
    const box = boundingBox(ALEPPO, 25);
    expect(box.minLat).toBeLessThan(ALEPPO.lat);
    expect(box.maxLat).toBeGreaterThan(ALEPPO.lat);
    // A point 25 km due north must fall inside the latitude band.
    const northLat = ALEPPO.lat + (25 / 6371) * (180 / Math.PI);
    expect(box.maxLat).toBeGreaterThanOrEqual(northLat - 1e-9);
  });

  it('widens longitude with latitude', () => {
    // A degree of longitude is shorter near the poles, so the same radius
    // needs a wider longitude window there.
    const equator = boundingBox({ lat: 0, lng: 0 }, 100);
    const north = boundingBox({ lat: 60, lng: 0 }, 100);
    const width = (b: ReturnType<typeof boundingBox>) =>
      b.lngRanges[0].maxLng - b.lngRanges[0].minLng;
    expect(width(north)).toBeGreaterThan(width(equator) * 1.5);
  });

  it('splits into two ranges across the antimeridian', () => {
    const box = boundingBox({ lat: 0, lng: 179.9 }, 50);
    expect(box.lngRanges).toHaveLength(2);
    // Every range stays inside the legal coordinate domain.
    for (const r of box.lngRanges) {
      expect(r.minLng).toBeGreaterThanOrEqual(-180);
      expect(r.maxLng).toBeLessThanOrEqual(180);
    }
    // One range must touch each edge.
    expect(box.lngRanges.some((r) => r.maxLng === 180)).toBe(true);
    expect(box.lngRanges.some((r) => r.minLng === -180)).toBe(true);
  });

  it('splits at the negative edge too', () => {
    const box = boundingBox({ lat: 0, lng: -179.9 }, 50);
    expect(box.lngRanges).toHaveLength(2);
    expect(box.lngRanges.some((r) => r.minLng === -180)).toBe(true);
    expect(box.lngRanges.some((r) => r.maxLng === 180)).toBe(true);
  });

  it('degrades to a latitude band near a pole instead of producing nonsense', () => {
    const box = boundingBox({ lat: 89.9, lng: 0 }, 100);
    expect(box.wholeWorldLng).toBe(true);
    expect(box.maxLat).toBeLessThanOrEqual(90);
    expect(box.minLat).toBeGreaterThanOrEqual(-90);
  });

  it('never emits a latitude outside [-90, 90]', () => {
    for (const lat of [89.99, -89.99, 90, -90]) {
      const box = boundingBox({ lat, lng: 0 }, 500);
      expect(box.minLat).toBeGreaterThanOrEqual(-90);
      expect(box.maxLat).toBeLessThanOrEqual(90);
    }
  });

  it('clamps a hostile radius so the box cannot become a table scan by request', () => {
    const box = boundingBox(ALEPPO, 999_999);
    expect(box.maxLat - box.minLat).toBeLessThanOrEqual(
      2 * (MAX_SERVICE_AREA_RADIUS_KM / 6371) * (180 / Math.PI) + 1e-9,
    );
  });
});

// The behaviour table in ADR 0003, asserted row by row.
describe('matchServiceArea — the ADR 0003 behaviour table', () => {
  it('both geocoded, inside radius → radius match', () => {
    const m = matchServiceArea(area({ radiusKm: 25 }), location(ALEPPO_SUBURB));
    expect(m.strategy).toBe('radius');
    expect(m.matches).toBe(true);
    expect(m.distanceKm).toBeGreaterThan(0);
  });

  it('both geocoded, outside radius → no match even in the same city', () => {
    // The correction this sprint exists for: city equality alone is not enough.
    const m = matchServiceArea(area({ radiusKm: 5 }), location({ ...DAMASCUS, cityKey: 'aleppo' }));
    expect(m.strategy).toBe('radius');
    expect(m.matches).toBe(false);
  });

  it('both geocoded, different cities but inside radius → MATCH', () => {
    // The other half of the correction: a job 5.6 km away across a municipal
    // boundary is a match. City must not veto the radius.
    const m = matchServiceArea(
      area({ radiusKm: 25, cityKey: 'aleppo' }),
      location({ ...ALEPPO_SUBURB, cityKey: 'some-other-municipality' }),
    );
    expect(m.strategy).toBe('radius');
    expect(m.matches).toBe(true);
  });

  it('provider geocoded, request NOT geocoded → city fallback, included', () => {
    // A seeker's address failing to geocode must not make their job invisible.
    const m = matchServiceArea(area(), location({ lat: null, lng: null, cityKey: 'aleppo' }));
    expect(m.strategy).toBe('city-fallback');
    expect(m.matches).toBe(true);
    expect(m.distanceKm).toBeNull();
  });

  it('provider geocoded, request ungeocoded in a DIFFERENT city → excluded', () => {
    const m = matchServiceArea(area(), location({ lat: null, lng: null, cityKey: 'damascus' }));
    expect(m.strategy).toBe('city-fallback');
    expect(m.matches).toBe(false);
  });

  it('provider has no radius → city fallback (today’s behaviour, unchanged)', () => {
    // This is the compatibility guarantee: enabling radius matching must not
    // narrow the feed of a provider who never set a service-area centre.
    const m = matchServiceArea(
      area({ radiusKm: null }),
      location({ ...DAMASCUS, cityKey: 'aleppo' }),
    );
    expect(m.strategy).toBe('city-fallback');
    expect(m.matches).toBe(true);
  });

  it('provider has no coordinates → city fallback', () => {
    const m = matchServiceArea(area({ lat: null, lng: null }), location());
    expect(m.strategy).toBe('city-fallback');
    expect(m.matches).toBe(true);
  });

  it('request has neither coordinates nor a city → unmatchable', () => {
    const m = matchServiceArea(area(), location({ lat: null, lng: null, cityKey: null }));
    expect(m.strategy).toBe('unmatchable');
    expect(m.matches).toBe(false);
  });

  it('exactly on the radius boundary is INSIDE', () => {
    // <= not <. An inclusive boundary is the defensible reading of "within
    // 25 km", and picking one deliberately stops it drifting later.
    const north = { lat: ALEPPO.lat + (10 / 6371) * (180 / Math.PI), lng: ALEPPO.lng };
    const exact = haversineKm(ALEPPO, north)!;
    const m = matchServiceArea(area({ radiusKm: exact }), location({ ...north, cityKey: 'x' }));
    expect(m.matches).toBe(true);
  });

  it('city comparison is exact on already-normalised keys', () => {
    // Both sides are normalised at write time, so the comparison itself is a
    // plain equality — and must not quietly become case-insensitive here,
    // because the SQL equality is not.
    expect(
      matchServiceArea(
        area({ lat: null, cityKey: 'aleppo' }),
        location({ lat: null, cityKey: 'aleppo' }),
      ).matches,
    ).toBe(true);
    expect(
      matchServiceArea(
        area({ lat: null, cityKey: 'aleppo' }),
        location({ lat: null, cityKey: 'Aleppo' }),
      ).matches,
    ).toBe(false);
  });
});

describe('serviceAreaWhere — SQL fragment', () => {
  it('returns null when nothing constrains the feed', () => {
    // Must be null, not {}. An empty filter would turn a half-onboarded
    // provider's feed into the global feed.
    expect(serviceAreaWhere({ lat: null, lng: null, radiusKm: null, cityKey: null })).toBeNull();
  });

  it('falls back to plain city equality without a usable radius', () => {
    const where = serviceAreaWhere({ lat: null, lng: null, radiusKm: null, cityKey: 'aleppo' });
    expect(where).toEqual({ locationCityKey: 'aleppo' });
  });

  it('emits a bounding box OR-ed with an ungeocoded same-city arm', () => {
    const where = serviceAreaWhere(area())!;
    expect(where.OR).toHaveLength(2);
    const [box, fallback] = where.OR as [Record<string, unknown>, Record<string, unknown>];
    expect(box.locationLat).toMatchObject({ gte: expect.any(Number), lte: expect.any(Number) });
    // The fallback arm must be restricted to rows with NO coordinates,
    // otherwise it would re-admit the geocoded rows the box just excluded.
    expect(fallback).toEqual({ locationLat: null, locationCityKey: 'aleppo' });
  });

  it('omits the fallback arm when the provider has no city', () => {
    // The remaining top-level OR is the LONGITUDE range list, which the box
    // always carries — not a city arm. Assert on its shape so this test
    // cannot pass just because some OR happens to exist.
    const where = serviceAreaWhere(area({ cityKey: null }))!;
    expect(where.locationLat).toBeDefined();
    const arms = (where.OR ?? []) as Array<Record<string, unknown>>;
    for (const arm of arms) {
      expect(Object.keys(arm)).toEqual(['locationLng']);
    }
    expect(arms.some((arm) => 'locationCityKey' in arm)).toBe(false);
  });
});

describe('filterByExactRadius — dropping the box corners', () => {
  it('removes a corner point that the box admits but the circle excludes', () => {
    const a = area({ radiusKm: 25 });
    const box = boundingBox({ lat: a.lat!, lng: a.lng! }, 25);
    // The box corner is sqrt(2)x further than the radius, so it is inside the
    // square and outside the circle — exactly what this filter is for.
    const corner: RequestLocation = { lat: box.maxLat, lng: box.lngRanges[0].maxLng, cityKey: 'x' };
    expect(haversineKm(a as never, corner)!).toBeGreaterThan(25);
    expect(filterByExactRadius(a, [corner], (r) => r)).toHaveLength(0);
  });

  it('keeps a point inside the circle', () => {
    expect(
      filterByExactRadius(area({ radiusKm: 25 }), [location(ALEPPO_SUBURB)], (r) => r),
    ).toHaveLength(1);
  });

  it('keeps ungeocoded rows — they arrived via the city arm, not the box', () => {
    const rows = [{ lat: null, lng: null, cityKey: 'aleppo' }];
    expect(filterByExactRadius(area(), rows, (r) => r)).toHaveLength(1);
  });

  it('is a no-op when the provider is not using radius matching', () => {
    const rows = [location(DAMASCUS), location(ALEPPO_SUBURB)];
    expect(filterByExactRadius(area({ radiusKm: null }), rows, (r) => r)).toHaveLength(2);
  });
});

// The core anti-drift guarantee: the SQL path and the in-memory path must
// agree. They are two implementations of one rule, which is exactly how the
// radius column stayed dead for a sprint.
describe('SQL and in-memory predicates agree', () => {
  const a = area({ radiusKm: 25 });

  const candidates: RequestLocation[] = [
    location(ALEPPO), // dead centre
    location(ALEPPO_SUBURB), // inside
    location({ ...DAMASCUS, cityKey: 'damascus' }), // far outside
    { lat: null, lng: null, cityKey: 'aleppo' }, // ungeocoded, same city
    { lat: null, lng: null, cityKey: 'damascus' }, // ungeocoded, other city
    { lat: null, lng: null, cityKey: null }, // unmatchable
  ];

  it('produces the same verdict for every fixture', () => {
    for (const c of candidates) {
      const inMemory = matchServiceArea(a, c).matches;

      // Simulate what the database would do: apply the OR-ed where fragment,
      // then the exact-radius post-filter the repository applies.
      const where = serviceAreaWhere(a)!;
      const arms = (where.OR ?? [where]) as Array<Record<string, unknown>>;
      const selectedByBox = arms.some((arm) => {
        if ('locationCityKey' in arm && arm.locationLat === null) {
          return c.lat == null && c.cityKey === arm.locationCityKey;
        }
        const lat = arm.locationLat as { gte: number; lte: number } | undefined;
        if (!lat || c.lat == null || c.lng == null) return false;
        const inLat = c.lat >= lat.gte && c.lat <= lat.lte;
        const lngArms = (arm.OR ?? []) as Array<{ locationLng: { gte: number; lte: number } }>;
        const inLng =
          lngArms.length === 0 ||
          lngArms.some((l) => c.lng! >= l.locationLng.gte && c.lng! <= l.locationLng.lte);
        return inLat && inLng;
      });
      const viaSql = selectedByBox && filterByExactRadius(a, [c], (r) => r).length === 1;

      expect({ fixture: c, viaSql }).toEqual({ fixture: c, viaSql: inMemory });
    }
  });
});

describe('usesRadiusMatching', () => {
  it('requires BOTH a coordinate and a positive radius', () => {
    expect(usesRadiusMatching(area())).toBe(true);
    expect(usesRadiusMatching(area({ radiusKm: 0 }))).toBe(false);
    expect(usesRadiusMatching(area({ lat: null }))).toBe(false);
  });
});
