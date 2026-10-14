import { signFeedback, verifyFeedbackSignature } from './feedback-signature';

// R21 — generic-hmac-v1 feedback authentication. This is the provider-neutral
// contract; vendor formats are not implemented (no service selected).

const SECRET = 's'.repeat(40);
const NOW = 1_800_000_000_000;
const ts = Math.floor(NOW / 1000);
const body = Buffer.from('{"events":[]}');

describe('verifyFeedbackSignature', () => {
  it('accepts an authentic, fresh request', () => {
    expect(
      verifyFeedbackSignature(SECRET, String(ts), signFeedback(SECRET, ts, body), body, NOW),
    ).toBe('ok');
  });

  it('accepts when one of several v1 candidates matches (secret rotation)', () => {
    const header = `v1=${'0'.repeat(64)}, ${signFeedback(SECRET, ts, body)}`;
    expect(verifyFeedbackSignature(SECRET, String(ts), header, body, NOW)).toBe('ok');
  });

  const cases: Array<[string, string | undefined, string | undefined, Buffer]> = [
    ['wrong secret', signFeedback('t'.repeat(40), ts, body), String(ts), body],
    ['tampered body', signFeedback(SECRET, ts, body), String(ts), Buffer.from('{"events":[1]}')],
    ['re-dated timestamp', signFeedback(SECRET, ts, body), String(ts + 1), body],
    ['missing signature', undefined, String(ts), body],
    ['missing timestamp', signFeedback(SECRET, ts, body), undefined, body],
    ['non-numeric timestamp', signFeedback(SECRET, ts, body), '12a', body],
    ['wrong scheme', signFeedback(SECRET, ts, body).replace('v1=', 'v0='), String(ts), body],
    ['short mac', 'v1=abcd', String(ts), body],
  ];
  it.each(cases)('rejects %s as "signature"', (_label, sig, tsHeader, raw) => {
    expect(verifyFeedbackSignature(SECRET, tsHeader, sig, raw, NOW)).toBe('signature');
  });

  it('rejects an authentic but replayed-late request as "stale"', () => {
    const old = ts - 301;
    expect(
      verifyFeedbackSignature(SECRET, String(old), signFeedback(SECRET, old, body), body, NOW),
    ).toBe('stale');
  });

  it('rejects an authentic request dated too far in the future as "stale"', () => {
    const future = ts + 61;
    expect(
      verifyFeedbackSignature(
        SECRET,
        String(future),
        signFeedback(SECRET, future, body),
        body,
        NOW,
      ),
    ).toBe('stale');
  });

  it('does not reveal staleness to an unauthenticated caller', () => {
    const old = ts - 10_000;
    expect(verifyFeedbackSignature(SECRET, String(old), `v1=${'a'.repeat(64)}`, body, NOW)).toBe(
      'signature',
    );
  });
});
