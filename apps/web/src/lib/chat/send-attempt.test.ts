import { describe, it, expect } from 'vitest';

import { keyForSend, newIdempotencyKey } from './send-attempt';

describe('keyForSend (R12)', () => {
  const failed = { conversationId: 'c-1', body: 'Is ten good?', idempotencyKey: 'key-failed-0001' };

  it('reuses the key when the unacknowledged message is sent again unchanged', () => {
    expect(keyForSend(failed, 'c-1', 'Is ten good?')).toBe('key-failed-0001');
  });

  it('uses a new key for different text, another conversation, or after an acknowledgement', () => {
    expect(keyForSend(failed, 'c-1', 'Is eleven good?')).not.toBe('key-failed-0001');
    expect(keyForSend(failed, 'c-2', 'Is ten good?')).not.toBe('key-failed-0001');
    expect(keyForSend(null, 'c-1', 'Is ten good?')).not.toBe('key-failed-0001');
  });

  it('makes keys the server accepts (16–128 characters of A-Z a-z 0-9 _ -)', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(newIdempotencyKey()).not.toBe(key);
  });
});
