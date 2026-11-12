import type { Response } from 'express';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { PublicMediaStream } from './public-media-read.service';

export async function servePublicMedia(res: Response, media: PublicMediaStream): Promise<void> {
  if (res.destroyed) {
    media.stream.destroy();
    return;
  }
  // Retirement/deletion is checked on every read. A cached immutable response
  // would bypass that decision long after the owning record was withdrawn.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Type', media.contentType);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Length', media.sizeBytes);
  let count = 0;
  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      count += chunk.length;
      if (count > media.sizeBytes) callback(new Error('Media length mismatch.'));
      else callback(null, chunk);
    },
    flush(callback) {
      callback(count === media.sizeBytes ? null : new Error('Media length mismatch.'));
    },
  });
  try {
    await pipeline(media.stream, bounded, res);
  } catch {
    // pipeline tears down storage on disconnect, and closes incomplete HTTP
    // bodies on read failure. Do not send storage errors or a second response
    // through Nest after the response has been destroyed/headers sent.
    media.stream.destroy();
    if (!res.destroyed) res.destroy();
  }
}
