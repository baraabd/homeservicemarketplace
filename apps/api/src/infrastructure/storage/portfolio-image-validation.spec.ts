import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  PORTFOLIO_MAX_DECODE_BYTES,
  PortfolioImageValidationError,
  validateStoredPortfolioImage,
} from './portfolio-image-validation';
import type { StoragePort } from './storage.port';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
import type { AppConfigService } from '../../config/app-config.service';

function stored(bytes: Buffer | null) {
  const stream = bytes ? Readable.from(bytes) : null;
  const readObjectStream = jest.fn(async () => stream);
  return { storage: { readObjectStream } as unknown as StoragePort, readObjectStream, stream };
}
const input = (bytes: Buffer, contentType = 'image/jpeg') => ({
  storageKey: 'portfolio-staging/ref/photo.jpg',
  contentType,
  sizeBytes: bytes.byteLength,
});
const picture = () =>
  sharp({ create: { width: 3, height: 2, channels: 3, background: '#008855' } });

describe('stored portfolio pixels are decoded before attachment or approval', () => {
  it('validates and reopens real persisted bytes through the configured local storage root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hsm-portfolio-decoder-'));
    const values: Record<string, unknown> = {
      LOCAL_STORAGE_DIR: directory,
      JWT_ACCESS_SECRET: 'local-portfolio-fixture-secret',
      PUBLIC_API_URL: 'http://localhost:4000',
    };
    const local = new LocalDiskStorageAdapter({
      get: (key: string) => values[key],
    } as unknown as AppConfigService);
    try {
      const bytes = await picture().png().toBuffer();
      const key = 'portfolio-staging/ref/photo.png';
      const upload = await local.presignUpload({
        key,
        contentType: 'image/png',
        sizeBytes: bytes.byteLength,
      });
      const query = new URL(upload.uploadUrl).searchParams;
      await local.acceptUpload({
        key,
        sig: query.get('sig')!,
        exp: Number(query.get('exp')),
        contentType: 'image/png',
        sizeBytes: bytes.byteLength,
        body: bytes,
        actualContentType: 'image/png',
      });
      await expect(
        validateStoredPortfolioImage(local, { ...input(bytes, 'image/png'), storageKey: key }),
      ).resolves.toBe('image/png');
      const stream = await local.readObjectStream(key);
      expect(stream).not.toBeNull();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(bytes);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each(['jpeg', 'png', 'webp', 'gif'] as const)(
    'accepts a complete valid %s image including legacy GIF',
    async (format) => {
      const bytes = await picture().toFormat(format).toBuffer();
      const fixture = stored(bytes);
      const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
      await expect(validateStoredPortfolioImage(fixture.storage, input(bytes, mime))).resolves.toBe(
        mime,
      );
      expect(fixture.stream?.destroyed).toBe(true);
    },
  );

  it('refuses a file carrying valid JPEG magic but no decodable image', async () => {
    const bytes = Buffer.alloc(128);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    const fixture = stored(bytes);
    await expect(
      validateStoredPortfolioImage(fixture.storage, input(bytes)),
    ).rejects.toBeInstanceOf(PortfolioImageValidationError);
    expect(fixture.stream?.destroyed).toBe(true);
  });

  it.each(['jpeg', 'png', 'webp'] as const)(
    'refuses truncated %s pixel data despite valid magic',
    async (format) => {
      const complete = await picture().toFormat(format).toBuffer();
      const bytes = complete.subarray(0, Math.max(16, Math.floor(complete.byteLength / 2)));
      const fixture = stored(bytes);
      await expect(
        validateStoredPortfolioImage(
          fixture.storage,
          input(bytes, format === 'jpeg' ? 'image/jpeg' : `image/${format}`),
        ),
      ).rejects.toBeInstanceOf(PortfolioImageValidationError);
    },
  );

  it('refuses a different declared format even when its image can be decoded', async () => {
    const bytes = await picture().png().toBuffer();
    await expect(
      validateStoredPortfolioImage(stored(bytes).storage, input(bytes, 'image/jpeg')),
    ).rejects.toBeInstanceOf(PortfolioImageValidationError);
  });

  it('does not open storage for an oversized declared file', async () => {
    const fixture = stored(Buffer.from('unused'));
    await expect(
      validateStoredPortfolioImage(fixture.storage, {
        ...input(Buffer.from('unused')),
        sizeBytes: PORTFOLIO_MAX_DECODE_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(PortfolioImageValidationError);
    expect(fixture.readObjectStream).not.toHaveBeenCalled();
  });

  it('stops an object stream as soon as it exceeds the reserved byte length', async () => {
    const bytes = await picture().jpeg().toBuffer();
    const fixture = stored(Buffer.concat([bytes, Buffer.alloc(100)]));
    await expect(
      validateStoredPortfolioImage(fixture.storage, input(bytes)),
    ).rejects.toBeInstanceOf(PortfolioImageValidationError);
    expect(fixture.stream?.destroyed).toBe(true);
  });

  it('refuses an image whose decoded pixels exceed the bounded review budget', async () => {
    const bytes = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: '#008855' },
    })
      .png()
      .toBuffer();
    await expect(
      validateStoredPortfolioImage(stored(bytes).storage, input(bytes, 'image/png')),
    ).rejects.toBeInstanceOf(PortfolioImageValidationError);
  });

  it('closes a stalled storage stream when its input deadline expires', async () => {
    jest.useFakeTimers();
    const stream = new Readable({ read() {} });
    const storage = { readObjectStream: async () => stream } as unknown as StoragePort;
    try {
      const attempt = validateStoredPortfolioImage(storage, input(Buffer.alloc(128)));
      const rejection = expect(attempt).rejects.toBeInstanceOf(PortfolioImageValidationError);
      await jest.advanceTimersByTimeAsync(5000);
      await rejection;
      expect(stream.destroyed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
