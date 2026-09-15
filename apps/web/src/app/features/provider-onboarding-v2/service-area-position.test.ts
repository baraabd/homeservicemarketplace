import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestServiceAreaPosition } from './service-area-position';

const originalGeolocation = navigator.geolocation;
let success: PositionCallback;
let failure: PositionErrorCallback | null;
let getCurrentPosition: ReturnType<typeof vi.fn<Geolocation['getCurrentPosition']>>;

beforeEach(() => {
  vi.useFakeTimers();
  getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((resolve, reject) => {
    success = resolve;
    failure = reject ?? null;
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: originalGeolocation,
  });
});

describe('device permission cannot indefinitely block leaving the work-area task', () => {
  it('ends an unanswered permission prompt after 15 seconds and ignores a later native success', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const outcome = requestServiceAreaPosition(new AbortController().signal).then(
      onSuccess,
      onError,
    );
    await vi.advanceTimersByTimeAsync(14999);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(onError).toHaveBeenCalledExactlyOnceWith({ code: 3 });
    success({ coords: { latitude: 33.51, longitude: 36.29 } } as GeolocationPosition);
    await Promise.resolve();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles immediately when the user cancels by editing manually, even without a native callback', async () => {
    const controller = new AbortController();
    const outcome = requestServiceAreaPosition(controller.signal);
    const rejected = expect(outcome).rejects.toEqual({ code: 2 });
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never requests device access for an already cancelled action', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(requestServiceAreaPosition(controller.signal)).rejects.toEqual({ code: 2 });
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves successful coordinates and releases its timeout', async () => {
    const controller = new AbortController();
    const outcome = requestServiceAreaPosition(controller.signal);
    const position = { coords: { latitude: 33.51, longitude: 36.29 } } as GeolocationPosition;
    success(position);
    await expect(outcome).resolves.toBe(position);
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a permission-denied outcome for the manual-entry explanation', async () => {
    const outcome = requestServiceAreaPosition(new AbortController().signal);
    const rejected = expect(outcome).rejects.toEqual({ code: 1 });
    failure!({ code: 1 } as GeolocationPositionError);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
