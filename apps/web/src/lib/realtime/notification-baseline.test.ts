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

  it('pairs sources without collapsing distinct fully identified events and stores only opaque claims', async () => {
    withLocks();
    const present = vi.fn();
    for (const actor of ['actor-a', 'actor-b']) {
      await presentNotificationOnce({
        userId: 'private-user',
        keys: [`transition:${actor}`],
        pairedSource: {
          counterpartKey: 'private-unattributed',
          claimKey: 'private-attributed',
        },
        present,
      });
    }
    expect(present).toHaveBeenCalledTimes(2);
    await presentNotificationOnce({
      userId: 'private-user',
      keys: ['immutable:notification:private-id'],
      pairedSource: {
        counterpartKey: 'private-attributed',
        claimKey: 'private-unattributed',
      },
      present,
    });
    await presentNotificationOnce({
      userId: 'private-user',
      keys: ['immutable:notification:private-id'],
      present,
    });
    expect(present).toHaveBeenCalledTimes(2);
    const raw = localStorage.getItem(
      `hsm:notif-presentation:v1:${notificationFingerprint('private-user')}`,
    )!;
    expect(raw).not.toContain('private');
    expect(raw).not.toContain('actor');
    expect(JSON.parse(raw)).toHaveLength(3);
  });

  it('bounds paired markers and lets their original five-minute claims expire', async () => {
    withLocks();
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const present = vi.fn();
    for (let i = 0; i < PRESENTATION_CAPACITY; i += 1) {
      await presentNotificationOnce({
        userId: 'u-1',
        keys: [`original-${i}`],
        pairedSource: { claimKey: `pair-${i}`, counterpartKey: `counterpart-${i}` },
        present,
      });
    }
    const key = `hsm:notif-presentation:v1:${notificationFingerprint('u-1')}`;
    expect(JSON.parse(localStorage.getItem(key)!)).toHaveLength(PRESENTATION_CAPACITY);
    now += PRESENTATION_WINDOW_MS - 1;
    await presentNotificationOnce({
      userId: 'u-1',
      keys: ['paired-before-expiry'],
      pairedSource: { claimKey: 'counterpart-199', counterpartKey: 'pair-199' },
      present,
    });
    expect(present).toHaveBeenCalledTimes(PRESENTATION_CAPACITY);
    now += 1;
    await presentNotificationOnce({
      userId: 'u-1',
      keys: ['paired-after-expiry'],
      pairedSource: { claimKey: 'counterpart-198', counterpartKey: 'pair-198' },
      present,
    });
    expect(present).toHaveBeenCalledTimes(PRESENTATION_CAPACITY + 1);
  });

  it('does not let a duplicate consume the next event awaiting its counterpart', async () => {
    withLocks();
    const present = vi.fn();
    const attributed = { claimKey: 'attributed', counterpartKey: 'unattributed' };
    const unattributed = { claimKey: 'unattributed', counterpartKey: 'attributed' };
    for (const [id, pairedSource] of [
      ['actor-a', attributed],
      ['rest-a', unattributed],
      ['actor-b', attributed],
      ['rest-a', unattributed],
      ['actor-a', attributed],
      ['rest-b', unattributed],
    ] as const) {
      await presentNotificationOnce({ userId: 'u-1', keys: [id], pairedSource, present });
    }
    expect(present).toHaveBeenCalledTimes(2);
  });

  it('retires only the duplicate counterpart with the same opaque durable identity', async () => {
    withLocks();
    const present = vi.fn();
    const attributed = { claimKey: 'attributed', counterpartKey: 'unattributed' };
    const unattributed = { claimKey: 'unattributed', counterpartKey: 'attributed' };
    await presentNotificationOnce({
      userId: 'u-1',
      keys: ['notification-a'],
      pairedSource: { ...unattributed, identityKey: 'private-notification-a' },
      present,
    });
    await presentNotificationOnce({
      userId: 'u-1',
      keys: ['notification-b'],
      pairedSource: { ...unattributed, identityKey: 'private-notification-b' },
      present,
    });
    // The B replay is unrelated to the retained A marker and cannot retire it.
    await presentNotificationOnce({
      userId: 'u-1',
      keys: ['notification-b', 'actor-b'],
      pairedSource: { ...attributed, identityKey: 'private-notification-b' },
      present,
    });
    const storageKey = `hsm:notif-presentation:v1:${notificationFingerprint('u-1')}`;
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toContainEqual({
      key: notificationFingerprint('unattributed'),
      at: expect.any(Number),
      identity: notificationFingerprint('private-notification-a'),
    });
    await presentNotificationOnce({
      userId: 'u-1',
      keys: ['notification-a', 'actor-a'],
      pairedSource: { ...attributed, identityKey: 'private-notification-a' },
      present,
    });
    await presentNotificationOnce({
      userId: 'u-1',
      keys: ['actor-c'],
      pairedSource: attributed,
      present,
    });
    expect(present).toHaveBeenCalledTimes(3);
    const raw = localStorage.getItem(storageKey)!;
    expect(raw).not.toContain('private');
    expect(raw).not.toContain('notification');
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
