import { createHmac, timingSafeEqual } from 'node:crypto';

// R21 — "generic-hmac-v1" feedback signature.
//
// This is the provider-NEUTRAL contract the feedback endpoint accepts. No
// email service has been selected (infra/production/STAGING.md), so no vendor
// format is implemented: a vendor's native callback (SNS-signed SES
// notifications, a signed event webhook, …) is translated into this contract
// by an adapter once the owner chooses one. Tests exercise it with a
// contract double, labelled as such.
//
//   x-mail-feedback-timestamp: <unix seconds>
//   x-mail-feedback-signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
//
// The timestamp is inside the MAC, so a captured request cannot be re-dated;
// requests outside the tolerance window are refused, and replays inside it
// are absorbed by the (source, externalId) uniqueness on EmailFeedbackEvent.

export const FEEDBACK_SOURCE = 'generic-hmac-v1';
export const SIGNATURE_TOLERANCE_SECONDS = 300;
const FUTURE_SKEW_SECONDS = 60;

export type SignatureVerdict = 'ok' | 'signature' | 'stale';

export function signFeedback(secret: string, timestamp: number, rawBody: Buffer | string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return `v1=${mac}`;
}

export function verifyFeedbackSignature(
  secret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  rawBody: Buffer,
  nowMs: number = Date.now(),
): SignatureVerdict {
  if (!timestampHeader || !signatureHeader || !/^\d{1,12}$/.test(timestampHeader))
    return 'signature';
  const timestamp = Number(timestampHeader);

  // Constant-time compare against every v1 candidate (a sender rotating its
  // secret may send two).
  const expected = Buffer.from(signFeedback(secret, timestamp, rawBody).slice(3), 'hex');
  const candidates = signatureHeader
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('v1=') && /^[0-9a-f]{64}$/.test(p.slice(3)));
  const matched = candidates.some((c) => timingSafeEqual(Buffer.from(c.slice(3), 'hex'), expected));
  if (!matched) return 'signature';

  // Freshness is checked only after authenticity, so an unauthenticated
  // caller learns nothing about the tolerance window.
  const nowSeconds = Math.floor(nowMs / 1000);
  if (timestamp < nowSeconds - SIGNATURE_TOLERANCE_SECONDS) return 'stale';
  if (timestamp > nowSeconds + FUTURE_SKEW_SECONDS) return 'stale';
  return 'ok';
}
