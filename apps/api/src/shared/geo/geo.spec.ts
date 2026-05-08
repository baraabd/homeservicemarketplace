import { getBoundingBox, haversineDistance } from './geo';

// Reference distances used to pin the helpers. Numbers come from the
// great-circle formula applied to well-known city centres so a future
// regression in `haversineDistance` shows up as a meaningful diff
// against a real-world expectation.
//
// Tolerances are loose (±1% relative) — Haversine has ~0.5% error vs the
// WGS-84 ellipsoid for distances of this scale and we're not building a
// geodesy library; we're filtering job rows.

describe('haversineDistance', () => {
  it('returns 0 for the same point', () => {
    expect(haversineDistance(24.7136, 46.6753, 24.7136, 46.6753)).toBeCloseTo(0, 5);
  });

  it('measures the Aleppo (city) → Aleppo Governorate centre as a small intra-city distance', () => {
    // Aleppo city centre and the governorate centroid are ~6 km apart —
    // the exact regression case behind this sprint. A 50 km radius
    // covers it comfortably.
    const aleppoCity: [number, number] = [36.2012, 37.1612];
    const aleppoGovernorate: [number, number] = [36.16, 37.17];
    const d = haversineDistance(...aleppoCity, ...aleppoGovernorate);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(8);
  });

  it('measures Riyadh → Jeddah at ~850 km', () => {
    const riyadh: [number, number] = [24.7136, 46.6753];
    const jeddah: [number, number] = [21.4858, 39.1925];
    const d = haversineDistance(...riyadh, ...jeddah);
    expect(d).toBeGreaterThan(840);
    expect(d).toBeLessThan(870);
  });

  it('is symmetric (a → b equals b → a)', () => {
    const a: [number, number] = [24.7136, 46.6753];
    const b: [number, number] = [33.5138, 36.2765];
    expect(haversineDistance(...a, ...b)).toBeCloseTo(haversineDistance(...b, ...a), 5);
  });
});

describe('getBoundingBox', () => {
  it('produces a bbox that strictly contains the centre', () => {
    const lat = 24.7136;
    const lng = 46.6753;
    const bbox = getBoundingBox(lat, lng, 50);
    expect(lat).toBeGreaterThan(bbox.minLat);
    expect(lat).toBeLessThan(bbox.maxLat);
    expect(lng).toBeGreaterThan(bbox.minLng);
    expect(lng).toBeLessThan(bbox.maxLng);
  });

  it('produces a bbox approximately ±0.45° latitude for a 50 km radius', () => {
    // 50 km / 111.045 km-per-degree ≈ 0.4503°. Asserting the range so
    // a future change in the constant is flagged.
    const bbox = getBoundingBox(24.7136, 46.6753, 50);
    expect(bbox.maxLat - bbox.minLat).toBeCloseTo(0.9, 1);
  });

  it('every point inside the bbox is at most ~1.42 × radius from centre', () => {
    // The bbox is circumscribed around the radius circle — its corners
    // are √2 × radius ≈ 1.414 × radius from the centre. Points
    // OUTSIDE the bbox are guaranteed > radius away, so the bbox is a
    // safe pre-filter; corners get clipped by the precise Haversine
    // post-filter the service layer applies.
    const radiusKm = 50;
    const lat = 24.7136;
    const lng = 46.6753;
    const bbox = getBoundingBox(lat, lng, radiusKm);
    const corners: Array<[number, number]> = [
      [bbox.minLat, bbox.minLng],
      [bbox.minLat, bbox.maxLng],
      [bbox.maxLat, bbox.minLng],
      [bbox.maxLat, bbox.maxLng],
    ];
    for (const [cLat, cLng] of corners) {
      const d = haversineDistance(lat, lng, cLat, cLng);
      // 1.5x radius is loose tolerance for the √2 corner ratio plus
      // the 111 km/deg flat-Earth approximation.
      expect(d).toBeLessThanOrEqual(radiusKm * 1.5);
    }
  });

  it('clamps the longitude delta near the poles instead of producing Infinity', () => {
    const bbox = getBoundingBox(89.999, 0, 50);
    expect(Number.isFinite(bbox.minLng)).toBe(true);
    expect(Number.isFinite(bbox.maxLng)).toBe(true);
    // Near the pole the longitude bbox should be clamped to ±180°.
    expect(bbox.maxLng - bbox.minLng).toBeLessThanOrEqual(360);
  });
});
