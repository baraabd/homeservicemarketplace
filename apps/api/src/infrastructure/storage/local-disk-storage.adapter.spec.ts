import fsPromises, { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finished } from 'node:stream/promises';

import type { AppConfigService } from '../../config/app-config.service';
import { LocalDiskStorageAdapter, signToken, validateKey } from './local-disk-storage.adapter';
import { makeTestSecret } from '../../../test/support/test-secrets';

// Pure-function + filesystem-level coverage. The HTTP plumbing (PUT
// /v1/media/uploads/* + GET /v1/media/files/*) is covered separately
// by the e2e spec under apps/api/test/e2e/media.e2e.spec.ts.

function makeConfig(over: Record<string, string | undefined> = {}): AppConfigService {
  const defaults: Record<string, string | undefined> = {
    JWT_ACCESS_SECRET: makeTestSecret('media-jwt'),
    PORT: '4000',
    PUBLIC_API_URL: '',
    LOCAL_STORAGE_DIR: '',
    MEDIA_SIGNING_SECRET: '',
  };
  const env = { ...defaults, ...over };
  return {
    get: (k: string) => env[k] as never,
  } as unknown as AppConfigService;
}

describe('signToken (pure)', () => {
  const baseArgs = {
    secret: 's',
    key: 'requests/u1/abc.jpg',
    exp: 1_900_000_000,
    contentType: 'image/jpeg',
    sizeBytes: 1024,
  };

  it('produces a stable hex digest for the same inputs', () => {
    const a = signToken(baseArgs);
    const b = signToken(baseArgs);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when ANY input field changes (no truncation, no field collision)', () => {
    const base = signToken(baseArgs);
    expect(signToken({ ...baseArgs, key: 'requests/u1/abc.jpeg' })).not.toBe(base);
    expect(signToken({ ...baseArgs, exp: baseArgs.exp + 1 })).not.toBe(base);
    expect(signToken({ ...baseArgs, contentType: 'image/png' })).not.toBe(base);
    expect(signToken({ ...baseArgs, sizeBytes: baseArgs.sizeBytes + 1 })).not.toBe(base);
    expect(signToken({ ...baseArgs, secret: 't' })).not.toBe(base);
  });
});

describe('validateKey (pure)', () => {
  it('accepts well-formed keys', () => {
    expect(() => validateKey('requests/u1/abc.jpg')).not.toThrow();
    expect(() => validateKey('a')).not.toThrow();
    expect(() => validateKey('a/b/c-1_2.png')).not.toThrow();
  });

  it('rejects path-traversal attempts (literal `..`)', () => {
    expect(() => validateKey('../etc/passwd')).toThrow();
    expect(() => validateKey('requests/../../../etc/passwd')).toThrow();
    expect(() => validateKey('a/./b')).toThrow();
  });

  it('rejects absolute / null-byte / out-of-charset keys', () => {
    expect(() => validateKey('/etc/passwd')).toThrow();
    expect(() => validateKey('\\windows\\system32')).toThrow();
    expect(() => validateKey('a\0b')).toThrow();
    expect(() => validateKey('a b')).toThrow(); // space disallowed
    expect(() => validateKey('a*b')).toThrow();
  });

  it('rejects empty / non-string / oversized keys', () => {
    expect(() => validateKey('')).toThrow();
    expect(() => validateKey(null as unknown as string)).toThrow();
    expect(() => validateKey('a'.repeat(201))).toThrow();
  });
});

describe('LocalDiskStorageAdapter', () => {
  const ROOT = join(tmpdir(), `hsm-storage-spec-${Date.now()}`);

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(ROOT, { recursive: true, force: true });
  });

  it('presignUpload returns uploadUrl + fileUrl + ISO expiresAt', async () => {
    const adapter = new LocalDiskStorageAdapter(
      makeConfig({ LOCAL_STORAGE_DIR: ROOT, PUBLIC_API_URL: 'http://localhost:4000' }),
    );
    const out = await adapter.presignUpload({
      key: 'requests/u1/abc.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 1024,
    });
    expect(out.uploadUrl).toMatch(
      /^http:\/\/localhost:4000\/v1\/media\/uploads\/requests\/u1\/abc\.jpg\?sig=[0-9a-f]{64}&exp=\d+&ct=image%2Fjpeg&sz=1024$/,
    );
    expect(out.fileUrl).toBe('http://localhost:4000/v1/media/files/requests/u1/abc.jpg');
    expect(new Date(out.expiresAt).toString()).not.toBe('Invalid Date');
  });

  it('acceptUpload writes the body to disk under the configured root', async () => {
    const adapter = new LocalDiskStorageAdapter(
      makeConfig({ LOCAL_STORAGE_DIR: ROOT, PUBLIC_API_URL: 'http://localhost:4000' }),
    );
    await mkdir(ROOT, { recursive: true });

    const presign = await adapter.presignUpload({
      key: 'requests/u1/photo.png',
      contentType: 'image/png',
      sizeBytes: 4,
    });
    const url = new URL(presign.uploadUrl);
    const sig = url.searchParams.get('sig')!;
    const exp = Number(url.searchParams.get('exp'));

    await adapter.acceptUpload({
      key: 'requests/u1/photo.png',
      sig,
      exp,
      contentType: 'image/png',
      sizeBytes: 4,
      body: Buffer.from('PNG!'),
      actualContentType: 'image/png',
    });

    const written = await readFile(join(ROOT, 'requests/u1/photo.png'));
    expect(written.toString()).toBe('PNG!');
  });

  it('refuses replaying a portfolio PUT over previously stored bytes', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    const key = 'portfolio-staging/ref/image.jpg';
    const upload = await adapter.presignUpload({ key, contentType: 'image/jpeg', sizeBytes: 4 });
    const url = new URL(upload.uploadUrl);
    const input = {
      key,
      sig: url.searchParams.get('sig')!,
      exp: Number(url.searchParams.get('exp')),
      contentType: 'image/jpeg',
      sizeBytes: 4,
      body: Buffer.from('OLD!'),
      actualContentType: 'image/jpeg',
    };
    await adapter.acceptUpload(input);
    await expect(
      adapter.acceptUpload({ ...input, body: Buffer.from('NEW!') }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect((await readFile(join(ROOT, key))).toString()).toBe('OLD!');
  });

  it('acceptUpload rejects a tampered signature', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    const presign = await adapter.presignUpload({
      key: 'r/k.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 4,
    });
    const url = new URL(presign.uploadUrl);
    await expect(
      adapter.acceptUpload({
        key: 'r/k.jpg',
        sig: 'a'.repeat(64), // wrong sig
        exp: Number(url.searchParams.get('exp')),
        contentType: 'image/jpeg',
        sizeBytes: 4,
        body: Buffer.from('JPG!'),
        actualContentType: 'image/jpeg',
      }),
    ).rejects.toThrow('signature-mismatch');
  });

  it('acceptUpload rejects an expired token', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    const expired = Math.floor(Date.now() / 1000) - 60;
    const sig = signToken({
      // The SAME secret the adapter is configured with: MEDIA_SIGNING_SECRET
      // is empty here, so it falls back to JWT_ACCESS_SECRET. Signing with a
      // different one would fail this as 'signature-mismatch' and stop it
      // testing expiry at all — which is the test directly above.
      secret: makeTestSecret('media-jwt'),
      key: 'r/k.jpg',
      exp: expired,
      contentType: 'image/jpeg',
      sizeBytes: 4,
    });
    await expect(
      adapter.acceptUpload({
        key: 'r/k.jpg',
        sig,
        exp: expired,
        contentType: 'image/jpeg',
        sizeBytes: 4,
        body: Buffer.from('JPG!'),
        actualContentType: 'image/jpeg',
      }),
    ).rejects.toThrow('expired');
  });

  it('acceptUpload rejects a content-type or size mismatch', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    const presign = await adapter.presignUpload({
      key: 'r/k.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 4,
    });
    const url = new URL(presign.uploadUrl);
    const sig = url.searchParams.get('sig')!;
    const exp = Number(url.searchParams.get('exp'));

    await expect(
      adapter.acceptUpload({
        key: 'r/k.jpg',
        sig,
        exp,
        contentType: 'image/jpeg',
        sizeBytes: 4,
        body: Buffer.from('JPG!'),
        actualContentType: 'application/octet-stream', // wrong header
      }),
    ).rejects.toThrow('content-type-mismatch');

    await expect(
      adapter.acceptUpload({
        key: 'r/k.jpg',
        sig,
        exp,
        contentType: 'image/jpeg',
        sizeBytes: 4,
        body: Buffer.from('TOO-LONG-BODY'),
        actualContentType: 'image/jpeg',
      }),
    ).rejects.toThrow('size-mismatch');
  });

  it('returns no stream when the requested file is absent', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    await expect(adapter.readObjectStream('portfolio-staging/ref/missing.jpg')).resolves.toBeNull();
  });

  it('returns no stream when a parent path is a file', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    await mkdir(ROOT, { recursive: true });
    await writeFile(join(ROOT, 'obstruction'), 'a file, not a directory');
    await expect(adapter.readObjectStream('obstruction/photo.jpg')).resolves.toBeNull();
  });

  it.each(['../escape.jpg', '/outside.jpg', 'invalid\0key.jpg'])(
    'refuses an invalid stream key %s before opening a descriptor',
    async (key) => {
      const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
      const open = jest.spyOn(fsPromises, 'open');
      await expect(adapter.readObjectStream(key)).resolves.toBeNull();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('closes an opened non-file descriptor without returning a stream', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    const handle = {
      stat: jest.fn(async () => ({ isFile: () => false })),
      close: jest.fn(async () => undefined),
      createReadStream: jest.fn(),
    };
    jest
      .spyOn(fsPromises, 'open')
      .mockResolvedValueOnce(handle as unknown as Awaited<ReturnType<typeof fsPromises.open>>);
    await expect(adapter.readObjectStream('portfolio-staging/ref/photo.jpg')).resolves.toBeNull();
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(handle.createReadStream).not.toHaveBeenCalled();
  });

  it.each(['EACCES', 'EIO'])(
    'preserves %s as a dependency failure rather than claiming the image is missing',
    async (code) => {
      const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
      const failure = Object.assign(new Error('storage cannot be read'), { code });
      jest.spyOn(fsPromises, 'open').mockRejectedValueOnce(failure);
      await expect(adapter.readObjectStream('portfolio-staging/ref/photo.jpg')).rejects.toBe(
        failure,
      );
    },
  );

  it('closes the owned descriptor if inspecting it fails, preserving the original failure', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    const failure = Object.assign(new Error('descriptor inspection failed'), { code: 'EIO' });
    const handle = {
      stat: jest.fn(async () => {
        throw failure;
      }),
      close: jest.fn(async () => undefined),
      createReadStream: jest.fn(),
    };
    jest
      .spyOn(fsPromises, 'open')
      .mockResolvedValueOnce(handle as unknown as Awaited<ReturnType<typeof fsPromises.open>>);
    await expect(adapter.readObjectStream('portfolio-staging/ref/photo.jpg')).rejects.toBe(failure);
    expect(handle.close).toHaveBeenCalledTimes(1);
    expect(handle.createReadStream).not.toHaveBeenCalled();
  });

  it('transfers the descriptor to a valid stream that closes after delivering its bytes', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    const key = 'portfolio-staging/ref/photo.jpg';
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    await mkdir(join(ROOT, 'portfolio-staging', 'ref'), { recursive: true });
    await writeFile(adapter.absolutePathForKey(key), bytes);
    const handle = await fsPromises.open(adapter.absolutePathForKey(key), 'r');
    jest.spyOn(fsPromises, 'open').mockResolvedValueOnce(handle);

    const stream = await adapter.readObjectStream(key);
    expect(stream).not.toBeNull();
    expect(handle.fd).toBeGreaterThanOrEqual(0);
    const closed = finished(stream!);
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    await closed;
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(handle.fd).toBe(-1);
    expect(stream?.destroyed).toBe(true);
  });

  // ── Sprint 9B.17 — readObjectHead, the avatar finalize measurement ──────

  it('returns the size and the leading bytes of a stored object', async () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    const key = 'avatars/ref/photo.png';
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    await mkdir(join(ROOT, 'avatars', 'ref'), { recursive: true });
    await writeFile(adapter.absolutePathForKey(key), bytes);

    const head = await adapter.readObjectHead(key, 8);

    // The SIZE is the whole object; the HEAD is only what was asked for.
    // Reading the whole file to look at eight bytes would be a memory lever.
    expect(head).not.toBeNull();
    expect(head!.sizeBytes).toBe(bytes.byteLength);
    expect(Buffer.from(head!.head)).toEqual(bytes.subarray(0, 8));
  });

  it('returns null for a key with nothing behind it', async () => {
    // A dropped PUT. Finalize must refuse rather than link a 404.
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    await expect(adapter.readObjectHead('avatars/ref/missing.png', 8)).resolves.toBeNull();
  });

  it('returns null for a DIRECTORY, which opens happily on POSIX', async () => {
    // Only the fstat on the open handle says what it actually is.
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    await mkdir(join(ROOT, 'avatars', 'adir'), { recursive: true });
    await expect(adapter.readObjectHead('avatars/adir', 8)).resolves.toBeNull();
  });

  it('returns null for an escaping key rather than throwing', async () => {
    // Indistinguishable from "not there": telling a prober which of their
    // guesses was structurally valid is itself an answer.
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    await expect(adapter.readObjectHead('../escape', 8)).resolves.toBeNull();
  });

  it('absolutePathForKey rejects keys that escape the root', () => {
    const adapter = new LocalDiskStorageAdapter(makeConfig({ LOCAL_STORAGE_DIR: ROOT }));
    // validateKey catches `..` segments before path resolution; the
    // throw shape is the same as the post-resolve guard so we don't
    // care which guard fires first — only that one always does.
    expect(() => adapter.absolutePathForKey('../escape')).toThrow();
  });
});
