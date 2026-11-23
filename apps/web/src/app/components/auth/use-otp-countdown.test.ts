import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useOtpCountdown } from './use-otp-countdown';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('counts down on the normal clock, clamps at expiry, renews from a new deadline and cleans up', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const { result, rerender, unmount } = renderHook(({ deadline }) => useOtpCountdown(deadline), {
    initialProps: { deadline: Date.now() + 63_000 },
  });
  expect(result.current.label).toBe('01:03');
  act(() => vi.advanceTimersByTime(3_000));
  expect(result.current.label).toBe('01:00');
  act(() => vi.advanceTimersByTime(65_000));
  expect(result.current.label).toBe('00:00');
  expect(result.current.expired).toBe(true);
  rerender({ deadline: Date.now() + 20_000 });
  expect(result.current.label).toBe('00:20');
  expect(result.current.expired).toBe(false);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
