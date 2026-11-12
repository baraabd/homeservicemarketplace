import { timingSafeEqual } from 'node:crypto';
import { signToken, validateKey } from './local-disk-storage.adapter';
import { isAllowedContentType, MAX_BYTES_PER_FILE } from './content-type';
import type { PresignUploadInput, SignedUploadInput } from './storage.port';

const TTL_SECONDS = 300;

/** The existing API upload capability, scoped to public-media namespaces.
 * Identity evidence has a separate authenticated, audited upload lifecycle. */
function validateInput(input: Pick<SignedUploadInput, 'key' | 'contentType' | 'sizeBytes'>): void {
  validateKey(input.key);
  if (!/^(?:avatars|requests|portfolio-staging)\//u.test(input.key)) throw new Error('invalid-key');
  if (!isAllowedContentType(input.contentType)) throw new Error('content-type-mismatch');
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_BYTES_PER_FILE
  )
    throw new Error('size-mismatch');
}

export function apiUploadOrigin(value: string | undefined): string {
  if (!value || value !== value.trim()) throw new Error('API upload origin is required');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('API uploads require an HTTP(S) origin');
  return url.origin;
}

export function createApiUploadGrant(input: PresignUploadInput, secret: string, origin: string) {
  validateInput(input);
  if (!secret) throw new Error('Upload signing secret is required');
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const sig = signToken({ ...input, secret, exp });
  const query = new URLSearchParams({
    sig,
    exp: String(exp),
    ct: input.contentType,
    sz: String(input.sizeBytes),
  });
  return {
    uploadUrl: `${apiUploadOrigin(origin)}/v1/media/uploads/${input.key.split('/').map(encodeURIComponent).join('/')}?${query}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export function verifyApiUploadGrant(input: SignedUploadInput, secret: string): void {
  validateInput(input);
  if (!Number.isSafeInteger(input.exp) || input.exp * 1000 < Date.now()) throw new Error('expired');
  if (!secret || typeof input.sig !== 'string' || !/^[a-f0-9]{64}$/u.test(input.sig))
    throw new Error('signature-mismatch');
  const expected = signToken({ ...input, secret });
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(input.sig, 'hex')))
    throw new Error('signature-mismatch');
  if (input.actualContentType !== input.contentType) throw new Error('content-type-mismatch');
  if (!Buffer.isBuffer(input.body) || input.body.byteLength !== input.sizeBytes)
    throw new Error('size-mismatch');
}
