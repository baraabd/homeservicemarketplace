import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestServiceAreaPosition } from './service-area-position';

const original = navigator.geolocation;
afterEach(() => {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: original });
});

describe('S07 device coordinate safety before map/autosave', () => {
  it.each([[Number.NaN, 37], [36, Number.POSITIVE_INFINITY], [91, 37], [-91, 37], [36, 181], [36, -181]])('rejects impossible coordinates %p', async (latitude, longitude) => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: vi.fn((success: PositionCallback) => success({ coords: { latitude, longitude } } as GeolocationPosition)),
    } });
    await expect(requestServiceAreaPosition(new AbortController().signal)).rejects.toEqual({ code: 2 });
  });

  it.each([[0, 0], [90, 180], [-90, -180], [36.2, 37.16]])('preserves finite geographic boundary coordinates %p', async (latitude, longitude) => {
    const position = { coords: { latitude, longitude } } as GeolocationPosition;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: vi.fn((success: PositionCallback) => success(position)),
    } });
    await expect(requestServiceAreaPosition(new AbortController().signal)).resolves.toBe(position);
  });
});
