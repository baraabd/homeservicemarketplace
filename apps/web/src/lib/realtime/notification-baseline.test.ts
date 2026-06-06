import { afterEach, describe, expect, it } from 'vitest';

import {
  __clearAllNotificationBaselinesForTests,
  clearNotificationBaseline,
  readNotificationBaseline,
  writeNotificationBaseline,
} from './notification-baseline';

afterEach(() => {
  __clearAllNotificationBaselinesForTests();
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
