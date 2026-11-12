import { apiUploadOrigin, createApiUploadGrant, verifyApiUploadGrant } from './api-upload-grant';
import { signToken } from './local-disk-storage.adapter';
import { envSchema } from '../../config/env.schema';
import { makeTestSecret } from '../../../test/support/test-secrets';

const secret = makeTestSecret('api-upload-capability');
const metadata = {
  key: 'avatars/owner/photo.png',
  contentType: 'image/png' as const,
  sizeBytes: 3,
};
function grant() {
  const signed = createApiUploadGrant(metadata, secret, 'https://api.example.test');
  const q = new URL(signed.uploadUrl).searchParams;
  return {
    ...metadata,
    sig: q.get('sig')!,
    exp: Number(q.get('exp')),
    body: Buffer.from('png'),
    actualContentType: 'image/png',
  };
}

describe('API upload capability', () => {
  it('issues only an API URL and binds every signed field', () => {
    const signed = createApiUploadGrant(metadata, secret, 'https://api.example.test');
    expect(new URL(signed.uploadUrl).origin).toBe('https://api.example.test');
    expect(signed.uploadUrl).not.toContain(secret);
    expect(() => verifyApiUploadGrant(grant(), secret)).not.toThrow();
    for (const change of [
      { key: 'avatars/other/photo.png' },
      { contentType: 'image/jpeg' },
      { sizeBytes: 4 },
      { exp: grant().exp + 1 },
      { sig: '0'.repeat(64) },
      { sig: 'é'.repeat(64) },
    ])
      expect(() => verifyApiUploadGrant({ ...grant(), ...change }, secret)).toThrow();
  });

  it.each([
    'verification/case/file.png',
    '.hsm-storage-root.json',
    'portfolio/ref/image.png',
    'avatars/../file.png',
    'avatars//file.png',
  ])('refuses a forbidden key even with a valid token: %s', (key) => {
    const value = { ...grant(), key };
    value.sig = signToken({ ...value, secret });
    expect(() => verifyApiUploadGrant(value, secret)).toThrow('invalid-key');
  });

  it('rejects expiry, binary size and actual content-type mismatches', () => {
    expect(() => verifyApiUploadGrant({ ...grant(), exp: 1 }, secret)).toThrow('expired');
    expect(() =>
      verifyApiUploadGrant({ ...grant(), body: Buffer.from('changed') }, secret),
    ).toThrow('size-mismatch');
    expect(() => verifyApiUploadGrant({ ...grant(), actualContentType: null }, secret)).toThrow(
      'content-type-mismatch',
    );
    expect(() =>
      verifyApiUploadGrant({ ...grant(), actualContentType: 'text/html' }, secret),
    ).toThrow('content-type-mismatch');
    for (const sizeBytes of [0, -1, 1.5, 10 * 1024 * 1024 + 1])
      expect(() =>
        createApiUploadGrant({ ...metadata, sizeBytes }, secret, 'https://api.example.test'),
      ).toThrow();
  });

  it.each([
    undefined,
    '',
    'ftp://api.test',
    'https://user:pass@api.test',
    'https://api.test/path',
    'https://api.test?x=1',
    ' https://api.test',
    'https://api.test/#token',
  ])('rejects malformed public origin %s', (origin) => {
    expect(() => apiUploadOrigin(origin)).toThrow();
  });

  it('requires HTTPS API origin at production boot only when private transport is selected', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://test:test@localhost/test',
      JWT_ACCESS_SECRET: secret,
      STORAGE_DRIVER: 's3',
    };
    expect(envSchema.safeParse(base).success).toBe(true);
    expect(envSchema.safeParse({ ...base, S3_UPLOAD_TRANSPORT: 'api' }).success).toBe(false);
    expect(
      envSchema.safeParse({
        ...base,
        S3_UPLOAD_TRANSPORT: 'api',
        PUBLIC_API_URL: 'http://api.test',
      }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({
        ...base,
        S3_UPLOAD_TRANSPORT: 'api',
        PUBLIC_API_URL: 'https://api.test',
      }).success,
    ).toBe(true);
  });
});
