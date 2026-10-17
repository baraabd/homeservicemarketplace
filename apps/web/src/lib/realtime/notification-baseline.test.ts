import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __clearAllNotificationBaselinesForTests,
  clearNotificationBaseline,
  readNotificationBaseline,
  writeNotificationBaseline,
  __clearPresentationClaimsForTests,
  notificationFingerprint,
  PRESENTATION_CAPACITY,
  PRESENTATION_WINDOW_MS,
  presentNotificationOnce,
} from './notification-baseline';

afterEach(() => {
  __clearAllNotificationBaselinesForTests();
  __clearPresentationClaimsForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('R25 multi-tab presentation coordination (Web Locks contract doubles)', () => {
  function withLocks() {
    let queue = Promise.resolve();
    const request = vi.fn((_key: string, _options: unknown, callback: () => void) => {
      const next = queue.then(callback);
      queue = next.catch(() => undefined);
      return next;
    });
    vi.stubGlobal('navigator', { locks: { request } });
    return request;
  }

  it('arbitrates simultaneous socket and polling candidates into one presentation', async () => {
    withLocks();
    const present = vi.fn();
    await Promise.all(
      Array.from({ length: 12 }, () =>
        presentNotificationOnce({
          userId: 'user-1',
          keys: ['immutable:notification:private-id'],
          present,
        }),
      ),
    );
    expect(present).toHaveBeenCalledTimes(1);
    const raw = localStorage.getItem(
      `hsm:notif-presentation:v1:${notificationFingerprint('user-1')}`,
    )!;
    expect(raw).not.toContain('private-id');
    expect(raw).not.toContain('user-1');
    expect(JSON.parse(raw)).toEqual([
      { key: expect.stringMatching(/^[a-f0-9]{16}$/), at: expect.any(Number) },
    ]);
  });

  it('learns durable aliases even when a paired event was already presented', async () => {
    withLocks();
    const present = vi.fn();
    await presentNotificationOnce({ userId: 'u-1', keys: ['booking:1:complete'], present });
    await presentNotificationOnce({
      userId: 'u-1',
      keys: ['booking:1:complete', 'immutable:notification:1'],
      present,
    });
    await presentNotificationOnce({ userId: 'u-1', keys: ['immutable:notification:1'], present });
    expect(present).toHaveBeenCalledTimes(1);
  });

  it('leaves a hidden tab claim available to a visible tab', async () => {
    withLocks();
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const present = vi.fn();
    await presentNotificationOnce({ userId: 'u-1', keys: ['notification-1'], present });
    expect(present).not.toHaveBeenCalled();
    visible.mockReturnValue('visible');
    await presentNotificationOnce({ userId: 'u-1', keys: ['notification-1'], present });
    expect(present).toHaveBeenCalledTimes(1);
  });

  it('bounds its metadata window and allows a different account to receive its own event', async () => {
    withLocks();
    const present = vi.fn();
    for (let i = 0; i < PRESENTATION_CAPACITY + 5; i += 1) {
      await presentNotificationOnce({ userId: 'u-1', keys: [`notification-${i}`], present });
    }
    const raw = localStorage.getItem(
      `hsm:notif-presentation:v1:${notificationFingerprint('u-1')}`,
    )!;
    expect(JSON.parse(raw)).toHaveLength(PRESENTATION_CAPACITY);
    await presentNotificationOnce({ userId: 'u-2', keys: ['notification-1'], present });
    expect(present).toHaveBeenCalledTimes(PRESENTATION_CAPACITY + 6);
  });

  it('expires only old metadata and suppresses queued presentation after session disposal', async () => {
    withLocks();
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const present = vi.fn();
    await presentNotificationOnce({ userId: 'u-1', keys: ['notification-1'], present });
    now += PRESENTATION_WINDOW_MS - 1;
    await presentNotificationOnce({ userId: 'u-1', keys: ['notification-1'], present });
    expect(present).toHaveBeenCalledTimes(1);
    now += 1;
    await presentNotificationOnce({ userId: 'u-1', keys: ['notification-1'], present });
    expect(present).toHaveBeenCalledTimes(2);
    let active = true;
    const queued = presentNotificationOnce({
      userId: 'u-1',
      keys: ['notification-2'],
      isCurrent: () => active,
      present,
    });
    active = false;
    await queued;
    expect(present).toHaveBeenCalledTimes(2);
  });

  it('keeps the inbox quiet when atomic locking or storage is unavailable', async () => {
    const present = vi.fn();
    vi.stubGlobal('navigator', {});
    await presentNotificationOnce({ userId: 'u-1', keys: ['n-1'], present });
    vi.stubGlobal('navigator', {
      locks: {
        request: () => {
          throw new Error('SecurityError');
        },
      },
    });
    await expect(
      presentNotificationOnce({ userId: 'u-1', keys: ['n-1'], present }),
    ).resolves.toBeUndefined();
    withLocks();
    const write = vi.fn(() => {
      throw new Error('quota');
    });
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue({
      getItem: () => null,
      setItem: write,
      clear: () => undefined,
      length: 0,
    } as unknown as Storage);
    await presentNotificationOnce({ userId: 'u-1', keys: ['n-1'], present });
    expect(write).toHaveBeenCalled();
    expect(present).not.toHaveBeenCalled();
  });

  it('bounds pending work instead of growing a blocked lock queue', async () => {
    const callbacks: Array<() => void> = [];
    const request = vi.fn(
      (_key: string, _options: unknown, callback: () => void) =>
        new Promise<void>((resolve) =>
          callbacks.push(() => {
            callback();
            resolve();
          }),
        ),
    );
    vi.stubGlobal('navigator', { locks: { request } });
    const present = vi.fn();
    const flights = Array.from({ length: 40 }, (_, index) =>
      presentNotificationOnce({
        userId: 'u-1',
        keys: [`notification-${index}`],
        present,
      }),
    );
    expect(request).toHaveBeenCalledTimes(32);
    for (const callback of callbacks) callback();
    await Promise.all(flights);
    expect(present).toHaveBeenCalledTimes(32);
  });
});

describe('notification-baseline', () => {
  it('returns null when nothing has been written', () => {
    expect(readNotificationBaseline('seeker', 'u1')).toBeNull();
  });

  it('round-trips a written cursor', () => {
    writeNotificationBaseline('seeker', 'u1', '2026-05-01T10:00:00Z');
    expect(readNotificationBaseline('seeker', 'u1')?.lastSeenCreatedAt).toBe(
      '2026-05-01T10:00:00Z',
    );
  });

  it('advances but never rewinds the cursor', () => {
    writeNotificationBaseline('seeker', 'u1', '2026-05-02T10:00:00Z');
    writeNotificationBaseline('seeker', 'u1', '2026-05-01T10:00:00Z'); // older — ignored
    expect(readNotificationBaseline('seeker', 'u1')?.lastSeenCreatedAt).toBe(
      '2026-05-02T10:00:00Z',
    );
    writeNotificationBaseline('seeker', 'u1', '2026-05-03T10:00:00Z'); // newer — applied
    expect(readNotificationBaseline('seeker', 'u1')?.lastSeenCreatedAt).toBe(
      '2026-05-03T10:00:00Z',
    );
  });

  it('ignores a null createdAt', () => {
    writeNotificationBaseline('seeker', 'u1', null);
    expect(readNotificationBaseline('seeker', 'u1')).toBeNull();
  });

  it('keys are isolated per experience and per user', () => {
    writeNotificationBaseline('seeker', 'u1', '2026-05-01T10:00:00Z');
    expect(readNotificationBaseline('provider', 'u1')).toBeNull();
    expect(readNotificationBaseline('seeker', 'u2')).toBeNull();
  });

  it('clear removes a single baseline', () => {
    writeNotificationBaseline('seeker', 'u1', '2026-05-01T10:00:00Z');
    clearNotificationBaseline('seeker', 'u1');
    expect(readNotificationBaseline('seeker', 'u1')).toBeNull();
  });
});
