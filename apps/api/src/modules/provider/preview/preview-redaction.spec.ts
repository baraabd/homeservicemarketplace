import {
  freshnessOf,
  previewRef,
  redactForPreview,
  snapToCell,
  type PreviewPolicy,
  type PreviewSourceRow,
} from './preview-redaction';

// Sprint 9B.9 — the redaction, asserted against the attack it exists to stop.
//
// A preview user is unverified by definition, so these tests are written from
// the attacker's side: what can someone rebuild by collecting many previews?

const POLICY: PreviewPolicy = { cellKm: 25, pageSize: 10, maxItems: 30 };
const SALT = 'viewer-salt-a';
const NOW = new Date('2026-06-15T12:00:00.000Z');

// Aleppo, to six decimal places — roughly 10 cm of precision.
const LAT = 36.202105;
const LNG = 37.13426;

function row(over: Partial<PreviewSourceRow> = {}): PreviewSourceRow {
  return {
    id: 'req-1',
    categoryId: 'cat-1',
    category: { slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
    scheduleType: 'ASAP',
    locationCityKey: 'aleppo',
    locationLat: LAT,
    locationLng: LNG,
    createdAt: new Date('2026-06-15T08:00:00.000Z'),
    ...over,
  };
}

describe('the allowlist is the whole output', () => {
  it('emits exactly the permitted top-level fields, and nothing else', () => {
    // The strongest form of the assertion: not "it does not contain a phone
    // number" but "these are the only keys there are". A field added to the
    // projection without being considered fails here immediately.
    const item = redactForPreview(row(), POLICY, SALT, NOW);

    expect(Object.keys(item).sort()).toEqual(
      [
        'area',
        'categoryLabelAr',
        'categoryLabelEn',
        'categorySlug',
        'freshness',
        'ref',
        'scheduleType',
      ].sort(),
    );
    expect(Object.keys(item.area).sort()).toEqual(
      ['cellKm', 'cellLat', 'cellLng', 'cityKey'].sort(),
    );
  });

  it('carries no seeker, description, media, bid count or exact timestamp', () => {
    const serialised = JSON.stringify(redactForPreview(row(), POLICY, SALT, NOW));

    for (const forbidden of [
      'seeker',
      'seekerUserId',
      'description',
      'media',
      'mediaUrls',
      'bidsCount',
      'addressSnapshot',
      'line1',
      'phone',
      'email',
      'createdAt',
      'distanceKm',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('never emits the real request id', () => {
    // A preview client that learned the real id could correlate its harvest
    // with the real feed the moment it gained access.
    const item = redactForPreview(row({ id: 'req-secret-id' }), POLICY, SALT, NOW);
    expect(JSON.stringify(item)).not.toContain('req-secret-id');
    expect(item.ref).not.toBe('req-secret-id');
  });

  it('never emits the request’s own coordinates', () => {
    const item = redactForPreview(row(), POLICY, SALT, NOW);
    expect(item.area.cellLat).not.toBe(LAT);
    expect(item.area.cellLng).not.toBe(LNG);
  });
});

describe('the reference is a per-viewer pseudonym', () => {
  it('is stable for one viewer, so a client can key and de-duplicate a list', () => {
    expect(previewRef('req-1', SALT)).toBe(previewRef('req-1', SALT));
  });

  it('differs between viewers for the SAME request', () => {
    // Colluding preview users must not be able to align their harvests.
    expect(previewRef('req-1', 'viewer-salt-a')).not.toBe(previewRef('req-1', 'viewer-salt-b'));
  });

  it('differs between requests for the same viewer', () => {
    expect(previewRef('req-1', SALT)).not.toBe(previewRef('req-2', SALT));
  });

  it('does not leak the request id through its own bytes', () => {
    const id = 'req-0123456789abcdef';
    expect(previewRef(id, SALT)).not.toContain(id.slice(4));
  });
});

describe('location is snapped, never jittered', () => {
  it('is deterministic: re-requesting reveals nothing new', () => {
    // THE central property. Random jitter around a true point averages out,
    // so an attacker who can re-request converges on the exact location.
    // Snapping returns the identical cell every time, so 10,000 samples say
    // exactly what one says.
    const first = snapToCell(LAT, LNG, 25);
    for (let i = 0; i < 50; i++) {
      expect(snapToCell(LAT, LNG, 25)).toEqual(first);
    }
  });

  it('maps every point in a cell to ONE identical output', () => {
    // Indistinguishability within a cell is what makes the cell meaningful.
    // Two homes a few hundred metres apart must be the same dot.
    const a = snapToCell(36.2021, 37.1342, 25);
    const b = snapToCell(36.2035, 37.1361, 25);
    expect(a).toEqual(b);
  });

  it('keeps the emitted centre within the promised distance of the truth', () => {
    // The client is told cellKm; the promise has to hold, or the number is a
    // lie a provider would act on.
    const cellKm = 25;
    for (const [lat, lng] of [
      [36.2021, 37.1342],
      [0.0001, 0.0001],
      [-33.8688, 151.2093],
      [59.9139, 10.7522],
      [-54.8019, -68.3029],
    ]) {
      const cell = snapToCell(lat, lng, cellKm);
      expect(haversineKm(lat, lng, cell.lat, cell.lng)).toBeLessThanOrEqual(cellKm);
    }
  });

  it('a larger cell is never more precise than a smaller one', () => {
    // Monotonicity: raising the policy's cellKm must not accidentally narrow
    // the disclosure, which a naive modulo scheme can do at cell boundaries.
    const tight = snapToCell(LAT, LNG, 5);
    const loose = snapToCell(LAT, LNG, 50);
    expect(haversineKm(LAT, LNG, loose.lat, loose.lng)).toBeGreaterThanOrEqual(
      haversineKm(LAT, LNG, tight.lat, tight.lng) - 1e-9,
    );
  });

  it('does not narrow the longitude cell at high latitude', () => {
    // A degree of longitude is ~111 km at the equator and ~55 km at 60°N. A
    // fixed degree step would make a "25 km" cell a 12 km cell in Oslo and
    // quietly halve the privacy the policy promises.
    const cellKm = 25;
    const cell = snapToCell(59.9139, 10.7522, cellKm);
    expect(haversineKm(59.9139, 10.7522, cell.lat, cell.lng)).toBeLessThanOrEqual(cellKm);
  });

  it('handles a request with no coordinates at all', () => {
    const item = redactForPreview(row({ locationLat: null, locationLng: null }), POLICY, SALT, NOW);
    expect(item.area.cellLat).toBeNull();
    expect(item.area.cellLng).toBeNull();
    expect(item.area.cityKey).toBe('aleppo');
  });
});

describe('pagination cannot reconstruct a location', () => {
  it('yields the same cell however many times the row is paged over', () => {
    // The anti-scraping property stated directly: walking every page, or the
    // same page repeatedly, produces one value.
    const seen = new Set<string>();
    for (let page = 0; page < 200; page++) {
      const item = redactForPreview(row(), POLICY, SALT, NOW);
      seen.add(`${item.area.cellLat},${item.area.cellLng}`);
    }
    expect(seen.size).toBe(1);
  });

  it('averaging many observations does not converge on the true point', () => {
    // The explicit refutation of the jitter approach. The mean of every
    // observation is the cell centre — still a whole cell away from the truth,
    // no matter how many samples an attacker collects.
    const observations = Array.from({ length: 500 }, () => snapToCell(LAT, LNG, POLICY.cellKm));
    const meanLat = observations.reduce((a, o) => a + o.lat, 0) / observations.length;
    const meanLng = observations.reduce((a, o) => a + o.lng, 0) / observations.length;

    expect(haversineKm(LAT, LNG, meanLat, meanLng)).toBeGreaterThan(0.5);
  });

  it('two requests in one cell stay indistinguishable across the whole page set', () => {
    const a = redactForPreview(
      row({ id: 'a', locationLat: 36.2021, locationLng: 37.1342 }),
      POLICY,
      SALT,
      NOW,
    );
    const b = redactForPreview(
      row({ id: 'b', locationLat: 36.2035, locationLng: 37.1361 }),
      POLICY,
      SALT,
      NOW,
    );

    expect(a.area).toEqual(b.area);
    // Different refs, identical geography: the viewer can tell there are two
    // jobs, and cannot tell where either of them is.
    expect(a.ref).not.toBe(b.ref);
  });
});

describe('time is banded, not exact', () => {
  it.each([
    ['2026-06-15T11:00:00.000Z', 'TODAY'],
    ['2026-06-14T13:00:00.000Z', 'TODAY'],
    ['2026-06-12T12:00:00.000Z', 'THIS_WEEK'],
    ['2026-06-01T12:00:00.000Z', 'EARLIER'],
  ])('%s becomes %s', (iso, expected) => {
    expect(freshnessOf(new Date(iso), NOW)).toBe(expected);
  });

  it('collapses timestamps that differ by seconds into one band', () => {
    // An exact createdAt is close to a unique key. Two listings posted a
    // minute apart must not be distinguishable by their time.
    const a = freshnessOf(new Date('2026-06-15T08:00:00.000Z'), NOW);
    const b = freshnessOf(new Date('2026-06-15T08:00:37.000Z'), NOW);
    expect(a).toBe(b);
  });

  it('is exactly at the boundary rather than approximately', () => {
    const exactly24h = new Date(NOW.getTime() - 86_400_000);
    expect(freshnessOf(exactly24h, NOW)).toBe('THIS_WEEK');
    expect(freshnessOf(new Date(exactly24h.getTime() + 1), NOW)).toBe('TODAY');
  });
});

describe('the category passes through, because it is public', () => {
  it('carries both locales so the client renders in either', () => {
    const item = redactForPreview(row(), POLICY, SALT, NOW);
    expect(item.categoryLabelEn).toBe('Plumbing');
    expect(item.categoryLabelAr).toBe('سباكة');
  });

  it('tolerates a request with no category', () => {
    const item = redactForPreview(row({ categoryId: null, category: null }), POLICY, SALT, NOW);
    expect(item.categorySlug).toBeNull();
    expect(item.categoryLabelEn).toBeNull();
  });
});

/** Straight-line distance, for asserting the cell promise. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
