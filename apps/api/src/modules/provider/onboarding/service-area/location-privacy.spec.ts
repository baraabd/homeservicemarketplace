import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  redactForPreview,
  snapToCell,
  type PreviewSourceRow,
} from '../../preview/preview-redaction';

// Sprint 9B.19 — exact location must not leave the building.
//
// The brief treats coordinate or address disclosure in a response, a log, or a
// fixture as a release blocker, so this file is deliberately structural rather
// than behavioural: it asserts things about the SHAPES that can be serialised,
// not about one handler's behaviour on one day. A test that checked a single
// endpoint would pass forever while a new one leaked.
//
// WHAT IS AND IS NOT SENSITIVE HERE
//
// A provider's own coordinates are theirs. `GET /v1/me/provider/*` returning
// them is correct and this file does not object to it. What must never happen
// is those numbers reaching a SEEKER, a preview user, an analytics payload or
// a log line.

const API_SRC = join(__dirname, '..', '..', '..', '..');
const CONTRACTS_SRC = join(API_SRC, '..', '..', '..', 'packages', 'contracts', 'src');

/** Field names that carry an exact position or address. */
const EXACT_LOCATION_FIELDS = [
  'lat',
  'lng',
  'latitude',
  'longitude',
  'serviceAreaLat',
  'serviceAreaLng',
  'workshopLat',
  'workshopLng',
  'workshopAddressLine',
  'addressLine',
  'line1',
  'postcode',
  'postalCode',
];

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('seeker-facing provider shapes carry no location at all', () => {
  // The strongest guarantee available: the seeker's view of a provider has
  // nowhere to PUT a coordinate, so no mapping bug can put one there.
  it('ProviderBidSummary declares no location field', () => {
    const source = read(
      join(CONTRACTS_SRC, 'seeker', 'bids', 'response', 'provider-bid-summary.ts'),
    );

    for (const field of EXACT_LOCATION_FIELDS) {
      expect({ field, present: new RegExp(`\\b${field}\\b\\s*[?]?\\s*:`).test(source) }).toEqual({
        field,
        present: false,
      });
    }
  });

  it('ProviderBidSummary declares no city or area field either', () => {
    // Coarse location is still location. The seeker chooses between bids on
    // reputation; where the provider sleeps is not part of that decision.
    const source = read(
      join(CONTRACTS_SRC, 'seeker', 'bids', 'response', 'provider-bid-summary.ts'),
    );
    expect(/\bserviceAreaCity\b\s*:/.test(source)).toBe(false);
    expect(/\bcityKey\b\s*:/.test(source)).toBe(false);
  });
});

describe('the redacted preview allowlist cannot express an exact position', () => {
  it('PreviewItem has no coordinate field outside the snapped cell', () => {
    const source = read(join(API_SRC, 'modules', 'provider', 'preview', 'preview-redaction.ts'));
    const itemBlock = source.slice(
      source.indexOf('export interface PreviewItem'),
      source.indexOf('export function previewRef'),
    );

    // `area` is the only location, and PreviewArea carries cell centres only.
    expect(itemBlock).toContain('area: PreviewArea');
    for (const field of ['lat:', 'lng:', 'addressLine', 'line1']) {
      expect({ field, present: itemBlock.includes(field) }).toEqual({ field, present: false });
    }
  });

  it('never emits the source coordinates, only the cell centre', () => {
    const row: PreviewSourceRow = {
      id: 'req-1',
      categoryId: 'c-1',
      category: { slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
      scheduleType: 'FLEXIBLE',
      locationCityKey: 'damascus',
      locationLat: 33.513805,
      locationLng: 36.276527,
      createdAt: new Date('2026-08-28T00:00:00Z'),
    };

    const item = redactForPreview(
      row,
      { cellKm: 25, pageSize: 10, maxItems: 30 },
      'salt',
      new Date(),
    );

    expect(item.area.cellLat).not.toBe(row.locationLat);
    expect(item.area.cellLng).not.toBe(row.locationLng);
    // And the serialised payload contains neither number anywhere.
    const wire = JSON.stringify(item);
    expect(wire).not.toContain('33.513805');
    expect(wire).not.toContain('36.276527');
  });

  it('is deterministic, so re-sampling reveals nothing further', () => {
    // The property that makes snapping safe where jitter is not: an attacker
    // who re-requests the same listing converges on nothing.
    const a = snapToCell(33.513805, 36.276527, 25);
    const b = snapToCell(33.513805, 36.276527, 25);
    expect(a).toEqual(b);
  });

  it('maps every point in a cell to the SAME output', () => {
    // Two providers a few hundred metres apart must be indistinguishable.
    const a = snapToCell(33.5, 36.2, 25);
    const b = snapToCell(33.51, 36.21, 25);
    expect(a).toEqual(b);
  });
});

describe('coordinates are not written to logs or analytics', () => {
  const walk = (relative: string) => read(join(API_SRC, relative));

  it('the onboarding wizard never logs a coordinate field', () => {
    // The wizard is where coordinates are WRITTEN, so it is the most likely
    // place for one to end up in a structured log by accident.
    const source = walk(
      join('modules', 'provider', 'onboarding', 'provider-onboarding-wizard.service.ts'),
    );

    const logCalls = source.match(/this\.logger\.[a-z]+\(\{[^}]*\}/gs) ?? [];
    for (const call of logCalls) {
      for (const field of [
        'serviceAreaLat',
        'serviceAreaLng',
        'workshopLat',
        'workshopLng',
        'workshopAddressLine',
      ]) {
        expect({ field, inLog: call.includes(field) }).toEqual({ field, inLog: false });
      }
    }
  });

  it('the analytics read-model selects no coordinate column', () => {
    const source = walk(join('modules', 'admin', 'analytics', 'admin-analytics.service.ts'));
    for (const field of ['serviceAreaLat', 'serviceAreaLng', 'workshopLat', 'workshopLng']) {
      expect({ field, selected: source.includes(field) }).toEqual({ field, selected: false });
    }
  });
});
