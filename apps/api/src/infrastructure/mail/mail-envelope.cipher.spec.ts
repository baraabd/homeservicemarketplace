import { randomBytes } from 'node:crypto';

import { MailEnvelopeCipher, recipientHash } from './mail-envelope.cipher';

// R21 — queued AUTH mail holds a one-time secret until the provider accepts
// it; at rest it is sealed and bound to its row.

const KEY = randomBytes(32).toString('base64');
const env = {
  to: 'ada@example.test',
  vars: { token: 'secret-reset-token-value-0123456789abcdef' },
};

describe('MailEnvelopeCipher', () => {
  it('round-trips and never stores the recipient or secret in clear text', () => {
    const c = MailEnvelopeCipher.fromBase64(KEY);
    const sealed = c.seal('key-1', env);
    expect(sealed.includes(Buffer.from('secret-reset-token'))).toBe(false);
    expect(sealed.includes(Buffer.from('ada@example.test'))).toBe(false);
    expect(c.open('key-1', sealed)).toEqual(env);
  });

  it('binds the ciphertext to its messageKey: copied onto another row it does not open', () => {
    const c = MailEnvelopeCipher.fromBase64(KEY);
    expect(c.open('key-2', c.seal('key-1', env))).toBeNull();
  });

  it('returns null (never throws) for tampering, a wrong key, truncation or an unknown version', () => {
    const c = MailEnvelopeCipher.fromBase64(KEY);
    const sealed = c.seal('k', env);
    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1] = flipped[flipped.length - 1]! ^ 0x01;
    expect(c.open('k', flipped)).toBeNull();
    expect(
      MailEnvelopeCipher.fromBase64(randomBytes(32).toString('base64')).open('k', sealed),
    ).toBeNull();
    expect(c.open('k', sealed.subarray(0, 10))).toBeNull();
    const v2 = Buffer.from(sealed);
    v2[0] = 0x02;
    expect(c.open('k', v2)).toBeNull();
  });

  it('uses a fresh IV per seal', () => {
    const c = MailEnvelopeCipher.fromBase64(KEY);
    expect(c.seal('k', env).equals(c.seal('k', env))).toBe(false);
  });

  it('refuses keys that are not exactly 32 bytes', () => {
    expect(() => MailEnvelopeCipher.fromBase64(randomBytes(16).toString('base64'))).toThrow(
      /32 bytes/,
    );
    expect(() => MailEnvelopeCipher.fromBase64('')).toThrow(/32 bytes/);
  });

  it('derived keys are deterministic per parent secret and differ between secrets', () => {
    const sealed = MailEnvelopeCipher.derived('p'.repeat(48)).seal('k', env);
    expect(MailEnvelopeCipher.derived('p'.repeat(48)).open('k', sealed)).toEqual(env);
    expect(MailEnvelopeCipher.derived('q'.repeat(48)).open('k', sealed)).toBeNull();
  });

  it('recipientHash normalises case and whitespace and is not the address', () => {
    expect(recipientHash(' Ada@Example.TEST ')).toBe(recipientHash('ada@example.test'));
    expect(recipientHash('ada@example.test')).toMatch(/^[0-9a-f]{64}$/);
  });
});
