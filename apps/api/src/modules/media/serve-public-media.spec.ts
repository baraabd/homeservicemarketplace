import { Readable, Writable } from 'node:stream';
import type { Response } from 'express';
import { servePublicMedia } from './serve-public-media';

function response() {
  const chunks: Buffer[] = [];
  const res = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  const headers = new Map<string, unknown>();
  const wire = Object.assign(res, {
    setHeader: (name: string, value: unknown) => headers.set(name, value),
  });
  return { res: wire as unknown as Response, chunks, headers };
}

describe('public media streaming', () => {
  it('streams exact bytes with revocable non-sniffable response headers', async () => {
    const f = response();
    await servePublicMedia(f.res, {
      stream: Readable.from(Buffer.from('png')),
      contentType: 'image/png',
      sizeBytes: 3,
    });
    expect(Buffer.concat(f.chunks).toString()).toBe('png');
    expect(Object.fromEntries(f.headers)).toMatchObject({
      'Cache-Control': 'private, no-store',
      Pragma: 'no-cache',
      'Content-Type': 'image/png',
      'Content-Length': 3,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
    });
  });

  it.each([2, 4])(
    'closes a length-mismatched stream without leaking another response (expected=%s)',
    async (sizeBytes) => {
      const f = response();
      const stream = Readable.from(Buffer.from('png'));
      await expect(
        servePublicMedia(f.res, { stream, contentType: 'image/png', sizeBytes }),
      ).resolves.toBeUndefined();
      expect(f.res.destroyed).toBe(true);
      expect(stream.destroyed).toBe(true);
      if (sizeBytes === 2) expect(f.chunks).toHaveLength(0);
    },
  );

  it('closes storage and response after a mid-stream fault without throwing raw errors', async () => {
    const f = response();
    const stream = Readable.from(
      (async function* () {
        yield Buffer.from('png');
        throw new Error('secret bucket metadata');
      })(),
    );
    await expect(
      servePublicMedia(f.res, { stream, contentType: 'image/png', sizeBytes: 8 }),
    ).resolves.toBeUndefined();
    expect(f.res.destroyed).toBe(true);
    expect(stream.destroyed).toBe(true);
    expect(Buffer.concat(f.chunks).toString()).not.toContain('secret');
  });

  it('destroys the storage stream when the browser disconnects', async () => {
    const f = response();
    f.res.destroy();
    const stream = new Readable({ read() {} });
    await servePublicMedia(f.res, { stream, contentType: 'image/png', sizeBytes: 8 });
    expect(stream.destroyed).toBe(true);
  });
});
