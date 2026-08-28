import { describe, it, expect } from 'vitest';

import {
  AVATAR_JPEG_QUALITY,
  AVATAR_TARGET_PX,
  ImageProcessingError,
  MAX_SOURCE_BYTES,
  isDecodableImage,
  processAvatarImage,
} from './image-processing';

// Sprint 9B.17 — the client-side image pipeline.
//
// Only the GUARDS are exercised here. The draw path needs a real canvas
// encoder, which the DOM shim does not implement, so it is covered in the
// browser suite instead of being faked into a test that proves nothing.
//
// None of this is validation. It runs in a browser, where anything can be
// replaced, so the server re-reads the stored object regardless — these tests
// pin that a bad pick fails EARLY and locally, not that a bad file is made
// safe.

describe('isDecodableImage', () => {
  it('accepts what a phone gallery actually hands back', () => {
    // HEIC included: it is what an iPhone produces by default, and the canvas
    // re-encode is exactly what turns it into something every browser renders.
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      expect(isDecodableImage({ type })).toBe(true);
    }
  });

  it('refuses what is not an image', () => {
    for (const type of ['video/mp4', 'application/pdf', 'text/html', 'image/svg+xml', '']) {
      expect(isDecodableImage({ type })).toBe(false);
    }
  });
});

describe('processAvatarImage — guards', () => {
  const file = (type: string, size: number) => ({ type, size, name: 'x' }) as unknown as File;

  it('refuses a non-image before attempting to decode', async () => {
    await expect(processAvatarImage(file('video/mp4', 1000))).rejects.toBeInstanceOf(
      ImageProcessingError,
    );
    await expect(processAvatarImage(file('video/mp4', 1000))).rejects.toMatchObject({
      code: 'UNSUPPORTED_TYPE',
    });
  });

  it('refuses an absurdly large source', async () => {
    await expect(
      processAvatarImage(file('image/jpeg', MAX_SOURCE_BYTES + 1)),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('allows a large-but-real phone photo PAST the guard', async () => {
    // A 12 MB camera photo is ordinary, and refusing it would reject the most
    // common input there is.
    //
    // Asserted as "not refused by a guard" rather than as a specific later
    // failure: past the guards this reaches a decoder the DOM shim does not
    // implement, and what that throws is an accident of the environment, not
    // behaviour worth pinning.
    const error = await processAvatarImage(file('image/jpeg', 12 * 1024 * 1024)).catch(
      (err: unknown) => err,
    );
    const code = (error as { code?: string }).code;
    expect(code).not.toBe('TOO_LARGE');
    expect(code).not.toBe('UNSUPPORTED_TYPE');
  });
});

describe('output settings', () => {
  it('targets a square that is sharp on a retina avatar without being wasteful', () => {
    expect(AVATAR_TARGET_PX).toBeGreaterThanOrEqual(256);
    expect(AVATAR_TARGET_PX).toBeLessThanOrEqual(1024);
  });

  it('re-encodes at a quality that does not band skin tones', () => {
    expect(AVATAR_JPEG_QUALITY).toBeGreaterThanOrEqual(0.7);
    expect(AVATAR_JPEG_QUALITY).toBeLessThan(1);
  });

  it('accepts a source far larger than the server ceiling, because it shrinks it', () => {
    // The server refuses stored objects over 5 MB. The client accepts a 25 MB
    // PICK because what it uploads is the re-encoded square, not the original.
    expect(MAX_SOURCE_BYTES).toBeGreaterThan(5 * 1024 * 1024);
  });
});
