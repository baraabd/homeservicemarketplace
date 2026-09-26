import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGeocodeAddress } from './reverse-geocode-payload';
import { reverseGeocodeViaNominatim } from './reverse-geocode';

afterEach(() => vi.unstubAllGlobals());

describe('S07 untrusted geocoder response boundary', () => {
  it.each([null, [], 42, true, 'address', {}, { display_name: 12 }, { display_name: {} }, { display_name: '   ' }, { display_name: 'Address', error: 'no match' }])('refuses malformed top-level JSON %p without throwing', (body) => {
    expect(parseGeocodeAddress(body)).toBeNull();
  });

  it('selects the first nonempty string locality, never a numeric/object field', () => {
    expect(parseGeocodeAddress({ display_name: ' Street, City ', address: {
      city: '', town: 37.16, village: { label: 'not a string' }, municipality: ' Aleppo ', country: 7,
    } })).toEqual({ formattedAddress: 'Street, City', city: 'Aleppo', country: '' });
  });

  it.each([null, [], 1, 'unexpected address shape'])('allows a formatted address with no usable component object %p', (address) => {
    expect(parseGeocodeAddress({ display_name: 'Country only', address })).toEqual({
      formattedAddress: 'Country only', city: '', country: '',
    });
  });

  it.each([null, [], { display_name: { label: 'bad' } }])('the real wrapper resolves partial for malformed vendor JSON %p', async (body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    await expect(reverseGeocodeViaNominatim(36.2, 37.16)).resolves.toMatchObject({
      status: 'partial', reason: 'no_match', city: '', country: '', lat: 36.2, lng: 37.16,
    });
  });
});
