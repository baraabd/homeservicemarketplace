// K02 — Saudi launch market: registry validity, Riyadh schedule conversion
// at midnight boundaries, and +966 phone normalisation. Hermetic.
import {
  LAUNCH_MARKET,
  isPlausibleE164,
  normalisePhoneNumber,
  todayInZone,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from '@homeservicemarketplace/contracts';
import {
  SAUDI_LAUNCH_MARKET_REGISTRY,
  assertMarketInitAllowed,
} from '@homeservicemarketplace/database';

import {
  marketContainsPoint,
  parseSupportedMarkets,
} from '../../src/modules/provider/onboarding/market/supported-market';

describe('K02 Saudi market registry', () => {
  it('is accepted by the API registry parser exactly as the operator CLI writes it', () => {
    const markets = parseSupportedMarkets(JSON.parse(JSON.stringify(SAUDI_LAUNCH_MARKET_REGISTRY)));
    expect(markets).toHaveLength(1);
    expect(markets[0]).toEqual(
      expect.objectContaining({ countryCode: 'SA', enabled: true, defaultTimezone: 'Asia/Riyadh' }),
    );
    expect(LAUNCH_MARKET).toEqual({
      countryCode: 'SA',
      timeZone: 'Asia/Riyadh',
      dialCode: '+966',
      currency: 'SAR',
    });
  });

  it('contains Saudi cities and excludes points outside the envelope', () => {
    const [sa] = parseSupportedMarkets(JSON.parse(JSON.stringify(SAUDI_LAUNCH_MARKET_REGISTRY)));
    expect(marketContainsPoint(sa!, { lat: 24.7136, lng: 46.6753 })).toBe(true); // Riyadh
    expect(marketContainsPoint(sa!, { lat: 21.4858, lng: 39.1925 })).toBe(true); // Jeddah
    expect(marketContainsPoint(sa!, { lat: 26.4207, lng: 50.0888 })).toBe(true); // Dammam
    expect(marketContainsPoint(sa!, { lat: 33.5138, lng: 36.2765 })).toBe(false); // Damascus
    expect(marketContainsPoint(sa!, { lat: 59.3293, lng: 18.0686 })).toBe(false); // Stockholm
  });

  it('refuses a production run without the explicit operator flag', () => {
    expect(() => assertMarketInitAllowed({ NODE_ENV: 'production' })).toThrow(
      /ALLOW_PROD_MARKET_INIT/,
    );
    expect(() =>
      assertMarketInitAllowed({ NODE_ENV: 'production', ALLOW_PROD_MARKET_INIT: 'true' }),
    ).not.toThrow();
    expect(() => assertMarketInitAllowed({ NODE_ENV: 'development' })).not.toThrow();
  });
});

describe('K02 Riyadh schedule conversion', () => {
  const tz = 'Asia/Riyadh'; // UTC+03:00, no DST

  it('stores a Riyadh wall time as the right UTC instant across midnight', () => {
    expect(zonedWallTimeToUtc('2026-11-04', '00:30', tz)!.toISOString()).toBe(
      '2026-11-03T21:30:00.000Z',
    );
    expect(zonedWallTimeToUtc('2026-11-04', '00:00', tz)!.toISOString()).toBe(
      '2026-11-03T21:00:00.000Z',
    );
    expect(zonedWallTimeToUtc('2026-11-03', '23:59', tz)!.toISOString()).toBe(
      '2026-11-03T20:59:00.000Z',
    );
    expect(zonedWallTimeToUtc('2026-12-31', '23:30', tz)!.toISOString()).toBe(
      '2026-12-31T20:30:00.000Z',
    );
    expect(zonedWallTimeToUtc('2027-01-01', '02:15', tz)!.toISOString()).toBe(
      '2026-12-31T23:15:00.000Z',
    );
  });

  it('round-trips every 15 minutes of a day, independent of the host time zone', () => {
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      const utc = zonedWallTimeToUtc('2026-11-04', time, tz)!;
      expect(utcToZonedWallTime(utc, tz)).toEqual({ date: '2026-11-04', time });
      expect(utcToZonedWallTime(utc.toISOString(), tz)).toEqual({ date: '2026-11-04', time });
    }
  });

  it('computes "today" in Riyadh, not in UTC or the host zone', () => {
    // 22:00 UTC on 3 Nov is 01:00 on 4 Nov in Riyadh.
    expect(todayInZone(tz, new Date('2026-11-03T22:00:00Z'))).toBe('2026-11-04');
    expect(todayInZone(tz, new Date('2026-11-03T20:59:59Z'))).toBe('2026-11-03');
  });

  it('refuses malformed input and wall times that do not exist in a DST zone', () => {
    for (const [date, time] of [
      ['2026-13-01', '10:00'],
      ['2026-02-30', '10:00'],
      ['2026-11-04', '24:00'],
      ['2026-11-04', '9:00'],
      ['04/11/2026', '10:00'],
    ]) {
      expect(zonedWallTimeToUtc(date!, time!, tz)).toBeNull();
    }
    // Generic: 02:30 on the US spring-forward day does not exist in New York.
    expect(zonedWallTimeToUtc('2026-03-08', '02:30', 'America/New_York')).toBeNull();
    expect(zonedWallTimeToUtc('2026-03-08', '03:30', 'America/New_York')!.toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
  });
});

describe('K02 +966 phone normalisation', () => {
  it('normalises the ways Saudi numbers are typed to one E.164 form', () => {
    for (const input of [
      '+966512345678',
      '+966 51 234 5678',
      '+966-51-234-5678',
      '(+966) 51 234 5678',
      '00966512345678',
      '+٩٦٦٥١٢٣٤٥٦٧٨',
      '٠٠٩٦٦٥١٢٣٤٥٦٧٨',
      '\u200e+966 51 234 5678\u200f',
    ]) {
      expect(normalisePhoneNumber(input)).toBe('+966512345678');
      expect(isPlausibleE164(input)).toBe(true);
    }
  });

  it('does not guess a country for a national number', () => {
    expect(isPlausibleE164('0512345678')).toBe(false);
    expect(isPlausibleE164('512345678')).toBe(false);
    expect(isPlausibleE164('+966 5O1234567')).toBe(false); // letter O
  });
});
